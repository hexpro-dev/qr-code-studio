import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import { Registry } from '../../src/core/registry.js';
import { snapToGrid } from '../../src/design/logo.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { DesignLogo, DesignRegistries, LogoIcon } from '../../src/design/types.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { ROLE_CODES } from '../../src/symbology/roles.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { designWith, discImage } from './helpers.js';
import { microSymbol, qrSymbol } from './symbols.js';

/** A test icon: a solid square over the middle half of the unit box, so its silhouette is known exactly. */
const block: LogoIcon = {
	id: 'block',
	labelKey: 'design.icon.info',
	path: new PathBuilder().rect(0.25, 0.25, 0.5, 0.5).build(),
};
const base = createDesignRegistries();
const registries: DesignRegistries = {
	...base,
	icons: new Registry('icon', [...base.icons.list(), block]),
};

// Version 5, 37 modules: alignment pattern at 30, 30, nothing else near the middle.
const symbol = qrSymbol('https://example.com/logo', 'H', { minVersion: '5', maxVersion: '5' });
const size = symbol.matrix.width;

function logo(patch: Partial<DesignLogo>): DesignLogo {
	return {
		source: { kind: 'icon', id: 'block' },
		size: 0.25,
		clear: 'box',
		padding: 1,
		plate: null,
		...patch,
	};
}

/** Modules, as row major indices, for which `hit(x, y)` holds. */
function where(hit: (x: number, y: number) => boolean): number[] {
	const out: number[] = [];
	for (let y = 0; y < size; y += 1)
		for (let x = 0; x < size; x += 1) if (hit(x, y)) out.push(y * size + x);
	return out;
}

function marked(mask: Uint8Array): number[] {
	const out: number[] = [];
	mask.forEach((value, i) => {
		if (value === 1) out.push(i);
	});
	return out;
}

/** Distance from the module square at (x, y) to a rectangle. */
function toRect(
	x: number,
	y: number,
	left: number,
	top: number,
	right: number,
	bottom: number,
): number {
	const dx = Math.max(left - (x + 1), x - right, 0);
	const dy = Math.max(top - (y + 1), y - bottom, 0);
	return Math.hypot(dx, dy);
}

describe('the logo', () => {
	it('snaps to whole modules, centred exactly', () => {
		expect(snapToGrid(9.25, 37, 35)).toBe(9);
		expect(snapToGrid(8.6, 37, 35)).toBe(9);
		expect(snapToGrid(7.6, 37, 35)).toBe(7);
		expect(snapToGrid(40, 37, 35)).toBe(35);
		expect(snapToGrid(5, 20, 18)).toBe(4);
	});

	// 0.25 of 37 is 9.25: a box of 9 modules from 14 to 23, padded to 13 to 24.
	it("'box' hides and removes every module under the padded box", () => {
		const built = buildScene(symbol, designWith({ logo: logo({ clear: 'box' }) }), { registries });
		const expected = where((x, y) => x >= 13 && x < 24 && y >= 13 && y < 24);
		expect(marked(built.obscured)).toEqual(expected);
		expect(built.issues).toEqual([]);
		const logoNode = built.scene.layers.at(-1);
		expect(logoNode).toMatchObject({ kind: 'path', role: 'logo' });
	});

	it("'shape' removes the modules within the padding of the logo's own outline", () => {
		const built = buildScene(symbol, designWith({ logo: logo({ clear: 'shape' }) }), {
			registries,
		});
		// The block fills 16.25 to 20.75 of the box; within one module of it.
		const expected = where((x, y) => toRect(x, y, 16.25, 16.25, 20.75, 20.75) < 1);
		expect(marked(built.obscured)).toEqual(expected);
	});

	it("'none' keeps every module and marks the ones the logo is drawn over", () => {
		const built = buildScene(symbol, designWith({ logo: logo({ clear: 'none' }) }), { registries });
		const expected = where(
			(x, y) =>
				toRect(x, y, 16.25, 16.25, 20.75, 20.75) === 0 &&
				x + 1 > 16.25 &&
				x < 20.75 &&
				y + 1 > 16.25 &&
				y < 20.75,
		);
		expect(marked(built.obscured)).toEqual(expected);
		const plain = buildScene(symbol, designWith({}), { registries });
		const modules = (scene: typeof plain.scene) =>
			scene.layers.find((node) => node.kind === 'path' && node.role === 'modules');
		expect(modules(built.scene)).toEqual(modules(plain.scene));
	});

	it('marks the plate as well, whatever its shape, and removes under it unless told not to', () => {
		const circle = buildScene(
			symbol,
			designWith({
				logo: logo({
					clear: 'shape',
					plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'circle' },
				}),
			}),
			{ registries },
		);
		// An icon's circle goes round its box's inside: radius 4.5 plus the padding.
		const disc = where((x, y) => {
			const dx = Math.max(x - 18.5, 18.5 - (x + 1), 0);
			const dy = Math.max(y - 18.5, 18.5 - (y + 1), 0);
			return Math.hypot(dx, dy) < 5.5;
		});
		expect(marked(circle.obscured)).toEqual(disc);
		expect(circle.scene.layers.at(-2)).toMatchObject({ kind: 'path', role: 'logo-plate' });

		const rounded = buildScene(
			symbol,
			designWith({
				logo: logo({
					clear: 'none',
					plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'rounded' },
				}),
			}),
			{ registries },
		);
		const r = 11 * 0.2;
		// Within the radius of the plate's inner rectangle, by more than rounding.
		const roundedSet = where((x, y) => toRect(x, y, 13 + r, 13 + r, 24 - r, 24 - r) < r - 1e-9);
		expect(marked(rounded.obscured)).toEqual(roundedSet);
		const square = buildScene(
			symbol,
			designWith({
				logo: logo({
					clear: 'shape',
					plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'square' },
				}),
			}),
			{ registries },
		);
		expect(marked(square.obscured)).toEqual(
			where((x, y) => x >= 13 && x < 24 && y >= 13 && y < 24),
		);
	});

	it('draws a picture inside its box at its own proportions, and goes round its corners with a circle plate', () => {
		const wide = discImage(32);
		const picture = { width: 32, height: 16, data: wide.data.slice(0, 32 * 16 * 4) };
		const design = designWith({
			logo: logo({
				source: { kind: 'asset', id: 'mark' },
				clear: 'box',
				plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'circle' },
			}),
			assets: { mark: { png: 'unused here', width: 32, height: 16 } },
		});
		const built = buildScene(symbol, design, {
			registries,
			assets: (id) => (id === 'mark' ? picture : undefined),
		});
		const image = built.scene.layers.at(-1);
		// Nine modules wide and, at two to one, five high (the nearest odd height).
		expect(image).toMatchObject({ kind: 'image', x: 4 + 14, width: 9, height: 4.5 });
		expect(image).toMatchObject({ y: 4 + 16 + 0.25 });
		const r = Math.hypot(9, 5) / 2 + 1;
		const disc = where((x, y) => {
			const dx = Math.max(x - 18.5, 18.5 - (x + 1), 0);
			const dy = Math.max(y - 18.5, 18.5 - (y + 1), 0);
			return Math.hypot(dx, dy) < r;
		});
		const padded = where((x, y) => x >= 13 && x < 24 && y >= 15 && y < 22);
		expect(marked(built.obscured)).toEqual(
			[...new Set([...disc, ...padded])].sort((a, b) => a - b),
		);

		const shaped = buildScene(
			symbol,
			{
				...design,
				logo: logo({ source: { kind: 'asset', id: 'mark' }, clear: 'shape', padding: 0 }),
			},
			{
				registries,
				assets: () => picture,
			},
		);
		expect(marked(shaped.obscured).length).toBeGreaterThan(0);
		expect(marked(shaped.obscured).length).toBeLessThan(45);
		const none = buildScene(
			symbol,
			{
				...design,
				logo: logo({ source: { kind: 'asset', id: 'mark' }, clear: 'none', padding: 0 }),
			},
			{
				registries,
				assets: () => picture,
			},
		);
		expect(marked(none.obscured)).toEqual(marked(shaped.obscured));
	});

	it('is made smaller, two modules at a time, until it is off every pattern a reader needs', () => {
		const small = qrSymbol('A', 'H', { minVersion: '1', maxVersion: '1' });
		const built = buildScene(small, designWith({ logo: logo({ size: 0.4, padding: 1 }) }), {
			registries,
		});
		expect(built.issues).toEqual([
			{ code: 'design.issue.logo-shrunk', path: ['logo', 'size'], severity: 'info' },
		]);
		const width = small.matrix.width;
		for (let i = 0; i < width * width; i += 1) {
			if (built.obscured[i] === 1) {
				expect([ROLE_CODES.data, ROLE_CODES.alignment]).toContain(small.layout.roles[i]);
			}
		}
		expect(marked(built.obscured).length).toBeGreaterThan(0);
	});

	it('is left out, with a word, when it cannot be drawn', () => {
		const micro = buildScene(
			microSymbol('1', 'M1'),
			designWith({ quietZone: 2, logo: logo({ size: 0.3 }) }),
			{ registries },
		);
		expect(micro.issues.map((found) => found.code)).toEqual(['design.issue.logo-too-small']);
		const unknown = buildScene(
			symbol,
			designWith({ logo: logo({ source: { kind: 'icon', id: 'rocket' } }) }),
			{ registries },
		);
		expect(unknown.issues.map((found) => found.code)).toEqual(['design.issue.unknown-entry']);
		const missing = buildScene(
			symbol,
			designWith({ logo: logo({ source: { kind: 'asset', id: 'mark' } }) }),
			{ registries },
		);
		expect(missing.issues.map((found) => found.code)).toEqual(['design.issue.asset-unavailable']);
		const unresolved = buildScene(
			symbol,
			designWith({
				logo: logo({ source: { kind: 'asset', id: 'mark' } }),
				assets: { mark: { png: '', width: 1, height: 1 } },
			}),
			{ registries },
		);
		expect(unresolved.issues.map((found) => found.code)).toEqual([
			'design.issue.asset-unavailable',
		]);
		for (const built of [micro, unknown, missing]) expect(marked(built.obscured)).toEqual([]);
	});

	it('keeps its size inside the allowed range', () => {
		const tiny = buildScene(symbol, designWith({ logo: logo({ size: 0.001, padding: 9 }) }), {
			registries,
		});
		// 0.05 of 37 is about 2: one module wide (odd, to centre), padded by the most allowed, 4.
		expect(marked(tiny.obscured)).toEqual(where((x, y) => x >= 14 && x < 23 && y >= 14 && y < 23));
	});

	it('takes the module paint when an icon has none, and its own when it has one', () => {
		const plain = buildScene(symbol, designWith({ logo: logo({}) }), { registries });
		expect(plain.scene.layers.at(-1)).toMatchObject({
			paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0 } },
		});
		const own = buildScene(
			symbol,
			designWith({ logo: logo({ paint: { kind: 'solid', ink: '#0b76d9' } }) }),
			{ registries },
		);
		expect(own.scene.layers.at(-1)).toMatchObject({
			paint: { kind: 'solid', colour: { r: 11, g: 118, b: 217 } },
		});
	});
});

describe('the logo near the edges', () => {
	it('is kept off a timing pattern its circle plate would reach, though its box would not', () => {
		const v2 = qrSymbol('EDGE', 'H', { minVersion: '2', maxVersion: '2' });
		const picture = discImage(16);
		const design = designWith({
			logo: {
				source: { kind: 'asset', id: 'mark' },
				size: 0.3,
				clear: 'box',
				padding: 1,
				plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'circle' },
			},
			assets: { mark: { png: '', width: 16, height: 16 } },
		});
		const built = buildScene(v2, design, { registries, assets: () => picture });
		expect(built.issues.map((found) => found.code)).toEqual(['design.issue.logo-shrunk']);
	});

	it('marks nothing outside the symbol, however far its padding reaches', () => {
		const data: BuiltSymbol = {
			...symbol,
			matrix: new BitMatrix(9, 9),
			layout: {
				width: 9,
				height: 9,
				roles: new Uint8Array(81),
				dataBits: new Int32Array(81).fill(-1),
				regions: [],
			},
		};
		const built = buildScene(data, designWith({ logo: logo({ size: 0.4, padding: 4 }) }), {
			registries,
		});
		expect(built.obscured).toEqual(new Uint8Array(81).fill(1));
	});
});
