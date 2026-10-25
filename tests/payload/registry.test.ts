import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { textType } from '../../src/payload/content/text.js';
import { definePayload } from '../../src/payload/define.js';
import { detectPayload } from '../../src/payload/detect.js';
import { BUILT_IN_PAYLOAD_TYPES, createPayloadRegistry } from '../../src/payload/registry.js';
import type { PayloadRegistry } from '../../src/payload/registry.js';
import type { PayloadType } from '../../src/payload/types.js';

const EXPECTED_IDS = [
	'wifi',
	'vcard',
	'mecard',
	'event',
	'email',
	'phone',
	'sms',
	'whatsapp',
	'telegram',
	'signal',
	'facetime',
	'geo',
	'bitcoin',
	'lightning',
	'epc',
	'swiss-qr-bill',
	'pix',
	'upi',
	'zatca',
	'gs1-digital-link',
	'url',
	'text',
];

function stub(id: string, detect: (text: string) => number): PayloadType {
	return definePayload({
		id,
		category: 'text',
		fields: [],
		write: () => '',
		detect,
		parse: () => ({}),
		vectors: [],
	}) as PayloadType;
}

/** A registry with only the given entries, for detection tests. */
function only(entries: readonly PayloadType[]): PayloadRegistry {
	const registry = createPayloadRegistry();
	return {
		...registry,
		kind: registry.kind,
		version: 0,
		list: () => entries,
		get: (id: string) => entries.find((entry) => entry.id === id),
	} as PayloadRegistry;
}

describe('createPayloadRegistry', () => {
	it('holds every built-in type, most specific first and text last', () => {
		const registry = createPayloadRegistry();
		expect(registry.ids()).toEqual(EXPECTED_IDS);
		expect(registry.list()).toEqual(BUILT_IN_PAYLOAD_TYPES);
		expect(registry.kind).toBe('payload type');
		expect(registry.version).toBe(EXPECTED_IDS.length);
	});

	it('returns a fresh instance each time, so registering on one changes no other', () => {
		const first = createPayloadRegistry();
		const second = createPayloadRegistry();
		first.register(stub('custom', () => 0));
		expect(first.has('custom')).toBe(true);
		expect(second.has('custom')).toBe(false);
		expect(first.version).toBe(second.version + 1);
	});

	it('meets the core Registry contract', () => {
		const registry = createPayloadRegistry();
		expect(registry.get('wifi')?.id).toBe('wifi');
		expect(registry.get('nothing')).toBeUndefined();
		expect(registry.require('url').id).toBe('url');
		expect(Object.isFrozen(registry.list())).toBe(true);
		expect(Object.isFrozen(registry.ids())).toBe(true);
		expect(() => registry.register(stub('wifi', () => 0))).toThrow(TypeError);
		expect(() => registry.register(stub('Not_Kebab', () => 0))).toThrow(TypeError);
		try {
			registry.require('missing-type');
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).code).toBe('design/unknown-entry');
			expect((error as QrStudioError).params).toEqual({ kind: 'payload type', id: 'missing-type' });
		}
	});

	it('gives every type a unique kebab-case id and its own message keys', () => {
		for (const type of BUILT_IN_PAYLOAD_TYPES) {
			expect(type.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
			expect(type.labelKey).toBe(`payload.${type.id}.label`);
			expect(type.actionKey).toBe(`payload.${type.id}.action`);
			expect(type.vectors.length, type.id).toBeGreaterThan(0);
			const keys = type.fields.map((field) => field.key);
			expect(new Set(keys).size, type.id).toBe(keys.length);
		}
	});

	it('marks only the Saudi e-invoice as read only', () => {
		expect(
			BUILT_IN_PAYLOAD_TYPES.filter((type) => type.generate === false).map((type) => type.id),
		).toEqual(['zatca']);
	});
});

describe('detectPayload', () => {
	const registry = createPayloadRegistry();

	it('recognises every built-in type from its own vectors', () => {
		for (const type of BUILT_IN_PAYLOAD_TYPES) {
			for (const vector of type.vectors) {
				const found = detectPayload(vector.text, registry);
				expect(found.type.id, vector.text.slice(0, 60)).toBe(type.id);
				expect(found.confidence).toBeGreaterThan(0);
				expect(found.confidence).toBeLessThanOrEqual(1);
			}
		}
	});

	it('prefers a type at a specific host over the generic link', () => {
		expect(detectPayload('https://wa.me/61400000000', registry).type.id).toBe('whatsapp');
		expect(detectPayload('https://www.google.com/maps?q=-33.8568,151.2153', registry).type.id).toBe(
			'geo',
		);
		expect(detectPayload('https://example.com/', registry)).toEqual({
			type: registry.get('url'),
			confidence: 0.5,
		});
	});

	it('falls back to text', () => {
		expect(detectPayload('Note: buy milk', registry).type.id).toBe('text');
		expect(detectPayload('', registry)).toEqual({ type: registry.get('text'), confidence: 0 });
	});

	it('falls back to the built-in text type when the registry has none', () => {
		const found = detectPayload('anything', only([stub('never', () => 0)]));
		expect(found.type).toBe(textType);
		expect(found.confidence).toBe(0.01);
	});

	it('scores a detect that throws, or answers nonsense, as nothing, and clamps the rest', () => {
		const broken = stub('broken', () => {
			throw new Error('a broken entry');
		});
		const nonsense = stub('nonsense', () => Number.NaN);
		const eager = stub('eager', () => 7);
		expect(detectPayload('x', only([broken, nonsense, textType as PayloadType])).type.id).toBe(
			'text',
		);
		expect(detectPayload('x', only([eager, textType as PayloadType]))).toEqual({
			type: eager,
			confidence: 1,
		});
	});

	it('breaks a tie in registration order', () => {
		const first = stub('first', () => 0.5);
		const second = stub('second', () => 0.5);
		expect(detectPayload('x', only([first, second])).type).toBe(first);
	});
});
