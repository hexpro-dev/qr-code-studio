/**
 * Every message key the batch layer uses has an English sentence, every
 * sentence is reached, each placeholder is a param its issue or error
 * carries, and the sentences keep the house register. Keys are found by
 * provoking each one through the public functions, not by listing them.
 */

import { describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import { BATCH_ISSUES } from '../../src/batch/issues.js';
import { planBatch } from '../../src/batch/plan.js';
import { runBatch } from '../../src/batch/run.js';
import { decodeCsvBytes } from '../../src/batch/text-decoding.js';
import type { BatchOutcome } from '../../src/batch/types.js';
import { QrStudioError } from '../../src/core/errors.js';
import type { Issue } from '../../src/core/issue.js';
import type { FrameEntry } from '../../src/design/types.js';
import { BATCH_MESSAGES } from '../../src/messages/en/batch.js';
import { designWith } from '../design/helpers.js';
import { checkRegister } from '../encode/register.js';
import { drain, registries } from './helpers.js';
import { messageArguments } from '../../src/messages/format.js';

/** The key an error is shown with, and the params it can use. */
function errorKey(run: () => unknown): { key: string; params: Readonly<Record<string, unknown>> } {
	try {
		run();
	} catch (error) {
		const { code, params } = error as QrStudioError;
		expect(error).toBeInstanceOf(QrStudioError);
		if (code === 'batch/malformed-csv')
			return { key: `batch.malformed-csv.${String(params.reason)}`, params };
		// The studio's errorKey gives a text encoding this browser lacks the batch layer's sentence.
		if (code === 'platform/unavailable' && params.feature === 'text-encoding')
			return { key: 'batch.encoding-unavailable', params };
		return { key: code.replace('/', '.'), params };
	}
	throw new Error('expected a failure');
}

function provokeIssues(): Issue[] {
	const reg = registries();
	const found: Issue[] = [];
	found.push(...parseCsv('a,b,a\n1\n1,2,3,4\n').issues);
	found.push(...decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0x61])).issues);
	found.push(...decodeCsvBytes(new Uint8Array([0xe9])).issues);
	const rows = planBatch(
		parseCsv('name,lat\n../x,"1,5"\n,\nsame,1\nsame,1\n'),
		{
			typeId: 'geo',
			fields: { latitude: { column: 'lat' }, longitude: { template: '1' } },
			filename: '{name}',
		},
		reg,
	);
	found.push(...rows.flatMap((row) => row.issues));
	const usable = rows.filter((row) => row.content !== null);
	const outcomes = (generator: ReturnType<typeof runBatch>): readonly BatchOutcome[] =>
		drain(generator).outcomes;
	const translucent = designWith({ background: { kind: 'solid', ink: '#ffffff80' } });
	found.push(
		...outcomes(runBatch(usable, translucent, { kind: 'zip', format: 'eps' }, reg)).flatMap(
			(o) => o.issues,
		),
	);
	for (const verdict of ['warn', 'fail'] as const) {
		found.push(
			...outcomes(
				runBatch(usable, designWith({}), { kind: 'zip', format: 'svg', verify: 'all' }, reg, {
					verifyRow: () => ({ verdict }),
				}),
			).flatMap((o) => o.issues),
		);
	}
	found.push(
		...outcomes(
			runBatch(usable, designWith({}), { kind: 'zip', format: 'svg', verify: 'all' }, reg, {
				verifyRow: () => {
					throw new QrStudioError('verify/missing-entry', 'x', { kind: 'frame' });
				},
			}),
		).flatMap((o) => o.issues),
	);
	const huge: FrameEntry = {
		id: 'tall-test',
		labelKey: 'design.frame.tall-test',
		params: [],
		text: null,
		layout: ({ symbolSize, quietZone }) => {
			const side = symbolSize.width + 2 * quietZone;
			return { width: side, height: side * 40, symbol: { x: 0, y: 0 }, nodes: [], textBox: null };
		},
	};
	reg.design.frames.register(huge);
	found.push(
		...outcomes(
			runBatch(
				usable,
				designWith({ frame: { ref: { id: 'tall-test' } } }),
				{ kind: 'zip', format: 'png', widthPx: 8192 },
				reg,
			),
		).flatMap((o) => o.issues),
	);
	return found;
}

/** A fallback this engine's TextDecoder cannot read, as in a build without full ICU. */
function encodingUnavailable(): ReturnType<typeof errorKey> {
	class Utf8Only extends TextDecoder {
		constructor(label?: string, options?: TextDecoderOptions) {
			if (label !== 'utf-8') throw new RangeError('unsupported');
			super(label, options);
		}
	}
	vi.stubGlobal('TextDecoder', Utf8Only);
	try {
		return errorKey(() => decodeCsvBytes(new Uint8Array([0x82, 0xa0]), { fallback: 'shift_jis' }));
	} finally {
		vi.unstubAllGlobals();
	}
}

describe('the batch messages', () => {
	const errors = [
		encodingUnavailable(),
		errorKey(() => parseCsv('a\n"open')),
		errorKey(() => parseCsv('a\nb"c')),
		errorKey(() => parseCsv('a\n"b"c')),
		errorKey(() => parseCsv('')),
		errorKey(() => parseCsv('a\n1\n2', { maxRows: 1 })),
		errorKey(() =>
			planBatch(
				parseCsv('a\n1'),
				{ typeId: 'text', fields: { text: { column: 'b' } }, filename: '' },
				registries(),
			),
		),
	];
	const issues = provokeIssues().filter((found) => found.code.startsWith('batch.'));

	it('raise every issue code the layer declares, and no other of its own', () => {
		expect([...new Set(issues.map((found) => found.code))].sort()).toEqual(
			Object.values(BATCH_ISSUES).sort(),
		);
	});

	it('have a sentence for every key, and every sentence is reached', () => {
		const used = new Set([
			...errors.map((error) => error.key),
			...issues.map((found) => found.code),
		]);
		for (const key of used) expect(BATCH_MESSAGES[key], key).toBeDefined();
		expect([...used].sort()).toEqual(Object.keys(BATCH_MESSAGES).sort());
	});

	it('fill each placeholder from a param the issue or error carries', () => {
		const params = new Map<string, Set<string>>();
		const add = (key: string, from: Readonly<Record<string, unknown>> | undefined): void => {
			const set = params.get(key) ?? new Set<string>();
			for (const name of Object.keys(from ?? {})) set.add(name);
			params.set(key, set);
		};
		for (const error of errors) add(error.key, error.params);
		for (const found of issues) add(found.code, found.params);
		for (const [key, sentence] of Object.entries(BATCH_MESSAGES)) {
			for (const name of messageArguments(sentence)) {
				expect(params.get(key)?.has(name), `${key} uses {${name}}`).toBe(true);
			}
		}
	});

	it('keep the house register', () => {
		checkRegister(BATCH_MESSAGES);
	});
});
