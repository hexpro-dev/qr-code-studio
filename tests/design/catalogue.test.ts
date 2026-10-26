import { describe, expect, it } from 'vitest';
import { createDesignRegistries } from '../../src/design/registries.js';
import { bounds } from '../../src/geometry/measure.js';
import { PathBuilder } from '../../src/geometry/path.js';

describe('the built-in catalogue', () => {
	it('is fresh registries every time, with nothing shared between them', () => {
		const a = createDesignRegistries();
		const b = createDesignRegistries();
		expect(a.moduleShapes).not.toBe(b.moduleShapes);
		a.icons.register({ ...a.icons.require('star'), id: 'extra' });
		expect(b.icons.has('extra')).toBe(false);
		expect(a.icons.require('star').path).not.toBe(b.icons.require('star').path);
	});

	it('holds the shapes, fills, frames, icons and presets the studio offers', () => {
		const registries = createDesignRegistries();
		expect(registries.moduleShapes.ids()).toEqual([
			'square',
			'rounded',
			'dot',
			'diamond',
			'squircle',
			'hex',
			'bars-horizontal',
			'bars-vertical',
			'fluid',
			'classy',
			'cross',
			'tiny-square',
			'mosaic',
			'star',
		]);
		const regions = registries.regionShapes.list();
		expect(regions.filter((shape) => shape.part === 'outer').map((shape) => shape.id)).toEqual([
			'square',
			'rounded',
			'extra-rounded',
			'circle',
			'squircle',
			'cushion',
			'dot-ring',
			'octagon',
			'scooped',
		]);
		expect(regions.filter((shape) => shape.part === 'inner').map((shape) => shape.id)).toEqual([
			'square-centre',
			'rounded-centre',
			'circle-centre',
			'squircle-centre',
			'leaf-centre',
			'octagon-centre',
			'scooped-centre',
			'flower-centre',
		]);
		for (const shape of regions) {
			expect(shape.kinds).toContain('concentric-7');
			if (shape.part === 'outer') expect(shape.kinds).toContain('corner-l');
			else expect(shape.kinds).not.toContain('corner-l');
		}
		expect(registries.fills.ids()).toEqual(['palette-scatter', 'two-tone-diagonal']);
		expect(registries.frames.ids()).toHaveLength(12);
		expect(registries.icons.ids()).toHaveLength(16);
		const presets = registries.presets.list();
		expect(presets.length).toBeGreaterThanOrEqual(40);
		expect(new Set(presets.map((preset) => preset.category))).toEqual(
			new Set(['classic', 'rounded', 'dots', 'hex', 'fluid', 'bold', 'minimal', 'colour', 'print']),
		);
		expect(presets.filter((preset) => preset.design.frame !== null).length).toBeGreaterThanOrEqual(
			6,
		);
		expect(presets.filter((preset) => preset.design.logo !== null).length).toBeGreaterThanOrEqual(
			2,
		);
		expect(
			presets.filter((preset) => preset.design.regions.finder?.outerPaint !== undefined).length,
		).toBeGreaterThanOrEqual(5);
	});

	it('gives every frame but the plain one room for a caption', () => {
		for (const frame of createDesignRegistries().frames.list()) {
			if (frame.id === 'none') expect(frame.text).toBeNull();
			else expect(frame.text?.maxChars).toBeGreaterThan(0);
		}
	});

	it('draws a centre as nothing in the corner pattern, which has no centre', () => {
		for (const shape of createDesignRegistries().regionShapes.list()) {
			if (shape.part !== 'inner') continue;
			const out = new PathBuilder();
			shape.path({ kind: 'corner-l', params: {} }, out);
			expect(out.empty).toBe(true);
		}
	});

	it('draws every icon inside its unit box, at one visual size', () => {
		for (const icon of createDesignRegistries().icons.list()) {
			const box = bounds(icon.path);
			expect(box, icon.id).not.toBeNull();
			if (box === null) continue;
			expect(box.x, icon.id).toBeGreaterThanOrEqual(0.05);
			expect(box.y, icon.id).toBeGreaterThanOrEqual(0.05);
			expect(box.x + box.width, icon.id).toBeLessThanOrEqual(0.95);
			expect(box.y + box.height, icon.id).toBeLessThanOrEqual(0.95);
			// Each fills most of its box one way or the other.
			expect(Math.max(box.width, box.height), icon.id).toBeGreaterThanOrEqual(0.7);
		}
	});
});
