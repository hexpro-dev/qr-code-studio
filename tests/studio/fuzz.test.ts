/**
 * The dispatch contract over random action sequences: nothing a person can
 * cause throws, and after every action the invariants hold.
 *
 * - the document's design always validates, and its content type is one the
 *   registry has and can make, with exactly that type's fields;
 * - revisions never go backwards;
 * - once there has been a code, there is always one on screen (stale at
 *   worst), whatever is typed;
 * - every slice of the snapshot can be read;
 * - undoing everything and redoing everything walks the same states.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDesignRegistries } from '../../src/design/registries.js';
import { validateDesign } from '../../src/design/validate.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import type { StudioAction } from '../../src/studio/types.js';
import { FakeRunner, settle, studioWith } from './helpers.js';

const design = createDesignRegistries();
const payloads = createPayloadRegistry();
const typeIds = payloads.ids();
const fieldKeys = [
	...new Set(payloads.list().flatMap((type) => type.fields.map((field) => field.key))),
];

const fieldValue = fc.oneof(
	fc.string({ maxLength: 40 }),
	fc.constantFrom(
		'https://example.com/',
		'Example Network',
		'+61 400 000 000',
		'example@example.com',
		'CH4431999123000889012',
	),
	fc.integer({ min: -1000, max: 100000 }),
	fc.double({ noNaN: false }),
	fc.boolean(),
	fc.constant(null),
	fc.array(fc.string({ maxLength: 12 }), { maxLength: 3 }),
	fc.object({ maxDepth: 1 }) as fc.Arbitrary<never>,
);

const patchValue = fc.oneof(
	fc.jsonValue({ maxDepth: 2 }),
	fc.constantFrom(
		{ id: 'dot' },
		{ id: 'rounded', params: { radius: 0.4 } },
		{ kind: 'solid', ink: '#123456' },
		{ kind: 'solid', ink: '#ffffff' },
		{ outer: { id: 'circle' }, inner: { id: 'circle-centre' } },
		{ source: { kind: 'icon', id: 'star' }, size: 0.2, clear: 'box', padding: 1, plate: null },
		'H',
		'L',
		'micro',
		6,
		null,
	),
	fc.constant(undefined),
);

const patchPath = fc.oneof(
	fc.constantFrom(
		['modules', 'shape'],
		['modules', 'paint'],
		['background'],
		['regions', 'finder'],
		['logo'],
		['symbol', 'ecLevel'],
		['symbol', 'symbology'],
		['quietZone'],
		['frame'],
		['name'],
		['output', 'sizeMm'],
	),
	fc.array(fc.oneof(fc.string({ maxLength: 8 }), fc.integer({ min: -2, max: 4 })), {
		maxLength: 4,
	}),
);

const action: fc.Arbitrary<StudioAction> = fc.oneof(
	fc.constantFrom('create', 'scan', 'bulk').map((mode) => ({ type: 'mode' as const, mode })),
	fc
		.oneof(fc.constantFrom(...typeIds), fc.string({ maxLength: 8 }))
		.map((typeId) => ({ type: 'payload/type' as const, typeId })),
	fc
		.record({
			key: fc.oneof(fc.constantFrom(...fieldKeys), fc.string({ maxLength: 6 })),
			value: fieldValue,
		})
		.map(({ key, value }) => ({ type: 'payload/field' as const, key, value: value as never })),
	fc
		.oneof(
			fc.string({ maxLength: 60 }),
			fc.constantFrom(...payloads.list().flatMap((type) => type.vectors.map((v) => v.text))),
		)
		.map((text) => ({ type: 'payload/raw' as const, text })),
	fc
		.record({
			path: patchPath,
			value: patchValue,
			coalesce: fc.option(fc.constantFrom('a', 'b'), { nil: undefined }),
		})
		.map(({ path, value, coalesce }) => ({
			type: 'design/patch' as const,
			patch: { path, value },
			...(coalesce === undefined ? {} : { coalesce }),
		})),
	fc
		.oneof(fc.constantFrom(...design.presets.ids()), fc.string({ maxLength: 6 }))
		.map((id) => ({ type: 'design/preset' as const, id })),
	fc
		.oneof(fc.jsonValue({ maxDepth: 3 }), fc.string({ maxLength: 30 }))
		.map((value) => ({ type: 'design/replace' as const, design: value })),
	fc.integer().map((seed) => ({ type: 'design/shuffle' as const, seed })),
	fc
		.record({
			sizeMm: fc.option(fc.oneof(fc.double(), fc.integer({ min: 1, max: 200 })), {
				nil: undefined,
			}),
			distanceMm: fc.option(fc.oneof(fc.constant(null), fc.integer({ min: -5, max: 2000 })), {
				nil: undefined,
			}),
		})
		.map((conditions) => ({ type: 'conditions' as const, conditions: conditions as never })),
	fc.constant({ type: 'history/undo' as const }),
	fc.constant({ type: 'history/redo' as const }),
	fc.constantFrom('drag', 'other').map((key) => ({ type: 'history/begin' as const, key })),
	fc.constantFrom('drag', 'other').map((key) => ({ type: 'history/commit' as const, key })),
	fc.constant({ type: 'history/cancel' as const }),
	fc.constant({ type: 'verify/request' as const }),
	fc.constant({ type: 'verify/cancel' as const }),
	fc.string({ maxLength: 6 }).map((fixId) => ({ type: 'fix/apply' as const, fixId })),
);

describe('dispatch under random actions', () => {
	it('never throws, and the invariants hold after every action', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 25 }), async (actions) => {
				const runner = new FakeRunner();
				const { studio, time } = studioWith({ verifyRunner: runner });
				let revision = studio.getSnapshot().revision;
				let hadCode = false;
				for (const next of actions) {
					expect(() => studio.dispatch(next), JSON.stringify(next)).not.toThrow();
					time.advance(300);
					for (const run of runner.runs.splice(0)) runner.answer(run);
					await settle();
					const snapshot = studio.getSnapshot();
					expect(Object.isFrozen(snapshot)).toBe(true);
					expect(snapshot.revision).toBeGreaterThanOrEqual(revision);
					revision = snapshot.revision;
					const { document } = snapshot;
					expect(validateDesign(document.design, design).design).not.toBeNull();
					const type = payloads.get(document.typeId);
					expect(type?.generate).not.toBe(false);
					expect(Object.keys(document.fields).sort()).toEqual(
						type?.fields.map((field) => field.key).sort(),
					);
					const status = snapshot.symbol.status;
					if (hadCode) expect(status, 'the code went blank').not.toBe('empty');
					if (status === 'ok') hadCode = true;
					void snapshot.form;
					void snapshot.design;
					void snapshot.payloadIssues;
				}
				// The picture, once, at the end: drawing is the slow part.
				expect(() => studio.getSnapshot().preview).not.toThrow();
				// From the top of the history, undoing all the way down and redoing
				// all the way up walk the same states.
				let guard = 0;
				while (studio.getSnapshot().history.canRedo && guard < 300) {
					studio.dispatch({ type: 'history/redo' });
					guard += 1;
				}
				const work = (): string => {
					const { typeId, fields, design: drawn } = studio.getSnapshot().document;
					return JSON.stringify({ typeId, fields, drawn });
				};
				const seen: string[] = [work()];
				while (studio.getSnapshot().history.canUndo && guard < 600) {
					studio.dispatch({ type: 'history/undo' });
					seen.push(work());
					guard += 1;
				}
				const back: string[] = [];
				while (studio.getSnapshot().history.canRedo && guard < 900) {
					studio.dispatch({ type: 'history/redo' });
					back.push(work());
					guard += 1;
				}
				expect(back).toEqual(seen.slice(0, -1).reverse());
				studio.dispose();
				expect(time.pending).toBe(0);
			}),
			{ numRuns: 150, seed: 20261026 },
		);
	}, 60_000);
});
