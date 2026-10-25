/**
 * Networks, cards and events: Wi-Fi, vCard, MECARD and iCalendar. These are
 * the formats with escaping and folding, so most of what is checked here is
 * what a character with meaning does on the way through.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { addDays, eventType } from '../../src/payload/content/event.js';
import { mecardType } from '../../src/payload/content/mecard.js';
import { vcardType } from '../../src/payload/content/vcard.js';
import { wifiType } from '../../src/payload/content/wifi.js';
import type { PayloadType, PayloadValue } from '../../src/payload/types.js';
import { VALID } from './cases.js';

function refuses(type: PayloadType, text: string): void {
	try {
		type.parse(text);
		expect.unreachable(`${type.id} read ${JSON.stringify(text)}`);
	} catch (error) {
		expect(error, text).toBeInstanceOf(QrStudioError);
		expect((error as QrStudioError).code).toBe('payload/unparseable');
	}
}

const build = (type: PayloadType, change: PayloadValue = {}) =>
	type.build({ ...VALID[type.id], ...change } as never).text;

describe('wifi', () => {
	it('writes the fields in the WPA3 URI order with ZXing escaping', () => {
		expect(build(wifiType, { ssid: 'Cafe; "Main"', password: 'p:a,s\\s1' })).toBe(
			'WIFI:T:WPA;S:Cafe\\; \\"Main\\";P:p\\:a\\,s\\\\s1;;',
		);
		expect(build(wifiType, { security: 'nopass', password: '', hidden: true })).toBe(
			'WIFI:T:nopass;S:Example Network;H:true;;',
		);
		expect(build(wifiType, { security: 'sae', password: 'x' })).toBe(
			'WIFI:T:SAE;S:Example Network;P:x;;',
		);
		expect(build(wifiType, { security: 'wep', password: '0123456789' })).toBe(
			'WIFI:T:WEP;S:Example Network;P:0123456789;;',
		);
	});

	it('writes the enterprise fields', () => {
		const text = build(wifiType, {
			security: 'wpa2-eap',
			eapMethod: 'aka-prime',
			phase2: 'mschapv2',
			identity: 'user;1',
			anonymousIdentity: 'anon',
		});
		expect(text).toBe(
			'WIFI:T:WPA2-EAP;S:Example Network;E:AKA_PRIME;A:anon;I:user\\;1;PH2:MSCHAPV2;P:correct horse;;',
		);
		expect(wifiType.parse(text)).toEqual({
			...VALID.wifi,
			security: 'wpa2-eap',
			eapMethod: 'aka-prime',
			phase2: 'mschapv2',
			identity: 'user;1',
			anonymousIdentity: 'anon',
		});
		expect(build(wifiType, { security: 'wpa2-eap', eapMethod: 'tls' })).toBe(
			'WIFI:T:WPA2-EAP;S:Example Network;E:TLS;P:correct horse;;',
		);
	});

	it('accepts the passphrase forms IEEE 802.11 allows', () => {
		const issues = (change: PayloadValue) =>
			wifiType.validate({ ...VALID.wifi, ...change } as never);
		expect(issues({ password: 'a'.repeat(63) })).toEqual([]);
		expect(issues({ password: 'A'.repeat(64) })).toEqual([]);
		expect(issues({ password: 'g'.repeat(64) }).map((found) => found.code)).toEqual([
			'payload.wifi.issue.wpa-length',
		]);
		expect(issues({ security: 'wep', password: 'abcde' })).toEqual([]);
		expect(issues({ security: 'wep', password: '0123456789abcdef0123456789' })).toEqual([]);
		expect(issues({ security: 'sae', password: 'x' })).toEqual([]);
	});

	it('reads what ZXing and Android read, including their quirks', () => {
		expect(wifiType.parse('WIFI:S:Open;;')).toEqual({
			...VALID.wifi,
			ssid: 'Open',
			security: 'nopass',
			password: '',
		});
		expect(wifiType.parse('wifi:t:wpa2;s:Net;p:pass1234;h:TRUE;;')).toMatchObject({
			security: 'wpa',
			hidden: true,
			password: 'pass1234',
		});
		expect(wifiType.parse('WIFI:T:WPA3;S:Net;P:x;H:false;;')).toMatchObject({
			security: 'sae',
			hidden: false,
		});
		expect(wifiType.parse('WIFI:T:nopass;S:Net;P:ignored;;')).toMatchObject({ password: '' });
		// ZXing up to 4.7.8 wrote the phase 2 method in H:.
		expect(wifiType.parse('WIFI:T:WPA2-EAP;S:Net;E:PEAP;H:MSCHAPV2;P:x;;')).toMatchObject({
			hidden: false,
			phase2: 'mschapv2',
			eapMethod: 'peap',
		});
		expect(wifiType.parse('WIFI:T:WPA2-EAP;S:Net;E:PEAP;PH2:GTC;H:true;;')).toMatchObject({
			hidden: true,
			phase2: 'gtc',
			password: '',
		});
		expect(wifiType.parse('WIFI:T:WPA2-EAP;S:Net;;')).toMatchObject({ eapMethod: '', phase2: '' });
		// An I: outside WPA2-EAP is the WPA3 password identifier, not offered.
		expect(wifiType.parse('WIFI:T:WPA;S:Net;I:id;P:pass1234;;')).toMatchObject({ identity: '' });
		// The first occurrence wins; a piece with no name is skipped.
		expect(wifiType.parse('WIFI:S:First;S:Second;:x;junk;;')).toMatchObject({ ssid: 'First' });
		// Transition Disable without bit 0, or not hexadecimal, leaves WPA as WPA.
		expect(wifiType.parse('WIFI:T:WPA;R:2;S:Net;P:pass1234;;')).toMatchObject({ security: 'wpa' });
		expect(wifiType.parse('WIFI:T:WPA;R:zz;S:Net;P:pass1234;;')).toMatchObject({ security: 'wpa' });
		expect(wifiType.parse('WIFI:T:WPA;R:3;S:Net;P:pass1234;;')).toMatchObject({ security: 'sae' });
		// An unknown T: is kept, so validation can say it is not an option.
		expect(wifiType.parse('WIFI:T:ADB;S:Net;;')).toMatchObject({ security: 'adb' });
	});

	it('refuses a string with no network name', () => {
		refuses(wifiType, 'WIFI:T:WPA;P:x;;');
		refuses(wifiType, 'WIFI:S:;;');
		refuses(wifiType, 'T:WPA;S:Net;;');
		expect(wifiType.detect('WIFI:T:WPA;;')).toBe(0);
	});

	it('warns about a network with no password', () => {
		expect(wifiType.safety?.({ ...VALID.wifi, security: 'nopass', password: '' } as never)).toEqual(
			[{ code: 'payload/open-wifi', severity: 'caution' }],
		);
		expect(wifiType.safety?.(VALID.wifi as never)).toEqual([]);
	});
});

describe('vcard', () => {
	const full = {
		...VALID.vcard,
		prefix: 'Dr',
		givenName: 'Alex',
		additionalNames: 'Sam',
		familyName: 'Example, Jr',
		suffix: 'PhD',
		formattedName: 'Dr Alex Example',
		organisation: 'Example; Pty Ltd',
		department: 'Research',
		title: 'Director',
		mobile: ['+61 400 000 000'],
		workPhone: ['+61290000000'],
		homePhone: ['+61390000000'],
		fax: ['+61290000001'],
		otherPhone: ['+61290000002'],
		email: ['alex@example.com', 'a@example.org'],
		website: ['https://example.com/'],
		street: '1 Example Street',
		locality: 'Sydney',
		region: 'NSW',
		postcode: '2000',
		country: 'Australia',
		addressType: 'home',
		note: 'First line\nSecond, with a comma; and a semicolon \\ and a backslash',
		birthday: '1990-01-31',
	};

	it('writes 3.0 with CRLF, escaping and the derived FN', () => {
		const text = vcardType.build(full as never).text;
		expect(text.split('\r\n')).toEqual([
			'BEGIN:VCARD',
			'VERSION:3.0',
			'N:Example\\, Jr;Alex;Sam;Dr;PhD',
			'FN:Dr Alex Example',
			'ORG:Example\\; Pty Ltd;Research',
			'TITLE:Director',
			'TEL;TYPE=CELL:+61400000000',
			'TEL;TYPE=WORK,VOICE:+61290000000',
			'TEL;TYPE=HOME,VOICE:+61390000000',
			'TEL;TYPE=FAX:+61290000001',
			'TEL;TYPE=VOICE:+61290000002',
			'EMAIL;TYPE=INTERNET:alex@example.com',
			'EMAIL;TYPE=INTERNET:a@example.org',
			'URL:https://example.com/',
			'ADR;TYPE=HOME:;;1 Example Street;Sydney;NSW;2000;Australia',
			'NOTE:First line\\nSecond\\, with a comma\\; and a semicolon \\\\ and a backslash',
			'BDAY:1990-01-31',
			'END:VCARD',
		]);
		expect(vcardType.parse(text)).toEqual({ ...full, mobile: ['+61400000000'] });
	});

	it('makes FN from the organisation for a card with no person, and folds long lines', () => {
		const text = vcardType.build({
			...VALID.vcard,
			givenName: '',
			familyName: '',
			organisation: 'Example',
			department: 'A department with a long name that goes past the seventy-five octet limit',
		} as never).text;
		expect(text).toContain('FN:Example\r\n');
		expect(text).toContain('\r\n ');
		expect(vcardType.parse(text).department).toBe(
			'A department with a long name that goes past the seventy-five octet limit',
		);
		expect(vcardType.build({ ...VALID.vcard, department: 'Unit' } as never).text).toContain(
			'ORG:;Unit',
		);
	});

	it('reads a 4.0 card in the form of RFC 6350 section 8, with synthetic content', () => {
		const card = [
			'\uFEFFBEGIN:VCARD',
			'VERSION:4.0',
			'FN:Example Person',
			'N:Person;Example;;;ing. jr,M.Sc.',
			'BDAY:--0203',
			'ORG;TYPE=work:Example Org;Unit A;Unit B',
			'ADR;TYPE=work:;Suite D2-630;2875 Example Road;',
			' Quebec;QC;G1V 2M2;Canada',
			'ADR;TYPE=home:;;Ignored;;;;',
			'TEL;VALUE=uri;TYPE="work,voice";PREF=1:tel:+1-418-555-0100;ext=102',
			'TEL;VALUE=uri;TYPE="work,cell,voice,video,text":tel:+1-418-555-0101',
			'TEL;TYPE=home:+1-418-555-0102',
			'TEL:+1-418-555-0103',
			'EMAIL;TYPE=work:person@example.com',
			'GEO;TYPE=work:geo:46.772673,-71.282945',
			'URL;TYPE=home:http://example.org',
			'no colon here',
			'END:VCARD',
			'NOTE:after the end',
		].join('\r\n');
		expect(vcardType.parse(card)).toEqual({
			...VALID.vcard,
			prefix: '',
			givenName: 'Example',
			familyName: 'Person',
			suffix: 'ing. jr,M.Sc.',
			// The parts joined would be "Example Person ing. jr,M.Sc.", so FN says something of its own.
			formattedName: 'Example Person',
			organisation: 'Example Org',
			department: 'Unit A Unit B',
			mobile: ['+1-418-555-0101'],
			workPhone: ['+1-418-555-0100'],
			homePhone: ['+1-418-555-0102'],
			otherPhone: ['+1-418-555-0103'],
			email: ['person@example.com'],
			website: ['http://example.org'],
			street: '2875 Example Road',
			locality: 'Quebec',
			region: 'QC',
			postcode: 'G1V 2M2',
			country: 'Canada',
			addressType: 'work',
		});
	});

	it('reads the birthday forms 3.0 and 4.0 allow', () => {
		const bday = (value: string) =>
			vcardType.parse(`BEGIN:VCARD\nVERSION:4.0\nFN:X\nBDAY:${value}\nEND:VCARD`).birthday;
		expect(bday('19900131')).toBe('1990-01-31');
		expect(bday('1990-01-31')).toBe('1990-01-31');
		expect(bday('1990-01-31T00:00:00Z')).toBe('1990-01-31');
		expect(bday('--0131')).toBe('');
	});

	it('reads vCard 2.1 bare types and refuses what is not a card', () => {
		expect(
			vcardType.parse('BEGIN:VCARD\nVERSION:2.1\nN:Example;Alex\nTEL;CELL:+61400000000\nEND:VCARD'),
		).toMatchObject({
			givenName: 'Alex',
			mobile: ['+61400000000'],
		});
		refuses(vcardType, 'VERSION:3.0\nN:Example');
		expect(vcardType.detect('BEGIN:VCARD\r\nVERSION:3.0')).toBe(1);
		expect(vcardType.detect('\uFEFFbegin:vcard')).toBe(1);
		expect(vcardType.detect('BEGIN:VCARDS')).toBe(0);
		expect(vcardType.detect('MECARD:N:x;;')).toBe(0);
	});

	it('writes a work address unless told it is a home one', () => {
		const text = vcardType.build({
			...VALID.vcard,
			street: '1 Example Street',
			addressType: 'work',
		} as never).text;
		expect(text).toContain('ADR;TYPE=WORK:;;1 Example Street;;;;');
	});

	it('analyses the websites on a card', () => {
		expect(
			vcardType.safety?.({ ...VALID.vcard, website: ['http://example.com/'] } as never),
		).toEqual([{ code: 'url/insecure', severity: 'caution' }]);
	});
});

describe('mecard', () => {
	it('writes every field, escaped', () => {
		const text = mecardType.build({
			familyName: 'Example, Jr',
			givenName: 'Alex',
			nickname: 'Al',
			phones: ['+61 400 000 000', '+61290000000'],
			email: ['alex@example.com'],
			url: 'https://example.com/a:b',
			address: '1 Example St; Sydney',
			organisation: 'Example',
			note: 'Back\\slash',
			birthday: '1990-01-31',
		}).text;
		expect(text).toBe(
			'MECARD:N:Example\\, Jr,Alex;NICKNAME:Al;TEL:+61400000000;TEL:+61290000000;EMAIL:alex@example.com;URL:https\\://example.com/a\\:b;ADR:1 Example St\\; Sydney;ORG:Example;NOTE:Back\\\\slash;BDAY:19900131;;',
		);
		expect(mecardType.parse(text)).toMatchObject({
			familyName: 'Example, Jr',
			url: 'https://example.com/a:b',
		});
		expect(
			mecardType.build({ ...VALID.mecard, familyName: '', givenName: 'Alex' } as never).text,
		).toBe('MECARD:N:,Alex;;');
		expect(mecardType.build({ ...VALID.mecard, givenName: '' } as never).text).toBe(
			'MECARD:N:Example;;',
		);
	});

	it('reads leniently and refuses a card with no name', () => {
		expect(mecardType.parse('mecard:N:Example;NOTE:one;NOTE:two;BDAY:1990;junk;;')).toMatchObject({
			familyName: 'Example',
			givenName: '',
			note: 'one',
			birthday: '',
		});
		refuses(mecardType, 'MECARD:TEL:+61400000000;;');
		refuses(mecardType, 'BEGIN:VCARD');
		expect(
			mecardType.safety?.({ ...VALID.mecard, url: 'http://example.com/' } as never),
		).toHaveLength(1);
		expect(mecardType.safety?.(VALID.mecard as never)).toEqual([]);
	});
});

describe('event', () => {
	it('writes UTC, floating and all-day times', () => {
		expect(build(eventType).split('\r\n')).toEqual([
			'BEGIN:VEVENT',
			'SUMMARY:Example event',
			'DTSTART:20261103T090000Z',
			'DTEND:20261103T100000Z',
			'END:VEVENT',
		]);
		expect(build(eventType, { timing: 'floating', start: '2026-11-03T09:00:30', end: '' })).toBe(
			'BEGIN:VEVENT\r\nSUMMARY:Example event\r\nDTSTART:20261103T090030\r\nEND:VEVENT',
		);
		expect(
			build(eventType, {
				timing: 'all-day',
				start: '',
				end: '',
				startDate: '2026-12-31',
				endDate: '2026-12-31',
				location: 'Hall; B',
				description: 'Bring, a pen',
				url: 'https://example.com/event',
			}).split('\r\n'),
		).toEqual([
			'BEGIN:VEVENT',
			'SUMMARY:Example event',
			'DTSTART;VALUE=DATE:20261231',
			'DTEND;VALUE=DATE:20270101',
			'LOCATION:Hall\\; B',
			'DESCRIPTION:Bring\\, a pen',
			'URL:https://example.com/event',
			'END:VEVENT',
		]);
		expect(
			build(eventType, { timing: 'all-day', startDate: '2026-12-31', endDate: '' }),
		).not.toContain('DTEND');
	});

	it('reads an event inside a VCALENDAR, and a zoned time as floating', () => {
		const value = eventType.parse(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'BEGIN:VEVENT',
				'DTSTART;TZID=Australia/Sydney:20261103T090000',
				'DTEND;TZID=Australia/Sydney:20261103T093015',
				'LOCATION:Room 1',
				'DESCRIPTION:Line\\nTwo',
				'URL:https://example.com/',
				'X-NOTHING',
				'END:VEVENT',
				'END:VCALENDAR',
			].join('\n'),
		);
		expect(value).toEqual({
			summary: '',
			timing: 'floating',
			start: '2026-11-03T09:00',
			end: '2026-11-03T09:30:15',
			startDate: '',
			endDate: '',
			location: 'Room 1',
			description: 'Line\nTwo',
			url: 'https://example.com/',
		});
		expect(eventType.detect('BEGIN:VCALENDAR\nBEGIN:VEVENT')).toBe(1);
		expect(eventType.detect('BEGIN:VCALENDAR\nBEGIN:VTODO')).toBe(0);
	});

	it('refuses an event it cannot place in time', () => {
		refuses(eventType, 'BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT');
		refuses(eventType, 'BEGIN:VEVENT\nDTSTART:20261103\nDTEND:20261103T100000Z\nEND:VEVENT');
		refuses(eventType, 'BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261103T100000\nEND:VEVENT');
		refuses(eventType, 'BEGIN:VEVENT\nDTSTART:20261332\nEND:VEVENT');
		refuses(eventType, 'BEGIN:VEVENT\nDTSTART:20261103T250000\nEND:VEVENT');
		refuses(eventType, 'BEGIN:VEVENT\nDTSTART:soon\nEND:VEVENT');
		refuses(eventType, 'SUMMARY:x');
	});

	it('moves dates across months, years and leap days without Date', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
		expect(addDays('2000-03-01', -1)).toBe('2000-02-29');
		for (let day = 0; day < 3000; day += 37) {
			const start = new Date(Date.UTC(1999, 0, 1));
			const expected = new Date(start.getTime() + day * 86400000).toISOString().slice(0, 10);
			expect(addDays('1999-01-01', day)).toBe(expected);
		}
	});

	it('analyses the event link', () => {
		expect(
			eventType.safety?.({ ...VALID.event, url: 'http://example.com/' } as never),
		).toHaveLength(1);
		expect(eventType.safety?.(VALID.event as never)).toEqual([]);
	});
});
