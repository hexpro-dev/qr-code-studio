/**
 * Every word the page shows comes from the English catalogue, by key.
 *
 * The library never hands over a sentence, only a key and its parameters, so
 * the same catalogue explains a refusal from the studio, an issue on a field
 * and a label of the application's own. The application's keys start `app.`
 * and live in src/messages/en/app.ts, outside what the website mirrors.
 */

import type { Issue } from '../core/issue.js';
import { message } from '../messages/en/index.js';
import type { StudioError } from '../studio/index.js';

export function t(key: string, params: Readonly<Record<string, number | string>> = {}): string {
	return message(key, params);
}

export function issueText(found: Issue): string {
	return message(found.code, found.params ?? {});
}

export function errorText(error: StudioError): string {
	return message(error.messageKey, error.params);
}

const ONE_PLACE = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const TWO_PLACES = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });

/** A measurement as a person reads it: at most one decimal place. */
export function num(value: number): string {
	return ONE_PLACE.format(value);
}

export function whole(value: number): string {
	return WHOLE.format(value);
}

export function fine(value: number): string {
	return TWO_PLACES.format(value);
}

const PERCENT = new Intl.NumberFormat('en-AU', { style: 'percent', maximumFractionDigits: 0 });
const DEGREES = new Intl.NumberFormat('en-AU', {
	style: 'unit',
	unit: 'degree',
	unitDisplay: 'long',
	maximumFractionDigits: 0,
});

/** A fraction from 0 to 1 as a percentage. */
export function percent(fraction: number): string {
	return PERCENT.format(fraction);
}

export function degrees(value: number): string {
	return DEGREES.format(value);
}

const WHEN = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

export function when(ms: number): string {
	return WHEN.format(new Date(ms));
}
