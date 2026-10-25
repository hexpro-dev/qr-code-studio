import { Resvg } from '@resvg/resvg-js';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { PathBuilder } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';
import { parseColour } from '../../src/render/colour.js';
import { formatNumber, pathData, sceneToSvg } from '../../src/render/svg.js';
import type { Scene, SceneNode, ScenePaint } from '../../src/render/types.js';
import { sceneFor } from './scenes.js';

/**
 * Parse as XML, failing on any error rather than recovering.
 *
 * Two parsers, because neither is enough alone. xmldom gives a DOM to query
 * but forgives a bare ampersand and control characters; resvg's parser
 * (roxmltree) refuses both, and anything else XML 1.0 does not allow. xmldom's
 * warnings are let through: it warns about every U+FFFD, which is the
 * character this writer puts in place of what XML cannot hold.
 */
function parse(svg: string): Element {
	new Resvg(svg);
	const document = new DOMParser({
		onError: (level, message) => {
			if (level !== 'warning') throw new Error(`${level}: ${message}`);
		},
	}).parseFromString(svg, 'image/svg+xml');
	const root = document.documentElement;
	if (root === null) throw new Error('no root element');
	return root;
}

function elements(root: Element, name: string): Element[] {
	return Array.from(root.getElementsByTagName(name)) as Element[];
}

const square: Path = new PathBuilder().rect(1, 1, 2, 2).build();
const black = parseColour('#000000');

function sceneOf(layers: SceneNode[], extra: Partial<Scene> = {}): Scene {
	return { width: 10, height: 10, background: null, layers, ...extra };
}

function pathNode(paint: ScenePaint, path: Path = square): SceneNode {
	return { kind: 'path', path, paint };
}

describe('the parsers these tests rely on', () => {
	it('refuse what is not well formed', () => {
		const xmlns = 'xmlns="http://www.w3.org/2000/svg"';
		expect(() => parse(`<svg ${xmlns}><title>a & b</title></svg>`)).toThrow();
		expect(() => parse(`<svg ${xmlns}><title>\u0001</title></svg>`)).toThrow();
		expect(() => parse(`<svg ${xmlns}><title>a < b</title></svg>`)).toThrow();
		expect(() => parse(`<svg ${xmlns}><g></svg>`)).toThrow();
		expect(() => parse(`<svg ${xmlns}/>`)).not.toThrow();
	});
});

describe('formatNumber', () => {
	it('keeps four decimals, trims trailing zeros and never writes a negative zero', () => {
		expect(formatNumber(1)).toBe('1');
		expect(formatNumber(100)).toBe('100');
		expect(formatNumber(0.5)).toBe('0.5');
		expect(formatNumber(1 / 3)).toBe('0.3333');
		expect(formatNumber(2 / 3)).toBe('0.6667');
		expect(formatNumber(-1.25)).toBe('-1.25');
		expect(formatNumber(-0)).toBe('0');
		expect(formatNumber(-0.00001)).toBe('0');
		expect(formatNumber(1e21)).toBe('1e+21');
		expect(formatNumber(123456.00004)).toBe('123456');
	});

	it('refuses NaN and infinities', () => {
		expect(() => formatNumber(Number.NaN)).toThrow(TypeError);
		expect(() => formatNumber(Infinity)).toThrow(TypeError);
	});
});

describe('pathData', () => {
	it('writes every command, starting with a move', () => {
		const path = new PathBuilder()
			.lineTo(0, 0)
			.lineTo(1, 0)
			.quadTo(2, 0, 2, 1)
			.cubicTo(2, 2, 1, 3, 0.5, 3)
			.close()
			.build();
		expect(pathData(path)).toBe('M0 0L1 0Q2 0 2 1C2 2 1 3 0.5 3Z');
	});
});

describe('sceneToSvg', () => {
	it('is well formed XML with the root the contract describes', () => {
		const svg = sceneToSvg(sceneOf([pathNode({ kind: 'solid', colour: black })]));
		const root = parse(svg);
		expect(root.tagName).toBe('svg');
		expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
		expect(root.getAttribute('viewBox')).toBe('0 0 10 10');
		expect(root.getAttribute('role')).toBe('img');
		expect(root.getAttribute('fill-rule')).toBe('nonzero');
		expect(root.getAttribute('clip-rule')).toBe('nonzero');
		expect(root.hasAttribute('width')).toBe(false);
		expect(elements(root, 'title')).toHaveLength(0);
		expect(svg).toBe(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" fill-rule="nonzero" clip-rule="nonzero"><path d="M1 1L3 1L3 3L1 3Z" fill="#000000"/></svg>',
		);
	});

	it('gives a physical size in millimetres when the scene has one', () => {
		const root = parse(sceneToSvg(sceneOf([], { width: 30, height: 20, unitsPerMm: 4 })));
		expect(root.getAttribute('width')).toBe('7.5mm');
		expect(root.getAttribute('height')).toBe('5mm');
	});

	it('takes its accessible name from the title only, escaped', () => {
		const title = 'Menu & "specials" <today> \'5\'';
		const root = parse(sceneToSvg(sceneOf([], { title })));
		const [element] = elements(root, 'title');
		expect(element?.textContent).toBe(title);
		expect(root.firstChild).toBe(element);
	});

	it('replaces what XML cannot hold in a title, so the file still parses', () => {
		const title = `a\u0000b\u0008c\u000bd￾e￿\ud800f\udc00g\u{1f600}h\ti\nj`;
		const root = parse(sceneToSvg(sceneOf([], { title })));
		expect(elements(root, 'title')[0]?.textContent).toBe('a�b�c�d�e��f�g\u{1f600}h\ti\nj');
		expect(() => parse(sceneToSvg(sceneOf([], { title: '\ud800' })))).not.toThrow();
	});

	it('writes a solid colour with its opacity separately, for older readers', () => {
		const root = parse(
			sceneToSvg(sceneOf([pathNode({ kind: 'solid', colour: parseColour('#0b76d980') })])),
		);
		const [path] = elements(root, 'path');
		expect(path?.getAttribute('fill')).toBe('#0b76d9');
		expect(path?.getAttribute('fill-opacity')).toBe('0.502');
	});

	it('writes gradients in user space with normalised stops', () => {
		const red = parseColour('#ff0000');
		const blue = parseColour('#0000ff80');
		const svg = sceneToSvg(
			sceneOf([
				pathNode({
					kind: 'linear',
					x1: 0,
					y1: 0,
					x2: 10,
					y2: 0,
					stops: [
						{ offset: -1, colour: red },
						{ offset: 0.6, colour: blue },
						{ offset: 0.4, colour: red },
						{ offset: 2, colour: blue },
					],
				}),
				pathNode({
					kind: 'radial',
					cx: 5,
					cy: 5,
					r: 4,
					stops: [
						{ offset: 0, colour: red },
						{ offset: 1, colour: blue },
					],
				}),
			]),
		);
		const root = parse(svg);
		const [linear] = elements(root, 'linearGradient');
		const [radial] = elements(root, 'radialGradient');
		expect(linear?.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
		expect(linear?.getAttribute('id')).toBe('qrs-1');
		expect(radial?.getAttribute('id')).toBe('qrs-2');
		expect(radial?.getAttribute('r')).toBe('4');
		const offsets = elements(linear as Element, 'stop').map((stop) => stop.getAttribute('offset'));
		expect(offsets).toEqual(['0', '0.6', '0.6', '1']);
		const opacities = elements(linear as Element, 'stop').map((stop) =>
			stop.getAttribute('stop-opacity'),
		);
		expect(opacities).toEqual([null, '0.502', null, '0.502']);
		const fills = elements(root, 'path').map((path) => path.getAttribute('fill'));
		expect(fills).toEqual(['url(#qrs-1)', 'url(#qrs-2)']);
	});

	it('reduces degenerate gradients as SVG specifies, and leaves out what paints nothing', () => {
		const red = parseColour('#ff0000');
		const blue = parseColour('#0000ff');
		const stops = [
			{ offset: 0, colour: red },
			{ offset: 1, colour: blue },
		];
		const root = parse(
			sceneToSvg(
				sceneOf([
					pathNode({ kind: 'linear', x1: 1, y1: 1, x2: 1, y2: 1, stops }),
					pathNode({ kind: 'radial', cx: 1, cy: 1, r: 0, stops }),
					pathNode({
						kind: 'linear',
						x1: 0,
						y1: 0,
						x2: 1,
						y2: 1,
						stops: [{ offset: 0.5, colour: red }],
					}),
					pathNode({ kind: 'radial', cx: 0, cy: 0, r: 1, stops: [] }),
					pathNode({ kind: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [] }),
					pathNode({ kind: 'solid', colour: parseColour('#12345600') }),
					pathNode({ kind: 'solid', colour: red }, new PathBuilder().moveTo(1, 1).build()),
				]),
			),
		);
		expect(elements(root, 'path').map((path) => path.getAttribute('fill'))).toEqual([
			'#0000ff',
			'#0000ff',
			'#ff0000',
		]);
		expect(elements(root, 'defs')).toHaveLength(0);
	});

	it('writes groups with their opacity and clip, and drops ones that show nothing', () => {
		const clip = new PathBuilder().circle(5, 5, 3).build();
		const child = pathNode({ kind: 'solid', colour: black });
		const root = parse(
			sceneToSvg(
				sceneOf([
					{ kind: 'group', children: [child], opacity: 0.25, clip },
					{ kind: 'group', children: [child] },
					{ kind: 'group', children: [child], opacity: 0 },
					{ kind: 'group', children: [child], clip: new PathBuilder().build() },
					{ kind: 'group', children: [] },
					{ kind: 'group', children: [child], opacity: 7 },
				]),
				{ idPrefix: 'code_a-' },
			),
		);
		const groups = elements(root, 'g');
		expect(groups).toHaveLength(3);
		expect(groups[0]?.getAttribute('opacity')).toBe('0.25');
		expect(groups[0]?.getAttribute('clip-path')).toBe('url(#code_a-1)');
		expect(groups[1]?.hasAttribute('opacity')).toBe(false);
		expect(groups[2]?.hasAttribute('opacity')).toBe(false);
		const [clipPath] = elements(root, 'clipPath');
		expect(clipPath?.getAttribute('id')).toBe('code_a-1');
		expect(elements(clipPath as Element, 'path')[0]?.getAttribute('d')).toBe(pathData(clip));
	});

	it('paints the background over the whole scene', () => {
		const root = parse(
			sceneToSvg({
				width: 4,
				height: 3,
				background: { kind: 'solid', colour: parseColour('#fff') },
				layers: [],
			}),
		);
		const [rect] = elements(root, 'rect');
		expect(rect?.getAttribute('width')).toBe('4');
		expect(rect?.getAttribute('height')).toBe('3');
		expect(rect?.getAttribute('fill')).toBe('#ffffff');
	});

	it('gives the same bytes every time, with ids in document order', () => {
		for (let seed = 1; seed <= 20; seed += 1) {
			const scene = sceneFor(seed, { size: 32, layers: 5, translucent: true, groups: true });
			const first = sceneToSvg(scene, { idPrefix: 'x' });
			expect(sceneToSvg(scene, { idPrefix: 'x' })).toBe(first);
			const root = parse(first);
			const ids = [...first.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
			expect(ids).toEqual(ids.map((_, i) => `x${i + 1}`));
			// Every reference points at a definition that exists.
			for (const match of first.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(match[1]);
			expect(root.tagName).toBe('svg');
		}
	});

	it('says the same thing pretty or compact', () => {
		const scene = sceneFor(7, { size: 32, layers: 5, translucent: true, groups: true });
		const compact = sceneToSvg(scene);
		const pretty = sceneToSvg(scene, { pretty: true });
		expect(pretty).toContain('\n\t\t<');
		expect(pretty.replace(/\n\t*/g, '')).toBe(compact);
		parse(pretty);
	});

	it('refuses an id prefix that is not a plain name', () => {
		for (const idPrefix of ['', '1a', 'a b', 'a"b', 'a:b', 'a.b', '<x>']) {
			expect(() => sceneToSvg(sceneOf([]), { idPrefix })).toThrow(TypeError);
		}
		expect(() => sceneToSvg(sceneOf([]), { idPrefix: 3 as unknown as string })).toThrow(TypeError);
	});

	it('refuses a malformed scene with a TypeError', () => {
		const bad: unknown[] = [
			null,
			{ width: 0, height: 1, background: null, layers: [] },
			{ width: 1, height: Number.NaN, background: null, layers: [] },
			{ width: 1, height: 1, background: null, layers: 'none' },
			{ width: 1, height: 1, background: null, layers: [], unitsPerMm: 0 },
			{ width: 1, height: 1, background: null, layers: [], unitsPerMm: Infinity },
			{ width: 1, height: 1, background: null, layers: [], title: 5 },
			{ width: 1, height: 1, background: { kind: 'tartan' }, layers: [] },
			{ width: 1, height: 1, background: 'red', layers: [] },
			sceneOf([null as unknown as SceneNode]),
			sceneOf([{ kind: 'text' } as unknown as SceneNode]),
			sceneOf([pathNode({ kind: 'solid', colour: { r: 1.5, g: 0, b: 0, a: 1 } })]),
			sceneOf([pathNode({ kind: 'radial', cx: 0, cy: 0, r: -1, stops: [] })]),
			sceneOf([pathNode({ kind: 'linear', x1: 0, y1: 0, x2: 1, y2: Number.NaN, stops: [] })]),
			sceneOf([pathNode({ kind: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: 'red' as never })]),
			sceneOf([pathNode({ kind: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [null as never] })]),
			sceneOf([
				pathNode({
					kind: 'linear',
					x1: 0,
					y1: 0,
					x2: 1,
					y2: 1,
					stops: [{ offset: Number.NaN, colour: black }],
				}),
			]),
			sceneOf([pathNode({ kind: 'conic', cx: 0, cy: Infinity, angle: 0, stops: [] })]),
			sceneOf([
				{
					kind: 'path',
					path: { commands: [9], points: [] },
					paint: { kind: 'solid', colour: black },
				} as never,
			]),
			sceneOf([{ kind: 'group', children: 'none' } as never]),
			sceneOf([{ kind: 'group', children: [], opacity: Number.NaN }]),
			sceneOf([{ kind: 'group', children: [], clip: { commands: [1], points: [] } as never }]),
		];
		for (const scene of bad) expect(() => sceneToSvg(scene as Scene)).toThrow(TypeError);
	});

	it('refuses groups nested deeper than the limit, which also stops a cycle', () => {
		let node: SceneNode = pathNode({ kind: 'solid', colour: black });
		for (let i = 0; i < 40; i += 1) node = { kind: 'group', children: [node] };
		expect(() => sceneToSvg(sceneOf([node]))).toThrow(TypeError);
		const cycle: { kind: 'group'; children: SceneNode[] } = { kind: 'group', children: [] };
		cycle.children.push(cycle);
		expect(() => sceneToSvg(sceneOf([cycle]))).toThrow(TypeError);
	});
});
