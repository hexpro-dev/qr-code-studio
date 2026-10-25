/**
 * Inspecting pictures: every content type's vectors drawn as codes and read
 * back, how well each code read, several codes in one picture, structured
 * append sets in any order, GS1 element strings, and the failures.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { encode, encodeStructuredAppend } from '../../src/encode/index.js';
import { inspectImage, inspectText } from '../../src/inspect/inspect.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { fromRgba, invert, mirror, toRgba } from '../../src/verify/degrade.js';
import { draw, registries, sideBySide } from './helpers.js';

describe('every content type, drawn and read back', () => {
	for (const type of createPayloadRegistry().list()) {
		it(`${type.id}: reads to the same explanation as its text`, () => {
			for (const vector of type.vectors) {
				// ECI 'auto' never writes an ECI header, as EPC and the Swiss QR-bill require.
				const symbol = encode(vector.text, { ecLevel: 'L' });
				const result = inspectImage(draw(symbol, 3), registries);
				expect(result.ok, vector.source).toBe(true);
				if (!result.ok) continue;
				const report = result.value;
				expect(report.symbols).toHaveLength(1);
				expect(report.symbols[0]?.text).toBe(vector.text);
				const text = inspectText(vector.text, registries);
				expect(report.payload).toEqual(text.payload);
				expect(report.safety).toEqual(text.safety);
			}
		});
	}
});

describe('how a code read', () => {
	const symbol = encode('https://example.com/menu', { ecLevel: 'M' });

	it('reports the symbol and a clean reading', () => {
		const result = inspectImage(draw(symbol), registries);
		if (!result.ok) throw result.error;
		const [read] = result.value.symbols;
		expect(read).toMatchObject({
			symbology: 'qr',
			version: symbol.version,
			ecLevel: 'M',
			mask: symbol.mask,
			textSource: 'utf-8',
			structuredAppend: null,
			gs1: null,
		});
		expect(read?.corners).toHaveLength(4);
		expect(read?.segments.length).toBeGreaterThan(0);
		expect(read?.quality.errorsPerBlock.every((errors) => errors === 0)).toBe(true);
		expect(read?.quality).toMatchObject({ mirrored: false, inverted: false, formatErrors: 0 });
		expect(read?.quality.minConfidence).toBeGreaterThan(0.5);
		expect(result.value.sets).toEqual([]);
	});

	it('says when it read the code light on dark or as a mirror image', () => {
		const inverted = inspectImage(toRgba(invert(fromRgba(draw(symbol)))), registries);
		if (!inverted.ok) throw inverted.error;
		expect(inverted.value.symbols[0]?.quality.inverted).toBe(true);
		const mirrored = inspectImage(toRgba(mirror(fromRgba(draw(symbol)))), registries);
		if (!mirrored.ok) throw mirrored.error;
		expect(mirrored.value.symbols[0]?.quality.mirrored).toBe(true);
		expect(mirrored.value.payload?.typeId).toBe('url');
	});

	it('reads Micro QR and rMQR', () => {
		for (const symbology of ['micro', 'rmqr'] as const) {
			const result = inspectImage(draw(encode('12345', { symbology }), 6), registries);
			if (!result.ok) throw result.error;
			expect(result.value.symbols[0]?.symbology).toBe(symbology);
		}
	});

	it('reads several codes in one picture and explains the first', () => {
		const picture = sideBySide([
			draw(encode('https://example.com/a')),
			draw(encode('WIFI:T:nopass;S:Example Network;;')),
		]);
		const result = inspectImage(picture, registries);
		if (!result.ok) throw result.error;
		expect(result.value.symbols).toHaveLength(2);
		expect(result.value.payload?.typeId).toBe(
			result.value.symbols[0]?.text.startsWith('WIFI') === true ? 'wifi' : 'url',
		);
	});

	it('fails with the reason the reader gives when nothing reads', () => {
		const blank = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
		const result = inspectImage(blank, registries);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(QrStudioError);
			expect(result.error.code).toBe('decode/not-found');
		}
		expect(() => inspectImage(blank, null as never)).toThrow(TypeError);
	});

	it('passes the options it is given to the reader', () => {
		const result = inspectImage(draw(symbol), registries, { profile: 'strict-v1' });
		expect(result.ok).toBe(true);
		const none = inspectImage(draw(symbol), registries, { symbologies: ['micro'] });
		expect(none.ok).toBe(false);
	});
});

describe('structured append', () => {
	const message = `https://example.com/catalogue/${'item-'.repeat(60)}end`;
	const parts = encodeStructuredAppend(message, { maxVersion: '6', ecLevel: 'M' });
	const pictures = parts.map((part) => draw(part, 3));

	it('was split into a set worth testing', () => {
		expect(parts.length).toBeGreaterThanOrEqual(3);
	});

	it('puts a set back together in any order and explains the whole message', () => {
		const orders = [
			pictures.map((_, i) => i),
			pictures.map((_, i) => pictures.length - 1 - i),
			pictures
				.map((_, i) => ((i * 2) % pictures.length === i ? i : (i + 1) % pictures.length))
				.filter((v, i, all) => all.indexOf(v) === i),
		];
		for (const order of orders) {
			if (order.length !== pictures.length) continue;
			const result = inspectImage(sideBySide(order.map((i) => pictures[i] as never)), registries);
			if (!result.ok) throw result.error;
			expect(result.value.sets).toHaveLength(1);
			expect(result.value.sets[0]).toMatchObject({
				complete: true,
				text: message,
				missing: [],
				parityMatches: true,
				total: parts.length,
			});
			expect(result.value.payload).toEqual(inspectText(message, registries).payload);
		}
	});

	it('reports the parts it did not see, and explains the first part alone', () => {
		const result = inspectImage(
			sideBySide([pictures[2] as never, pictures[0] as never]),
			registries,
		);
		if (!result.ok) throw result.error;
		const [set] = result.value.sets;
		expect(set?.complete).toBe(false);
		expect(set?.text).toBeNull();
		expect(set?.parityMatches).toBeNull();
		expect(set?.missing).toEqual([1, ...Array.from({ length: parts.length - 3 }, (_, i) => i + 3)]);
		expect(result.value.symbols[0]?.structuredAppend?.total).toBe(parts.length);
		expect(result.value.payload?.value).toEqual(
			inspectText(result.value.symbols[0]?.text as string, registries).payload?.value,
		);
	});
});

describe('GS1', () => {
	it('splits the element strings of a code that starts with FNC1', () => {
		const symbol = encode('0109520123456788172601011' + '0ABC1\u001d21XYZ', { fnc1: 'gs1' });
		const result = inspectImage(draw(symbol), registries);
		if (!result.ok) throw result.error;
		expect(result.value.symbols[0]?.gs1).toEqual([
			{ ai: '01', value: '09520123456788' },
			{ ai: '17', value: '260101' },
			{ ai: '10', value: 'ABC1' },
			{ ai: '21', value: 'XYZ' },
		]);
	});
});
