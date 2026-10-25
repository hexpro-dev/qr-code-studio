/**
 * The conservativeness property over styled designs.
 *
 * Every design preset, built by the design layer over seeded content,
 * rasterised by the render layer and photographed by the verify layer's
 * camera model (tests/helpers/styled.ts): clean captures at 4 to 12 pixels a
 * module, the pinhole tilt the angle axis uses, and the corpus's damage
 * ladders on top. The same property as for plain renders (conservative.ts):
 * whatever strict-v1 reads, reserve applied, zxing-cpp and jsQR both read to
 * the same text.
 *
 * And the other side, which is what the styled corpus was added for: strict
 * must not refuse styling the readers it is held to read. Of the clean
 * captures at 6 pixels a module or more that both oracles read, it reads at
 * least 95 per cent, and of the captures tilted 20 degrees that both read, at
 * least 95 per cent of those whose finders have straight-sided rings. Round
 * and dotted rings are refused at a slant (see finderRingsTraceable): zxing-
 * cpp misses most of them there, and the ones it reads cannot be told from the
 * ones it does not, so the strict reader gives those up.
 *
 * One file rather than shards, because the read rates are over the whole
 * corpus: a preset the strict reader refuses on purpose (a ring of dots, see
 * finderRingsTraceable) would otherwise weigh more in one shard than another.
 * QR_DECODE_NIGHTLY=1 runs every preset over four seeds, every density, three
 * tilts and every damage kind at two severities.
 */

import { describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/decode/decoder.js';
import type { Preset } from '../../src/design/types.js';
import type { DamageKind } from '../helpers/corpus.js';
import { DAMAGE_KINDS } from '../helpers/corpus.js';
import { jsqrText, zxingTexts } from '../helpers/oracles.js';
import type { StyledOptions } from '../helpers/styled.js';
import { presets, styledCapture } from '../helpers/styled.js';
import { keepsReserve } from './conservative.js';

const NIGHTLY = process.env.QR_DECODE_NIGHTLY === '1';

/**
 * Violations the nightly run tolerates, listed when there are more.
 *
 * Zero at the default size. At nightly size there is one known: charcoal-dots,
 * whose finders are rings of dots, under the corpus's blur at 0.5, version 4
 * at 8 pixels a module, seed 8200. The blur joins the dots into a solid ring,
 * which the strict profile and jsQR read and zxing-cpp at its default effort
 * does not (with its denoising switched on, it does), as with the plain
 * corpus's seed 17078. The strict profile read it before its styled rules too,
 * and its finders measure as solid, cornered, closed rings in both thresholds,
 * as the blurred dot rings zxing-cpp does read do.
 */
const NIGHTLY_TOLERANCE = 1;

/** Rings the strict reader refuses at a slant: no straight side to trace. */
const UNTRACEABLE_RINGS = new Set(['circle', 'dot-ring']);

type Purpose = 'clean' | 'tilt' | 'damage';

interface Case {
	readonly purpose: Purpose;
	readonly options: StyledOptions;
}

function cases(preset: Preset, index: number): Case[] {
	const out: Case[] = [];
	const seeds = NIGHTLY ? 4 : 1;
	for (let s = 0; s < seeds; s += 1) {
		const seed = 7000 + index * 100 + s;
		const clean: [number, number][] = NIGHTLY
			? [
					[4, 2],
					[6, 3],
					[8, 4],
					[10, 6],
					[12, 8],
				]
			: [
					[6, 3],
					[10, 6],
				];
		for (const [modulePixels, version] of clean) {
			out.push({ purpose: 'clean', options: { preset, modulePixels, version, seed } });
		}
		for (const tilt of NIGHTLY ? [10, 20, 30] : [20]) {
			out.push({ purpose: 'tilt', options: { preset, modulePixels: 10, version: 2, seed, tilt } });
			out.push({ purpose: 'tilt', options: { preset, modulePixels: 8, version: 7, seed, tilt } });
		}
		const kinds: readonly DamageKind[] = NIGHTLY
			? DAMAGE_KINDS
			: [DAMAGE_KINDS[(index + s) % DAMAGE_KINDS.length] as DamageKind];
		for (const kind of kinds) {
			for (const severity of NIGHTLY ? [0.25, 0.5] : [0.4]) {
				out.push({
					purpose: 'damage',
					options: { preset, modulePixels: 8, version: 4, seed, kind, severity },
				});
			}
		}
	}
	return out;
}

interface Tally {
	readonly violations: string[];
	/** Clean captures at 6 pixels a module or more that both oracles read, and how many strict read. */
	readonly clean: { both: number; strict: number };
	/** Captures tilted 20 degrees with straight-ringed finders that both oracles read, and how many strict read. */
	readonly tilt: { both: number; strict: number };
	/** What strict missed of those, for the failure message. */
	readonly missed: string[];
}

async function run(item: Case, tally: Tally): Promise<void> {
	const shot = styledCapture(item.options);
	const result = decodeImage(shot.image, { profile: 'strict-v1' });
	const strict = result.ok
		? result.value
				.filter((found) => keepsReserve(found.read))
				.map((found) => found.read.bitstream.text)
		: [];
	const zxing = await zxingTexts(shot.image);
	const jsqr = jsqrText(shot.image);
	const both = zxing.includes(shot.text) && jsqr === shot.text;
	const read = strict.includes(shot.text);
	for (const text of strict) {
		if (!zxing.includes(text) || jsqr !== text) {
			tally.violations.push(
				`${shot.preset} ${item.purpose} version ${shot.version} at ${shot.modulePixels} px, tilt ${shot.tilt}, ${shot.kind} ${shot.severity}, seed ${item.options.seed}: zxing ${zxing.includes(text)}, jsQR ${jsqr === text}`,
			);
		}
	}
	if (!both) return;
	const where = `${shot.preset} version ${shot.version} at ${shot.modulePixels} px, tilt ${shot.tilt}, seed ${item.options.seed}`;
	if (item.purpose === 'clean' && shot.modulePixels >= 6) {
		tally.clean.both += 1;
		if (read) tally.clean.strict += 1;
		else tally.missed.push(where);
	}
	const ring = item.options.preset.design.regions.finder?.outer.id ?? 'square';
	if (item.purpose === 'tilt' && shot.tilt === 20 && !UNTRACEABLE_RINGS.has(ring)) {
		tally.tilt.both += 1;
		if (read) tally.tilt.strict += 1;
		else tally.missed.push(where);
	}
}

describe('strict-v1 on styled designs against zxing-cpp and jsQR', () => {
	const tally: Tally = {
		violations: [],
		clean: { both: 0, strict: 0 },
		tilt: { both: 0, strict: 0 },
		missed: [],
	};
	presets().forEach((preset, index) => {
		it(
			preset.id,
			async () => {
				for (const item of cases(preset, index)) await run(item, tally);
			},
			1_800_000,
		);
	});
	it('reads nothing either oracle cannot, and nearly all of what both can', () => {
		const violations = tally.violations.join('\n');
		expect(tally.violations.length, violations).toBeLessThanOrEqual(
			NIGHTLY ? NIGHTLY_TOLERANCE : 0,
		);
		const missed = tally.missed.join('\n');
		expect(tally.clean.strict, missed).toBeGreaterThanOrEqual(Math.ceil(tally.clean.both * 0.95));
		expect(tally.tilt.strict, missed).toBeGreaterThanOrEqual(Math.ceil(tally.tilt.both * 0.95));
	});
});
