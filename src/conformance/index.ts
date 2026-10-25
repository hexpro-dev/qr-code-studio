export type { Violation } from './types.js';
export { sampleParams } from './sample.js';
export {
	CENTRE_CROSS_ARM,
	CENTRE_CROSS_MIN,
	LIGHT_DISC_RADIUS,
	MODULE_PIXELS,
	checkModuleShape,
} from './module-shape.js';
export type { ModuleShapeCheckOptions } from './module-shape.js';
export { checkRegionShape } from './region-shape.js';
export type { RegionShapeCheckOptions } from './region-shape.js';
export { FRAME_SIZES, checkFrame } from './frame.js';
export type { FrameCheckOptions, FrameSize } from './frame.js';
export {
	MIN_CONTRAST,
	checkPreset,
	contrast,
	darkInks,
	emptySymbol,
	luminance,
	paintInks,
} from './preset.js';
export type { PresetVerifier } from './preset.js';
