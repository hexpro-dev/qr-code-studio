/**
 * A contact card: vCard, written as 3.0 (RFC 2426) and read as 3.0 or 4.0
 * (RFC 6350), and as 2.1 well enough to recover names and numbers,
 * including the quoted-printable values 2.1 writes for anything not ASCII.
 *
 * 3.0 is written rather than 4.0 because it is what the phone address books
 * import most reliably from a scan; 4.0 changed TYPE values to lower case and
 * TEL to a URI, and older readers drop what they do not recognise.
 *
 * Lines end in CRLF and are folded at 75 octets (RFC 2425 section 5.8.1, which
 * RFC 2426 uses). Text values escape backslash, comma, semicolon and newline.
 * FN is required in 3.0, so when the formatted name is left empty it is made
 * from the name parts, or from the organisation for a card with no person.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import {
	escapeText,
	foldLine,
	parseContentLine,
	splitCompound,
	unescapeText,
	unfoldLines,
} from '../escape.js';
import { compactTel, listOf, textOf } from '../fields.js';
import type { FieldSchema } from '../types.js';
import { analyseUrl } from '../url-safety.js';

const ID = 'vcard';

export type VcardValue = {
	readonly prefix: string;
	readonly givenName: string;
	readonly additionalNames: string;
	readonly familyName: string;
	readonly suffix: string;
	readonly formattedName: string;
	readonly organisation: string;
	readonly department: string;
	readonly title: string;
	readonly mobile: readonly string[];
	readonly workPhone: readonly string[];
	readonly homePhone: readonly string[];
	readonly fax: readonly string[];
	readonly otherPhone: readonly string[];
	readonly email: readonly string[];
	readonly website: readonly string[];
	readonly street: string;
	readonly locality: string;
	readonly region: string;
	readonly postcode: string;
	readonly country: string;
	readonly addressType: string;
	readonly note: string;
	readonly birthday: string;
};

const NAME_PARTS = ['prefix', 'givenName', 'additionalNames', 'familyName', 'suffix'] as const;
const ADDRESS_PARTS = ['street', 'locality', 'region', 'postcode', 'country'] as const;

/** Each phone field and the TYPE values it is written with. */
const PHONES = [
	['mobile', 'CELL'],
	['workPhone', 'WORK,VOICE'],
	['homePhone', 'HOME,VOICE'],
	['fax', 'FAX'],
	['otherPhone', 'VOICE'],
] as const;

function derivedName(value: VcardValue): string {
	const parts = NAME_PARTS.map((key) => textOf(value, key)).filter((part) => part !== '');
	return parts.length > 0 ? parts.join(' ') : textOf(value, 'organisation');
}

function rules(value: VcardValue): Issue[] {
	if (derivedName(value) !== '' || textOf(value, 'formattedName') !== '') return [];
	return [issue('payload.vcard.issue.no-name', ['fields', 'givenName'])];
}

function write(value: VcardValue): string {
	const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
	const text = (key: string) => escapeText(textOf(value, key));
	lines.push(
		`N:${[text('familyName'), text('givenName'), text('additionalNames'), text('prefix'), text('suffix')].join(';')}`,
	);
	const formatted = textOf(value, 'formattedName');
	lines.push(`FN:${escapeText(formatted === '' ? derivedName(value) : formatted)}`);
	if (textOf(value, 'organisation') !== '' || textOf(value, 'department') !== '') {
		lines.push(
			`ORG:${text('organisation')}${textOf(value, 'department') === '' ? '' : `;${text('department')}`}`,
		);
	}
	if (textOf(value, 'title') !== '') lines.push(`TITLE:${text('title')}`);
	for (const [key, types] of PHONES) {
		for (const number of listOf(value, key)) lines.push(`TEL;TYPE=${types}:${compactTel(number)}`);
	}
	for (const address of listOf(value, 'email')) lines.push(`EMAIL;TYPE=INTERNET:${address}`);
	for (const url of listOf(value, 'website')) lines.push(`URL:${url}`);
	if (ADDRESS_PARTS.some((key) => textOf(value, key) !== '')) {
		const type = textOf(value, 'addressType') === 'home' ? 'HOME' : 'WORK';
		lines.push(`ADR;TYPE=${type}:;;${ADDRESS_PARTS.map(text).join(';')}`);
	}
	if (textOf(value, 'note') !== '') lines.push(`NOTE:${text('note')}`);
	if (textOf(value, 'birthday') !== '') lines.push(`BDAY:${textOf(value, 'birthday')}`);
	lines.push('END:VCARD');
	return lines.map(foldLine).join('\r\n');
}

/**
 * windows-1252's 0x80 to 0x9F, which is what WHATWG and so every browser
 * decodes for the label ISO-8859-1. Node's TextDecoder gives C1 controls for
 * the same bytes, so the table is here to make every engine agree.
 */
const WINDOWS_1252_HIGH = [
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
	0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
	0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function decodeBytes(bytes: Uint8Array, charset: string): string {
	if (/^(?:iso-8859-1|latin1|windows-1252|cp1252|us-ascii|ascii)$/i.test(charset)) {
		let out = '';
		for (const byte of bytes) {
			out += String.fromCharCode(
				byte >= 0x80 && byte < 0xa0 ? (WINDOWS_1252_HIGH[byte - 0x80] as number) : byte,
			);
		}
		return out;
	}
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder(charset);
	} catch {
		decoder = new TextDecoder('utf-8');
	}
	return decoder.decode(bytes);
}

/**
 * Quoted-printable (RFC 2045 section 6.7), as vCard 2.1 writes names and
 * notes that are not ASCII: "=C3=89" is the two UTF-8 bytes of a capital E
 * with an acute accent.
 * The charset comes from the CHARSET parameter; an unknown one is read as
 * UTF-8.
 */
function decodeQuotedPrintable(text: string, charset: string): string {
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	for (let i = 0; i < text.length;) {
		const hex = text.slice(i + 1, i + 3);
		if (text[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
			bytes.push(Number.parseInt(hex, 16));
			i += 3;
		} else {
			// A character the writer left unencoded, taken whole so that a
			// character outside the BMP keeps both halves.
			const char = String.fromCodePoint(text.codePointAt(i) as number);
			bytes.push(...encoder.encode(char));
			i += char.length;
		}
	}
	return decodeBytes(Uint8Array.from(bytes), charset);
}

/** A birthday as YYYY-MM-DD, from the forms 3.0 and 4.0 allow; '' for one with no year. */
function readDate(raw: string): string {
	const match = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(raw.trim());
	return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function phoneKey(types: readonly string[]): string {
	const upper = types.flatMap((type) => type.toUpperCase().split(','));
	if (upper.includes('FAX')) return 'fax';
	if (upper.includes('CELL')) return 'mobile';
	if (upper.includes('WORK')) return 'workPhone';
	if (upper.includes('HOME')) return 'homePhone';
	return 'otherPhone';
}

function parse(text: string): VcardValue {
	const lines = unfoldLines(text.replace(/^\uFEFF/, ''));
	const begin = lines.findIndex((line) => /^BEGIN:VCARD$/i.test(line.trim()));
	if (begin === -1) throw unparseable(ID, 'not-vcard');
	const out: Record<string, string> = {};
	const lists: Record<string, string[]> = {
		mobile: [],
		workPhone: [],
		homePhone: [],
		fax: [],
		otherPhone: [],
		email: [],
		website: [],
	};
	let formatted = '';
	let address = false;
	for (let i = begin + 1; i < lines.length; i += 1) {
		const line = lines[i] as string;
		if (/^END:VCARD$/i.test(line.trim())) break;
		const content = parseContentLine(line);
		if (content === undefined) continue;
		const types = content.params.get('TYPE') ?? [];
		let value = content.value;
		if (
			[...(content.params.get('ENCODING') ?? []), ...types].some((v) =>
				/^quoted-printable$/i.test(v),
			)
		) {
			// A soft line break is "=" at the end of a line (RFC 2045 section
			// 6.7), and the next line carries on with no leading space.
			while (value.endsWith('=') && i + 1 < lines.length) {
				i += 1;
				value = `${value.slice(0, -1)}${lines[i] as string}`;
			}
			value = decodeQuotedPrintable(value, content.params.get('CHARSET')?.[0] ?? 'utf-8');
		}
		switch (content.name) {
			case 'N': {
				const [family = '', given = '', additional = '', prefix = '', suffix = ''] =
					splitCompound(value);
				Object.assign(out, {
					familyName: family,
					givenName: given,
					additionalNames: additional,
					prefix,
					suffix,
				});
				break;
			}
			case 'FN':
				formatted = unescapeText(value);
				break;
			case 'ORG': {
				const [organisation = '', ...units] = splitCompound(value);
				Object.assign(out, { organisation, department: units.join(' ') });
				break;
			}
			case 'TITLE':
			case 'NOTE':
				out[content.name === 'TITLE' ? 'title' : 'note'] = unescapeText(value);
				break;
			case 'TEL':
				(lists[phoneKey(types)] as string[]).push(
					value.replace(/^tel:/i, '').split(';')[0] as string,
				);
				break;
			case 'EMAIL':
				lists.email?.push(value);
				break;
			case 'URL':
				lists.website?.push(value);
				break;
			case 'ADR': {
				if (address) break;
				address = true;
				const [, , street = '', locality = '', region = '', postcode = '', country = ''] =
					splitCompound(value);
				Object.assign(out, { street, locality, region, postcode, country });
				out.addressType = types.some((type) => /home/i.test(type)) ? 'home' : 'work';
				break;
			}
			case 'BDAY':
				out.birthday = readDate(value);
				break;
			default:
				break;
		}
	}
	const get = (key: string) => out[key] ?? '';
	const value = {
		prefix: get('prefix'),
		givenName: get('givenName'),
		additionalNames: get('additionalNames'),
		familyName: get('familyName'),
		suffix: get('suffix'),
		formattedName: '',
		organisation: get('organisation'),
		department: get('department'),
		title: get('title'),
		mobile: lists.mobile as string[],
		workPhone: lists.workPhone as string[],
		homePhone: lists.homePhone as string[],
		fax: lists.fax as string[],
		otherPhone: lists.otherPhone as string[],
		email: lists.email as string[],
		website: lists.website as string[],
		street: get('street'),
		locality: get('locality'),
		region: get('region'),
		postcode: get('postcode'),
		country: get('country'),
		addressType: get('addressType') || 'work',
		note: get('note'),
		birthday: get('birthday'),
	};
	// A formatted name that is only the parts joined together carries nothing
	// the parts do not, and leaving it empty keeps it in step if they change.
	return { ...value, formattedName: formatted === derivedName(value) ? '' : formatted };
}

const name = (key: string): FieldSchema =>
	field(ID, key, 'text', { maxLength: 100, group: 'name' });
const phones = (key: string, advanced = false): FieldSchema =>
	field(ID, key, 'tel', {
		multiple: true,
		maxItems: 10,
		group: 'phones',
		...(advanced ? { advanced } : {}),
	});
const address = (key: string): FieldSchema =>
	field(ID, key, 'text', { maxLength: 100, group: 'address' });

export const vcardType = definePayload<VcardValue>({
	id: ID,
	category: 'contact',
	fields: [
		name('prefix'),
		name('givenName'),
		name('additionalNames'),
		name('familyName'),
		name('suffix'),
		field(ID, 'formattedName', 'text', { maxLength: 200, advanced: true, hint: true }),
		field(ID, 'organisation', 'text', { maxLength: 200 }),
		field(ID, 'department', 'text', { maxLength: 200, advanced: true }),
		field(ID, 'title', 'text', { maxLength: 200 }),
		phones('mobile'),
		phones('workPhone'),
		phones('homePhone'),
		phones('fax', true),
		phones('otherPhone', true),
		field(ID, 'email', 'email', { multiple: true, maxItems: 10 }),
		field(ID, 'website', 'url', { multiple: true, maxItems: 10 }),
		address('street'),
		address('locality'),
		address('region'),
		address('postcode'),
		address('country'),
		field(ID, 'addressType', 'select', {
			options: ['work', 'home'],
			default: 'work',
			group: 'address',
		}),
		field(ID, 'note', 'multiline', { maxLength: 1000 }),
		field(ID, 'birthday', 'date'),
	],
	rules,
	write,
	detect: (text) => (/^\uFEFF?BEGIN:VCARD[ \t]*(?:\r?\n|$)/i.test(text) ? 1 : 0),
	parse,
	safety: (value) => listOf(value, 'website').flatMap((url) => analyseUrl(url).findings),
	vectors: [
		{
			text: [
				'BEGIN:VCARD',
				'VERSION:3.0',
				'N:Example;Alex;;;',
				'FN:Alex Example',
				'ORG:Example Pty Ltd',
				'TEL;TYPE=CELL:+61400000000',
				'EMAIL;TYPE=INTERNET:alex@example.com',
				'END:VCARD',
			].join('\r\n'),
			value: {
				prefix: '',
				givenName: 'Alex',
				additionalNames: '',
				familyName: 'Example',
				suffix: '',
				formattedName: '',
				organisation: 'Example Pty Ltd',
				department: '',
				title: '',
				mobile: ['+61400000000'],
				workPhone: [],
				homePhone: [],
				fax: [],
				otherPhone: [],
				email: ['alex@example.com'],
				website: [],
				street: '',
				locality: '',
				region: '',
				postcode: '',
				country: '',
				addressType: 'work',
				note: '',
				birthday: '',
			},
			source:
				'RFC 2426 sections 3.1.1, 3.1.2, 3.3.1, 3.3.2 and 3.5.5 (FN, N, TEL, EMAIL, ORG); synthetic content.',
		},
	],
});
