/**
 * EMVCo merchant-presented QR (MPM): the tag, length, value format that
 * Brazil's Pix, Singapore's PayNow, Thailand's PromptPay, Malaysia's DuitNow
 * and others all share.
 *
 * Each data object is a two-digit ID, a two-digit length and the value. Some
 * IDs hold templates whose value is more data objects in the same format. The
 * last object is always 63, a CRC-16/CCITT-FALSE over everything before it
 * including the "6304" that introduces it, written as four upper-case hex
 * digits (EMVCo MPM specification, section 4.7.3; BCB Manual BR Code).
 *
 * Lengths count characters. The specification's character set is printable
 * ASCII, where characters and bytes are the same thing; a value outside it is
 * reported by the content type, and the CRC is taken over UTF-8 bytes, which
 * is what every Pix reader that accepts such a value does.
 */

import { crc16CcittFalse } from './check-digits.js';

export interface EmvObject {
	readonly id: string;
	readonly value: string;
}

/** Why a string is not an MPM payload. */
export type EmvFailure = 'format' | 'crc';

/** One data object as text. Throws TypeError for a value longer than 99 characters or an ID that is not two digits. */
export function emvObject(id: string, value: string): string {
	if (!/^\d{2}$/.test(id)) throw new TypeError('An EMV data object ID is two digits.');
	const length = [...value].length;
	if (length > 99) throw new TypeError('An EMV data object holds at most 99 characters.');
	return `${id}${String(length).padStart(2, '0')}${value}`;
}

export function emvCrc(text: string): string {
	return crc16CcittFalse(new TextEncoder().encode(text))
		.toString(16)
		.toUpperCase()
		.padStart(4, '0');
}

/** A whole payload: the objects in order, then 63 with its CRC. */
export function writeEmv(objects: readonly EmvObject[]): string {
	const body = `${objects.map(({ id, value }) => emvObject(id, value)).join('')}6304`;
	return `${body}${emvCrc(body)}`;
}

/** Read a run of data objects, as the top level or a template's value holds them. */
export function readEmvObjects(text: string): EmvObject[] | undefined {
	const chars = [...text];
	const objects: EmvObject[] = [];
	let i = 0;
	while (i < chars.length) {
		const id = chars.slice(i, i + 2).join('');
		const lengthText = chars.slice(i + 2, i + 4).join('');
		if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText)) return undefined;
		const length = Number(lengthText);
		if (i + 4 + length > chars.length) return undefined;
		objects.push({ id, value: chars.slice(i + 4, i + 4 + length).join('') });
		i += 4 + length;
	}
	return objects;
}

/**
 * Read a whole payload and check its CRC. The CRC object must come last and
 * the payload format indicator (00, "01") first, as the specification fixes.
 */
export function readEmv(
	text: string,
):
	| { readonly ok: true; readonly value: readonly EmvObject[] }
	| { readonly ok: false; readonly reason: EmvFailure } {
	const objects = readEmvObjects(text);
	const last = objects?.[objects.length - 1];
	if (objects === undefined || last === undefined || last.id !== '63' || objects[0]?.id !== '00') {
		return { ok: false, reason: 'format' };
	}
	if (objects[0].value !== '01' || !/^[0-9A-Fa-f]{4}$/.test(last.value))
		return { ok: false, reason: 'format' };
	const body = text.slice(0, text.length - 4);
	if (emvCrc(body) !== last.value.toUpperCase()) return { ok: false, reason: 'crc' };
	return { ok: true, value: objects.slice(0, -1) };
}
