/**
 * The conformance suite: every type's specification vectors, from
 * `BUILT_IN_VECTORS` rather than from the types, which no longer carry them.
 *
 * Each vector's text reads as its value. Where the value validates and the
 * type can be made, writing it and reading that back gives the value again,
 * and the vectors listed in EXACT are written byte for byte as the
 * specification prints them, because they are already in the form this
 * package writes.
 *
 * Some vectors are known not to validate, and the suite holds them to that:
 * BIP 21's example address fails its own base58check checksum, BIP 321's
 * example addresses fail their bech32 checksums, and ZXing's Wi-Fi example
 * has a six-character WPA password.
 */

import { describe, expect, it } from 'vitest';
import { hasErrors } from '../../src/core/issue.js';
import { BUILT_IN_PAYLOAD_TYPES } from '../../src/payload/registry.js';
import { BUILT_IN_VECTORS } from '../../src/payload/vectors/index.js';

/** Vectors whose text is exactly what `build` writes for their value. */
const EXACT = new Set([
	'WIFI:T:WPA;S:MyNet;P:MyPassword;;',
	'mailto:chris@example.com',
	'mailto:infobot@example.com?subject=current-issue',
	'mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index',
	'mailto:gorby%25kremvax@example.com',
	'mailto:Mike%26family@example.org',
	'mailto:joe@example.com?cc=bob@example.com&body=hello',
	'mailto:addr1@an.example,addr2@an.example',
	'tel:+1-201-555-0123',
	'bitcoin:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4?amount=0.001',
	'SMSTO:+61400000000:Hello from the example',
	'https://wa.me/15551234567',
	"https://wa.me/15551234567?text=I'm%20interested%20in%20your%20car%20for%20sale",
	'https://t.me/example_channel',
	'https://t.me/+61400000000?text=Hello',
	'https://signal.me/#p/+61400000000',
	'facetime:14085551234',
	'facetime-audio:user@example.com',
	'geo:13.4125,103.8667',
	'MECARD:N:Doe,John;TEL:13035551212;EMAIL:john.doe@example.com;;',
	'BCD\n001\n1\nSCT\nBHBLDEHHXXX\nFranz Mustermänn\nDE71110220330123456789\nEUR12.3\nGDDS\nRF18539007547034',
	'00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
	'upi://pay?pa=example@upi&pn=Example%20Shop&am=10.00&cu=INR&tn=Order%201',
	'https://id.gs1.org/01/09520123456788/10/ABC1/21/12345?17=180426',
	'https://example.com/',
	'https://example.com/menu?utm_source=poster&utm_medium=qr&utm_campaign=spring',
	'Example text',
]);

const KNOWN_INVALID = new Map([
	['bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W', 'payload.bitcoin.issue.address-checksum'],
	['BITCOIN:BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ', 'payload.bitcoin.issue.address-checksum'],
	['WIFI:T:WPA;S:mynetwork;P:mypass;;', 'payload.wifi.issue.wpa-length'],
]);

describe('specification vectors', () => {
	for (const type of BUILT_IN_PAYLOAD_TYPES) {
		for (const vector of BUILT_IN_VECTORS[type.id]) {
			const label = `${type.id}: ${JSON.stringify(vector.text).slice(0, 70)}`;
			it(label, () => {
				expect(vector.source.length).toBeGreaterThan(10);
				expect(type.parse(vector.text)).toEqual(vector.value);
				const issues = type.validate(vector.value);
				const known = [...KNOWN_INVALID].find(([prefix]) => vector.text.startsWith(prefix));
				if (known !== undefined) {
					expect(issues.map((found) => found.code)).toContain(known[1]);
					return;
				}
				expect(hasErrors(issues), JSON.stringify(issues)).toBe(false);
				if (type.generate === false) {
					expect(() => type.build(vector.value)).toThrow(TypeError);
					return;
				}
				const { text } = type.build(vector.value);
				expect(type.parse(text)).toEqual(vector.value);
				if (EXACT.has(vector.text)) expect(text).toBe(vector.text);
			});
		}
	}

	it('lists only vectors that exist', () => {
		const texts = new Set(
			BUILT_IN_PAYLOAD_TYPES.flatMap((type) =>
				BUILT_IN_VECTORS[type.id].map((vector) => vector.text),
			),
		);
		for (const text of EXACT) expect(texts.has(text), text).toBe(true);
	});
});
