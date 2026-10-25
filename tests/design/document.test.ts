import { describe, expect, it } from 'vitest';
import { isQrStudioError } from '../../src/core/errors.js';
import type { QrStudioError } from '../../src/core/errors.js';
import { deflateRaw } from '../../src/core/deflate.js';
import {
	base64Decode,
	base64Encode,
	base64UrlDecode,
	base64UrlEncode,
} from '../../src/design/base64.js';
import { canonicalJson } from '../../src/design/canonical.js';
import { applyConstraints } from '../../src/design/constraints.js';
import { defaultDesign } from '../../src/design/document.js';
import {
	LINK_PREFIX,
	MAX_LINK_LENGTH,
	decodeDesignLink,
	designLink,
	encodeDesignLink,
} from '../../src/design/link.js';
import { migrateDesign, runMigrations } from '../../src/design/migrate.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { assetOf, designWith, discImage } from './helpers.js';

const registries = createDesignRegistries();

function thrown(fn: () => unknown): QrStudioError {
	try {
		fn();
	} catch (error) {
		if (isQrStudioError(error)) return error;
		throw error;
	}
	throw new Error('expected a QrStudioError');
}

describe('defaultDesign', () => {
	it('is classic black on white, square, quiet zone 4, level M, and fresh each time', () => {
		const design = defaultDesign();
		expect(design.symbol).toEqual({ symbology: 'qr', ecLevel: 'M' });
		expect(design.quietZone).toBe(4);
		expect(design.modules.shape).toEqual({ id: 'square' });
		expect(design.background).toEqual({ kind: 'solid', ink: '#ffffff' });
		expect(design.modules.paint).toEqual({ kind: 'solid', ink: '#000000' });
		expect(defaultDesign()).not.toBe(design);
	});
});

describe('migrateDesign', () => {
	it('copies a version 1 document and is idempotent', () => {
		const design = defaultDesign();
		const once = migrateDesign(design);
		expect(once).toEqual(design);
		expect(once).not.toBe(design);
		expect(migrateDesign(once)).toEqual(once);
	});

	it('copies plain data only: no functions, no __proto__, no infinities', () => {
		const input = JSON.parse(
			'{"schema":"qr-design","version":1,"__proto__":{"x":1},"list":[1,null]}',
		) as Record<string, unknown>;
		input.fn = () => 1;
		input.big = Number.POSITIVE_INFINITY;
		(input.list as unknown[]).push(undefined, () => 2);
		input.flag = true;
		const copied = migrateDesign(input) as unknown as Record<string, unknown>;
		expect(copied).toEqual({
			schema: 'qr-design',
			version: 1,
			list: [1, null, null, null],
			big: null,
			flag: true,
		});
		expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
	});

	it('refuses anything that is not a design of a version it knows', () => {
		for (const input of [
			null,
			[],
			'design',
			{ schema: 'other', version: 1 },
			{ schema: 'qr-design' },
			{ schema: 'qr-design', version: 1.5 },
		]) {
			expect(thrown(() => migrateDesign(input)).code).toBe('design/unsupported-schema');
		}
		expect(thrown(() => migrateDesign({ schema: 'qr-design', version: 2 })).params).toEqual({
			version: 2,
		});
		expect(thrown(() => migrateDesign({ schema: 'qr-design', version: 0 })).params).toEqual({
			version: 0,
		});
		expect(thrown(() => migrateDesign({ schema: 'qr-design', version: -5 })).params).toEqual({});
	});

	it('refuses a document nested past the limit', () => {
		let deep: unknown = 1;
		for (let i = 0; i < 40; i += 1) deep = { deep };
		const error = thrown(() => migrateDesign({ schema: 'qr-design', version: 1, deep }));
		expect(error.code).toBe('design/invalid');
	});

	it('runs steps in order to the current version, and refuses a gap', () => {
		const steps = [
			{
				from: 1,
				migrate: (doc: Record<string, unknown>) => ({
					...doc,
					quiet: doc.quietZone,
					quietZone: undefined,
				}),
			},
			{ from: 2, migrate: (doc: Record<string, unknown>) => ({ ...doc, upgraded: true }) },
		];
		const result = runMigrations({ ...defaultDesign() }, steps, 3);
		expect(result).toMatchObject({ version: 3, quiet: 4, upgraded: true });
		expect(runMigrations(result, steps, 3)).toEqual(result);
		expect(thrown(() => runMigrations({ ...defaultDesign() }, [steps[1]!], 3)).params).toEqual({
			version: 1,
		});
	});
});

describe('applyConstraints', () => {
	const fancy: QrDesignV1 = {
		...defaultDesign(),
		symbol: {
			symbology: 'micro',
			ecLevel: 'L',
			boostEc: true,
			minVersion: 'M2',
			maxVersion: 'M4',
			segmentation: { eci: 'utf-8' },
		},
		modules: {
			shape: { id: 'dot' },
			paint: { kind: 'solid', ink: '#0b3d91' },
			light: { shape: { id: 'dot' }, paint: { kind: 'solid', ink: '#eeeeee' } },
		},
		regions: {
			finder: {
				outer: { id: 'circle' },
				inner: { id: 'circle-centre' },
				outerPaint: { kind: 'solid', ink: '#ff0000' },
			},
		},
		logo: {
			source: { kind: 'icon', id: 'wifi' },
			size: 0.2,
			clear: 'box',
			padding: 1,
			plate: { paint: { kind: 'solid', ink: '#ffeeee' }, shape: 'circle' },
			paint: { kind: 'solid', ink: '#123456' },
		},
		frame: {
			ref: { id: 'banner-bottom' },
			paint: { kind: 'solid', ink: '#00ff00' },
			text: { content: 'Scan', fontId: 'plex-sans-bold' },
		},
		output: { sizeMm: 30, colourSpace: 'srgb' },
		name: 'Kept',
	};

	it('leaves a design alone with no constraints', () => {
		const design = defaultDesign();
		expect(applyConstraints(design, undefined)).toEqual({ design, issues: [], overlay: null });
		expect(applyConstraints(design, {})).toEqual({ design, issues: [], overlay: null });
		expect(applyConstraints(design, {}).design).toBe(design);
	});

	it('locks the Swiss QR-bill to black on white, square modules, level M and 46 mm', () => {
		const { design, issues, overlay } = applyConstraints(fancy, {
			ecLevels: ['M'],
			maxVersion: '25',
			sizeMm: 46,
			colours: 'black-on-white',
			designLocked: true,
			overlay: 'swiss-cross',
		});
		// The cross comes back beside the design, for buildScene, and is not
		// written into a design that could be shared as a link.
		expect(overlay).toBe('swiss-cross');
		expect(design).toEqual({
			...defaultDesign(),
			symbol: { symbology: 'qr', ecLevel: 'M', maxVersion: '25', segmentation: { eci: 'utf-8' } },
			output: { sizeMm: 46, sizeBasis: 'symbol', colourSpace: 'srgb' },
			name: 'Kept',
		});
		expect(issues.map((found) => found.code)).toEqual([
			'design.issue.design-locked',
			'design.issue.size-constrained',
		]);
		const { name: _name, ...nameless } = fancy;
		expect(applyConstraints(nameless, { designLocked: true }).design).not.toHaveProperty('name');
		const plainMicro = applyConstraints(
			{ ...fancy, symbol: { symbology: 'micro', ecLevel: 'L', maxVersion: 'M3' } },
			{ designLocked: true },
		);
		expect(plainMicro.design.symbol).toEqual({ symbology: 'qr', ecLevel: 'M' });
		const sameQr = applyConstraints(
			{ ...fancy, symbol: { symbology: 'qr', ecLevel: 'H', mask: 2 } },
			{ designLocked: true },
		);
		expect(sameQr.design.symbol).toEqual({ symbology: 'qr', ecLevel: 'M', mask: 2 });
		// A design already as the lock wants it is not reported as changed.
		const again = applyConstraints(design, { designLocked: true, colours: 'black-on-white' });
		expect(again.issues).toEqual([]);
		expect(
			applyConstraints({ ...design, quietZone: 6 }, { designLocked: true }).design.quietZone,
		).toBe(6);
	});

	it('recolours to black on white and keeps the shapes', () => {
		const { design, issues } = applyConstraints(fancy, { colours: 'black-on-white' });
		expect(design.modules).toEqual({
			shape: { id: 'dot' },
			paint: { kind: 'solid', ink: '#000000' },
			light: null,
		});
		expect(design.background).toEqual({ kind: 'solid', ink: '#ffffff' });
		expect(design.regions).toEqual({
			finder: { outer: { id: 'circle' }, inner: { id: 'circle-centre' } },
		});
		expect(design.logo?.paint).toEqual({ kind: 'solid', ink: '#000000' });
		expect(design.logo?.plate?.paint).toEqual({ kind: 'solid', ink: '#ffffff' });
		expect(design.frame?.paint).toEqual({ kind: 'solid', ink: '#000000' });
		// The caption gives up its own paint and takes the frame's ink, white
		// on the frame's artwork and black beside it.
		expect(design.frame?.text).toEqual({ content: 'Scan', fontId: 'plex-sans-bold' });
		expect(issues.map((found) => found.code)).toEqual(['design.issue.colours-constrained']);
		const picture = applyConstraints(
			{
				...fancy,
				logo: {
					source: { kind: 'asset', id: 'x' },
					size: 0.2,
					clear: 'box',
					padding: 0,
					plate: null,
				},
				frame: { ref: { id: 'none' } },
			},
			{ colours: 'black-on-white' },
		).design;
		expect(picture.logo).not.toHaveProperty('paint');
		expect(picture.frame).toEqual({
			ref: { id: 'none' },
			paint: { kind: 'solid', ink: '#000000' },
		});
		expect(
			applyConstraints({ ...fancy, logo: null, frame: null }, { colours: 'black-on-white' }).design
				.logo,
		).toBeNull();
	});

	it('clamps the level to the nearest allowed and stops boosting past the set', () => {
		const raised = applyConstraints(fancy, { ecLevels: ['M', 'Q'] });
		expect(raised.design.symbol.ecLevel).toBe('M');
		expect(raised.design.symbol.boostEc).toBe(false);
		expect(raised.issues).toEqual([
			{
				code: 'design.issue.ec-level-constrained',
				path: ['symbol', 'ecLevel'],
				severity: 'warning',
				params: { level: 'M' },
			},
			{ code: 'design.issue.boost-constrained', path: ['symbol', 'boostEc'], severity: 'warning' },
		]);
		const lowered = applyConstraints(
			{ ...fancy, symbol: { symbology: 'qr', ecLevel: 'H' } },
			{ ecLevels: ['L', 'M'] },
		);
		expect(lowered.design.symbol.ecLevel).toBe('M');
		// No level set means M, and a set holding it needs no change or note.
		const unset = applyConstraints({ ...fancy, symbol: { symbology: 'qr' } }, { ecLevels: ['M'] });
		expect(unset.design.symbol.ecLevel).toBe('M');
		expect(unset.issues).toEqual([]);
		const filled = applyConstraints({ ...fancy, symbol: { symbology: 'qr' } }, { ecLevels: ['H'] });
		expect(filled.design.symbol.ecLevel).toBe('H');
		expect(filled.issues).toEqual([]);
		// Boosting is fine where every level above is allowed.
		const free = applyConstraints(
			{ ...fancy, symbol: { symbology: 'qr', ecLevel: 'Q', boostEc: true } },
			{ ecLevels: ['Q', 'H'] },
		);
		expect(free.design.symbol.boostEc).toBe(true);
		expect(applyConstraints(fancy, { ecLevels: [] }).design).toBe(fancy);
	});

	it('changes the symbology, caps the version and stops the ECI header', () => {
		const { design, issues } = applyConstraints(fancy, {
			symbologies: ['qr'],
			maxVersion: '13',
			eci: 'never',
		});
		expect(design.symbol).toEqual({
			symbology: 'qr',
			ecLevel: 'L',
			boostEc: true,
			segmentation: { eci: 'never' },
			maxVersion: '13',
		});
		expect(issues.map((found) => found.code)).toEqual([
			'design.issue.symbology-constrained',
			'design.issue.eci-constrained',
		]);
		const capped = applyConstraints(
			{ ...fancy, symbol: { symbology: 'qr', minVersion: '20', maxVersion: '30' } },
			{ maxVersion: '13' },
		);
		expect(capped.design.symbol).toEqual({ symbology: 'qr', maxVersion: '13' });
		expect(capped.issues.map((found) => found.path.join('.'))).toEqual([
			'symbol.maxVersion',
			'symbol.minVersion',
		]);
		const fine = applyConstraints(
			{ ...fancy, symbol: { symbology: 'qr', minVersion: '2', maxVersion: '5' } },
			{ maxVersion: '13' },
		);
		expect(fine.issues).toEqual([]);
		const quiet = applyConstraints({ ...fancy, symbol: { symbology: 'qr' } }, { eci: 'never' });
		expect(quiet.issues).toEqual([]);
		expect(quiet.design.symbol.segmentation).toEqual({ eci: 'never' });
		expect(applyConstraints(fancy, { symbologies: ['micro', 'qr'] }).design.symbol.symbology).toBe(
			'micro',
		);
		expect(applyConstraints(fancy, { symbologies: [] }).design).toBe(fancy);
		const bare = applyConstraints(
			{ ...fancy, symbol: { symbology: 'rmqr' } },
			{ symbologies: ['qr'] },
		);
		expect(bare.design.symbol).toEqual({ symbology: 'qr' });
		// A cap means nothing to symbologies whose versions are not numbers.
		expect(applyConstraints(fancy, { maxVersion: '13' }).design).toBe(fancy);
	});

	it("sets the printed size as the symbol's own, quietly when none was set", () => {
		expect(applyConstraints(defaultDesign(), { sizeMm: 46 })).toEqual({
			design: {
				...defaultDesign(),
				output: { colourSpace: 'srgb', sizeMm: 46, sizeBasis: 'symbol' },
			},
			issues: [],
			overlay: null,
		});
		// The same width measured over the whole artwork is a different size.
		const artwork = applyConstraints(fancy, { sizeMm: 30 });
		expect(artwork.design.output).toEqual({ sizeMm: 30, sizeBasis: 'symbol', colourSpace: 'srgb' });
		expect(artwork.issues.map((found) => found.code)).toEqual(['design.issue.size-constrained']);
		const already = {
			...fancy,
			output: { sizeMm: 30, sizeBasis: 'symbol' as const, colourSpace: 'srgb' as const },
		};
		expect(applyConstraints(already, { sizeMm: 30 })).toEqual({
			design: already,
			issues: [],
			overlay: null,
		});
	});
});

describe('canonicalJson', () => {
	it('writes known keys in a fixed order and the rest in code unit order', () => {
		const a = { version: 1, schema: 'qr-design', zeta: 1, alpha: [3, undefined], beta: undefined };
		const b = { alpha: [3, undefined], zeta: 1, schema: 'qr-design', version: 1 };
		expect(canonicalJson(a)).toBe('{"schema":"qr-design","version":1,"alpha":[3,null],"zeta":1}');
		expect(canonicalJson(b)).toBe(canonicalJson(a));
		expect(canonicalJson({ b: 1, a: 2, a1: 3 })).toBe('{"a":2,"a1":3,"b":1}');
		expect(canonicalJson(-0)).toBe('0');
		expect(canonicalJson(undefined)).toBe('null');
	});
});

describe('base64', () => {
	it('round-trips every length in both alphabets', () => {
		for (let length = 0; length < 70; length += 1) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 97 + length) & 255);
			expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
			expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
			expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
			expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
		}
	});

	it('refuses every text that is not the one spelling', () => {
		for (const text of ['A', 'AB=', 'ABC=D===', 'AB==', 'A===', '****', 'AÀAA', 'ABC']) {
			expect(base64Decode(text), text).toBeNull();
		}
		expect(base64Decode('AA==')).toEqual(Uint8Array.of(0));
		for (const text of ['A', 'AB', 'AAB', 'ab+/', 'AA=='])
			expect(base64UrlDecode(text), text).toBeNull();
		expect(base64UrlDecode('AA')).toEqual(Uint8Array.of(0));
	});
});

describe('design links', () => {
	const fancy = designWith({
		modules: {
			shape: { id: 'fluid', params: { radius: 0.4 } },
			paint: { kind: 'solid', ink: '#0b3d91' },
			light: null,
		},
		regions: { finder: { outer: { id: 'squircle' }, inner: { id: 'squircle-centre' } } },
		frame: {
			ref: { id: 'rounded-card' },
			text: { content: 'Scan for the menu', fontId: 'plex-sans-bold' },
		},
		name: 'Café menu',
	});

	it('carry the size basis, an optional addition to version 1, through links and migration', () => {
		const symbol = designWith({
			output: { sizeMm: 46, sizeBasis: 'symbol', colourSpace: 'cmyk' },
		});
		const link = encodeDesignLink(symbol);
		expect(decodeDesignLink(link, registries)).toEqual(symbol);
		expect(migrateDesign(JSON.parse(JSON.stringify(symbol)))).toEqual(symbol);
		expect(canonicalJson(symbol.output)).toBe(
			'{"sizeMm":46,"sizeBasis":"symbol","colourSpace":"cmyk"}',
		);
		// A design without it is the same document it always was.
		expect(encodeDesignLink(designWith({ output: { sizeMm: 46, colourSpace: 'cmyk' } }))).not.toBe(
			link,
		);
	});

	it('round-trip a design through the canonical link', () => {
		const link = encodeDesignLink(fancy);
		expect(link.startsWith(LINK_PREFIX)).toBe(true);
		expect(decodeDesignLink(link, registries)).toEqual(fancy);
		expect(decodeDesignLink(`#${link}`)).toEqual(fancy);
		expect(designLink(fancy)).toEqual({ link, issues: [] });
	});

	it('give the same link whatever order the keys were written in', () => {
		const shuffled = JSON.parse(JSON.stringify(fancy, Object.keys(fancy).reverse())) as QrDesignV1;
		const reordered = Object.fromEntries(Object.entries(fancy).reverse()) as unknown as QrDesignV1;
		expect(encodeDesignLink(reordered)).toBe(encodeDesignLink(fancy));
		expect(shuffled).toBeDefined();
	});

	it('leave images out and say so, with the logo that used them', () => {
		const withPicture = designWith({
			logo: {
				source: { kind: 'asset', id: 'mark' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
			assets: { mark: assetOf(discImage()) },
		});
		const { link, issues } = designLink(withPicture);
		expect(issues.map((found) => found.code)).toEqual(['design.issue.link-assets-dropped']);
		expect(decodeDesignLink(link)).toEqual(designWith({ logo: null }));
		const strayAsset = designLink(designWith({ assets: { mark: assetOf(discImage()) } }));
		expect(strayAsset.issues.map((found) => found.code)).toEqual([
			'design.issue.link-assets-dropped',
		]);
		const pictureNoAsset = designLink(
			designWith({
				logo: {
					source: { kind: 'asset', id: 'mark' },
					size: 0.2,
					clear: 'box',
					padding: 1,
					plate: null,
				},
			}),
		);
		expect(pictureNoAsset.issues).toHaveLength(1);
		const icon = designWith({
			logo: {
				source: { kind: 'icon', id: 'wifi' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
		});
		expect(designLink(icon).issues).toEqual([]);
		expect(decodeDesignLink(encodeDesignLink(icon))).toEqual(icon);
	});

	it('refuse a design too large to link, either way it is measured', () => {
		const huge = {
			...defaultDesign(),
			name: undefined,
			pad: 'x'.repeat(40_000),
		} as unknown as QrDesignV1;
		expect(thrown(() => encodeDesignLink(huge)).params).toMatchObject({
			reason: 'size',
			limit: 32768,
		});
		let seed = 1;
		const noise = Array.from({ length: 6000 }, () => {
			seed = (seed * 1103515245 + 12345) >>> 0;
			return String.fromCharCode(97 + (seed % 26));
		}).join('');
		const noisy = { ...defaultDesign(), noise } as unknown as QrDesignV1;
		expect(thrown(() => encodeDesignLink(noisy)).params).toMatchObject({
			reason: 'size',
			limit: MAX_LINK_LENGTH,
		});
		expect(() => designLink(null as never)).toThrow(TypeError);
	});

	it('refuse a damaged, foreign, oversized or invalid link', () => {
		const reason = (fragment: string): string | number | undefined =>
			thrown(() => decodeDesignLink(fragment)).params.reason;
		expect(reason('v1.' + 'A'.repeat(MAX_LINK_LENGTH))).toBe('length');
		expect(reason('design')).toBe('prefix');
		expect(reason('v1.***')).toBe('encoding');
		expect(reason('v1.' + base64UrlEncode(Uint8Array.of(0xff, 0xff)))).toBe('compression');
		const bomb = deflateRaw(new Uint8Array(40_000), { level: 9 });
		expect(reason('v1.' + base64UrlEncode(bomb))).toBe('compression');
		expect(reason('v1.' + base64UrlEncode(deflateRaw(Uint8Array.of(0xc3, 0x28))))).toBe('json');
		expect(reason('v1.' + base64UrlEncode(deflateRaw(new TextEncoder().encode('{not json'))))).toBe(
			'json',
		);
		const bad = new TextEncoder().encode(JSON.stringify({ ...defaultDesign(), quietZone: -1 }));
		expect(thrown(() => decodeDesignLink('v1.' + base64UrlEncode(deflateRaw(bad)))).params).toEqual(
			{ reason: 'content', issues: 1 },
		);
		expect(thrown(() => decodeDesignLink('v2.AAAA')).code).toBe('design/unsupported-schema');
		const later = new TextEncoder().encode(JSON.stringify({ ...defaultDesign(), version: 2 }));
		expect(thrown(() => decodeDesignLink('v1.' + base64UrlEncode(deflateRaw(later)))).code).toBe(
			'design/unsupported-schema',
		);
		expect(() => decodeDesignLink(7 as never)).toThrow(TypeError);
	});
});
