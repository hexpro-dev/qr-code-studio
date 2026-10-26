/**
 * The size a preset is promised to scan at, for the level a design asks for.
 *
 * A preset's `minSizeMm` is measured at its own level. Raising the level
 * makes the same content take a larger symbol, whose modules are smaller at
 * the same printed width, so each allowed level has a size of its own
 * (`sizesMm`). Anything that suggests or defaults a print size from a preset
 * asks here with the level the design will be built at.
 */

import type { EcLevel } from '../segment/types.js';
import type { Preset } from './types.js';

/** The smallest printed width, in millimetres, `preset` scans at with `level` (default its own). */
export function presetSizeMm(preset: Preset, level?: EcLevel): number {
	return level === undefined ? preset.minSizeMm : (preset.sizesMm?.[level] ?? preset.minSizeMm);
}
