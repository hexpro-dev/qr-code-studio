/**
 * A ring and a centre captured as the scan check captures a print.
 *
 * The design layer's finder conformance measures a pair on pictures drawn
 * sharp at 6 and 8 pixels a module. A photograph is softer than that, and a
 * styled finder that reads among square modules can fail among dots: the
 * light round each dot changes what the reader's threshold makes of the
 * finder and of the alignment patterns, which take the finder's style. So
 * each pair is also put in a whole code, among one family's modules, and
 * read from the scan check's own captures: a short and a long link at their
 * own level, at 6, 8 and 10 pixels a module, clean and with ink spread (even
 * seeds) or starved (odd seeds) by 0.05 of a module, each seed placed,
 * turned and blurred as the clean capture is.
 *
 * Conformance takes this as a hook (`RegionCaptureReader`), as it takes the
 * preset scan check, because captures belong to the layer above it.
 */

import { defaultDesign } from '../design/document.js';
import type { DesignRegistries, EntryRef, QrDesignV1 } from '../design/types.js';
import { createSymbologyRegistry } from '../symbology/registry.js';
import { renderCapture } from './capture.js';
import { masterResolution } from './job.js';
import { prepare, renderMaster } from './prepare.js';
import type { ContentSize } from './preset.js';
import { PRESET_CONTENT } from './preset.js';
import { strictRead } from './read.js';

export interface RegionCaptureReaderOptions {
	/** Seeds read at each density and condition, from 0. Default 8. */
	readonly seeds?: number;
	/** Pixels a module. Default 6, 8 and 10. */
	readonly densities?: readonly number[];
	/** Default a short and a long link. */
	readonly contents?: readonly ContentSize[];
}

export interface RegionCaptureResult {
	readonly captures: number;
	/** One entry per condition that missed: content, pixels a module, condition and how many seeds. */
	readonly missed: readonly string[];
	readonly missedCount: number;
}

/** Reads a finder of `ring` round `centre` among modules of `module`, and says what it missed. */
export type RegionCaptureReader = (
	module: EntryRef,
	ring: EntryRef,
	centre: EntryRef,
	registries: DesignRegistries,
) => RegionCaptureResult;

/** Ink moved this many modules each way: the ink axis's everyday level. */
const INK = 0.05;

export function regionCaptureReader(options: RegionCaptureReaderOptions = {}): RegionCaptureReader {
	const seeds = options.seeds ?? 8;
	const densities = options.densities ?? [6, 8, 10];
	const contents = options.contents ?? (['small', 'large'] as const);
	return (module, ring, centre, design) => {
		const base = defaultDesign();
		const subject: QrDesignV1 = {
			...base,
			modules: { ...base.modules, shape: module },
			regions: { finder: { outer: ring, inner: centre } },
		};
		const registries = { symbologies: createSymbologyRegistry(), design };
		const missed: string[] = [];
		let captures = 0;
		let missedCount = 0;
		for (const content of contents) {
			const prepared = prepare(
				{
					content: PRESET_CONTENT[content],
					design: subject,
					conditions: { sizeMm: null, dpi: null, distanceMm: null },
					seed: 1,
					requires: [],
					captureSeeds: seeds,
				},
				registries,
			);
			const master = renderMaster(prepared, masterResolution(Math.max(...densities)));
			const { width, height } = prepared.built.scene;
			for (const pxPerModule of densities) {
				for (const [axis, level] of [
					['baseline', 0],
					['ink', INK],
				] as const) {
					let bad = 0;
					for (let seed = 0; seed < seeds; seed += 1) {
						const { image } = renderCapture(master, width, height, 1, {
							axis,
							level,
							seed,
							pxPerModule,
						});
						captures += 1;
						if (!strictRead(image, prepared).read) bad += 1;
					}
					if (bad > 0) {
						missedCount += bad;
						missed.push(`${content} link at ${pxPerModule} px, ${axis}: ${bad} of ${seeds}`);
					}
				}
			}
		}
		return { captures, missed, missedCount };
	};
}
