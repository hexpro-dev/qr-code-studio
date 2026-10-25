/**
 * The symbol a view draws: ok, stale with the last code that worked, or
 * empty before anything has. The code on screen never goes blank while the
 * content is wrong or too long.
 */

import { describe, expect, it } from 'vitest';
import { encode } from '../../src/encode/encode.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import { contentOf, encodeContent, symbolView } from '../../src/studio/symbol.js';
import { defaultDesign } from '../../src/design/document.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import type { PayloadType } from '../../src/payload/types.js';
import { studioWith, studioWithCode } from './helpers.js';

const LONG = `https://example.com/${'n'.repeat(40)}`;
const LONG_VERSION = encode(LONG, { ecLevel: 'M' }).version;

describe('the symbol states', () => {
	it('starts empty, saying there is nothing yet, with no preview', () => {
		const { studio } = studioWith();
		const { symbol, preview } = studio.getSnapshot();
		expect(symbol).toEqual({
			status: 'empty',
			issue: { code: 'studio.issue.content-empty', path: ['fields'], severity: 'info' },
		});
		expect(preview).toBeNull();
	});

	it('is empty with the reason when the first content is wrong', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'not a link' });
		const { symbol } = studio.getSnapshot();
		expect(symbol.status).toBe('empty');
		expect(symbol.status === 'empty' && symbol.issue?.code).toBe('studio.issue.content-invalid');
	});

	it('describes a good code from the symbol itself', () => {
		const { studio } = studioWithCode({}, 'https://example.com/a');
		const { symbol } = studio.getSnapshot();
		expect(symbol.status).toBe('ok');
		if (symbol.status !== 'ok') return;
		const built = encode('https://example.com/a', { ecLevel: 'M' });
		expect(symbol.view).toMatchObject({
			symbology: 'qr',
			symbologyLabelKey: 'symbology.qr.label',
			phoneReadable: true,
			noteKey: null,
			version: built.version,
			ecLevel: 'M',
			mask: built.mask,
			modules: [built.matrix.width, built.matrix.height],
			quietZone: 4,
			segments: [{ mode: 'byte', chars: 21, eci: null }],
		});
		// Byte mode: 4 bits of mode, 8 of count, 8 a character.
		expect(symbol.view.capacity.usedBits).toBe(4 + 8 + 21 * 8);
		expect(symbol.view.capacity.totalBits).toBe(built.blocks.dataBits);
		expect(symbol.view.capacity.fraction).toBeCloseTo((4 + 8 + 168) / built.blocks.dataBits);
		expect(symbol.view.capacity.ofLargest).toBeLessThan(0.02);
	});

	it('says wherever Micro QR is shown that most phones cannot read it', () => {
		const { studio } = studioWithCode({}, 'https://example.com/a');
		studio.dispatch({ type: 'payload/type', typeId: 'text' });
		studio.dispatch({ type: 'payload/field', key: 'text', value: '12345' });
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['symbol'], value: { symbology: 'micro', ecLevel: 'L' } },
		});
		const { symbol } = studio.getSnapshot();
		expect(symbol.status).toBe('ok');
		expect(symbol.status === 'ok' && symbol.view).toMatchObject({
			symbology: 'micro',
			phoneReadable: false,
			noteKey: 'symbology.micro.not-phone-readable',
			quietZone: 4,
		});
	});

	it('keeps the last good code on screen while the content is wrong', () => {
		const { studio } = studioWithCode({}, 'https://example.com/a');
		const good = studio.getSnapshot();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://' });
		const bad = studio.getSnapshot();
		expect(bad.symbol.status).toBe('stale');
		if (bad.symbol.status !== 'stale' || good.symbol.status !== 'ok') return;
		expect(bad.symbol.view).toBe(good.symbol.view);
		expect(bad.symbol.issue.code).toBe('studio.issue.content-invalid');
		expect(bad.preview).toBe(good.preview);
		expect(bad.payloadIssues.length).toBeGreaterThan(0);
	});

	it('keeps it while the content is too long for any code, saying by how much', () => {
		const { studio } = studioWithCode({}, 'https://example.com/a');
		studio.dispatch({ type: 'payload/type', typeId: 'text' });
		studio.dispatch({ type: 'payload/field', key: 'text', value: 'x'.repeat(5000) });
		const { symbol, preview } = studio.getSnapshot();
		expect(symbol.status).toBe('stale');
		if (symbol.status !== 'stale') return;
		expect(symbol.issue.code).toBe('encode.too-much-data');
		expect(symbol.issue.params).toMatchObject({ bitsAvailable: expect.any(Number) });
		expect(symbol.view.version).toBe('2');
		expect(preview).not.toBeNull();
	});

	it('draws the last good content with the design as it is now', () => {
		const { studio } = studioWithCode({}, 'https://example.com/a');
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		studio.dispatch({ type: 'design/patch', patch: { path: ['symbol', 'ecLevel'], value: 'H' } });
		const { symbol } = studio.getSnapshot();
		expect(symbol.status === 'stale' && symbol.view.ecLevel).toBe('H');
	});

	it('keeps the last symbol as it was when the design no longer fits the last content', () => {
		const { studio } = studioWithCode({}, `https://example.com/${'a'.repeat(60)}`);
		const version = (() => {
			const { symbol } = studio.getSnapshot();
			return symbol.status === 'ok' ? symbol.view.version : '';
		})();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['symbol', 'maxVersion'], value: '1' },
		});
		const { symbol } = studio.getSnapshot();
		expect(symbol.status).toBe('stale');
		expect(symbol.status === 'stale' && symbol.view.version).toBe(version);
	});

	it('keeps the last content that worked, whatever a view happened to read', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/old' });
		const older = studio.getSnapshot();
		studio.dispatch({ type: 'payload/field', key: 'url', value: LONG });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		void older.symbol;
		const { symbol } = studio.getSnapshot();
		expect(symbol.status).toBe('stale');
		expect(symbol.status === 'stale' && symbol.view.version).toBe(LONG_VERSION);
	});

	it('shows the latest good code when the same wrong content comes back', () => {
		const { studio } = studioWithCode({}, 'https://example.com/a');
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		studio.dispatch({ type: 'payload/field', key: 'url', value: LONG });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		const { symbol } = studio.getSnapshot();
		expect(symbol.status === 'stale' && symbol.view.version).toBe(LONG_VERSION);
	});
});

describe('the helpers behind it', () => {
	const symbologies = createSymbologyRegistry();
	const payloads = createPayloadRegistry();

	it('reports a validator that throws as content that cannot be made', () => {
		const broken = {
			...payloads.require('text'),
			validate: () => {
				throw new Error('a third party type that throws');
			},
		} as PayloadType;
		const content = contentOf(broken, { text: 'x' });
		expect(content.ok).toBe(false);
		expect(!content.ok && content.reason.code).toBe('error.payload.invalid');
	});

	it('reports a build that disagrees with its own validator', () => {
		const broken = {
			...payloads.require('text'),
			build: () => {
				throw new TypeError('disagrees with itself');
			},
		} as PayloadType;
		const content = contentOf(broken, { text: 'x' });
		expect(!content.ok && content.reason.code).toBe('error.payload.invalid');
	});

	it('reports an encoder refusal that is not one of the package errors', () => {
		const design = { ...defaultDesign(), symbol: { symbology: 'qr', mask: 99 } } as never;
		const encoded = encodeContent('x', design, symbologies);
		expect(encoded.ok).toBe(false);
		expect(!encoded.ok && encoded.error.code).toBe('encode/unsupported-content');
	});

	it('falls back to its own segmentation when the symbol cannot be read back', () => {
		const entry = symbologies.require('qr');
		const unreadable = new Proxy(symbologies, {
			get(target, property) {
				if (property === 'require') {
					return () => ({
						...entry,
						read: () => {
							throw new Error('cannot read back');
						},
					});
				}
				return Reflect.get(target, property);
			},
		});
		const built = encode('HELLO 123', { ecLevel: 'M' });
		const view = symbolView(built, 'HELLO 123', defaultDesign(), unreadable);
		expect(view.segments.length).toBeGreaterThan(0);
		const nothing = new Proxy(symbologies, {
			get(target, property) {
				if (property === 'require') {
					return () => ({
						...entry,
						read: () => {
							throw new Error('cannot read back');
						},
						profile: () => {
							throw new Error('no profile either');
						},
						blocks: () => {
							throw new Error('no blocks');
						},
					});
				}
				return Reflect.get(target, property);
			},
		});
		const unknown = symbolView(built, 'HELLO 123', defaultDesign(), nothing);
		expect(unknown.segments).toEqual([]);
		expect(unknown.capacity.usedBits).toBe(0);
	});
});
