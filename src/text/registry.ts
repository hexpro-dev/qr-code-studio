/**
 * The fonts a caption can be set in.
 *
 * `createFontRegistry()` returns a new registry each time, holding the
 * built-in family (Regular and Bold, compiled from IBM Plex Sans into
 * `src/fonts/latin.ts`); the website adds a person's own font to its registry
 * with `register(parseTrueType(bytes, { id }))`. Nothing registers itself at
 * import.
 *
 * The built-in `Font` objects are made once, on first use, and shared by
 * every registry. They are frozen and hold only caches of their own decoded
 * tables, so sharing them is sharing data: a font registered with one
 * registry never appears in another.
 */

import { Registry } from '../core/registry.js';
import { PLEX_SANS_BOLD, PLEX_SANS_REGULAR } from '../fonts/latin.js';
import { loadCompiledFont } from './compiled.js';
import type { Font, FontRegistry } from './types.js';

/** The built-in ids, which design files refer to. */
export const BUILT_IN_FONTS = Object.freeze(['plex-sans-regular', 'plex-sans-bold'] as const);

let builtIns: readonly Font[] | undefined;

/** The built-in family's `Font` objects, made on first use. */
export function builtInFonts(): readonly Font[] {
	builtIns ??= Object.freeze([
		loadCompiledFont(PLEX_SANS_REGULAR),
		loadCompiledFont(PLEX_SANS_BOLD),
	]);
	return builtIns;
}

export function createFontRegistry(): FontRegistry {
	return new Registry<Font>('font', builtInFonts());
}
