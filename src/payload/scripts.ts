/**
 * Which writing system each letter of a host belongs to, for the three that
 * matter to lookalike hosts: Latin, Cyrillic and Greek.
 *
 * A label that mixes them is almost never real. Japanese, Chinese and Korean
 * names mix scripts as a matter of course, which is why only these three are
 * compared and everything else counts as "other". The ranges are the Unicode
 * blocks for each script (Unicode 15.1, Blocks.txt), which is coarser than the
 * Script property and is enough for this: a host has no reason to hold a
 * Latin letter from an obscure extension block either.
 */

export type HostScript = 'latin' | 'cyrillic' | 'greek' | 'other';

const RANGES: readonly (readonly [number, number, HostScript])[] = [
	[0x0041, 0x005a, 'latin'],
	[0x0061, 0x007a, 'latin'],
	[0x00c0, 0x024f, 'latin'],
	[0x1e00, 0x1eff, 'latin'],
	[0x2c60, 0x2c7f, 'latin'],
	[0xa720, 0xa7ff, 'latin'],
	[0xab30, 0xab6f, 'latin'],
	[0xff21, 0xff3a, 'latin'],
	[0xff41, 0xff5a, 'latin'],
	[0x0370, 0x03ff, 'greek'],
	[0x1f00, 0x1fff, 'greek'],
	[0x0400, 0x052f, 'cyrillic'],
	[0x1c80, 0x1c8f, 'cyrillic'],
	[0x2de0, 0x2dff, 'cyrillic'],
	[0xa640, 0xa69f, 'cyrillic'],
];

/** The script of one code point, or undefined for digits, the hyphen and other shared characters. */
export function scriptOf(codePoint: number): HostScript | undefined {
	// The multiplication and division signs sit inside Latin-1's letter range.
	if (codePoint === 0xd7 || codePoint === 0xf7) return undefined;
	for (const [from, to, script] of RANGES) {
		if (codePoint >= from && codePoint <= to) return script;
	}
	// Anything above ASCII that is not one of the three is a letter of some
	// other script, or a symbol, and either way is not confusable here.
	return codePoint > 0x7f ? 'other' : undefined;
}

/** The scripts a label uses, ignoring the characters every script shares. */
export function scriptsIn(label: string): ReadonlySet<HostScript> {
	const found = new Set<HostScript>();
	for (const char of label) {
		const script = scriptOf(char.codePointAt(0) as number);
		if (script !== undefined) found.add(script);
	}
	return found;
}

/** True when a label combines Latin, Cyrillic or Greek letters with each other. */
export function isMixedScript(label: string): boolean {
	const scripts = scriptsIn(label);
	let confusable = 0;
	for (const script of ['latin', 'cyrillic', 'greek'] as const)
		if (scripts.has(script)) confusable += 1;
	return confusable > 1;
}

/**
 * Cyrillic and Greek lower-case letters that render like a Latin letter,
 * from the Unicode confusables data (UTS #39, confusables.txt). Hosts are
 * lower case after WHATWG processing, so only lower case is listed.
 */
const LATIN_LOOKALIKES = new Set(
	[
		// Cyrillic: a, e, o, p, c, y, x, s, i, j, d, l, h, q, w, y.
		0x0430, 0x0435, 0x043e, 0x0440, 0x0441, 0x0443, 0x0445, 0x0455, 0x0456, 0x0458, 0x0501, 0x04cf,
		0x04bb, 0x051b, 0x051d, 0x04af,
		// Greek: o, a, v, p, i, k, u, x, c, j.
		0x03bf, 0x03b1, 0x03bd, 0x03c1, 0x03b9, 0x03ba, 0x03c5, 0x03c7, 0x03f2, 0x03f3,
	].map((code) => String.fromCodePoint(code)),
);

/**
 * True when a label is written entirely in Cyrillic or Greek letters that each
 * look like a Latin one, so the whole label reads as a Latin word that it is
 * not: "аррӏе" in Cyrillic. UTS #39 calls this a whole-script confusable.
 */
export function isWholeScriptLookalike(label: string): boolean {
	const scripts = scriptsIn(label);
	if (scripts.size !== 1 || !(scripts.has('cyrillic') || scripts.has('greek'))) return false;
	for (const char of label) {
		if (scriptOf(char.codePointAt(0) as number) === undefined) continue;
		if (!LATIN_LOOKALIKES.has(char)) return false;
	}
	return true;
}
