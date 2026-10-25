/**
 * opentype.js ships no types. The tests use it as an oracle through `parse`
 * alone and describe the parts of the result they read where they read them,
 * so this says only that the module exists and what `parse` takes.
 */
declare module 'opentype.js' {
	export function parse(buffer: ArrayBuffer): unknown;
}
