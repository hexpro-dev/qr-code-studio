/**
 * Conservativeness, end to end: every capture the scan check counts as
 * passing is also read, to the same text, by zxing-cpp (through zxing-wasm)
 * and by jsQR.
 *
 * The decode layer holds its strict profile to that over its own corpus.
 * This holds the whole chain to it: real designs (presets with logos,
 * frames, gradients and shaped modules), through this layer's own print and
 * camera model, at the levels the ladders really ask for. A capture that the
 * strict profile passes and either reader fails is a design the check would
 * pass and a phone could fail, which is the one mistake the check must not
 * make.
 *
 * The default corpus is a sample sized for the ordinary run; set
 * QRS_VERIFY_NIGHTLY=1 for every QR preset, every level and every seed.
 */

import { describe, expect, it } from 'vitest';
import { renderCapture } from '../../src/verify/capture.js';
import { framingPxPerModule, LADDERS } from '../../src/verify/ladders.js';
import { prepare, renderMaster } from '../../src/verify/prepare.js';
import { strictRead } from '../../src/verify/read.js';
import { jsqrText, zxingTexts } from '../design/oracles.js';
import { CONTENT, registries } from './helpers.js';

const NIGHTLY = process.env.QRS_VERIFY_NIGHTLY === '1';

const DESIGNS = NIGHTLY
	? registries.design.presets.list().map((preset) => preset.id)
	: ['classic-black', 'rounded-link', 'fluid-lagoon', 'shop-tag'];

const SEEDS = NIGHTLY ? 8 : 1;

interface Tally {
	strict: number;
	both: number;
	misses: string[];
}

async function survey(id: string, tally: Tally): Promise<void> {
	const design = registries.design.presets.require(id).design;
	const prepared = prepare(
		{
			content: CONTENT,
			design,
			conditions: { sizeMm: 40, dpi: null, distanceMm: null },
			seed: 3,
			requires: [],
		},
		registries,
	);
	const across = prepared.symbol.matrix.width + 2 * prepared.quietZone;
	const framing = framingPxPerModule(across, prepared.moduleMm);
	const master = renderMaster(prepared, 16);
	const { width, height } = prepared.built.scene;
	for (const ladder of LADDERS) {
		// The ordinary run samples the mildest level and the everyday one, where passes are.
		const levels = NIGHTLY
			? ladder.levels
			: ladder.levels.filter((level, i) => i === 0 || level === ladder.typical);
		for (const level of levels) {
			for (let seed = 0; seed < SEEDS; seed += 1) {
				const spec = {
					axis: ladder.axis,
					level,
					seed,
					pxPerModule: ladder.axis === 'distance' ? level : framing,
				};
				const { image } = renderCapture(master, width, height, 3, spec);
				if (!strictRead(image, prepared).read) continue;
				tally.strict += 1;
				const zxing = (await zxingTexts(image)).includes(CONTENT);
				const jsqr = jsqrText(image) === CONTENT;
				if (zxing && jsqr) tally.both += 1;
				else
					tally.misses.push(
						`${id} ${ladder.axis} ${level} seed ${seed}: zxing ${zxing}, jsQR ${jsqr}`,
					);
			}
		}
	}
}

describe('every capture the scan check passes', () => {
	it('is read by zxing-cpp and by jsQR', async () => {
		const tally: Tally = { strict: 0, both: 0, misses: [] };
		for (const id of DESIGNS) await survey(id, tally);
		expect(tally.strict).toBeGreaterThan(NIGHTLY ? 1000 : 30);
		expect(tally.misses).toEqual([]);
		expect(tally.both).toBe(tally.strict);
	}, 600_000);
});
