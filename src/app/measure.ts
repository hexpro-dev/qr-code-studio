/**
 * What the code measures, and the sample drawn before there is a code.
 */

import { buildScene } from '../design/scene.js';
import type { QrDesignV1 } from '../design/types.js';
import { encode } from '../encode/encode.js';
import type { Registries } from '../registries.js';
import { sceneToSvg } from '../render/svg.js';
import type { Scene } from '../render/types.js';
import { DEFAULT_PRINT_MM, SAMPLE_CONTENT } from '../studio/index.js';
import type { StudioSnapshot, SymbolView } from '../studio/index.js';

/** CSS pixels to the millimetre, as the CSS specification fixes them: 96 to the inch. */
export const CSS_PX_PER_MM = 96 / 25.4;

/**
 * How wide the artwork prints, in millimetres: the design's own size when it
 * has one (read from the scene, as an export reads it), otherwise the scan
 * conditions' size, which measures the symbol with its quiet zone.
 */
export function printedWidthMm(
	scene: Scene,
	view: SymbolView | null,
	snapshot: StudioSnapshot,
): number {
	if (scene.unitsPerMm !== undefined && scene.unitsPerMm > 0) return scene.width / scene.unitsPerMm;
	const symbolWidth = view === null ? scene.width : view.modules[0] + 2 * view.quietZone;
	const size = snapshot.document.conditions.sizeMm ?? DEFAULT_PRINT_MM;
	return (scene.width * size) / symbolWidth;
}

export interface Sample {
	readonly svg: string;
	readonly scene: Scene;
}

/**
 * The sample code, drawn with the person's design, for the moment before they
 * have typed anything. It holds the address RFC 2606 reserves for examples,
 * and the proof marks it as a sample in words.
 */
export function drawSample(registries: Registries, design: QrDesignV1): Sample | null {
	// A picture logo needs its decoded pixels, which the studio keeps to itself;
	// the sample goes without it rather than draw a gap.
	const drawn: QrDesignV1 =
		design.logo !== null && design.logo.source.kind === 'asset'
			? { ...design, logo: null }
			: design;
	const attempts: readonly QrDesignV1[] = [
		drawn,
		{ ...drawn, symbol: { symbology: 'qr', ecLevel: drawn.symbol.ecLevel ?? 'M' } },
	];
	for (const candidate of attempts) {
		try {
			const symbol = encode(
				SAMPLE_CONTENT,
				{
					symbology: candidate.symbol.symbology,
					...(candidate.symbol.ecLevel === undefined ? {} : { ecLevel: candidate.symbol.ecLevel }),
				},
				registries.symbologies,
			);
			const scene = buildScene(symbol, candidate, { registries: registries.design, seed: 1 }).scene;
			return { svg: sceneToSvg(scene, { idPrefix: 'sample-' }), scene };
		} catch {
			// A symbology too small for the sample, or a design that cannot draw:
			// try plain QR, then give up and show the empty sheet.
		}
	}
	return null;
}
