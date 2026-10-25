/**
 * The design registries, filled with the built-ins.
 *
 * Fresh instances every call, so a caller that registers a shape of its own
 * changes no other registry, and nothing is registered at import.
 */

import { Registry } from '../core/registry.js';
import { BUILT_IN_FILLS } from './catalogue/fills.js';
import { BUILT_IN_FRAMES } from './catalogue/frames.js';
import { builtInIcons } from './catalogue/icons.js';
import { BUILT_IN_MODULE_SHAPES } from './catalogue/module-shapes.js';
import { builtInPresets } from './catalogue/presets.js';
import { BUILT_IN_REGION_SHAPES } from './catalogue/region-shapes.js';
import type { DesignRegistries } from './types.js';

export function createDesignRegistries(): DesignRegistries {
	return {
		moduleShapes: new Registry('module-shape', BUILT_IN_MODULE_SHAPES),
		regionShapes: new Registry('region-shape', BUILT_IN_REGION_SHAPES),
		fills: new Registry('fill', BUILT_IN_FILLS),
		frames: new Registry('frame', BUILT_IN_FRAMES),
		icons: new Registry('icon', builtInIcons()),
		presets: new Registry('preset', builtInPresets()),
	};
}
