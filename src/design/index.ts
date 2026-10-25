export type {
	BuildContext,
	BuiltScene,
	Box,
	DesignAsset,
	DesignConstraints,
	DesignFrame,
	DesignLogo,
	DesignOverlay,
	DesignPaint,
	DesignRegistries,
	DesignStop,
	EntryRef,
	FillEntry,
	FontRegistry,
	FrameEntry,
	FrameLayout,
	FrameLayoutContext,
	FrameTextBox,
	Ink,
	LogoIcon,
	LogoPlate,
	ModuleShape,
	ModuleShapeContext,
	Neighbours,
	ParamOption,
	ParamSchema,
	ParamValue,
	Preset,
	PresetCategory,
	QrDesignV1,
	RegionKind,
	RegionRole,
	RegionShape,
	RegionShapeContext,
	RegionStyle,
	ResolvedParams,
	RingKind,
} from './types.js';
export { DESIGN_VERSION, LIMITS, MIN_QUIET_ZONE, defaultDesign } from './document.js';
export { createDesignRegistries } from './registries.js';
export { validateDesign } from './validate.js';
export { migrateDesign } from './migrate.js';
export { applyConstraints } from './constraints.js';
export {
	LINK_PREFIX,
	MAX_LINK_JSON,
	MAX_LINK_LENGTH,
	decodeDesignLink,
	designLink,
	encodeDesignLink,
} from './link.js';
export { canonicalJson } from './canonical.js';
export { buildScene } from './scene.js';
export { direction, inkColour, linearPaint, paintSpace, resolvePaint } from './paint.js';
export { paramProblem, resolveParams } from './params.js';
export type { ParamProblem } from './params.js';
export {
	EAST,
	NEIGHBOUR_OFFSETS,
	NORTH,
	NORTH_EAST,
	NORTH_WEST,
	SOUTH,
	SOUTH_EAST,
	SOUTH_WEST,
	WEST,
	neighbourMasks,
} from './neighbours.js';
export {
	FINDER_PIXELS,
	FINDER_TOLERANCE,
	LIGHT_RING_MIN,
	finderProblems,
	outlineGap,
	regionPairConforms,
	regionPath,
	ringKindOf,
} from './finder.js';
export type { FinderProblem } from './finder.js';
export { ICON_STROKE } from './catalogue/icons.js';
