/**
 * Checking a design document.
 *
 * A design arrives from a file, a link or a form, so the checker assumes
 * nothing about its shape and reports every problem it finds, each with the
 * exact path to it and a message key, and never the offending value: a
 * design's colours are harmless, but its name and caption are text a person
 * typed, and an issue is the thing that gets pasted into a bug report.
 *
 * Problems with one obvious fix are fixed and reported as warnings, and the
 * fixed design is returned:
 *
 * - keys the schema does not know are dropped (an entry's unknown parameters
 *   too);
 * - `light`, `logo`, a logo's `plate`, `frame` and `regions` left out mean
 *   none, `output` and its colour space left out mean screen colour, and a
 *   gradient's `space` left out means the symbol's;
 * - an angle outside 0 to 360 is brought round into it;
 * - a paint on a picture logo, which only icons take, is dropped, as is a
 *   caption on a frame that has nowhere to put one;
 * - embedded images nothing uses are dropped.
 *
 * A caption in a font the font registry does not hold is a warning and is
 * kept as it is: the website registers a person's own fonts at runtime, so a
 * design made there may name one that this registry has not been given yet,
 * and the scene builder leaves such a caption out rather than set it in
 * another font.
 *
 * Anything else is an error and the design comes back null. Region pairs
 * that would not make a finder the strict reader finds are a warning: the
 * design is valid, and the studio uses the warning to steer the choice.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Registry, RegistryEntry } from '../core/registry.js';
import { parseColour } from '../render/colour.js';
import { PNG_SIGNATURE } from '../render/png.js';
import { createFontRegistry } from '../text/registry.js';
import type { FontRegistry } from '../text/types.js';
import { base64Decode } from './base64.js';
import { codePoints } from './caption.js';
import { DESIGN_VERSION, LIMITS, MIN_QUIET_ZONE } from './document.js';
import { regionPairConforms } from './finder.js';
import { paramProblem, resolveParams } from './params.js';
import type {
	DesignAsset,
	DesignFrame,
	DesignLogo,
	DesignPaint,
	DesignRegistries,
	DesignStop,
	EntryRef,
	Ink,
	ParamSchema,
	ParamValue,
	QrDesignV1,
	RegionKind,
	RegionRole,
	RegionStyle,
} from './types.js';

type Path = readonly (string | number)[];

/** A sentinel for a value that could not be checked into shape. */
const BAD: unique symbol = Symbol('bad');
type Checked<T> = T | typeof BAD;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Keys from the file that may appear in an issue's path: short and plain. */
const PLAIN_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const VERSION_NAMES: Readonly<Record<string, RegExp>> = Object.freeze({
	qr: /^(?:[1-9]|[1-3][0-9]|40)$/,
	micro: /^M[1-4]$/,
	rmqr: /^R(?:7|9|11|13|15|17)x(?:27|43|59|77|99|139)$/,
});
const MASK_LIMIT: Readonly<Record<string, number>> = Object.freeze({ qr: 7, micro: 3, rmqr: 0 });

/** The concentric kind each region role is, for the pair check. */
const ROLE_KINDS: Readonly<Record<RegionRole, RegionKind>> = Object.freeze({
	finder: 'concentric-7',
	'sub-finder': 'concentric-5',
	'corner-finder': 'corner-l',
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

/** The position of the first control character other than those `allowed`, or -1. */
function controlAt(text: string, allowed: readonly number[] = []): number {
	for (let i = 0; i < text.length; i += 1) {
		const unit = text.charCodeAt(i);
		if ((unit < 0x20 || (unit >= 0x7f && unit < 0xa0)) && !allowed.includes(unit)) return i;
	}
	return -1;
}

class Checker {
	readonly issues: Issue[] = [];
	errors = 0;
	private fontRegistry: FontRegistry | undefined;

	constructor(
		readonly registries: DesignRegistries,
		fonts: FontRegistry | undefined,
	) {
		this.fontRegistry = fonts;
	}

	/** The fonts captions are checked against, the built-in family unless the caller gave some. */
	get fonts(): FontRegistry {
		this.fontRegistry ??= createFontRegistry();
		return this.fontRegistry;
	}

	error(code: string, path: Path, params?: Readonly<Record<string, number | string>>): typeof BAD {
		this.errors += 1;
		this.issues.push(issue(code, path, 'error', params));
		return BAD;
	}

	warn(code: string, path: Path, params?: Readonly<Record<string, number | string>>): void {
		this.issues.push(issue(code, path, 'warning', params));
	}

	/** An object, with every key it is not allowed reported and dropped. */
	record(value: unknown, path: Path, allowed: readonly string[]): Checked<Record<string, unknown>> {
		if (!isRecord(value)) return this.error('design.issue.not-an-object', path);
		let hidden = 0;
		for (const key of Object.keys(value)) {
			if (allowed.includes(key)) continue;
			if (PLAIN_KEY.test(key)) this.warn('design.issue.unknown-key', [...path, key]);
			else hidden += 1;
		}
		if (hidden > 0) this.warn('design.issue.unknown-key', path, { count: hidden });
		return value;
	}

	number(
		value: unknown,
		path: Path,
		range: { readonly min?: number; readonly max?: number; readonly integer?: boolean },
		code = 'design.issue.out-of-range',
	): Checked<number> {
		if (typeof value !== 'number' || !Number.isFinite(value))
			return this.error('design.issue.not-a-number', path);
		if (range.integer === true && !Number.isInteger(value))
			return this.error('design.issue.not-an-integer', path);
		if (
			(range.min !== undefined && value < range.min) ||
			(range.max !== undefined && value > range.max)
		) {
			const params: Record<string, number> = {};
			if (range.min !== undefined) params.min = range.min;
			if (range.max !== undefined) params.max = range.max;
			return this.error(code, path, params);
		}
		return value;
	}

	boolean(value: unknown, path: Path): Checked<boolean> {
		return typeof value === 'boolean' ? value : this.error('design.issue.not-a-boolean', path);
	}

	option<T extends string>(value: unknown, path: Path, options: readonly T[]): Checked<T> {
		return typeof value === 'string' && (options as readonly string[]).includes(value)
			? (value as T)
			: this.error('design.issue.invalid-option', path);
	}

	/** Brought round into 0 to 360 when it is outside, with a warning. */
	angle(value: unknown, path: Path): Checked<number> {
		const checked = this.number(value, path, {});
		if (checked === BAD) return BAD;
		if (checked >= 0 && checked < 360) return checked;
		this.warn('design.issue.angle-normalised', path);
		return ((checked % 360) + 360) % 360;
	}

	ink(value: unknown, path: Path): Checked<Ink> {
		if (typeof value === 'string') {
			try {
				parseColour(value);
				return value;
			} catch {
				return this.error('design.issue.invalid-colour', path);
			}
		}
		const record = this.record(value, path, ['srgb', 'cmyk']);
		if (record === BAD) return BAD;
		let screen: Checked<string> = BAD;
		const srgb = record.srgb;
		if (typeof srgb === 'string') screen = this.ink(srgb, [...path, 'srgb']) as Checked<string>;
		else this.error('design.issue.invalid-colour', [...path, 'srgb']);
		const cmyk = record.cmyk;
		let print: Checked<[number, number, number, number]> = BAD;
		if (!Array.isArray(cmyk) || cmyk.length !== 4) {
			this.error('design.issue.cmyk', [...path, 'cmyk']);
		} else {
			const values = cmyk.map((part: unknown, i) =>
				this.number(part, [...path, 'cmyk', i], { min: 0, max: 1 }),
			);
			if (!values.includes(BAD)) print = values as [number, number, number, number];
		}
		if (screen === BAD || print === BAD) return BAD;
		return { srgb: screen, cmyk: print };
	}

	stops(value: unknown, path: Path): Checked<DesignStop[]> {
		if (!Array.isArray(value)) return this.error('design.issue.not-a-list', path);
		if (value.length < 2 || value.length > LIMITS.stops) {
			return this.error('design.issue.stop-count', path, { min: 2, max: LIMITS.stops });
		}
		const out: DesignStop[] = [];
		let failed = false;
		let previous = 0;
		value.forEach((stop: unknown, i) => {
			const at = [...path, i];
			const record = this.record(stop, at, ['offset', 'ink']);
			if (record === BAD) {
				failed = true;
				return;
			}
			const offset = this.number(record.offset, [...at, 'offset'], { min: 0, max: 1 });
			const ink = this.ink(record.ink, [...at, 'ink']);
			if (offset !== BAD && offset < previous) {
				this.error('design.issue.stop-order', [...at, 'offset']);
				failed = true;
			}
			if (offset === BAD || ink === BAD) {
				failed = true;
				return;
			}
			previous = offset;
			out.push({ offset, ink });
		});
		return failed ? BAD : out;
	}

	space(record: Record<string, unknown>, path: Path): Checked<'symbol' | 'module'> {
		if (!own(record, 'space')) {
			this.warn('design.issue.filled-default', [...path, 'space']);
			return 'symbol';
		}
		return this.option(record.space, [...path, 'space'], ['symbol', 'module'] as const);
	}

	paint(value: unknown, path: Path): Checked<DesignPaint> {
		if (!isRecord(value)) return this.error('design.issue.not-an-object', path);
		const kind = this.option(value.kind, [...path, 'kind'], [
			'solid',
			'linear',
			'radial',
			'conic',
			'entry',
		] as const);
		if (kind === BAD) return BAD;
		const centre = { min: LIMITS.centre.min, max: LIMITS.centre.max };
		switch (kind) {
			case 'solid': {
				this.record(value, path, ['kind', 'ink']);
				const ink = this.ink(value.ink, [...path, 'ink']);
				return ink === BAD ? BAD : { kind, ink };
			}
			case 'linear': {
				this.record(value, path, ['kind', 'angle', 'stops', 'space']);
				const angle = this.angle(value.angle, [...path, 'angle']);
				const stops = this.stops(value.stops, [...path, 'stops']);
				const space = this.space(value, path);
				return angle === BAD || stops === BAD || space === BAD
					? BAD
					: { kind, angle, stops, space };
			}
			case 'radial': {
				this.record(value, path, ['kind', 'cx', 'cy', 'radius', 'stops', 'space']);
				const cx = this.number(value.cx, [...path, 'cx'], centre);
				const cy = this.number(value.cy, [...path, 'cy'], centre);
				const radius = this.number(value.radius, [...path, 'radius'], LIMITS.radius);
				const stops = this.stops(value.stops, [...path, 'stops']);
				const space = this.space(value, path);
				return cx === BAD || cy === BAD || radius === BAD || stops === BAD || space === BAD
					? BAD
					: { kind, cx, cy, radius, stops, space };
			}
			case 'conic': {
				this.record(value, path, ['kind', 'cx', 'cy', 'angle', 'stops', 'space']);
				const cx = this.number(value.cx, [...path, 'cx'], centre);
				const cy = this.number(value.cy, [...path, 'cy'], centre);
				const angle = this.angle(value.angle, [...path, 'angle']);
				const stops = this.stops(value.stops, [...path, 'stops']);
				const space = this.space(value, path);
				return cx === BAD || cy === BAD || angle === BAD || stops === BAD || space === BAD
					? BAD
					: { kind, cx, cy, angle, stops, space };
			}
			case 'entry': {
				this.record(value, path, ['kind', 'ref']);
				const ref = this.ref(value.ref, [...path, 'ref'], this.registries.fills, 'fill');
				return ref === BAD ? BAD : { kind, ref: ref.ref };
			}
		}
	}

	/** An entry reference: a registered id, and parameters that fit its schema. */
	ref<T extends RegistryEntry & { readonly params: readonly ParamSchema[] }>(
		value: unknown,
		path: Path,
		registry: Registry<T>,
		kind: string,
	): Checked<{ readonly ref: EntryRef; readonly entry: T }> {
		const record = this.record(value, path, ['id', 'params']);
		if (record === BAD) return BAD;
		const id = record.id;
		const entry = typeof id === 'string' ? registry.get(id) : undefined;
		if (entry === undefined) {
			return this.error(
				'design.issue.unknown-entry',
				[...path, 'id'],
				typeof id === 'string' && id.length <= 64 && KEBAB.test(id) ? { kind, id } : { kind },
			);
		}
		if (!own(record, 'params')) return { ref: { id: entry.id }, entry };
		const params = this.record(
			record.params,
			[...path, 'params'],
			entry.params.map((p) => p.key),
		);
		if (params === BAD) return BAD;
		const kept: Record<string, ParamValue> = {};
		let failed = false;
		for (const schema of entry.params) {
			if (!own(params, schema.key)) continue;
			const problem = paramProblem(schema, params[schema.key]);
			if (problem !== null) {
				this.error(problem.code, [...path, 'params', schema.key], problem.params);
				failed = true;
			} else kept[schema.key] = params[schema.key] as ParamValue;
		}
		if (failed) return BAD;
		return { ref: { id: entry.id, params: kept }, entry };
	}

	text(value: unknown, path: Path, max: number): Checked<string> {
		if (typeof value !== 'string') return this.error('design.issue.not-text', path);
		const length = codePoints(value);
		if (length > max) return this.error('design.issue.too-long', path, { length, max });
		return value;
	}
}

function checkSymbol(checker: Checker, value: unknown): Checked<QrDesignV1['symbol']> {
	const path = ['symbol'];
	const record = checker.record(value, path, [
		'symbology',
		'ecLevel',
		'boostEc',
		'minVersion',
		'maxVersion',
		'mask',
		'segmentation',
	]);
	if (record === BAD) return BAD;
	let failed = false;
	const symbology = record.symbology;
	if (typeof symbology !== 'string' || symbology.length > 32 || !KEBAB.test(symbology)) {
		checker.error('design.issue.symbology', [...path, 'symbology']);
		return BAD;
	}
	const out: { -readonly [K in keyof QrDesignV1['symbol']]: QrDesignV1['symbol'][K] } = {
		symbology,
	};
	if (own(record, 'ecLevel')) {
		const level = checker.option(record.ecLevel, [...path, 'ecLevel'], [
			'L',
			'M',
			'Q',
			'H',
		] as const);
		if (level === BAD) failed = true;
		else out.ecLevel = level;
	}
	if (own(record, 'boostEc')) {
		const boost = checker.boolean(record.boostEc, [...path, 'boostEc']);
		if (boost === BAD) failed = true;
		else out.boostEc = boost;
	}
	const versionName = VERSION_NAMES[symbology] ?? /^[A-Za-z0-9]{1,16}$/;
	for (const key of ['minVersion', 'maxVersion'] as const) {
		if (!own(record, key)) continue;
		const name = record[key];
		if (typeof name !== 'string' || !versionName.test(name)) {
			checker.error('design.issue.version-name', [...path, key]);
			failed = true;
		} else out[key] = name;
	}
	if (symbology === 'qr' && out.minVersion !== undefined && out.maxVersion !== undefined) {
		if (Number(out.minVersion) > Number(out.maxVersion)) {
			checker.error('design.issue.version-range', [...path, 'maxVersion']);
			failed = true;
		}
	}
	if (own(record, 'mask')) {
		const mask = record.mask;
		const limit = MASK_LIMIT[symbology] ?? 7;
		if (mask === 'auto') out.mask = 'auto';
		else if (typeof mask !== 'number' || !Number.isInteger(mask) || mask < 0 || mask > limit) {
			checker.error('design.issue.mask', [...path, 'mask'], { max: limit });
			failed = true;
		} else out.mask = mask;
	}
	if (own(record, 'segmentation')) {
		const at = [...path, 'segmentation'];
		const policy = checker.record(record.segmentation, at, ['kanji', 'eci']);
		if (policy === BAD) failed = true;
		else {
			const segmentation: {
				kanji?: 'never' | 'when-smaller' | 'always';
				eci?: 'auto' | 'never' | 'utf-8';
			} = {};
			if (own(policy, 'kanji')) {
				const kanji = checker.option(policy.kanji, [...at, 'kanji'], [
					'never',
					'when-smaller',
					'always',
				] as const);
				if (kanji === BAD) failed = true;
				else segmentation.kanji = kanji;
			}
			if (own(policy, 'eci')) {
				const eci = checker.option(policy.eci, [...at, 'eci'], ['auto', 'never', 'utf-8'] as const);
				if (eci === BAD) failed = true;
				else segmentation.eci = eci;
			}
			out.segmentation = segmentation;
		}
	}
	return failed ? BAD : out;
}

function checkModules(checker: Checker, value: unknown): Checked<QrDesignV1['modules']> {
	const path = ['modules'];
	const record = checker.record(value, path, ['shape', 'paint', 'light']);
	if (record === BAD) return BAD;
	const shape = own(record, 'shape')
		? checker.ref(record.shape, [...path, 'shape'], checker.registries.moduleShapes, 'module-shape')
		: checker.error('design.issue.required', [...path, 'shape']);
	const paint = own(record, 'paint')
		? checker.paint(record.paint, [...path, 'paint'])
		: checker.error('design.issue.required', [...path, 'paint']);
	let light: Checked<QrDesignV1['modules']['light']> = null;
	if (!own(record, 'light')) checker.warn('design.issue.filled-default', [...path, 'light']);
	else if (record.light !== null) {
		const at = [...path, 'light'];
		const inner = checker.record(record.light, at, ['shape', 'paint']);
		if (inner === BAD) light = BAD;
		else {
			const lightShape = own(inner, 'shape')
				? checker.ref(
						inner.shape,
						[...at, 'shape'],
						checker.registries.moduleShapes,
						'module-shape',
					)
				: checker.error('design.issue.required', [...at, 'shape']);
			const lightPaint = own(inner, 'paint')
				? checker.paint(inner.paint, [...at, 'paint'])
				: checker.error('design.issue.required', [...at, 'paint']);
			light =
				lightShape === BAD || lightPaint === BAD
					? BAD
					: { shape: lightShape.ref, paint: lightPaint };
		}
	}
	if (shape === BAD || paint === BAD || light === BAD) return BAD;
	return { shape: shape.ref, paint, light };
}

function checkRegions(checker: Checker, value: unknown): Checked<QrDesignV1['regions']> {
	const path = ['regions'];
	if (value === undefined) {
		checker.warn('design.issue.filled-default', path);
		return {};
	}
	const roles: readonly RegionRole[] = ['finder', 'sub-finder', 'corner-finder'];
	const record = checker.record(value, path, roles);
	if (record === BAD) return BAD;
	const out: Partial<Record<RegionRole, RegionStyle>> = {};
	let failed = false;
	for (const role of roles) {
		if (!own(record, role)) continue;
		const at = [...path, role];
		const style = checker.record(record[role], at, ['outer', 'inner', 'outerPaint', 'innerPaint']);
		if (style === BAD) {
			failed = true;
			continue;
		}
		const part = (key: 'outer' | 'inner') => {
			if (!own(style, key)) return checker.error('design.issue.required', [...at, key]);
			const found = checker.ref(
				style[key],
				[...at, key],
				checker.registries.regionShapes,
				'region-shape',
			);
			if (found === BAD) return BAD;
			if (found.entry.part !== key)
				return checker.error('design.issue.region-part', [...at, key, 'id'], { part: key });
			return found;
		};
		const outer = part('outer');
		const inner = part('inner');
		const outerPaint = own(style, 'outerPaint')
			? checker.paint(style.outerPaint, [...at, 'outerPaint'])
			: undefined;
		const innerPaint = own(style, 'innerPaint')
			? checker.paint(style.innerPaint, [...at, 'innerPaint'])
			: undefined;
		if (outer === BAD || inner === BAD || outerPaint === BAD || innerPaint === BAD) {
			failed = true;
			continue;
		}
		const kind = ROLE_KINDS[role];
		for (const [name, found] of [
			['outer', outer],
			['inner', inner],
		] as const) {
			// A centre has nothing to draw in the corner pattern.
			if (name === 'inner' && kind === 'corner-l') continue;
			if (!found.entry.kinds.includes(kind)) {
				checker.issues.push(issue('design.issue.region-kind', [...at, name], 'info', { kind }));
			}
		}
		if (
			(kind === 'concentric-7' || kind === 'concentric-5') &&
			outer.entry.kinds.includes(kind) &&
			inner.entry.kinds.includes(kind) &&
			!regionPairConforms(
				outer.entry,
				resolveParams(outer.entry.params, outer.ref.params),
				inner.entry,
				resolveParams(inner.entry.params, inner.ref.params),
				kind,
			)
		) {
			checker.warn('design.issue.region-pair', at, { kind });
		}
		const styleOut: { -readonly [K in keyof RegionStyle]: RegionStyle[K] } = {
			outer: outer.ref,
			inner: inner.ref,
		};
		if (outerPaint !== undefined) styleOut.outerPaint = outerPaint;
		if (innerPaint !== undefined) styleOut.innerPaint = innerPaint;
		out[role] = styleOut;
	}
	return failed ? BAD : out;
}

function checkLogo(
	checker: Checker,
	value: unknown,
	assets: Record<string, unknown> | null,
): Checked<DesignLogo | null> {
	const path = ['logo'];
	if (value === undefined) {
		checker.warn('design.issue.filled-default', path);
		return null;
	}
	if (value === null) return null;
	const record = checker.record(value, path, [
		'source',
		'size',
		'clear',
		'padding',
		'plate',
		'paint',
	]);
	if (record === BAD) return BAD;
	let failed = false;
	let source: DesignLogo['source'] | null = null;
	const sourceRecord = checker.record(record.source, [...path, 'source'], ['kind', 'id']);
	if (sourceRecord === BAD) failed = true;
	else {
		const kind = checker.option(sourceRecord.kind, [...path, 'source', 'kind'], [
			'icon',
			'asset',
		] as const);
		const id = sourceRecord.id;
		if (kind === BAD) failed = true;
		else if (kind === 'icon') {
			if (typeof id === 'string' && checker.registries.icons.has(id)) source = { kind, id };
			else {
				checker.error(
					'design.issue.unknown-entry',
					[...path, 'source', 'id'],
					typeof id === 'string' && id.length <= 64 && KEBAB.test(id)
						? { kind: 'icon', id }
						: { kind: 'icon' },
				);
				failed = true;
			}
		} else if (typeof id === 'string' && assets !== null && own(assets, id)) source = { kind, id };
		else {
			checker.error('design.issue.asset-missing', [...path, 'source', 'id']);
			failed = true;
		}
	}
	const size = checker.number(record.size, [...path, 'size'], LIMITS.logoSize);
	const clear = checker.option(record.clear, [...path, 'clear'], ['none', 'box', 'shape'] as const);
	const padding = checker.number(record.padding, [...path, 'padding'], LIMITS.logoPadding);
	let plate: Checked<DesignLogo['plate']> = null;
	if (!own(record, 'plate')) checker.warn('design.issue.filled-default', [...path, 'plate']);
	else if (record.plate !== null) {
		const at = [...path, 'plate'];
		const plateRecord = checker.record(record.plate, at, ['paint', 'shape']);
		if (plateRecord === BAD) plate = BAD;
		else {
			const paint = checker.paint(plateRecord.paint, [...at, 'paint']);
			const shape = checker.option(plateRecord.shape, [...at, 'shape'], [
				'square',
				'rounded',
				'circle',
			] as const);
			plate = paint === BAD || shape === BAD ? BAD : { paint, shape };
		}
	}
	let paint: Checked<DesignPaint> | undefined;
	if (own(record, 'paint')) {
		if (source !== null && source.kind === 'asset')
			checker.warn('design.issue.logo-paint-ignored', [...path, 'paint']);
		else paint = checker.paint(record.paint, [...path, 'paint']);
	}
	if (
		failed ||
		source === null ||
		size === BAD ||
		clear === BAD ||
		padding === BAD ||
		plate === BAD ||
		paint === BAD
	) {
		return BAD;
	}
	return paint === undefined
		? { source, size, clear, padding, plate }
		: { source, size, clear, padding, plate, paint };
}

function checkFrame(checker: Checker, value: unknown): Checked<DesignFrame | null> {
	const path = ['frame'];
	if (value === undefined) {
		checker.warn('design.issue.filled-default', path);
		return null;
	}
	if (value === null) return null;
	const record = checker.record(value, path, ['ref', 'paint', 'text']);
	if (record === BAD) return BAD;
	const ref = checker.ref(record.ref, [...path, 'ref'], checker.registries.frames, 'frame');
	const paint = own(record, 'paint') ? checker.paint(record.paint, [...path, 'paint']) : undefined;
	let text: Checked<DesignFrame['text']> | undefined;
	if (own(record, 'text') && ref !== BAD) {
		const at = [...path, 'text'];
		const limits = ref.entry.text;
		if (limits === null) checker.warn('design.issue.caption-unsupported', at);
		else {
			const textRecord = checker.record(record.text, at, ['content', 'fontId', 'paint']);
			if (textRecord === BAD) text = BAD;
			else {
				const content = checker.text(
					textRecord.content,
					[...at, 'content'],
					Math.min(limits.maxChars, LIMITS.caption),
				);
				let contentOk = content !== BAD;
				if (content !== BAD) {
					const control = controlAt(content, [0x0a]);
					const lines = content.split('\n').length;
					if (control !== -1) {
						checker.error('design.issue.control-character', [...at, 'content'], {
							position: control,
						});
						contentOk = false;
					} else if (lines > limits.maxLines) {
						checker.error('design.issue.too-many-lines', [...at, 'content'], {
							lines,
							max: limits.maxLines,
						});
						contentOk = false;
					}
				}
				const fontId = textRecord.fontId;
				const fontOk = typeof fontId === 'string' && fontId.length <= 64 && KEBAB.test(fontId);
				if (!fontOk) checker.error('design.issue.font-id', [...at, 'fontId']);
				else if (!checker.fonts.has(fontId))
					checker.warn('design.issue.font-unavailable', [...at, 'fontId']);
				const textPaint = own(textRecord, 'paint')
					? checker.paint(textRecord.paint, [...at, 'paint'])
					: undefined;
				if (!contentOk || !fontOk || textPaint === BAD) text = BAD;
				else {
					const caption = { content: content as string, fontId: fontId as string };
					text = textPaint === undefined ? caption : { ...caption, paint: textPaint };
				}
			}
		}
	}
	if (ref === BAD || paint === BAD || text === BAD) return BAD;
	const out: { -readonly [K in keyof DesignFrame]: DesignFrame[K] } = { ref: ref.ref };
	if (paint !== undefined) out.paint = paint;
	if (text !== undefined) out.text = text;
	return out;
}

function checkOutput(checker: Checker, value: unknown): Checked<QrDesignV1['output']> {
	const path = ['output'];
	if (value === undefined) {
		checker.warn('design.issue.filled-default', path);
		return { colourSpace: 'srgb' };
	}
	const record = checker.record(value, path, ['sizeMm', 'dpi', 'colourSpace']);
	if (record === BAD) return BAD;
	const out: { -readonly [K in keyof QrDesignV1['output']]: QrDesignV1['output'][K] } = {
		colourSpace: 'srgb',
	};
	let failed = false;
	if (own(record, 'sizeMm')) {
		const size = checker.number(record.sizeMm, [...path, 'sizeMm'], LIMITS.sizeMm);
		if (size === BAD) failed = true;
		else out.sizeMm = size;
	}
	if (own(record, 'dpi')) {
		const dpi = checker.number(record.dpi, [...path, 'dpi'], { ...LIMITS.dpi, integer: true });
		if (dpi === BAD) failed = true;
		else out.dpi = dpi;
	}
	if (!own(record, 'colourSpace'))
		checker.warn('design.issue.filled-default', [...path, 'colourSpace']);
	else {
		const space = checker.option(record.colourSpace, [...path, 'colourSpace'], [
			'srgb',
			'cmyk',
		] as const);
		if (space === BAD) failed = true;
		else out.colourSpace = space;
	}
	return failed ? BAD : out;
}

/** The width and height a PNG's header gives, or null when the bytes are not a PNG. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 33) return null;
	for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
	// The first chunk must be IHDR, 13 bytes long.
	const type = String.fromCharCode(
		bytes[12] as number,
		bytes[13] as number,
		bytes[14] as number,
		bytes[15] as number,
	);
	if (type !== 'IHDR') return null;
	const read = (at: number): number =>
		(((bytes[at] as number) << 24) |
			((bytes[at + 1] as number) << 16) |
			((bytes[at + 2] as number) << 8) |
			(bytes[at + 3] as number)) >>>
		0;
	return { width: read(16), height: read(20) };
}

function checkAssets(
	checker: Checker,
	value: unknown,
): Checked<Record<string, DesignAsset> | null> {
	const path = ['assets'];
	if (value === undefined) return null;
	if (!isRecord(value)) return checker.error('design.issue.not-an-object', path);
	const ids = Object.keys(value);
	if (ids.length > LIMITS.assets) {
		return checker.error('design.issue.too-many-assets', path, {
			count: ids.length,
			max: LIMITS.assets,
		});
	}
	const out: Record<string, DesignAsset> = {};
	let failed = false;
	for (const id of ids) {
		if (id.length > 32 || !KEBAB.test(id)) {
			checker.error('design.issue.asset-id', PLAIN_KEY.test(id) ? [...path, id] : path);
			failed = true;
			continue;
		}
		const at = [...path, id];
		const record = checker.record(value[id], at, ['png', 'width', 'height']);
		if (record === BAD) {
			failed = true;
			continue;
		}
		const side = { min: 1, max: LIMITS.assetSide, integer: true };
		const width = checker.number(record.width, [...at, 'width'], side);
		const height = checker.number(record.height, [...at, 'height'], side);
		const png = record.png;
		let bytes: Uint8Array | null = null;
		if (typeof png !== 'string') checker.error('design.issue.asset-encoding', [...at, 'png']);
		else if (png.length > Math.ceil(LIMITS.assetBytes / 3) * 4) {
			checker.error('design.issue.asset-too-large', [...at, 'png'], { max: LIMITS.assetBytes });
		} else {
			bytes = base64Decode(png);
			if (bytes === null) checker.error('design.issue.asset-encoding', [...at, 'png']);
		}
		const size = bytes === null ? null : pngSize(bytes);
		if (bytes !== null && size === null)
			checker.error('design.issue.asset-not-png', [...at, 'png']);
		if (
			size !== null &&
			width !== BAD &&
			height !== BAD &&
			(size.width !== width || size.height !== height)
		) {
			checker.error('design.issue.asset-mismatch', [...at, 'png']);
			failed = true;
		}
		if (size === null || width === BAD || height === BAD) {
			failed = true;
			continue;
		}
		out[id] = { png: png as string, width, height };
	}
	return failed ? BAD : out;
}

/**
 * Every problem at once. `design` is the input made valid where that is
 * unambiguous, or null. `options.fonts` is where a caption's font is looked
 * up, the built-in family by default: a contract addition, as for
 * `buildScene`'s context.
 */
export function validateDesign(
	input: unknown,
	registries: DesignRegistries,
	options: { readonly fonts?: FontRegistry } = {},
): { readonly design: QrDesignV1 | null; readonly issues: readonly Issue[] } {
	if (typeof registries !== 'object' || registries === null) {
		throw new TypeError('validateDesign: registries is the design registries.');
	}
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('validateDesign: options is an object.');
	}
	const checker = new Checker(registries, options.fonts);
	const top = [
		'schema',
		'version',
		'symbol',
		'quietZone',
		'background',
		'modules',
		'regions',
		'logo',
		'frame',
		'output',
		'assets',
		'name',
	];
	if (!isRecord(input)) {
		checker.error('design.issue.not-an-object', []);
		return { design: null, issues: checker.issues };
	}
	if (input.schema !== 'qr-design') {
		checker.error('design.issue.schema', ['schema']);
		return { design: null, issues: checker.issues };
	}
	if (input.version !== DESIGN_VERSION) {
		checker.error('design.issue.unsupported-version', ['version'], { supported: DESIGN_VERSION });
		return { design: null, issues: checker.issues };
	}
	checker.record(input, [], top);

	const symbol = own(input, 'symbol')
		? checkSymbol(checker, input.symbol)
		: checker.error('design.issue.required', ['symbol']);
	const quietZone = own(input, 'quietZone')
		? checker.number(input.quietZone, ['quietZone'], {
				min: 0,
				max: LIMITS.quietZone,
				integer: true,
			})
		: checker.error('design.issue.required', ['quietZone']);
	if (symbol !== BAD && quietZone !== BAD) {
		const minimum = MIN_QUIET_ZONE[symbol.symbology];
		if (minimum !== undefined && quietZone < minimum) {
			checker.warn('design.issue.quiet-zone-small', ['quietZone'], { min: minimum });
		}
	}
	let background: Checked<DesignPaint | null> = BAD;
	if (!own(input, 'background')) checker.error('design.issue.required', ['background']);
	else
		background = input.background === null ? null : checker.paint(input.background, ['background']);
	const modules = own(input, 'modules')
		? checkModules(checker, input.modules)
		: checker.error('design.issue.required', ['modules']);
	const regions = checkRegions(checker, input.regions);
	const assets = checkAssets(checker, input.assets);
	const rawAssets = isRecord(input.assets) ? input.assets : null;
	const logo = checkLogo(checker, input.logo, rawAssets);
	const frame = checkFrame(checker, input.frame);
	const output = checkOutput(checker, input.output);
	let name: Checked<string> | undefined;
	if (own(input, 'name')) {
		name = checker.text(input.name, ['name'], LIMITS.name);
		if (name !== BAD && controlAt(name) !== -1)
			name = checker.error('design.issue.control-character', ['name'], {
				position: controlAt(name),
			});
	}

	// Embedded images nothing refers to are dropped. Which image the logo
	// names is read from the input, so this is reported with everything else
	// even when the logo itself has a problem.
	const named =
		isRecord(input.logo) && isRecord(input.logo.source) && input.logo.source.kind === 'asset'
			? input.logo.source.id
			: undefined;
	const keepUsed = (
		all: Record<string, DesignAsset> | null,
	): Record<string, DesignAsset> | null => {
		if (all === null) return null;
		let kept: Record<string, DesignAsset> | null = null;
		for (const id of Object.keys(all)) {
			if (id === named) {
				kept ??= {};
				kept[id] = all[id] as DesignAsset;
			} else checker.warn('design.issue.unused-asset', ['assets', id]);
		}
		return kept;
	};
	const usedAssets = assets === BAD ? null : keepUsed(assets);

	// What the scene builder will change on Micro QR and rMQR, said up front.
	if (
		symbol !== BAD &&
		regions !== BAD &&
		(symbol.symbology === 'micro' || symbol.symbology === 'rmqr')
	) {
		for (const role of ['finder', 'sub-finder', 'corner-finder'] as const) {
			const style = regions[role];
			if (style === undefined) continue;
			// The finder keeps a styled centre; the smaller patterns are plain.
			const plain =
				style.outer.id === 'square' &&
				(role !== 'sub-finder' || style.inner.id === 'square-centre');
			if (!plain)
				checker.issues.push(issue('design.issue.region-corners', ['regions', role], 'info'));
		}
	}
	if (
		symbol !== BAD &&
		frame !== BAD &&
		frame !== null &&
		symbol.symbology === 'rmqr' &&
		frame.ref.id !== 'none'
	) {
		checker.warn('design.issue.frame-unsupported', ['frame']);
	}

	if (
		checker.errors > 0 ||
		symbol === BAD ||
		quietZone === BAD ||
		background === BAD ||
		modules === BAD ||
		regions === BAD ||
		assets === BAD ||
		logo === BAD ||
		frame === BAD ||
		output === BAD ||
		name === BAD
	) {
		return { design: null, issues: checker.issues };
	}

	const design: QrDesignV1 = {
		schema: 'qr-design',
		version: 1,
		symbol,
		quietZone,
		background,
		modules,
		regions,
		logo,
		frame,
		output,
		...(usedAssets === null ? {} : { assets: usedAssets }),
		...(name === undefined ? {} : { name }),
	};
	return { design, issues: checker.issues };
}
