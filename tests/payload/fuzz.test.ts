/**
 * The contract every parser of untrusted input meets (tests/fuzz): only
 * QrStudioError escapes `parse`, `detect` never throws and answers 0 to 1,
 * `validate` never throws on any value at all, and every call finishes.
 *
 * Inputs are random text and mutations of the specification vectors, which
 * reach far deeper into each parser than random text does: a vCard with one
 * line cut short, a Pix code with a length that runs past the end, a Wi-Fi
 * string with a backslash at the very end.
 */

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { detectPayload } from '../../src/payload/detect.js';
import { BUILT_IN_PAYLOAD_TYPES, createPayloadRegistry } from '../../src/payload/registry.js';
import { analyseUrl, cleanUrl } from '../../src/payload/url-safety.js';
import { guardUnhandledRejections } from '../fuzz/setup.js';
import { startWatchdog } from '../fuzz/watchdog.js';

guardUnhandledRejections();
const watchdog = startWatchdog();
afterAll(() => watchdog.stop());

const registry = createPayloadRegistry();
const SEEDS = BUILT_IN_PAYLOAD_TYPES.flatMap((type) => type.vectors.map((vector) => vector.text));

/** A seed with a few edits: deletions, insertions of syntax characters, duplicated slices. */
const mutated = fc
	.tuple(
		fc.constantFrom(...SEEDS),
		fc.array(
			fc.tuple(
				fc.nat(),
				fc.constantFrom('delete', 'insert', 'duplicate', 'truncate'),
				fc.constantFrom(...';:,\\"=&?#%\n\r\t 01234567899zZ\u0000é\ud800\u{1f600}'),
			),
			{ minLength: 1, maxLength: 6 },
		),
	)
	.map(([seed, edits]) => {
		let text = seed;
		for (const [at, kind, char] of edits) {
			const position = text.length === 0 ? 0 : at % text.length;
			if (kind === 'delete') text = text.slice(0, position) + text.slice(position + 1);
			else if (kind === 'insert') text = text.slice(0, position) + char + text.slice(position);
			else if (kind === 'duplicate')
				text = text.slice(0, position) + text.slice(position, position + 8) + text.slice(position);
			else text = text.slice(0, position);
		}
		return text;
	});

const anyText = fc.oneof(
	{ arbitrary: mutated, weight: 4 },
	{ arbitrary: fc.string({ maxLength: 200 }), weight: 1 },
	{ arbitrary: fc.string({ unit: 'binary', maxLength: 200 }), weight: 1 },
	{ arbitrary: fc.constantFrom(...SEEDS).map((seed) => seed.toUpperCase()), weight: 1 },
	{ arbitrary: fc.constantFrom(...SEEDS).map((seed) => seed.toLowerCase()), weight: 1 },
);

function onlyQrStudioError(run: () => unknown): void {
	try {
		run();
	} catch (error) {
		if (!(error instanceof QrStudioError)) throw error;
		expect(['payload/unparseable', 'payload/invalid']).toContain(error.code);
	}
}

describe('parsing untrusted text', () => {
	for (const type of BUILT_IN_PAYLOAD_TYPES) {
		it(`${type.id}: parse throws only QrStudioError, detect never throws`, () => {
			fc.assert(
				fc.property(anyText, (text) => {
					watchdog.beat(`${type.id} ${text.length}`);
					onlyQrStudioError(() => {
						const value = type.parse(text);
						// Whatever parsed must validate without throwing, and if it has
						// no errors it must build.
						const issues = type.validate(value);
						if (!issues.some((found) => found.severity === 'error') && type.generate !== false) {
							type.build(value);
						}
						type.safety?.(value);
					});
					const score = type.detect(text);
					expect(score).toBeGreaterThanOrEqual(0);
					expect(score).toBeLessThanOrEqual(1);
				}),
				{ numRuns: 400 },
			);
		});
	}

	it('detectPayload and the URL analyser answer for anything', () => {
		fc.assert(
			fc.property(anyText, (text) => {
				watchdog.beat(`detect ${text.length}`);
				const found = detectPayload(text, registry);
				expect(found.confidence).toBeGreaterThanOrEqual(0);
				analyseUrl(text);
				cleanUrl(text);
			}),
			{ numRuns: 1000 },
		);
	});

	it('finishes on long and pathological input', () => {
		const long = [
			`WIFI:${'S:a\\;'.repeat(5000)}`,
			`BEGIN:VCARD\r\n${'N:a;b;c;d;e\r\n '.repeat(3000)}`,
			`BEGIN:VEVENT\n${' x'.repeat(10000)}`,
			`000201${'2699'.repeat(3000)}`,
			`https://id.gs1.org${'/01'.repeat(3000)}/09520123456788`,
			`https://example.com/${'%'.repeat(10000)}`,
			`mailto:${'a,'.repeat(10000)}`,
			`bitcoin:${'1'.repeat(10000)}`,
			`lightning:ln${'q'.repeat(20000)}`,
			'A'.repeat(20000),
			`xn--${'9'.repeat(5000)}a.example`,
		];
		for (const text of long) {
			watchdog.beat(`long ${text.slice(0, 20)}`);
			for (const type of BUILT_IN_PAYLOAD_TYPES) onlyQrStudioError(() => type.parse(text));
			detectPayload(text, registry);
			analyseUrl(`https://${text}`);
		}
	});
});

describe('validating untrusted values', () => {
	const anyValue = fc.dictionary(
		fc.oneof(
			fc.constantFrom(
				...new Set(BUILT_IN_PAYLOAD_TYPES.flatMap((t) => t.fields.map((f) => f.key))),
			),
			fc.string(),
		),
		fc.oneof(
			fc.string(),
			fc.double(),
			fc.boolean(),
			fc.constant(null),
			fc.array(fc.string()),
			fc.array(fc.anything()),
			fc.anything(),
		),
	);

	for (const type of BUILT_IN_PAYLOAD_TYPES) {
		it(`${type.id}: validate never throws, and build either builds or throws TypeError`, () => {
			fc.assert(
				fc.property(anyValue, (value) => {
					const issues = type.validate(value as never);
					expect(Array.isArray(issues)).toBe(true);
					try {
						type.build(value as never);
					} catch (error) {
						expect(error).toBeInstanceOf(TypeError);
					}
				}),
				{ numRuns: 300 },
			);
		});
	}
});
