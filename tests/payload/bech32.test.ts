/**
 * BIP 173 and BIP 350 test vectors, copied from the "Test vectors" sections
 * of https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki and
 * bip-0350.mediawiki.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	bech32Decode,
	bech32Encode,
	convertBits,
	decodeSegwitAddress,
} from '../../src/payload/bech32.js';

const VALID_BECH32 = [
	'A12UEL5L',
	'a12uel5l',
	'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
	'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
	'11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
	'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
	'?1ezyfcl',
];

const VALID_BECH32M = [
	'A1LQFN3A',
	'a1lqfn3a',
	'an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6',
	'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx',
	'11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8',
	'split1checkupstagehandshakeupstreamerranterredcaperredlc445v',
	'?1v759aa',
];

/** BIP 173 invalid strings, with the reason the BIP gives. */
const INVALID_BECH32: readonly (readonly [string, string])[] = [
	['\x201nwldj5', 'HRP character out of range'],
	['\x7f1axkwrx', 'HRP character out of range'],
	['\x801eym55h', 'HRP character out of range'],
	[
		'an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx',
		'overall max length exceeded',
	],
	['pzry9x0s0muk', 'No separator character'],
	['1pzry9x0s0muk', 'Empty HRP'],
	['x1b4n0q5v', 'Invalid data character'],
	['li1dgmt3', 'Too short checksum'],
	['de1lg7wt\xff', 'Invalid character in checksum'],
	['A1G7SGD8', 'checksum calculated with uppercase form of HRP'],
	['10a06t8', 'empty HRP'],
	['1qzzfhee', 'empty HRP'],
];

/** Valid segwit addresses and their scriptPubKey, BIP 350's list (which supersedes BIP 173's for v1 and later). */
const VALID_ADDRESSES: readonly (readonly [string, string])[] = [
	['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', '0014751e76e8199196d454941c45d1b3a323f1433bd6'],
	[
		'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7',
		'00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262',
	],
	[
		'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y',
		'5128751e76e8199196d454941c45d1b3a323f1433bd6751e76e8199196d454941c45d1b3a323f1433bd6',
	],
	['BC1SW50QGDZ25J', '6002751e'],
	['bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs', '5210751e76e8199196d454941c45d1b3a323'],
	[
		'tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy',
		'0020000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433',
	],
	[
		'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c',
		'5120000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433',
	],
	[
		'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
		'512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
	],
];

/** BIP 350's invalid addresses. The human-readable part is checked by the Bitcoin type, not here. */
const INVALID_ADDRESSES: readonly (readonly [string, string])[] = [
	[
		'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd',
		'Invalid checksum (Bech32 instead of Bech32m)',
	],
	[
		'tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf',
		'Invalid checksum (Bech32 instead of Bech32m)',
	],
	[
		'BC1S0XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ54WELL',
		'Invalid checksum (Bech32 instead of Bech32m)',
	],
	['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh', 'Invalid checksum (Bech32m instead of Bech32)'],
	[
		'tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47',
		'Invalid checksum (Bech32m instead of Bech32)',
	],
	[
		'bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4',
		'Invalid character in checksum',
	],
	['BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R', 'Invalid witness version'],
	['bc1pw5dgrnzv', 'Invalid program length (1 byte)'],
	[
		'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav',
		'Invalid program length (41 bytes)',
	],
	['BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', 'Invalid program length for witness version 0'],
	['tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47Zagq', 'Mixed case'],
	[
		'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf',
		'zero padding of more than 4 bits',
	],
	[
		'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j',
		'Non-zero padding in 8-to-5 conversion',
	],
	['bc1gmk9yu', 'Empty data section'],
	// From BIP 173, still invalid under BIP 350.
	['BC13W508D6QEJXTDG4Y5R3ZARVARY0C5XW7KN40WF2', 'Invalid witness version'],
	['bc1rw5uspcuh', 'Invalid program length'],
	[
		'bc10w508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kw5rljs90',
		'Invalid program length',
	],
	['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7', 'Mixed case'],
	['bc1zw508d6qejxtdg4y5r3zarvaryvqyzf3du', 'zero padding of more than 4 bits'],
	[
		'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3pjxtptv',
		'Non-zero padding in 8-to-5 conversion',
	],
];

function scriptPubKey(version: number, program: Uint8Array): string {
	const op = version === 0 ? 0 : version + 0x50;
	return [op, program.length, ...program]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

describe('bech32Decode', () => {
	it('accepts every valid bech32 string in BIP 173', () => {
		for (const text of VALID_BECH32) {
			const decoded = bech32Decode(text);
			expect(decoded.ok, text).toBe(true);
			if (decoded.ok) expect(decoded.value.encoding).toBe('bech32');
		}
	});

	it('accepts every valid bech32m string in BIP 350', () => {
		for (const text of VALID_BECH32M) {
			const decoded = bech32Decode(text);
			expect(decoded.ok, text).toBe(true);
			if (decoded.ok) expect(decoded.value.encoding).toBe('bech32m');
		}
	});

	it('refuses every invalid string in BIP 173, for the reason given', () => {
		for (const [text, reason] of INVALID_BECH32) {
			expect(bech32Decode(text).ok, `${reason}: ${JSON.stringify(text)}`).toBe(false);
		}
		expect(bech32Decode('A1G7SGD8')).toEqual({ ok: false, reason: 'checksum' });
		expect(bech32Decode('pzry9x0s0muk')).toEqual({ ok: false, reason: 'format' });
		expect(
			bech32Decode(
				'an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx',
			),
		).toEqual({ ok: false, reason: 'too-long' });
		expect(bech32Decode('a12UEL5L')).toEqual({ ok: false, reason: 'mixed-case' });
	});

	it('lifts the length limit when asked to', () => {
		const long = bech32Encode('lnbc', new Array(200).fill(3), 'bech32');
		expect(bech32Decode(long).ok).toBe(false);
		expect(bech32Decode(long, Number.POSITIVE_INFINITY).ok).toBe(true);
	});
});

describe('bech32Encode', () => {
	it('round-trips through decode under both encodings', () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z]{1,10}$/),
				fc.array(fc.integer({ min: 0, max: 31 }), { maxLength: 60 }),
				fc.constantFrom('bech32' as const, 'bech32m' as const),
				(hrp, words, encoding) => {
					const decoded = bech32Decode(bech32Encode(hrp, words, encoding));
					expect(decoded).toEqual({ ok: true, value: { hrp, words, encoding } });
				},
			),
		);
	});
});

describe('convertBits', () => {
	it('regroups bytes into five-bit words and back', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
				const words = convertBits([...bytes], 8, 5, true) as number[];
				expect(convertBits(words, 5, 8, false)).toEqual([...bytes]);
			}),
		);
	});

	it('refuses leftover bits that are not zero', () => {
		expect(convertBits([31], 5, 8, false)).toBeUndefined();
	});
});

describe('decodeSegwitAddress', () => {
	it('decodes every valid address in BIP 350 to its scriptPubKey', () => {
		for (const [address, script] of VALID_ADDRESSES) {
			const decoded = decodeSegwitAddress(address);
			expect(decoded.ok, address).toBe(true);
			if (decoded.ok)
				expect(scriptPubKey(decoded.value.version, decoded.value.program)).toBe(script);
		}
	});

	it('refuses every invalid address, for the reason given', () => {
		for (const [address, reason] of INVALID_ADDRESSES) {
			expect(decodeSegwitAddress(address).ok, `${reason}: ${address}`).toBe(false);
		}
		expect(
			decodeSegwitAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd'),
		).toEqual({ ok: false, reason: 'wrong-encoding' });
		expect(
			decodeSegwitAddress('BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R'),
		).toEqual({
			ok: false,
			reason: 'version',
		});
		expect(decodeSegwitAddress('bc1gmk9yu')).toEqual({ ok: false, reason: 'version' });
	});

	it('refuses BIP 173 version 1 addresses that are bech32 rather than bech32m', () => {
		// BIP 173 listed these as valid; BIP 350 changed v1 and later to bech32m.
		expect(
			decodeSegwitAddress(
				'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx',
			).ok,
		).toBe(false);
		expect(decodeSegwitAddress('BC1SW50QA3JX3S').ok).toBe(false);
	});
});
