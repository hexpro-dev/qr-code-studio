export { FontMalformedError } from './errors.js';
export type { FontFailure } from './errors.js';
export { COMPILED_VERSION, loadCompiledFont } from './compiled.js';
export type { CompiledFontData } from './compiled.js';
export { MAX_DEPTH, MAX_POINTS } from './glyf.js';
export { MAX_SUBTABLES } from './kerning.js';
export { MAX_TEXT_LENGTH, layoutText, textToPaths } from './layout.js';
export { drawOutline, outlinePath } from './outline.js';
export { BUILT_IN_FONTS, builtInFonts, createFontRegistry } from './registry.js';
export { MAX_FONT_BYTES, parseTrueType } from './truetype.js';
export type { ParseFontOptions } from './truetype.js';
export type {
	Font,
	FontRegistry,
	GlyphOutline,
	LayoutLine,
	LayoutOptions,
	LayoutResult,
	TextAlign,
	TextBox,
} from './types.js';
