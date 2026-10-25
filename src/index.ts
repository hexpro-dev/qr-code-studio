/**
 * The everyday surface: make a code, design it, draw it.
 *
 * Kept small on purpose. The reader, the print writers and the fonts are each
 * tens of kilobytes that most callers never need, so they are subpaths of
 * their own (`./decode`, `./render`, `./text`) and nothing here imports them;
 * tests/studio/root.test.ts bundles this file and fails if one creeps in.
 */

export * from './core/index.js';
export { encode, encodeStructuredAppend } from './encode/index.js';
export type { EncodeOptions } from './encode/index.js';
export { createRegistries } from './registries.js';
export type { Registries } from './registries.js';
export {
	applyConstraints,
	decodeDesignLink,
	defaultDesign,
	designLink,
	encodeDesignLink,
	migrateDesign,
	validateDesign,
} from './design/index.js';
export { buildScene } from './design/scene.js';
export type { BuiltScene, DesignRegistries, QrDesignV1 } from './design/index.js';
export { sceneToSvg } from './render/svg.js';
export type { Scene } from './render/types.js';
export type { BuiltSymbol } from './symbology/types.js';
