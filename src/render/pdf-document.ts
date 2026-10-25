/**
 * A PDF file's objects, and the file around them.
 *
 * Objects are numbered as they are created and written in number order, each
 * an indirect object, followed by a classic cross-reference table and a
 * trailer. A cross-reference stream would be smaller, but the table is
 * readable by every reader there is, and by a test that parses it back.
 *
 * Nothing here reads a clock. The Info dictionary has a title and a producer
 * and no dates, and the file identifier is the SHA-256 of the file's body, so
 * the same pages give the same bytes every time.
 */

import { zlibWrap } from '../core/deflate.js';
import { sha256 } from './pdf-hash.js';

const encoder = new TextEncoder();

/** What the writers call this package in a file's Info dictionary. */
export const PRODUCER = 'Hex Pro QR Code Studio';

export class PdfDocument {
	private readonly bodies: (Uint8Array | null)[] = [];
	private readonly shared = new Map<string, number>();

	/** A number for an object to be written later. */
	reserve(): number {
		this.bodies.push(null);
		return this.bodies.length;
	}

	/** Write a dictionary or other object in full. */
	set(id: number, text: string): void {
		this.bodies[id - 1] = encoder.encode(text);
	}

	add(text: string): number {
		const id = this.reserve();
		this.set(id, text);
		return id;
	}

	/**
	 * The same object for the same text: an ExtGState with one opacity is
	 * written once however many shapes use it.
	 */
	addShared(text: string): number {
		const known = this.shared.get(text);
		if (known !== undefined) return known;
		const id = this.add(text);
		this.shared.set(text, id);
		return id;
	}

	/**
	 * A stream. `entries` is the inside of its dictionary without the length;
	 * the data is compressed with this package's deflate, which is the same in
	 * every engine, unless it is already.
	 */
	stream(id: number, entries: string, data: Uint8Array): void {
		const packed = zlibWrap(data, { level: 6 });
		const head = encoder.encode(
			`<< ${entries}${entries.length > 0 ? ' ' : ''}/Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
		);
		const tail = encoder.encode('\nendstream');
		const body = new Uint8Array(head.length + packed.length + tail.length);
		body.set(head);
		body.set(packed, head.length);
		body.set(tail, head.length + packed.length);
		this.bodies[id - 1] = body;
	}

	addStream(entries: string, data: Uint8Array): number {
		const id = this.reserve();
		this.stream(id, entries, data);
		return id;
	}

	/** The whole file. Every reserved number must have been written. */
	finish(root: number, info: number): Uint8Array {
		const parts: Uint8Array[] = [];
		let length = 0;
		const push = (bytes: Uint8Array): void => {
			parts.push(bytes);
			length += bytes.length;
		};
		// The second line's four bytes above 127 tell a transfer program the
		// file is binary, as the format recommends.
		push(Uint8Array.from([...encoder.encode('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
		const offsets: number[] = [];
		this.bodies.forEach((body, i) => {
			if (body === null) throw new Error(`PDF object ${i + 1} was reserved and never written`);
			offsets.push(length);
			push(encoder.encode(`${i + 1} 0 obj\n`));
			push(body);
			push(encoder.encode('\nendobj\n'));
		});
		const body = new Uint8Array(length);
		let at = 0;
		for (const part of parts) {
			body.set(part, at);
			at += part.length;
		}
		const id = [...sha256(body).subarray(0, 16)]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('')
			.toUpperCase();
		const count = this.bodies.length + 1;
		let xref = `xref\n0 ${count}\n0000000000 65535 f\r\n`;
		for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n\r\n`;
		const trailer =
			`trailer\n<< /Size ${count} /Root ${root} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\n` +
			`startxref\n${length}\n%%EOF\n`;
		const tail = encoder.encode(xref + trailer);
		const out = new Uint8Array(length + tail.length);
		out.set(body);
		out.set(tail, length);
		return out;
	}
}
