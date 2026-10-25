/**
 * The small codecs under the content types: base58check, base64, punycode,
 * EMVCo MPM TLV, the scripts table, and IBAN, BIC and ISO 11649.
 */

import { domainToASCII, domainToUnicode } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	compactCreditorReference,
	creditorReferenceFor,
	ibanProblem,
	ibanWithCheckDigits,
	isBic,
	isCreditorReference,
} from '../../src/payload/banking.js';
import {
	base58CheckDecode,
	base58CheckEncode,
	base58Decode,
	base58Encode,
} from '../../src/payload/base58.js';
import { base64Decode, base64Encode } from '../../src/payload/content/zatca.js';
import { emvCrc, emvObject, readEmv, readEmvObjects, writeEmv } from '../../src/payload/emv.js';
import { hostToUnicode, punycodeDecode } from '../../src/payload/punycode.js';
import {
	isMixedScript,
	isWholeScriptLookalike,
	scriptOf,
	scriptsIn,
} from '../../src/payload/scripts.js';

describe('base58', () => {
	it('decodes a known address and checks its four check bytes', () => {
		// The address in Bitcoin's genesis block coinbase output.
		const decoded = base58CheckDecode('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
		expect(decoded.ok).toBe(true);
		if (decoded.ok) {
			expect(Buffer.from(decoded.value).toString('hex')).toBe(
				'0062e907b15cbf27d5425399ebf6f0fb50ebb88f18',
			);
		}
	});

	it('reports a checksum failure separately from bad characters', () => {
		expect(base58CheckDecode('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb')).toEqual({
			ok: false,
			reason: 'checksum',
		});
		expect(base58CheckDecode('0OIl')).toEqual({ ok: false, reason: 'format' });
		expect(base58CheckDecode('1111')).toEqual({ ok: false, reason: 'format' });
		expect(base58Decode('abc0')).toBeUndefined();
	});

	it('round-trips any bytes, leading zeros included', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
				expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
				const checked = base58CheckDecode(base58CheckEncode(bytes));
				if (bytes.length >= 1) expect(checked).toEqual({ ok: true, value: bytes });
			}),
		);
	});
});

describe('base64', () => {
	it('round-trips with Node', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 60 }), (bytes) => {
				const text = base64Encode(bytes);
				expect(text).toBe(Buffer.from(bytes).toString('base64'));
				expect(base64Decode(text)).toEqual(bytes);
			}),
		);
	});

	it('refuses anything that is not padded standard base64', () => {
		expect(base64Decode('abc')).toBeUndefined();
		expect(base64Decode('ab=c')).toBeUndefined();
		expect(base64Decode('a-_b')).toBeUndefined();
		expect(base64Decode('')).toEqual(new Uint8Array());
	});
});

describe('punycode', () => {
	it('decodes the RFC 3492 section 7.1 samples', () => {
		expect(punycodeDecode('egbpdaj6bu4bxfgehfvwxn')).toBe(
			String.fromCodePoint(
				0x644,
				0x64a,
				0x647,
				0x645,
				0x627,
				0x628,
				0x62a,
				0x643,
				0x644,
				0x645,
				0x648,
				0x634,
				0x639,
				0x631,
				0x628,
				0x64a,
				0x61f,
			),
		);
		expect(punycodeDecode('ihqwcrb4cv8a8dqg056pqjye')).toBe(
			String.fromCodePoint(0x4ed6, 0x4eec, 0x4e3a, 0x4ec0, 0x4e48, 0x4e0d, 0x8bf4, 0x4e2d, 0x6587),
		);
		expect(punycodeDecode('ihqwctvzc91f659drss3x8bo0yb')).toBe(
			String.fromCodePoint(0x4ed6, 0x5011, 0x7232, 0x4ec0, 0x9ebd, 0x4e0d, 0x8aaa, 0x4e2d, 0x6587),
		);
	});

	it('keeps the basic code points before the delimiter', () => {
		expect(punycodeDecode('mnchen-3ya')).toBe('münchen');
		// Digits may be written in capitals; the basic code points keep their case.
		expect(punycodeDecode('MNCHEN-3YA')).toBe('MüNCHEN');
		expect(punycodeDecode('abc-')).toBe('abc');
	});

	it('refuses invalid punycode', () => {
		expect(punycodeDecode('-abc')).toBeUndefined();
		expect(punycodeDecode('a!')).toBeUndefined();
		expect(punycodeDecode('é-a')).toBeUndefined();
		// Ends in the middle of a variable-length integer.
		expect(punycodeDecode('a-9')).toBeUndefined();
		// Decodes past U+10FFFF, and far past what 32 bits hold.
		expect(punycodeDecode('99999a')).toBeUndefined();
		expect(punycodeDecode(`${'9'.repeat(300)}a`)).toBeUndefined();
		// Enough digits that the weight is Infinity and a zero digit makes NaN.
		expect(punycodeDecode(`${'9'.repeat(400)}a`)).toBeUndefined();
		expect(punycodeDecode(`b-${'9'.repeat(1000)}a`)).toBeUndefined();
		// Decodes to a surrogate code point.
		expect(punycodeDecode('qf9b')).toBeUndefined();
	});

	it('agrees with Node on hosts that WHATWG accepts', () => {
		const label = fc
			.array(fc.constantFrom(...'abcdeéüßаеорсуχλ中文日本ك'), { minLength: 1, maxLength: 10 })
			.map((chars) => chars.join(''));
		fc.assert(
			fc.property(fc.array(label, { minLength: 1, maxLength: 3 }), (labels) => {
				const ascii = domainToASCII(`${labels.join('.')}.example`);
				if (ascii === '') return;
				expect(hostToUnicode(ascii)).toBe(domainToUnicode(ascii));
			}),
		);
	});

	it('leaves a label that does not decode as it was', () => {
		expect(hostToUnicode('xn--a!.example')).toBe('xn--a!.example');
		expect(hostToUnicode('example.com')).toBe('example.com');
	});
});

describe('scripts', () => {
	it('places letters in their script and leaves shared characters out', () => {
		expect(scriptOf('a'.codePointAt(0) as number)).toBe('latin');
		expect(scriptOf('é'.codePointAt(0) as number)).toBe('latin');
		expect(scriptOf(0x0430)).toBe('cyrillic');
		expect(scriptOf(0x03bf)).toBe('greek');
		expect(scriptOf(0x4e2d)).toBe('other');
		expect(scriptOf('1'.codePointAt(0) as number)).toBeUndefined();
		expect(scriptOf('-'.codePointAt(0) as number)).toBeUndefined();
		expect(scriptOf(0xd7)).toBeUndefined();
		expect([...scriptsIn('ab1-中')]).toEqual(['latin', 'other']);
	});

	it('flags Latin mixed with Cyrillic or Greek, and nothing else', () => {
		expect(isMixedScript('pаypal')).toBe(true); // Cyrillic a
		expect(isMixedScript('gοogle')).toBe(true); // Greek omicron
		expect(isMixedScript('аοр')).toBe(true); // Cyrillic with Greek
		expect(isMixedScript('example')).toBe(false);
		expect(isMixedScript('пример')).toBe(false);
		expect(isMixedScript('日本語abc')).toBe(false);
	});

	it('flags a label written entirely in Latin look-alikes', () => {
		expect(isWholeScriptLookalike('аррӏе')).toBe(true); // "apple", in Cyrillic
		expect(isWholeScriptLookalike('οκ')).toBe(true); // "ok", in Greek
		expect(isWholeScriptLookalike('а1-е')).toBe(true);
		expect(isWholeScriptLookalike('пример')).toBe(false);
		expect(isWholeScriptLookalike('apple')).toBe(false);
		expect(isWholeScriptLookalike('123')).toBe(false);
	});
});

describe('EMVCo MPM', () => {
	it('writes and reads a payload with its CRC', () => {
		const text = writeEmv([
			{ id: '00', value: '01' },
			{ id: '59', value: 'Example' },
		]);
		expect(text).toBe(`0002015907Example6304${emvCrc('0002015907Example6304')}`);
		expect(readEmv(text)).toEqual({
			ok: true,
			value: [
				{ id: '00', value: '01' },
				{ id: '59', value: 'Example' },
			],
		});
	});

	it('reports a damaged CRC separately from a damaged structure', () => {
		const text = writeEmv([{ id: '00', value: '01' }]);
		const flipped = `${text.slice(0, -1)}${text.endsWith('0') ? '1' : '0'}`;
		expect(readEmv(flipped)).toEqual({ ok: false, reason: 'crc' });
		expect(readEmv('0002016304')).toEqual({ ok: false, reason: 'format' });
		expect(readEmv('000202')).toEqual({ ok: false, reason: 'format' });
		expect(readEmv('00020263040000')).toEqual({ ok: false, reason: 'format' });
		expect(readEmv('0002016304ZZZZ')).toEqual({ ok: false, reason: 'format' });
		expect(readEmv('5902ab63040000')).toEqual({ ok: false, reason: 'format' });
		expect(readEmv('')).toEqual({ ok: false, reason: 'format' });
	});

	it('reads nested templates and refuses a length that runs past the end', () => {
		expect(readEmvObjects('0002ab2605xy01')).toBeUndefined();
		expect(readEmvObjects('aa02ab')).toBeUndefined();
		expect(readEmvObjects('0002ab0103xyz')).toEqual([
			{ id: '00', value: 'ab' },
			{ id: '01', value: 'xyz' },
		]);
	});

	it('refuses an object it cannot write', () => {
		expect(() => emvObject('1', 'x')).toThrow(TypeError);
		expect(() => emvObject('59', 'x'.repeat(100))).toThrow(TypeError);
		expect(emvObject('59', 'é')).toBe('5901é');
	});
});

describe('IBAN', () => {
	it('accepts published examples, printed or electronic', () => {
		// ISO 13616-1 example, and the Swiss and German examples used across
		// banking documentation, including the Swiss QR-bill guidelines.
		for (const iban of [
			'GB82WEST12345698765432',
			'GB82 WEST 1234 5698 7654 32',
			'CH4431999123000889012',
			'DE89370400440532013000',
			'de89 3704 0044 0532 0130 00',
		]) {
			expect(ibanProblem(iban), iban).toBeUndefined();
		}
	});

	it('says what is wrong with a bad one', () => {
		expect(ibanProblem('GB82WEST12345698765433')).toEqual({ code: 'checksum' });
		expect(ibanProblem('GB82WEST1234569876543')).toEqual({
			code: 'length',
			length: 21,
			expected: 22,
		});
		expect(ibanProblem('ZZ82WEST12345698765432')).toEqual({ code: 'country' });
		expect(ibanProblem('GB8')).toEqual({ code: 'format' });
		expect(ibanProblem('GB82-WEST')).toEqual({ code: 'format' });
	});

	it('accepts any IBAN built with its check digits, and catches a changed digit', () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[0-9]{18}$/), fc.nat(17), (bban, position) => {
				const iban = ibanWithCheckDigits('DE', bban);
				expect(ibanProblem(iban)).toBeUndefined();
				const at = 4 + position;
				const changed = `${iban.slice(0, at)}${(Number(iban[at]) + 1) % 10}${iban.slice(at + 1)}`;
				expect(ibanProblem(changed)).toEqual({ code: 'checksum' });
			}),
		);
	});
});

describe('BIC', () => {
	it('accepts 8 and 11 character BICs, in either case', () => {
		expect(isBic('BHBLDEHHXXX')).toBe(true);
		expect(isBic('DEUTDEFF')).toBe(true);
		expect(isBic('deutdeff500')).toBe(true);
		expect(isBic('DEUTDEF')).toBe(false);
		expect(isBic('1EUTDEFF')).toBe(false);
		expect(isBic('DEUTDEFF5')).toBe(false);
	});
});

describe('ISO 11649 creditor reference', () => {
	it('accepts the standard example, printed or compact', () => {
		// ISO 11649 example RF18 5390 0754 7034, also EPC069-12's version 1 example.
		expect(isCreditorReference('RF18539007547034')).toBe(true);
		expect(isCreditorReference('RF18 5390 0754 7034')).toBe(true);
		expect(compactCreditorReference('rf18 5390 0754 7034')).toBe('RF18539007547034');
	});

	it('refuses a reference with the wrong check digits or shape', () => {
		expect(isCreditorReference('RF19539007547034')).toBe(false);
		expect(isCreditorReference('RF18')).toBe(false);
		expect(isCreditorReference('RF18ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(false);
		// SIX's QR-bill guidelines, example 4: its check digits should be 24.
		expect(isCreditorReference('RF720191230100405JSH0438')).toBe(false);
		expect(isCreditorReference('RF240191230100405JSH0438')).toBe(true);
	});

	it('accepts any reference built with its check digits', () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[A-Z0-9]{1,21}$/), (body) => {
				expect(isCreditorReference(creditorReferenceFor(body))).toBe(true);
			}),
		);
	});
});
