import { describe, expect, it } from 'vitest';
import { QrStudioError, UnknownEntryError } from '../../src/core/errors.js';
import { Registry } from '../../src/core/registry.js';

interface Shape {
	readonly id: string;
	readonly corners: number;
}

const square: Shape = { id: 'square', corners: 4 };
const rounded: Shape = { id: 'rounded-2', corners: 0 };
const dot: Shape = { id: 'dot', corners: 0 };

describe('Registry', () => {
	it('keeps entries in registration order and finds them by id', () => {
		const registry = new Registry<Shape>('module-shape', [square, rounded]);
		registry.register(dot);
		expect(registry.kind).toBe('module-shape');
		expect(registry.list()).toEqual([square, rounded, dot]);
		expect(registry.ids()).toEqual(['square', 'rounded-2', 'dot']);
		expect(registry.get('dot')).toBe(dot);
		expect(registry.require('rounded-2')).toBe(rounded);
		expect(registry.has('square')).toBe(true);
		expect(registry.has('star')).toBe(false);
		expect(registry.get('star')).toBeUndefined();
	});

	it('counts every registration in its version, including the first entries', () => {
		const registry = new Registry<Shape>('module-shape');
		expect(registry.version).toBe(0);
		registry.register(square);
		expect(registry.version).toBe(1);
		expect(new Registry<Shape>('module-shape', [square, dot]).version).toBe(2);
	});

	it('hands out frozen lists that later registrations do not change', () => {
		const registry = new Registry<Shape>('module-shape', [square]);
		const before = registry.list();
		const ids = registry.ids();
		registry.register(dot);
		expect(Object.isFrozen(before)).toBe(true);
		expect(Object.isFrozen(ids)).toBe(true);
		expect(before).toEqual([square]);
		expect(ids).toEqual(['square']);
		expect(registry.list()).toEqual([square, dot]);
		expect(Object.isFrozen(new Registry<Shape>('module-shape').list())).toBe(true);
	});

	it('refuses a duplicate id', () => {
		const registry = new Registry<Shape>('module-shape', [square]);
		expect(() => registry.register({ id: 'square', corners: 3 })).toThrow(TypeError);
		expect(() => new Registry<Shape>('module-shape', [dot, dot])).toThrow(TypeError);
		expect(registry.version).toBe(1);
	});

	it.each(['', 'Square', 'rounded_2', 'rounded--2', '-dot', 'dot-', '2dot', 'dot shape', 'dót'])(
		'refuses the id %j, which is not kebab-case',
		(id) => {
			expect(() => new Registry<Shape>('module-shape').register({ id, corners: 0 })).toThrow(
				TypeError,
			);
		},
	);

	it('refuses an id that is not a string, and a kind that is not kebab-case', () => {
		const registry = new Registry<Shape>('module-shape');
		expect(() => registry.register({ id: 5, corners: 0 } as unknown as Shape)).toThrow(TypeError);
		expect(() => new Registry<Shape>('Module Shape')).toThrow(TypeError);
		expect(() => new Registry<Shape>('')).toThrow(TypeError);
	});

	it('says which kind and id it could not find', () => {
		const registry = new Registry<Shape>('module-shape', [square]);
		try {
			registry.require('star-5');
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(UnknownEntryError);
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).code).toBe('design/unknown-entry');
			expect((error as QrStudioError).params).toEqual({ kind: 'module-shape', id: 'star-5' });
		}
	});

	it('does not echo text that is not an id into the error', () => {
		// A design file can put anything in an id field, including content.
		const registry = new Registry<Shape>('module-shape');
		for (const id of ['Example Network password', 'a'.repeat(65), 7 as unknown as string]) {
			try {
				registry.require(id);
				expect.unreachable();
			} catch (error) {
				expect((error as QrStudioError).params).toEqual({ kind: 'module-shape', id: '' });
			}
		}
	});
});
