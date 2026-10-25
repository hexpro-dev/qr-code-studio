/**
 * A calendar event: an iCalendar VEVENT (RFC 5545).
 *
 * Written as a bare VEVENT, as ZXing documents it for QR codes (ZXing wiki,
 * "Barcode Contents", calendar events), rather than wrapped in a VCALENDAR
 * with the UID and DTSTAMP an iTIP message needs: phones import the bare
 * component, and DTSTAMP would make the same event a different code every
 * time it was made. A wrapped one is read too.
 *
 * Three kinds of time. UTC (DTSTART:20261103T163000Z) is one instant
 * everywhere, so the view converts the person's local time before it gets
 * here. Floating (no Z) is "9 am wherever you are". All day uses DATE values,
 * and RFC 5545 section 3.6.1 makes DTEND exclusive for those, so an event on
 * the 3rd ends on the 4th; the form takes the last day inclusive and adds one.
 *
 * Text values escape backslash, comma, semicolon and newline (section
 * 3.3.11); lines end in CRLF and fold at 75 octets (section 3.1). A DTSTART
 * with a TZID is read as floating at that wall-clock time, because this type
 * has no time zone database to resolve it with.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { escapeText, foldLine, parseContentLine, unescapeText, unfoldLines } from '../escape.js';
import { isDate, isDateTime, textOf } from '../fields.js';
import { analyseUrl } from '../url-safety.js';

const ID = 'event';

export type EventValue = {
	readonly summary: string;
	readonly timing: string;
	readonly start: string;
	readonly end: string;
	readonly startDate: string;
	readonly endDate: string;
	readonly location: string;
	readonly description: string;
	readonly url: string;
};

/** Days since 1970-01-01 for a proleptic Gregorian date, without Date. */
function dayNumber(year: number, month: number, day: number): number {
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor(y / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

function fromDayNumber(days: number): string {
	const z = days + 719468;
	const era = Math.floor(z / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor(
		(doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
	);
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const month = mp < 10 ? mp + 3 : mp - 9;
	const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A YYYY-MM-DD date moved by some days. */
export function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number) as [number, number, number];
	return fromDayNumber(dayNumber(year, month, day) + days);
}

/**
 * A DURATION value in seconds (RFC 5545 section 3.3.6): weeks, or days with
 * an optional time part. Undefined for anything else, a negative duration
 * included, which belongs to alarms rather than events.
 */
function durationSeconds(text: string): number | undefined {
	const match =
		/^\+?P(?:(\d+)W|(\d+)D(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?|T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/.exec(
			text,
		);
	if (!match) return undefined;
	const [, weeks, days, hours, minutes, secs, onlyHours, onlyMinutes, onlySeconds] = match.map(
		(part) => Number(part ?? 0),
	);
	return (
		(weeks as number) * 604800 +
		(days as number) * 86400 +
		((hours as number) + (onlyHours as number)) * 3600 +
		((minutes as number) + (onlyMinutes as number)) * 60 +
		(secs as number) +
		(onlySeconds as number)
	);
}

/** A 'YYYY-MM-DDTHH:MM[:SS]' time moved by some seconds, written as readTime writes one. */
function addSeconds(value: string, seconds: number): string {
	const [date, time] = value.split('T') as [string, string];
	const [year, month, day] = date.split('-').map(Number) as [number, number, number];
	const [hh, mm, ss = 0] = time.split(':').map(Number) as [number, number, number?];
	const total = dayNumber(year, month, day) * 86400 + hh * 3600 + mm * 60 + ss + seconds;
	const days = Math.floor(total / 86400);
	const rest = total - days * 86400;
	const pad = (n: number) => String(n).padStart(2, '0');
	const s = rest % 60;
	return `${fromDayNumber(days)}T${pad(Math.floor(rest / 3600))}:${pad(Math.floor(rest / 60) % 60)}${s === 0 ? '' : `:${pad(s)}`}`;
}

/** 'YYYY-MM-DDTHH:MM[:SS]' as 'YYYYMMDDTHHMMSS'. */
function icalDateTime(value: string): string {
	const [date, time] = value.split('T') as [string, string];
	const [hh, mm, ss = '00'] = time.split(':');
	return `${date.replace(/-/g, '')}T${hh}${mm}${ss}`;
}

function rules(value: EventValue, flagged: (key: string) => boolean): Issue[] {
	const timing = textOf(value, 'timing');
	const allDay = timing === 'all-day';
	const [startKey, endKey] = allDay ? ['startDate', 'endDate'] : ['start', 'end'];
	const start = textOf(value, startKey);
	const end = textOf(value, endKey);
	if (start === '') return [issue('payload.issue.required', ['fields', startKey])];
	if (end === '' || flagged(startKey) || flagged(endKey)) return [];
	// Both are fixed-width ISO forms, so comparing the text compares the times,
	// once a missing seconds field is read as zero.
	const comparable = (text: string) => (allDay || text.length > 16 ? text : `${text}:00`);
	if (allDay ? end < start : comparable(end) <= comparable(start)) {
		return [issue('payload.event.issue.end-before-start', ['fields', endKey])];
	}
	return [];
}

function write(value: EventValue): string {
	const lines = ['BEGIN:VEVENT', `SUMMARY:${escapeText(textOf(value, 'summary'))}`];
	const timing = textOf(value, 'timing');
	if (timing === 'all-day') {
		lines.push(`DTSTART;VALUE=DATE:${textOf(value, 'startDate').replace(/-/g, '')}`);
		const end = textOf(value, 'endDate');
		if (end !== '') lines.push(`DTEND;VALUE=DATE:${addDays(end, 1).replace(/-/g, '')}`);
	} else {
		const zone = timing === 'utc' ? 'Z' : '';
		lines.push(`DTSTART:${icalDateTime(textOf(value, 'start'))}${zone}`);
		const end = textOf(value, 'end');
		if (end !== '') lines.push(`DTEND:${icalDateTime(end)}${zone}`);
	}
	for (const [key, name] of [
		['location', 'LOCATION'],
		['description', 'DESCRIPTION'],
	] as const) {
		const text = textOf(value, key);
		if (text !== '') lines.push(`${name}:${escapeText(text)}`);
	}
	if (textOf(value, 'url') !== '') lines.push(`URL:${textOf(value, 'url')}`);
	lines.push('END:VEVENT');
	return lines.map(foldLine).join('\r\n');
}

interface ReadTime {
	readonly kind: 'date' | 'utc' | 'floating';
	readonly text: string;
}

/** A DATE or DATE-TIME value, in the form the fields hold. Seconds are left off when they are zero. */
function readTime(raw: string, isDateValue: boolean): ReadTime | undefined {
	const date = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
	if (date) {
		const text = `${date[1]}-${date[2]}-${date[3]}`;
		return isDate(text) ? { kind: 'date', text } : undefined;
	}
	if (isDateValue) return undefined;
	const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(raw);
	if (!time) return undefined;
	const seconds = time[6] === '00' ? '' : `:${time[6]}`;
	const text = `${time[1]}-${time[2]}-${time[3]}T${time[4]}:${time[5]}${seconds}`;
	if (!isDateTime(text)) return undefined;
	return { kind: time[7] === 'Z' ? 'utc' : 'floating', text };
}

function parse(text: string): EventValue {
	const lines = unfoldLines(text);
	const begin = lines.findIndex((line) => /^BEGIN:VEVENT$/i.test(line.trim()));
	if (begin === -1) throw unparseable(ID, 'not-event');
	const found: Record<string, string> = {};
	let start: ReadTime | undefined;
	let end: ReadTime | undefined;
	for (const line of lines.slice(begin + 1)) {
		if (/^END:VEVENT$/i.test(line.trim())) break;
		const content = parseContentLine(line);
		if (content === undefined) continue;
		const isDateValue = (content.params.get('VALUE') ?? []).some((v) => v.toUpperCase() === 'DATE');
		if (content.name === 'DTSTART' || content.name === 'DTEND') {
			const time = readTime(content.value.trim(), isDateValue);
			if (time === undefined) throw unparseable(ID, 'malformed-time');
			if (content.name === 'DTSTART') start = time;
			else end = time;
		} else if (['SUMMARY', 'LOCATION', 'DESCRIPTION'].includes(content.name)) {
			found[content.name] = unescapeText(content.value);
		} else if (content.name === 'URL') {
			found.URL = content.value;
		} else if (content.name === 'DURATION') {
			found.DURATION = content.value.trim();
		}
	}
	if (start === undefined) throw unparseable(ID, 'missing-start');
	const allDay = start.kind === 'date';
	if (end !== undefined && (end.kind === 'date') !== allDay)
		throw unparseable(ID, 'mixed-time-kinds');
	// RFC 5545 allows DURATION in place of DTEND. A duration that cannot be
	// read leaves the event without an end rather than refusing it.
	const seconds = found.DURATION === undefined ? undefined : durationSeconds(found.DURATION);
	if (end === undefined && seconds !== undefined) {
		end = allDay
			? { kind: 'date', text: addDays(start.text, Math.floor(seconds / 86400)) }
			: { kind: start.kind, text: addSeconds(start.text, seconds) };
	}
	// An all-day DTEND is the day after the last one. One that is not after
	// DTSTART breaks the rule but is common, and every calendar shows it as a
	// one-day event, so it is read as one.
	if (allDay && end !== undefined && end.text <= start.text) end = undefined;
	return {
		summary: found.SUMMARY ?? '',
		timing: allDay ? 'all-day' : start.kind,
		start: allDay ? '' : start.text,
		end: allDay || end === undefined ? '' : end.text,
		startDate: allDay ? start.text : '',
		endDate: allDay && end !== undefined ? addDays(end.text, -1) : '',
		location: found.LOCATION ?? '',
		description: found.DESCRIPTION ?? '',
		url: found.URL ?? '',
	};
}

export const eventType = definePayload<EventValue>({
	id: ID,
	category: 'event',
	fields: [
		field(ID, 'summary', 'text', { required: true, maxLength: 200 }),
		field(ID, 'timing', 'select', {
			required: true,
			options: ['utc', 'floating', 'all-day'],
			default: 'utc',
			hint: true,
		}),
		field(ID, 'start', 'datetime', { group: 'time' }),
		field(ID, 'end', 'datetime', { group: 'time' }),
		field(ID, 'startDate', 'date', { group: 'time' }),
		field(ID, 'endDate', 'date', { group: 'time', hint: true }),
		field(ID, 'location', 'text', { maxLength: 300 }),
		field(ID, 'description', 'multiline', { maxLength: 2000 }),
		field(ID, 'url', 'url'),
	],
	rules,
	write,
	detect: (text) =>
		/^BEGIN:(?:VEVENT|VCALENDAR)\s*$/im.test(text) && /^BEGIN:VEVENT\s*$/im.test(text) ? 1 : 0,
	parse,
	safety: (value) => (textOf(value, 'url') === '' ? [] : analyseUrl(textOf(value, 'url')).findings),
});
