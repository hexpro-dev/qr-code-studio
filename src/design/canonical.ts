/**
 * Canonical JSON for designs: the same design always writes the same text.
 *
 * JSON.stringify writes keys in the order they were added, so two equal
 * designs built in different orders would give two different links. Here
 * every key the schema knows has a fixed rank, keys it does not know
 * (parameter names, embedded image ids) follow in code unit order, and
 * numbers are written as ECMAScript specifies them, which is the same in
 * every engine.
 */

const ORDER: readonly string[] = [
	'schema',
	'version',
	'name',
	'symbol',
	'symbology',
	'ecLevel',
	'boostEc',
	'minVersion',
	'maxVersion',
	'mask',
	'segmentation',
	'kanji',
	'eci',
	'quietZone',
	'background',
	'modules',
	'shape',
	'paint',
	'light',
	'regions',
	'finder',
	'sub-finder',
	'corner-finder',
	'outer',
	'inner',
	'outerPaint',
	'innerPaint',
	'logo',
	'source',
	'size',
	'clear',
	'padding',
	'plate',
	'frame',
	'ref',
	'text',
	'content',
	'fontId',
	'output',
	'sizeMm',
	'sizeBasis',
	'dpi',
	'colourSpace',
	'assets',
	'png',
	'width',
	'height',
	'kind',
	'id',
	'params',
	'ink',
	'srgb',
	'cmyk',
	'angle',
	'cx',
	'cy',
	'radius',
	'stops',
	'offset',
	'space',
];

const RANK = new Map(ORDER.map((key, i) => [key, i]));

function compare(a: string, b: string): number {
	const ra = RANK.get(a);
	const rb = RANK.get(b);
	if (ra !== undefined && rb !== undefined) return ra - rb;
	if (ra !== undefined) return -1;
	if (rb !== undefined) return 1;
	// An object's keys are distinct, so two never compare equal.
	return a < b ? -1 : 1;
}

/** The value as canonical JSON. Keys whose value is undefined are left out, as JSON leaves them. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
	}
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort(compare);
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}
