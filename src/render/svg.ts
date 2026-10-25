/**
 * The SVG writer.
 *
 * The output is ours from end to end: every number is formatted here, every
 * colour is rebuilt from checked channels (see `colour.ts`), every id is the
 * caller's checked prefix and a counter, and the only text from outside is
 * the title, which is escaped and stripped of what XML cannot hold. Nothing a
 * person supplied is passed through as markup, so an export can be pasted
 * into a page or opened in an editor without anyone having to trust it.
 *
 * The same scene always gives the same bytes: numbers have a fixed number of
 * decimals, defs are numbered in document order, and nothing depends on the
 * engine, the locale or the time.
 */

import { walkPath } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { formatColour } from './colour.js';
import { normaliseScene } from './scene.js';
import type { NormalNode, NormalPaint, NormalStop } from './scene.js';
import type { Colour, Scene } from './types.js';

export interface SvgOptions {
	/**
	 * Starts every id this document defines, so two exports inlined into one
	 * page cannot collide. A letter or underscore, then letters, digits,
	 * underscores and hyphens. Default `qrs-`.
	 */
	readonly idPrefix?: string;
	/** One element a line, indented with tabs. Default false. */
	readonly pretty?: boolean;
}

const ID_PREFIX = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Decimals kept in every coordinate: a ten thousandth of a user unit. */
const DECIMALS = 4;

/**
 * A number as SVG text, the same in every engine.
 *
 * `toFixed` is specified exactly by ECMAScript (the nearest decimal to the
 * double's true value, ties to the larger), unlike `toString`, whose digit
 * choice engines have historically disagreed on at the edges. Trailing zeros
 * are trimmed, and a negative zero is written as 0. Past 1e21 `toFixed` gives
 * exponent form, which SVG reads too.
 */
export function formatNumber(value: number): string {
	if (!Number.isFinite(value)) throw new TypeError('formatNumber: not a finite number.');
	let text = value.toFixed(DECIMALS);
	if (text.includes('e')) return text;
	text = text.replace(/\.?0+$/, '');
	return text === '-0' ? '0' : text;
}

/**
 * Escape for an attribute value or a text node.
 *
 * All five, so the result is safe in either place and in a `data:` URI.
 * `&#39;` rather than `&apos;`, which HTML 4 never defined.
 */
function escapeXml(text: string): string {
	if (!/[&<>"']/.test(text)) return text;
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Replace what XML 1.0 cannot carry with U+FFFD.
 *
 * The C0 controls other than tab, line feed and carriage return have no legal
 * spelling in XML at all, escaped or not, and neither do U+FFFE, U+FFFF or an
 * unpaired surrogate. A title holding one would make the whole file
 * unreadable to an XML parser, so they are swapped for the replacement
 * character rather than refused: the title is a label, not data.
 */
function xmlSafe(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i += 1) {
		const unit = text.charCodeAt(i);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const low = text.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				out += text[i] + text[i + 1];
				i += 1;
				continue;
			}
			out += '�';
			continue;
		}
		const illegal =
			(unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) ||
			(unit >= 0xdc00 && unit <= 0xdfff) ||
			unit === 0xfffe ||
			unit === 0xffff;
		out += illegal ? '�' : text[i];
	}
	return out;
}

/** SVG path data for a path, normalised by `walkPath`. */
export function pathData(path: Path): string {
	const parts: string[] = [];
	const n = formatNumber;
	walkPath(
		path,
		{
			move(x, y) {
				parts.push(`M${n(x)} ${n(y)}`);
			},
			line(x, y) {
				parts.push(`L${n(x)} ${n(y)}`);
			},
			quad(cx, cy, x, y) {
				parts.push(`Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`);
			},
			cubic(c1x, c1y, c2x, c2y, x, y) {
				parts.push(`C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`);
			},
			close() {
				parts.push('Z');
			},
		},
		'sceneToSvg',
	);
	return parts.join('');
}

type Attributes = readonly (readonly [string, string])[];

/** Collects markup with optional indentation, and numbers the defs. */
class Writer {
	readonly body: string[] = [];
	readonly defs: string[] = [];
	private count = 0;

	constructor(
		private readonly prefix: string,
		private readonly pretty: boolean,
	) {}

	nextId(): string {
		this.count += 1;
		return `${this.prefix}${this.count}`;
	}

	line(target: string[], depth: number, text: string): void {
		target.push(this.pretty ? `${'\t'.repeat(depth)}${text}\n` : text);
	}

	static tag(name: string, attributes: Attributes, selfClosing: boolean): string {
		let text = `<${name}`;
		for (const [key, value] of attributes) text += ` ${key}="${escapeXml(value)}"`;
		return text + (selfClosing ? '/>' : '>');
	}
}

function colourAttributes(colour: Colour, name: 'fill' | 'stop'): [string, string][] {
	const hex = formatColour({ r: colour.r, g: colour.g, b: colour.b, a: 1 });
	const out: [string, string][] = [[name === 'fill' ? 'fill' : 'stop-color', hex]];
	if (colour.a !== 1) {
		out.push([name === 'fill' ? 'fill-opacity' : 'stop-opacity', formatNumber(colour.a)]);
	}
	return out;
}

function stopsMarkup(writer: Writer, stops: readonly NormalStop[], depth: number): void {
	for (const stop of stops) {
		writer.line(
			writer.defs,
			depth,
			Writer.tag(
				'stop',
				[['offset', formatNumber(stop.offset)], ...colourAttributes(stop.colour, 'stop')],
				true,
			),
		);
	}
}

/** The fill attributes for a paint, defining a gradient in the defs when one is needed. */
function fillAttributes(writer: Writer, paint: NormalPaint): [string, string][] {
	if (paint.kind === 'solid') return colourAttributes(paint.colour, 'fill');
	if (paint.kind === 'linear') {
		const id = writer.nextId();
		writer.line(
			writer.defs,
			2,
			Writer.tag(
				'linearGradient',
				[
					['id', id],
					['gradientUnits', 'userSpaceOnUse'],
					['x1', formatNumber(paint.x1)],
					['y1', formatNumber(paint.y1)],
					['x2', formatNumber(paint.x2)],
					['y2', formatNumber(paint.y2)],
				],
				false,
			),
		);
		stopsMarkup(writer, paint.stops, 3);
		writer.line(writer.defs, 2, '</linearGradient>');
		return [['fill', `url(#${id})`]];
	}
	if (paint.kind === 'radial') {
		const id = writer.nextId();
		writer.line(
			writer.defs,
			2,
			Writer.tag(
				'radialGradient',
				[
					['id', id],
					['gradientUnits', 'userSpaceOnUse'],
					['cx', formatNumber(paint.cx)],
					['cy', formatNumber(paint.cy)],
					['r', formatNumber(paint.r)],
				],
				false,
			),
		);
		stopsMarkup(writer, paint.stops, 3);
		writer.line(writer.defs, 2, '</radialGradient>');
		return [['fill', `url(#${id})`]];
	}
	throw new Error('sceneToSvg: conic paints are written once the deterministic maths has landed.');
}

function clipAttribute(writer: Writer, clip: Path): [string, string] {
	const id = writer.nextId();
	writer.line(writer.defs, 2, Writer.tag('clipPath', [['id', id]], false));
	writer.line(writer.defs, 3, Writer.tag('path', [['d', pathData(clip)]], true));
	writer.line(writer.defs, 2, '</clipPath>');
	return ['clip-path', `url(#${id})`];
}

function writeNode(writer: Writer, node: NormalNode, depth: number): void {
	if (node.kind === 'path') {
		const d = pathData(node.path);
		writer.line(
			writer.body,
			depth,
			Writer.tag('path', [['d', d], ...fillAttributes(writer, node.paint)], true),
		);
		return;
	}
	if (node.kind === 'group') {
		const attributes: [string, string][] = [];
		if (node.opacity !== 1) attributes.push(['opacity', formatNumber(node.opacity)]);
		if (node.clip !== null) attributes.push(clipAttribute(writer, node.clip));
		writer.line(writer.body, depth, Writer.tag('g', attributes, false));
		for (const child of node.children) writeNode(writer, child, depth + 1);
		writer.line(writer.body, depth, '</g>');
		return;
	}
	throw new Error('sceneToSvg: images are written once the PNG encoder has landed.');
}

/**
 * The scene as an SVG document.
 *
 * `viewBox` is the scene in user units. When the scene has a physical size,
 * `width` and `height` give it in millimetres so a print workflow places it at
 * that size; otherwise the document has no intrinsic size and fills whatever
 * box it is put in. The fill and clip rules are written once on the root,
 * where every element inherits them, rather than relying on the default.
 */
export function sceneToSvg(scene: Scene, options: SvgOptions = {}): string {
	const prefix = options.idPrefix ?? 'qrs-';
	if (typeof prefix !== 'string' || !ID_PREFIX.test(prefix)) {
		throw new TypeError(
			'sceneToSvg: idPrefix starts with a letter or underscore and holds only letters, digits, underscores and hyphens.',
		);
	}
	const normal = normaliseScene(scene, 'sceneToSvg');
	const writer = new Writer(prefix, options.pretty === true);

	if (normal.background.kind !== 'none') {
		writer.line(
			writer.body,
			1,
			Writer.tag(
				'rect',
				[
					['width', formatNumber(normal.width)],
					['height', formatNumber(normal.height)],
					...fillAttributes(writer, normal.background),
				],
				true,
			),
		);
	}
	for (const layer of normal.layers) writeNode(writer, layer, 1);

	const root: [string, string][] = [
		['xmlns', 'http://www.w3.org/2000/svg'],
		['viewBox', `0 0 ${formatNumber(normal.width)} ${formatNumber(normal.height)}`],
	];
	if (normal.unitsPerMm !== null) {
		root.push(['width', `${formatNumber(normal.width / normal.unitsPerMm)}mm`]);
		root.push(['height', `${formatNumber(normal.height / normal.unitsPerMm)}mm`]);
	}
	root.push(['role', 'img'], ['fill-rule', 'nonzero'], ['clip-rule', 'nonzero']);

	const out: string[] = [];
	writer.line(out, 0, Writer.tag('svg', root, false));
	if (normal.title !== null) {
		writer.line(out, 1, `<title>${escapeXml(xmlSafe(normal.title))}</title>`);
	}
	if (writer.defs.length > 0) {
		writer.line(out, 1, '<defs>');
		out.push(...writer.defs);
		writer.line(out, 1, '</defs>');
	}
	out.push(...writer.body);
	writer.line(out, 0, '</svg>');
	return out.join('');
}
