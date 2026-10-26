/**
 * The design panels: presets, module shape, corner squares, colour, logo,
 * frame and printed size.
 *
 * Each turns a choice into a `design/patch` (or a preset, or a shuffle) and
 * reads back what the studio made of it, so a change the content type does
 * not allow simply does not stick, and the refusal says why. A slider opens a
 * history group on its first movement and closes it when it is let go, so a
 * whole drag is one step of undo.
 */

import { defaultDesign } from '../design/document.js';
import { importLogo } from '../dom/logo.js';
import type {
	DesignPaint,
	DesignStop,
	EntryRef,
	Ink,
	ModuleFamily,
	ParamValue,
	QrDesignV1,
	RegionRole,
	RegionStyle,
} from '../design/types.js';
import { BUILT_IN_FONTS } from '../text/registry.js';
import { contrastRatio, logoPatches, luminance, removeLogoPatches } from '../studio/index.js';
import type {
	CatalogueEntry,
	RegionCatalogueEntry,
	StudioAction,
	StudioSnapshot,
} from '../studio/index.js';
import {
	button,
	choiceGroup,
	field,
	grouped,
	issueList,
	paramControl,
	slider,
} from './controls.js';
import type { Choice, ParamControl } from './controls.js';
import type { AppContext, View } from './context.js';
import { h, replace, setText, uid } from './dom.js';
import { showSvg, staticUrl } from './images.js';
import { degrees, fine, num, percent, t } from './text.js';

export interface Panel extends View {
	readonly root: HTMLElement;
	meta(snapshot: StudioSnapshot): string;
}

/** JSON with its keys sorted, so two designs built in a different order still compare equal. */
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, inner]) => inner !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

function patch(
	ctx: AppContext,
	path: readonly (string | number)[],
	value: unknown,
	coalesce?: string,
): void {
	const action: StudioAction =
		coalesce === undefined
			? { type: 'design/patch', patch: { path, value } }
			: { type: 'design/patch', patch: { path, value }, coalesce };
	ctx.dispatch(action);
}

/** A grouped dispatcher for a slider whose value lands at `path`. */
function sliderPatch(
	ctx: AppContext,
	key: string,
	value: (input: number) => { path: readonly (string | number)[]; value: unknown },
): (input: number, phase: 'move' | 'end') => void {
	return grouped(
		key,
		(k) => ctx.dispatch({ type: 'history/begin', key: k }),
		(input) => {
			const next = value(input);
			patch(ctx, next.path, next.value);
		},
		(k) => ctx.dispatch({ type: 'history/commit', key: k }),
	);
}

function thumbnailUrl(kind: string, entry: CatalogueEntry): string {
	return staticUrl(`${kind}:${entry.id}`, () => entry.thumbnail());
}

/** Param controls for an entry, rebuilt when the entry changes and updated in place otherwise. */
function paramPanel(
	ctx: AppContext,
	host: HTMLElement,
	keyPrefix: string,
	read: () => EntryRef | undefined,
	write: (ref: EntryRef) => { path: readonly (string | number)[]; value: unknown },
): { draw(entry: CatalogueEntry | undefined, ref: EntryRef | undefined): void } {
	let drawnId: string | null = null;
	let controls = new Map<string, ParamControl>();
	return {
		draw(entry, ref) {
			const id = entry?.id ?? null;
			if (id !== drawnId) {
				drawnId = id;
				controls = new Map();
				const children: HTMLElement[] = [];
				for (const schema of entry?.params ?? []) {
					let open = false;
					const send = (value: ParamValue, phase: 'move' | 'end'): void => {
						const current = read();
						if (current === undefined) return;
						const next = write({
							id: current.id,
							params: { ...current.params, [schema.key]: value },
						});
						const key = `${keyPrefix}:${schema.key}`;
						if (phase === 'move' && !open) {
							ctx.dispatch({ type: 'history/begin', key });
							open = true;
						}
						patch(ctx, next.path, next.value);
						if (phase === 'end' && open) {
							ctx.dispatch({ type: 'history/commit', key });
							open = false;
						}
					};
					const control = paramControl(schema, send);
					controls.set(schema.key, control);
					children.push(control.root);
				}
				replace(host, children);
				host.hidden = children.length === 0;
			}
			for (const schema of entry?.params ?? []) {
				controls.get(schema.key)?.set(ref?.params?.[schema.key] ?? schema.default);
			}
		},
	};
}

// Presets.

export function createGallery(ctx: AppContext, card: HTMLDetailsElement): Panel {
	const grid = h('div', { className: 'gallery__grid' });
	const name = uid('preset');
	const shuffle = button(t('app.style.shuffle'), {
		icon: 'shuffle',
		onClick: () => {
			const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
			ctx.dispatch({ type: 'design/shuffle', seed });
		},
	});
	const root = h('div', { className: 'gallery' }, [
		h('fieldset', { className: 'gallery__set' }, [
			h('legend', { className: 'sr-only', text: t('app.style.presets') }),
			grid,
		]),
		h('div', { className: 'gallery__actions' }, [
			shuffle,
			h('p', { className: 'field__hint', text: t('app.style.shuffle-hint') }),
		]),
	]);
	// A preset can appear twice, under the brand kit and in its own category,
	// so each id keeps every picture and every input that shows it.
	const images: [string, HTMLImageElement][] = [];
	const inputs: [string, HTMLInputElement][] = [];
	let shownKit = '';
	let shownCatalogue: unknown = null;
	let thumbs: StudioSnapshot['presetThumbnails'] | null = null;
	let drawnThumbs: StudioSnapshot['presetThumbnails'] | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** The presets of the brand kit last applied, offered first. */
	function kitPresets(snapshot: StudioSnapshot): readonly string[] {
		const library = snapshot.library;
		if (library.status !== 'on' && library.status !== 'file') return [];
		return library.kit?.kit.presets ?? [];
	}

	function build(snapshot: StudioSnapshot): void {
		images.length = 0;
		inputs.length = 0;
		const children: HTMLElement[] = [];
		const all = snapshot.catalogue.presets.flatMap((group) => group.presets);
		const kit = kitPresets(snapshot)
			.map((id) => all.find((preset) => preset.id === id))
			.filter((preset) => preset !== undefined);
		const groups = [
			...(kit.length === 0 ? [] : [{ labelKey: 'app.style.from-kit', presets: kit }]),
			...snapshot.catalogue.presets,
		];
		for (const group of groups) {
			children.push(h('p', { className: 'gallery__category', text: t(group.labelKey) }));
			for (const preset of group.presets) {
				const img = h('img', {
					className: 'choice__img',
					attrs: { alt: '', width: 72, height: 72, decoding: 'async' },
				});
				const input = h('input', {
					className: 'choice__input',
					attrs: { type: 'radio', name, value: preset.id },
					on: {
						change: () => {
							if (input.checked) ctx.dispatch({ type: 'design/preset', id: preset.id });
						},
					},
				});
				images.push([preset.id, img]);
				inputs.push([preset.id, input]);
				children.push(
					h('label', { className: 'choice choice--preset' }, [
						input,
						h('span', { className: 'choice__box' }, [
							img,
							h('span', { className: 'choice__label', text: t(preset.labelKey) }),
						]),
					]),
				);
			}
		}
		replace(grid, children);
	}

	/** Draw the pictures a few at a time, so typing stays smooth while the gallery catches up. */
	function drawThumbs(): void {
		timer = null;
		if (!card.open || thumbs === null || thumbs === drawnThumbs) return;
		const set = thumbs;
		drawnThumbs = set;
		const queue = [...images];
		const step = (): void => {
			if (set !== thumbs) return;
			const started = performance.now();
			while (queue.length > 0 && performance.now() - started < 12) {
				const [id, img] = queue.shift() as [string, HTMLImageElement];
				const svg = set.get(id);
				if (svg !== null) showSvg(img, svg);
			}
			if (queue.length > 0) setTimeout(step, 0);
		};
		step();
	}

	card.addEventListener('toggle', () => {
		if (card.open && timer === null) timer = setTimeout(drawThumbs, 0);
	});

	return {
		root,
		update(snapshot) {
			const kit = kitPresets(snapshot).join(',');
			if (shownCatalogue !== snapshot.catalogue || kit !== shownKit) {
				shownCatalogue = snapshot.catalogue;
				shownKit = kit;
				build(snapshot);
				drawnThumbs = null;
			}
			if (snapshot.presetThumbnails !== thumbs) {
				thumbs = snapshot.presetThumbnails;
				if (timer !== null) clearTimeout(timer);
				// The first drawing at once; after that, only once typing pauses.
				timer = setTimeout(drawThumbs, drawnThumbs === null ? 0 : 350);
			}
			const current = matchPreset(ctx, snapshot.document.design);
			for (const [id, input] of inputs) {
				const checked = id === current;
				if (input.checked !== checked) input.checked = checked;
				input.disabled = snapshot.design.locked;
			}
			shuffle.disabled = snapshot.design.locked;
		},
		meta(snapshot) {
			const design = snapshot.document.design;
			const id = matchPreset(ctx, design);
			const preset = id === null ? undefined : ctx.registries.design.presets.get(id);
			if (preset !== undefined) return t(preset.labelKey);
			return isStandard(design) ? t('app.style.standard') : t('app.style.custom');
		},
	};
}

const STANDARD = stable(lookOf(defaultDesign()));

/** The parts of a design that make its look, without its size or name. */
function lookOf(design: QrDesignV1): unknown {
	return {
		modules: design.modules,
		regions: design.regions,
		background: design.background,
		frame: design.frame,
		logo: design.logo,
	};
}

/** True for the design the studio starts with: square modules, black on white. */
function isStandard(design: QrDesignV1): boolean {
	return stable(lookOf(design)) === STANDARD;
}

const matchCache = new WeakMap<QrDesignV1, string | null>();

/** The preset this design is, if it is one: its look, leaving out what a preset never sets. */
export function matchPreset(ctx: AppContext, design: QrDesignV1): string | null {
	const cached = matchCache.get(design);
	if (cached !== undefined) return cached;
	const look = (d: QrDesignV1, withLogo: boolean): string =>
		stable({
			modules: d.modules,
			regions: d.regions,
			background: d.background,
			frame: d.frame,
			quietZone: d.quietZone,
			logo: withLogo ? d.logo : null,
		});
	let found: string | null = null;
	for (const preset of ctx.registries.design.presets.list()) {
		const withLogo = preset.design.logo !== null;
		if (look(design, withLogo) === look(preset.design, withLogo)) {
			found = preset.id;
			break;
		}
	}
	matchCache.set(design, found);
	return found;
}

// Module shape.

export function createModules(ctx: AppContext): Panel {
	const params = h('div', { className: 'params' });
	const shapes = choiceGroup(
		t('app.modules.shape'),
		[],
		(value) => patch(ctx, ['modules', 'shape'], { id: value }),
		'swatches',
	);
	const panel = paramPanel(
		ctx,
		params,
		'modules',
		() => ctx.snapshot().document.design.modules.shape,
		(ref) => ({ path: ['modules', 'shape'], value: ref }),
	);
	const root = h('div', { className: 'panel' }, [shapes.root, params]);
	let shownCatalogue: unknown = null;
	return {
		root,
		update(snapshot) {
			const catalogue = snapshot.catalogue;
			if (shownCatalogue !== catalogue) {
				shownCatalogue = catalogue;
				shapes.setChoices(
					catalogue.moduleShapes.map((entry) => ({
						value: entry.id,
						label: t(entry.labelKey),
						picture: thumbnailUrl('module', entry),
					})),
				);
			}
			const ref = snapshot.document.design.modules.shape;
			shapes.set(ref.id);
			panel.draw(
				catalogue.moduleShapes.find((entry) => entry.id === ref.id),
				ref,
			);
			for (const input of shapes.inputs()) input.disabled = snapshot.design.locked;
		},
		meta(snapshot) {
			const entry = snapshot.catalogue.moduleShapes.find(
				(found) => found.id === snapshot.document.design.modules.shape.id,
			);
			return entry === undefined ? '' : t(entry.labelKey);
		},
	};
}

// Corner squares.

const ROLE_KINDS: Readonly<Record<RegionRole, string>> = {
	finder: 'concentric-7',
	'sub-finder': 'concentric-5',
	'corner-finder': 'corner-l',
};
const ROLES: readonly RegionRole[] = ['finder', 'sub-finder', 'corner-finder'];

/** The regions for a ring and centre: every role both can draw, keeping the colours already set. */
function regionsFor(
	outer: EntryRef,
	inner: EntryRef,
	snapshot: StudioSnapshot,
): QrDesignV1['regions'] {
	const current = snapshot.document.design.regions;
	const ring = snapshot.catalogue.rings.find((entry) => entry.id === outer.id);
	const centre = snapshot.catalogue.centres.find((entry) => entry.id === inner.id);
	const out: Partial<Record<RegionRole, RegionStyle>> = {};
	for (const role of ROLES) {
		const kind = ROLE_KINDS[role];
		const before = current[role] ?? current.finder;
		const style: RegionStyle = {
			outer,
			inner,
			...(before?.outerPaint === undefined ? {} : { outerPaint: before.outerPaint }),
			...(before?.innerPaint === undefined ? {} : { innerPaint: before.innerPaint }),
		};
		const drawable =
			ring !== undefined &&
			centre !== undefined &&
			(ring.kinds as readonly string[]).includes(kind) &&
			(centre.kinds as readonly string[]).includes(kind);
		// A role neither can draw keeps what it had (rMQR's corner pattern), or
		// falls back to the symbology's own when it had nothing.
		if (drawable) out[role] = style;
		else if (current[role] !== undefined && role !== 'finder') out[role] = current[role];
	}
	return out;
}

/** The family of finder pairs the design's module shape is drawn with. */
function moduleFamily(snapshot: StudioSnapshot): ModuleFamily {
	const id = snapshot.document.design.modules.shape.id;
	return snapshot.catalogue.moduleShapes.find((entry) => entry.id === id)?.family ?? 'square';
}

/** The centres a ring is offered with among the design's modules. */
function ringPairs(
	ring: RegionCatalogueEntry | undefined,
	snapshot: StudioSnapshot,
): readonly string[] {
	return ring === undefined ? [] : ring.pairsByFamily[moduleFamily(snapshot)];
}

function currentEyes(snapshot: StudioSnapshot): { outer: EntryRef; inner: EntryRef } {
	const finder = snapshot.document.design.regions.finder;
	return {
		outer: finder?.outer ?? { id: 'square' },
		inner: finder?.inner ?? { id: 'square-centre' },
	};
}

export function createEyes(ctx: AppContext): Panel {
	const ringParams = h('div', { className: 'params' });
	const centreParams = h('div', { className: 'params' });
	const setEyes = (outer: EntryRef, inner: EntryRef): void => {
		patch(ctx, ['regions'], regionsFor(outer, inner, ctx.snapshot()));
	};
	const rings = choiceGroup(
		t('app.eyes.ring'),
		[],
		(value) => {
			const snapshot = ctx.snapshot();
			const ring = snapshot.catalogue.rings.find((entry) => entry.id === value);
			const { inner } = currentEyes(snapshot);
			// Keep the centre if it pairs with the new ring; otherwise the first that does.
			const pairs = ringPairs(ring, snapshot);
			const centre = pairs.includes(inner.id) ? inner : { id: pairs[0] ?? 'square-centre' };
			setEyes({ id: value }, centre);
		},
		'swatches',
	);
	const centres = choiceGroup(
		t('app.eyes.centre'),
		[],
		(value) => setEyes(currentEyes(ctx.snapshot()).outer, { id: value }),
		'swatches',
	);
	const ringPanel = paramPanel(
		ctx,
		ringParams,
		'ring',
		() => currentEyes(ctx.snapshot()).outer,
		(ref) => ({
			path: ['regions'],
			value: regionsFor(ref, currentEyes(ctx.snapshot()).inner, ctx.snapshot()),
		}),
	);
	const centrePanel = paramPanel(
		ctx,
		centreParams,
		'centre',
		() => currentEyes(ctx.snapshot()).inner,
		(ref) => ({
			path: ['regions'],
			value: regionsFor(currentEyes(ctx.snapshot()).outer, ref, ctx.snapshot()),
		}),
	);
	const root = h('div', { className: 'panel' }, [
		rings.root,
		ringParams,
		centres.root,
		h('p', { className: 'field__hint', text: t('app.eyes.pairs-note') }),
		centreParams,
	]);
	let shownCatalogue: unknown = null;
	let shownFamily: ModuleFamily | null = null;
	let shownPairs = '';
	return {
		root,
		update(snapshot) {
			const catalogue = snapshot.catalogue;
			const { outer, inner } = currentEyes(snapshot);
			const family = moduleFamily(snapshot);
			if (shownCatalogue !== catalogue || shownFamily !== family) {
				shownCatalogue = catalogue;
				shownFamily = family;
				// A ring no centre makes a readable finder with among these modules
				// (the dotted ring, for a QR code) is left out rather than offered
				// with nothing to pair it.
				rings.setChoices(
					catalogue.rings
						.filter((entry) => entry.pairsByFamily[family].length > 0 || entry.id === outer.id)
						.map((entry) => ({
							value: entry.id,
							label: t(entry.labelKey),
							picture: thumbnailUrl('ring', entry),
						})),
				);
				shownPairs = '';
			}
			const ring: RegionCatalogueEntry | undefined = catalogue.rings.find(
				(entry) => entry.id === outer.id,
			);
			const pairs =
				ring === undefined ? catalogue.centres.map((entry) => entry.id) : ringPairs(ring, snapshot);
			const key = `${outer.id}:${pairs.join(',')}`;
			if (key !== shownPairs) {
				shownPairs = key;
				const choices: Choice[] = catalogue.centres
					.filter((entry) => pairs.includes(entry.id) || entry.id === inner.id)
					.map((entry) => ({
						value: entry.id,
						label: t(entry.labelKey),
						picture: thumbnailUrl('centre', entry),
					}));
				centres.setChoices(choices);
			}
			rings.set(outer.id);
			centres.set(inner.id);
			ringPanel.draw(ring, outer);
			centrePanel.draw(
				catalogue.centres.find((entry) => entry.id === inner.id),
				inner,
			);
			for (const input of [...rings.inputs(), ...centres.inputs()])
				input.disabled = snapshot.design.locked;
		},
		meta(snapshot) {
			const { outer } = currentEyes(snapshot);
			const ring = snapshot.catalogue.rings.find((entry) => entry.id === outer.id);
			return ring === undefined ? '' : t(ring.labelKey);
		},
	};
}

// Colour.

function inkHex(ink: Ink): string {
	const value = typeof ink === 'string' ? ink : ink.srgb;
	if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	if (short !== null)
		return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
	if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7).toLowerCase();
	return '#000000';
}

function inksOf(ctx: AppContext, paint: DesignPaint | null | undefined): readonly Ink[] {
	if (paint === null || paint === undefined) return [];
	switch (paint.kind) {
		case 'solid':
			return [paint.ink];
		case 'entry': {
			const fill = ctx.registries.design.fills.get(paint.ref.id);
			const out: Ink[] = [];
			for (const schema of fill?.params ?? []) {
				if (schema.kind !== 'colour') continue;
				const value = paint.ref.params?.[schema.key] ?? schema.default;
				if (typeof value === 'string') out.push(value);
			}
			return out;
		}
		default:
			return paint.stops.map((stop) => stop.ink);
	}
}

type PaintKind = 'solid' | 'linear' | 'radial' | 'entry' | 'none' | 'same';

interface PaintEditorOptions {
	readonly label: string;
	readonly read: (snapshot: StudioSnapshot) => DesignPaint | null | undefined;
	readonly write: (
		paint: DesignPaint | null | undefined,
	) => readonly { path: readonly (string | number)[]; value: unknown }[];
	/** Extra kinds this paint offers: transparent for the ground, "as the modules" for the corners. */
	readonly extra: readonly ('none' | 'same' | 'entry')[];
	readonly key: string;
}

function paintEditor(
	ctx: AppContext,
	options: PaintEditorOptions,
): { root: HTMLElement; update(snapshot: StudioSnapshot): void } {
	const body = h('div', { className: 'paint__body' });
	const send = (paint: DesignPaint | null | undefined, coalesce?: string): void => {
		const patches = options.write(paint);
		const action: StudioAction =
			coalesce === undefined
				? { type: 'design/patch', patch: patches }
				: { type: 'design/patch', patch: patches, coalesce };
		ctx.dispatch(action);
	};
	const kinds: { value: PaintKind; label: string }[] = [];
	if (options.extra.includes('same')) kinds.push({ value: 'same', label: t('app.colour.same') });
	if (options.extra.includes('none'))
		kinds.push({ value: 'none', label: t('app.colour.transparent') });
	kinds.push(
		{ value: 'solid', label: t('app.colour.kind-solid') },
		{ value: 'linear', label: t('app.colour.kind-linear') },
		{ value: 'radial', label: t('app.colour.kind-radial') },
	);
	if (options.extra.includes('entry'))
		kinds.push({ value: 'entry', label: t('app.colour.kind-pattern') });

	const kindOf = (paint: DesignPaint | null | undefined): PaintKind =>
		paint === undefined
			? 'same'
			: paint === null
				? 'none'
				: paint.kind === 'conic'
					? 'radial'
					: paint.kind;

	const firstInk = (paint: DesignPaint | null | undefined): Ink => {
		const inks = inksOf(ctx, paint);
		return inks[0] ?? '#000000';
	};

	const kindGroup = choiceGroup(options.label, kinds, (value) => {
		const current = options.read(ctx.snapshot());
		const ink = inkHex(firstInk(current ?? options.read(ctx.snapshot())));
		const second = '#1d4ed8';
		const stops: DesignStop[] =
			current !== null && current !== undefined && 'stops' in current && current.stops.length >= 2
				? [...current.stops]
				: [
						{ offset: 0, ink },
						{ offset: 1, ink: ink === second ? '#000000' : second },
					];
		switch (value as PaintKind) {
			case 'same':
				send(undefined);
				return;
			case 'none':
				send(null);
				return;
			case 'solid':
				send({ kind: 'solid', ink });
				return;
			case 'linear':
				send({ kind: 'linear', angle: 45, stops, space: 'symbol' });
				return;
			case 'radial':
				send({ kind: 'radial', cx: 0.5, cy: 0.5, radius: 0.75, stops, space: 'symbol' });
				return;
			case 'entry': {
				const fill = ctx.snapshot().catalogue.fills[0];
				if (fill !== undefined) send({ kind: 'entry', ref: { id: fill.id } });
				return;
			}
		}
	});

	let drawnShape = '';
	let updaters: ((paint: DesignPaint | null | undefined) => void)[] = [];

	/** A colour well and its hex value, which say the same thing two ways. */
	const inkRow = (
		labelText: string,
		read: (paint: DesignPaint) => Ink | undefined,
		write: (paint: DesignPaint, ink: string) => DesignPaint,
		key: string,
	): HTMLElement => {
		const well = h('input', {
			className: 'colour-well',
			attrs: { type: 'color', 'aria-label': labelText },
		});
		const hexId = uid('hex');
		const hex = h('input', {
			className: 'input input--hex',
			id: hexId,
			attrs: {
				type: 'text',
				spellcheck: 'false',
				autocomplete: 'off',
				maxlength: 7,
				'aria-label': `${labelText}, ${t('app.colour.hex')}`,
			},
		});
		const problem = h('p', {
			className: 'field__hint field__hint--error',
			text: t('app.colour.hex-invalid'),
		});
		problem.hidden = true;
		let open = false;
		const apply = (value: string, phase: 'move' | 'end'): void => {
			const paint = options.read(ctx.snapshot());
			if (paint === null || paint === undefined) return;
			if (phase === 'move' && !open) {
				ctx.dispatch({ type: 'history/begin', key });
				open = true;
			}
			send(write(paint, value));
			if (phase === 'end' && open) {
				ctx.dispatch({ type: 'history/commit', key });
				open = false;
			}
		};
		well.addEventListener('input', () => apply(well.value, 'move'));
		well.addEventListener('change', () => apply(well.value, 'end'));
		hex.addEventListener('change', () => {
			const text = hex.value.trim();
			const value = text.startsWith('#') ? text : `#${text}`;
			const valid = /^#[0-9a-f]{6}$/i.test(value);
			problem.hidden = valid;
			hex.setAttribute('aria-invalid', String(!valid));
			if (valid) apply(value.toLowerCase(), 'end');
		});
		updaters.push((paint) => {
			if (paint === null || paint === undefined) return;
			const ink = read(paint);
			if (ink === undefined) return;
			const value = inkHex(ink);
			if (well.value !== value) well.value = value;
			if (document.activeElement !== hex && hex.value !== value) hex.value = value;
		});
		return h('div', { className: 'ink' }, [
			h('span', { className: 'ink__label', text: labelText }),
			well,
			hex,
			problem,
		]);
	};

	function draw(paint: DesignPaint | null | undefined): void {
		updaters = [];
		const children: HTMLElement[] = [];
		if (paint === null || paint === undefined) {
			replace(body, children);
			return;
		}
		if (paint.kind === 'solid') {
			children.push(
				inkRow(
					t('app.colour.ink'),
					(p) => (p.kind === 'solid' ? p.ink : undefined),
					(_, ink) => ({ kind: 'solid', ink }),
					`${options.key}:solid`,
				),
			);
		} else if (paint.kind === 'entry') {
			const fills = choiceGroup(
				t('app.colour.pattern'),
				ctx.snapshot().catalogue.fills.map((entry) => ({
					value: entry.id,
					label: t(entry.labelKey),
					picture: thumbnailUrl('fill', entry),
				})),
				(value) => send({ kind: 'entry', ref: { id: value } }),
				'swatches',
			);
			fills.set(paint.ref.id);
			const params = h('div', { className: 'params' });
			const panel = paramPanel(
				ctx,
				params,
				`${options.key}:fill`,
				() => {
					const current = options.read(ctx.snapshot());
					return current?.kind === 'entry' ? current.ref : undefined;
				},
				(ref) => {
					const [first] = options.write({ kind: 'entry', ref });
					return first ?? { path: [], value: undefined };
				},
			);
			updaters.push((current) => {
				if (current?.kind !== 'entry') return;
				fills.set(current.ref.id);
				panel.draw(
					ctx.snapshot().catalogue.fills.find((entry) => entry.id === current.ref.id),
					current.ref,
				);
			});
			children.push(fills.root, params);
		} else {
			const gradient = paint;
			if (gradient.kind === 'linear') {
				const angle = slider(
					t('app.colour.angle'),
					{ min: 0, max: 360, step: 1 },
					(value) => degrees(value),
					sliderPatch(ctx, `${options.key}:angle`, (value) => {
						const current = options.read(ctx.snapshot());
						const next = current?.kind === 'linear' ? { ...current, angle: value } : current;
						const [first] = options.write(next);
						return first ?? { path: [], value: undefined };
					}),
				);
				updaters.push((current) => {
					if (current?.kind === 'linear') angle.set(current.angle);
				});
				children.push(angle.root);
			} else {
				const radius = slider(
					t('app.colour.radius'),
					{ min: 0.1, max: 2, step: 0.01 },
					fine,
					sliderPatch(ctx, `${options.key}:radius`, (value) => {
						const current = options.read(ctx.snapshot());
						const next = current?.kind === 'radial' ? { ...current, radius: value } : current;
						const [first] = options.write(next);
						return first ?? { path: [], value: undefined };
					}),
				);
				updaters.push((current) => {
					if (current?.kind === 'radial') radius.set(current.radius);
				});
				children.push(radius.root);
			}
			const stops = h('ol', { className: 'stops' });
			gradient.stops.forEach((_, index) => {
				const position = slider(
					t('app.colour.stop-position', { n: index + 1 }),
					{ min: 0, max: 100, step: 1 },
					(value) => percent(value / 100),
					sliderPatch(ctx, `${options.key}:stop-${index}`, (value) => {
						const current = options.read(ctx.snapshot());
						if (current === null || current === undefined || !('stops' in current))
							return { path: [], value: undefined };
						const next = {
							...current,
							stops: current.stops.map((stop, at) =>
								at === index ? { ...stop, offset: value / 100 } : stop,
							),
						};
						const [first] = options.write(next);
						return first ?? { path: [], value: undefined };
					}),
				);
				updaters.push((current) => {
					if (current !== null && current !== undefined && 'stops' in current) {
						const stop = current.stops[index];
						if (stop !== undefined) position.set(Math.round(stop.offset * 100));
					}
				});
				const ink = inkRow(
					t('app.colour.stop', { n: index + 1 }),
					(p) => ('stops' in p ? p.stops[index]?.ink : undefined),
					(p, value) =>
						'stops' in p
							? {
									...p,
									stops: p.stops.map((stop, at) => (at === index ? { ...stop, ink: value } : stop)),
								}
							: p,
					`${options.key}:stop-ink-${index}`,
				);
				const remove =
					gradient.stops.length > 2
						? button(t('app.colour.remove-stop'), {
								small: true,
								icon: 'minus',
								attrs: { 'aria-label': t('app.colour.remove-stop-numbered', { n: index + 1 }) },
								onClick: () => {
									const current = options.read(ctx.snapshot());
									if (current !== null && current !== undefined && 'stops' in current) {
										send({ ...current, stops: current.stops.filter((_, at) => at !== index) });
									}
								},
							})
						: null;
				stops.appendChild(h('li', { className: 'stops__row' }, [ink, position.root, remove]));
			});
			const add =
				gradient.stops.length < 16
					? button(t('app.colour.add-stop'), {
							small: true,
							icon: 'plus',
							onClick: () => {
								const current = options.read(ctx.snapshot());
								if (current === null || current === undefined || !('stops' in current)) return;
								const last = current.stops[current.stops.length - 1];
								const added: DesignStop = {
									offset: 1,
									ink: last === undefined ? '#000000' : last.ink,
								};
								const respaced = [...current.stops, added].map((stop, at, all) => ({
									...stop,
									offset: all.length === 1 ? 0 : at / (all.length - 1),
								}));
								send({ ...current, stops: respaced });
							},
						})
					: null;
			const space = choiceGroup(
				t('app.colour.space'),
				[
					{ value: 'symbol', label: t('app.colour.space-symbol') },
					{ value: 'module', label: t('app.colour.space-module') },
				],
				(value) => {
					const current = options.read(ctx.snapshot());
					if (current !== null && current !== undefined && 'space' in current) {
						send({ ...current, space: value as 'symbol' | 'module' });
					}
				},
			);
			updaters.push((current) => {
				if (current !== null && current !== undefined && 'space' in current)
					space.set(current.space);
			});
			children.push(stops, ...(add === null ? [] : [add]), space.root);
		}
		replace(body, children);
	}

	const root = h('div', { className: 'paint' }, [kindGroup.root, body]);
	return {
		root,
		update(snapshot) {
			const paint = options.read(snapshot);
			const kind = kindOf(paint);
			kindGroup.set(kind);
			const shape =
				paint === null || paint === undefined
					? kind
					: paint.kind === 'entry'
						? 'entry'
						: paint.kind === 'solid'
							? 'solid'
							: `${paint.kind}:${paint.stops.length}`;
			if (shape !== drawnShape) {
				drawnShape = shape;
				draw(paint);
			}
			for (const update of updaters) update(paint);
			for (const input of kindGroup.inputs()) input.disabled = snapshot.design.locked;
		},
	};
}

export function createColour(ctx: AppContext): Panel {
	const modules = paintEditor(ctx, {
		label: t('app.colour.modules'),
		read: (snapshot) => snapshot.document.design.modules.paint,
		write: (paint) => [
			{ path: ['modules', 'paint'], value: paint ?? { kind: 'solid', ink: '#000000' } },
		],
		extra: ['entry'],
		key: 'colour:modules',
	});
	const eyes = paintEditor(ctx, {
		label: t('app.colour.eyes'),
		read: (snapshot) => snapshot.document.design.regions.finder?.outerPaint,
		write: (paint) => {
			// The corners take one paint for ring and centre together, in every
			// role that has a style; a role with none gets the plain pair.
			const snapshot = ctx.snapshot();
			const regions = snapshot.document.design.regions;
			const base = regions.finder ?? { outer: { id: 'square' }, inner: { id: 'square-centre' } };
			const out: Partial<Record<RegionRole, RegionStyle>> = {};
			for (const role of ROLES) {
				const style = role === 'finder' ? base : regions[role];
				if (style === undefined) continue;
				const { outerPaint: _o, innerPaint: _i, ...rest } = style;
				out[role] =
					paint === undefined || paint === null
						? rest
						: { ...rest, outerPaint: paint, innerPaint: paint };
			}
			return [{ path: ['regions'], value: out }];
		},
		extra: ['same'],
		key: 'colour:eyes',
	});
	const ground = paintEditor(ctx, {
		label: t('app.colour.background'),
		read: (snapshot) => snapshot.document.design.background,
		write: (paint) => [{ path: ['background'], value: paint === undefined ? null : paint }],
		extra: ['none'],
		key: 'colour:background',
	});
	const ratio = h('p', { className: 'contrast__ratio' });
	const verdict = h('p', { className: 'contrast__verdict' });
	const notes = h('ul', { className: 'field__issues' });
	const swatch = h('span', { className: 'contrast__swatch', attrs: { 'aria-hidden': 'true' } }, [
		h('span', { className: 'contrast__fg' }),
	]);
	const contrast = h(
		'div',
		{ className: 'contrast', attrs: { role: 'group', 'aria-label': t('app.colour.contrast') } },
		[
			h('p', { className: 'legend', text: t('app.colour.contrast') }),
			h('div', { className: 'contrast__row' }, [swatch, h('div', {}, [ratio, verdict])]),
			notes,
		],
	);
	const root = h('div', { className: 'panel' }, [
		h('section', { className: 'panel__part' }, [modules.root]),
		h('section', { className: 'panel__part' }, [eyes.root]),
		h('section', { className: 'panel__part' }, [ground.root]),
		contrast,
	]);
	return {
		root,
		update(snapshot) {
			modules.update(snapshot);
			eyes.update(snapshot);
			ground.update(snapshot);
			const design = snapshot.design.effective;
			const fg = [
				...inksOf(ctx, design.modules.paint),
				...inksOf(ctx, design.regions.finder?.outerPaint),
			];
			const bg = design.background === null ? ['#ffffff'] : inksOf(ctx, design.background);
			let worst = 21;
			let inverted = false;
			for (const a of fg) {
				for (const b of bg) {
					try {
						const value = contrastRatio(a, b);
						if (value < worst) {
							worst = value;
							inverted = luminance(a) > luminance(b);
						}
					} catch {
						// An ink the page cannot read is the validator's to report.
					}
				}
			}
			swatch.style.setProperty('--fg', inkHex(fg[0] ?? '#000000'));
			swatch.style.setProperty('--bg', inkHex(bg[0] ?? '#ffffff'));
			setText(ratio, t('app.colour.contrast-value', { ratio: num(worst) }));
			const level = worst >= 7 ? 'good' : worst >= 4.5 ? 'fair' : 'poor';
			contrast.dataset.level = inverted ? 'poor' : level;
			setText(
				verdict,
				inverted
					? t('app.colour.contrast-inverted')
					: level === 'good'
						? t('app.colour.contrast-good')
						: level === 'fair'
							? t('app.colour.contrast-fair')
							: t('app.colour.contrast-poor'),
			);
			const extra: string[] = [];
			if (design.background === null) extra.push(t('app.colour.contrast-transparent'));
			if (snapshot.form.designLocked) extra.push(t('studio.issue.design-locked'));
			replace(
				notes,
				extra.map((text) => h('li', { className: 'note note--info', text })),
			);
			notes.hidden = extra.length === 0;
		},
		meta(snapshot) {
			const paint = snapshot.document.design.modules.paint;
			const background = snapshot.document.design.background;
			const fg = paint.kind === 'solid' ? inkHex(paint.ink) : t('app.colour.kind-short-gradient');
			const bg =
				background === null
					? t('app.colour.transparent')
					: background.kind === 'solid'
						? inkHex(background.ink)
						: t('app.colour.kind-short-gradient');
			return t('app.colour.meta', { fg, bg });
		},
	};
}

// Logo.

export function createLogo(ctx: AppContext): Panel {
	// Hidden, and opened by the button beside it, so there is one control to
	// reach rather than a native file button styled to look like ours.
	const fileInput = h('input', {
		attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml' },
	});
	fileInput.hidden = true;
	const problems = h('ul', { className: 'field__issues' });
	problems.hidden = true;
	const sources = choiceGroup(
		t('app.logo.choose'),
		[],
		(value) => {
			const design = ctx.snapshot().document.design;
			if (value === 'none') {
				ctx.dispatch({ type: 'design/patch', patch: removeLogoPatches(design) });
				return;
			}
			if (value === 'asset') return;
			const current = design.logo;
			ctx.dispatch({
				type: 'design/patch',
				patch: [
					{
						path: ['logo'],
						value: {
							source: { kind: 'icon', id: value },
							size: current?.size ?? 0.2,
							clear: current?.clear ?? 'box',
							padding: current?.padding ?? 1,
							plate: current?.plate ?? null,
						},
					},
					...(current?.source.kind === 'asset' ? [{ path: ['assets'], value: undefined }] : []),
				],
			});
		},
		'swatches',
	);
	const upload = button(t('app.logo.upload'), {
		icon: 'image',
		onClick: () => fileInput.click(),
	});
	const take = async (file: File): Promise<void> => {
		const result = await importLogo(file);
		if (!result.ok) {
			issueList(problems, [result.error]);
			ctx.announce(t(result.error.code, result.error.params ?? {}));
			return;
		}
		issueList(problems, result.value.issues);
		ctx.dispatch({
			type: 'design/patch',
			patch: logoPatches(ctx.snapshot().document.design, result.value.asset),
		});
		ctx.announce(t('app.logo.added'));
	};
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		fileInput.value = '';
		if (file !== undefined) void take(file);
	});
	const size = slider(
		t('app.logo.size'),
		{ min: 0.05, max: 0.4, step: 0.01 },
		(value) => percent(value),
		sliderPatch(ctx, 'logo:size', (value) => ({ path: ['logo', 'size'], value })),
	);
	const padding = slider(
		t('app.logo.padding'),
		{ min: 0, max: 4, step: 0.5 },
		(value) => t('app.logo.padding-value', { value: num(value) }),
		sliderPatch(ctx, 'logo:padding', (value) => ({ path: ['logo', 'padding'], value })),
	);
	const clear = choiceGroup(
		t('app.logo.clear'),
		[
			{ value: 'none', label: t('app.logo.clear-none') },
			{ value: 'box', label: t('app.logo.clear-box') },
			{ value: 'shape', label: t('app.logo.clear-shape') },
		],
		(value) => patch(ctx, ['logo', 'clear'], value),
	);
	const plate = choiceGroup(
		t('app.logo.plate'),
		[
			{ value: 'none', label: t('app.logo.plate-none') },
			{ value: 'square', label: t('app.logo.plate-square') },
			{ value: 'rounded', label: t('app.logo.plate-rounded') },
			{ value: 'circle', label: t('app.logo.plate-circle') },
		],
		(value) => {
			const background = ctx.snapshot().document.design.background;
			const paint: DesignPaint =
				background?.kind === 'solid' ? background : { kind: 'solid', ink: '#ffffff' };
			patch(ctx, ['logo', 'plate'], value === 'none' ? null : { paint, shape: value });
		},
	);
	const levelHint = h('div', { className: 'note note--warning logo__level' }, [
		h('span', { text: t('app.logo.level-hint') }),
		button(t('app.logo.use-h'), {
			small: true,
			onClick: () => patch(ctx, ['symbol', 'ecLevel'], 'H'),
		}),
	]);
	const settings = h('div', { className: 'logo__settings' }, [
		size.root,
		clear.root,
		padding.root,
		plate.root,
		levelHint,
	]);
	const root = h('div', { className: 'panel' }, [
		sources.root,
		h('div', { className: 'logo__upload' }, [
			upload,
			h('p', { className: 'field__hint', text: t('app.logo.upload-hint') }),
			fileInput,
		]),
		problems,
		settings,
	]);
	let shownKey = '';
	return {
		root,
		update(snapshot) {
			const design = snapshot.document.design;
			const logo = design.logo;
			const hasAsset = logo?.source.kind === 'asset';
			const key = `${snapshot.catalogue.icons.length}:${hasAsset}`;
			if (key !== shownKey) {
				shownKey = key;
				const choices: Choice[] = [{ value: 'none', label: t('app.logo.none') }];
				if (hasAsset) choices.push({ value: 'asset', label: t('app.logo.picture') });
				for (const entry of snapshot.catalogue.icons) {
					choices.push({
						value: entry.id,
						label: t(entry.labelKey),
						picture: thumbnailUrl('icon', entry),
					});
				}
				sources.setChoices(choices);
			}
			sources.set(logo === null ? 'none' : logo.source.kind === 'asset' ? 'asset' : logo.source.id);
			settings.hidden = logo === null;
			if (logo !== null) {
				size.set(logo.size);
				padding.set(logo.padding);
				clear.set(logo.clear);
				plate.set(logo.plate?.shape ?? 'none');
			}
			const level =
				snapshot.symbol.status === 'empty' ? design.symbol.ecLevel : snapshot.symbol.view.ecLevel;
			levelHint.hidden = logo === null || level === 'H';
			const locked = snapshot.design.locked;
			for (const input of [...sources.inputs(), ...clear.inputs(), ...plate.inputs()])
				input.disabled = locked;
			upload.disabled = locked;
		},
		meta(snapshot) {
			const logo = snapshot.document.design.logo;
			if (logo === null) return t('app.logo.none');
			if (logo.source.kind === 'asset') return t('app.logo.picture');
			const source = logo.source;
			const entry = snapshot.catalogue.icons.find((found) => found.id === source.id);
			return entry === undefined ? '' : t(entry.labelKey);
		},
	};
}

// Frame.

export function createFrame(ctx: AppContext): Panel {
	const params = h('div', { className: 'params' });
	const frames = choiceGroup(
		t('app.frame.choose'),
		[],
		(value) => {
			if (value === 'none') {
				patch(ctx, ['frame'], null);
				return;
			}
			const entry = ctx.snapshot().catalogue.frames.find((found) => found.id === value);
			const current = ctx.snapshot().document.design.frame;
			const content = current?.text?.content ?? t('app.frame.default-caption');
			patch(ctx, ['frame'], {
				ref: { id: value },
				...(entry?.text === null || entry === undefined
					? {}
					: {
							text: {
								content: content.slice(0, entry.text.maxChars),
								fontId: current?.text?.fontId ?? BUILT_IN_FONTS[1],
							},
						}),
			});
		},
		'swatches',
	);
	const captionInput = h('input', {
		className: 'input',
		attrs: { type: 'text', autocomplete: 'off' },
		on: {
			input: () => {
				const frame = ctx.snapshot().document.design.frame;
				if (frame === null) return;
				patch(
					ctx,
					['frame', 'text'],
					{ content: captionInput.value, fontId: frame.text?.fontId ?? BUILT_IN_FONTS[1] },
					'caption',
				);
			},
		},
	});
	const caption = field(t('app.frame.caption'), captionInput);
	const fonts = choiceGroup(
		t('app.frame.font'),
		[
			{ value: BUILT_IN_FONTS[0], label: t('text.font.plex-sans-regular') },
			{ value: BUILT_IN_FONTS[1], label: t('text.font.plex-sans-bold') },
		],
		(value) => {
			const frame = ctx.snapshot().document.design.frame;
			if (frame === null) return;
			patch(ctx, ['frame', 'text'], { content: frame.text?.content ?? '', fontId: value });
		},
	);
	const text = h('div', { className: 'frame__text' }, [caption.root, fonts.root]);
	const panel = paramPanel(
		ctx,
		params,
		'frame',
		() => ctx.snapshot().document.design.frame?.ref,
		(ref) => ({ path: ['frame', 'ref'], value: ref }),
	);
	const root = h('div', { className: 'panel' }, [frames.root, text, params]);
	let shownCatalogue: unknown = null;
	return {
		root,
		update(snapshot) {
			const catalogue = snapshot.catalogue;
			if (shownCatalogue !== catalogue) {
				shownCatalogue = catalogue;
				frames.setChoices(
					catalogue.frames.map((entry) => ({
						value: entry.id,
						label: t(entry.labelKey),
						picture: thumbnailUrl('frame', entry),
					})),
				);
			}
			const frame = snapshot.document.design.frame;
			const id = frame?.ref.id ?? 'none';
			frames.set(id);
			const entry = catalogue.frames.find((found) => found.id === id);
			const limits = entry?.text ?? null;
			text.hidden = frame === null || limits === null;
			if (limits !== null && frame !== null) {
				captionInput.maxLength = limits.maxChars;
				const value = frame.text?.content ?? '';
				if (captionInput.value !== value) captionInput.value = value;
				setText(caption.hint, t('app.frame.caption-hint', { chars: limits.maxChars }));
				caption.hint.hidden = false;
				fonts.set(frame.text?.fontId ?? BUILT_IN_FONTS[1]);
			}
			panel.draw(id === 'none' ? undefined : entry, frame?.ref);
			const locked = snapshot.design.locked;
			for (const input of [...frames.inputs(), ...fonts.inputs()]) input.disabled = locked;
			captionInput.disabled = locked;
		},
		meta(snapshot) {
			const id = snapshot.document.design.frame?.ref.id ?? 'none';
			const entry = snapshot.catalogue.frames.find((found) => found.id === id);
			return entry === undefined ? '' : t(entry.labelKey);
		},
	};
}

// Printed size.

function numberInput(
	onCommit: (value: number | null) => void,
	attrs: Readonly<Record<string, string | number>>,
): HTMLInputElement {
	const input = h('input', {
		className: 'input input--number',
		attrs: { type: 'number', inputmode: 'decimal', ...attrs },
	});
	input.addEventListener('change', () => {
		const text = input.value.trim();
		onCommit(text === '' ? null : Number(text));
	});
	return input;
}

export function createPrint(ctx: AppContext): Panel {
	const sizeInput = numberInput(
		(value) => patch(ctx, ['output', 'sizeMm'], value === null ? undefined : value),
		{ min: 5, max: 2000, step: 0.5 },
	);
	const size = field(t('app.print.size'), sizeInput, t('app.print.size-hint'));
	const basis = choiceGroup(
		t('app.print.basis'),
		[
			{ value: 'artwork', label: t('app.print.basis-artwork') },
			{ value: 'symbol', label: t('app.print.basis-symbol') },
		],
		(value) => patch(ctx, ['output', 'sizeBasis'], value),
	);
	const dpiInput = numberInput(
		(value) => patch(ctx, ['output', 'dpi'], value === null ? undefined : value),
		{ min: 72, max: 2400, step: 1 },
	);
	const dpi = field(t('app.print.dpi'), dpiInput, t('app.print.dpi-hint'));
	const distanceInput = numberInput(
		(value) =>
			ctx.dispatch({
				type: 'conditions',
				conditions: { distanceMm: value === null ? null : value * 10 },
			}),
		{ min: 1, max: 10000, step: 1 },
	);
	const distance = field(t('app.print.distance'), distanceInput, t('app.print.distance-hint'));
	const problems = h('ul', { className: 'field__issues' });
	const root = h('div', { className: 'panel' }, [
		size.root,
		basis.root,
		dpi.root,
		distance.root,
		problems,
	]);
	return {
		root,
		update(snapshot) {
			const output = snapshot.document.design.output;
			const set = (input: HTMLInputElement, value: number | null | undefined): void => {
				const text = value === null || value === undefined ? '' : String(value);
				if (document.activeElement !== input && input.value !== text) input.value = text;
			};
			set(sizeInput, output.sizeMm);
			set(dpiInput, output.dpi);
			const mm = snapshot.document.conditions.distanceMm;
			set(distanceInput, mm === null ? null : mm / 10);
			basis.set(output.sizeBasis ?? 'artwork');
			const refusal = snapshot.refusal;
			issueList(
				problems,
				refusal !== null &&
					refusal.issues.some(
						(found) => found.path[0] === 'output' || found.path[0] === 'conditions',
					)
					? refusal.issues
					: [],
			);
			const locked = snapshot.design.locked;
			sizeInput.disabled = locked;
			dpiInput.disabled = locked;
			for (const input of basis.inputs()) input.disabled = locked;
		},
		meta(snapshot) {
			const sizeMm = snapshot.document.design.output.sizeMm;
			return sizeMm === undefined
				? t('app.print.not-set')
				: t('app.print.meta', { size: num(sizeMm) });
		},
	};
}
