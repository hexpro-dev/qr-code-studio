/**
 * The built-in presets: whole designs to start from.
 *
 * Every one is dark modules on a light ground, with at least 7:1 luminance
 * contrast between every module, finder and logo colour and the ground (the
 * conformance suite measures it, and refuses anything under 4.5:1). Their
 * finder pairs all make a finder the strict reader finds, and those with a
 * logo ask for a level that can pay for it.
 *
 * `minSizeMm` is a first, cautious estimate of the smallest printed width,
 * quiet zone included, at which each scans: larger for shapes that ink less
 * of each module. The scan check calibrates these later.
 *
 * Built by a function so that importing the catalogue builds nothing.
 */

import type { EcLevel } from '../../segment/types.js';
import type {
	DesignFrame,
	DesignLogo,
	DesignPaint,
	EntryRef,
	Ink,
	Preset,
	PresetCategory,
	QrDesignV1,
	RegionStyle,
} from '../types.js';

const ALL: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];
const MEDIUM_UP: readonly EcLevel[] = ['M', 'Q', 'H'];
const HIGH: readonly EcLevel[] = ['Q', 'H'];

function solid(ink: Ink): DesignPaint {
	return { kind: 'solid', ink };
}

function linear(angle: number, from: string, to: string): DesignPaint {
	return {
		kind: 'linear',
		angle,
		space: 'symbol',
		stops: [
			{ offset: 0, ink: from },
			{ offset: 1, ink: to },
		],
	};
}

function eyes(
	outer: string,
	inner: string,
	outerParams?: EntryRef['params'],
	innerParams?: EntryRef['params'],
	paints?: { readonly outer?: DesignPaint; readonly inner?: DesignPaint },
): RegionStyle {
	return {
		outer: outerParams === undefined ? { id: outer } : { id: outer, params: outerParams },
		inner: innerParams === undefined ? { id: inner } : { id: inner, params: innerParams },
		...(paints?.outer === undefined ? {} : { outerPaint: paints.outer }),
		...(paints?.inner === undefined ? {} : { innerPaint: paints.inner }),
	};
}

interface PresetSpec {
	readonly id: string;
	readonly category: PresetCategory;
	readonly minSizeMm: number;
	readonly ecLevels: readonly EcLevel[];
	readonly ecLevel?: EcLevel;
	readonly shape: EntryRef;
	readonly paint: DesignPaint;
	readonly background: DesignPaint;
	/** The finder style, also used for the rMQR sub-finder and corner patterns. */
	readonly eyes: RegionStyle;
	/** The sub-finder's, where the finder's centre has no one-module form. */
	readonly subEyes?: RegionStyle;
	readonly logo?: DesignLogo;
	readonly frame?: DesignFrame;
	readonly colourSpace?: 'srgb' | 'cmyk';
}

function preset(spec: PresetSpec): Preset {
	const design: QrDesignV1 = {
		schema: 'qr-design',
		version: 1,
		symbol: { symbology: 'qr', ecLevel: spec.ecLevel ?? 'M' },
		quietZone: 4,
		background: spec.background,
		modules: { shape: spec.shape, paint: spec.paint, light: null },
		regions: {
			finder: spec.eyes,
			'sub-finder': spec.subEyes ?? spec.eyes,
			'corner-finder': spec.eyes,
		},
		logo: spec.logo ?? null,
		frame: spec.frame ?? null,
		output: { colourSpace: spec.colourSpace ?? 'srgb' },
	};
	return Object.freeze({
		id: spec.id,
		labelKey: `design.preset.${spec.id}`,
		category: spec.category,
		design,
		minSizeMm: spec.minSizeMm,
		ecLevels: spec.ecLevels,
	});
}

const SQUARE_EYES = eyes('square', 'square-centre');
const WHITE = solid('#ffffff');

function specs(): readonly PresetSpec[] {
	return [
		// Classic.
		{
			id: 'classic-black',
			category: 'classic',
			minSizeMm: 15,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#000000'),
			background: WHITE,
			eyes: SQUARE_EYES,
		},
		{
			id: 'classic-navy',
			category: 'classic',
			minSizeMm: 15,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#0b1f3a'),
			background: WHITE,
			eyes: SQUARE_EYES,
		},
		{
			id: 'classic-soft-corners',
			category: 'classic',
			minSizeMm: 16,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.15 } },
			paint: solid('#111111'),
			background: WHITE,
			eyes: eyes('rounded', 'rounded-centre', { radius: 0.75 }, { radius: 0.35 }),
		},
		{
			id: 'classic-ink-blue',
			category: 'classic',
			minSizeMm: 15,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#0b3d91'),
			background: solid('#f7f9fc'),
			eyes: SQUARE_EYES,
		},
		{
			id: 'classic-octagon',
			category: 'classic',
			minSizeMm: 15,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#1c2430'),
			background: WHITE,
			eyes: eyes('octagon', 'octagon-centre'),
		},
		// Rounded.
		{
			id: 'rounded-graphite',
			category: 'rounded',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.3 } },
			paint: solid('#222831'),
			background: WHITE,
			eyes: eyes('rounded', 'rounded-centre'),
		},
		{
			id: 'rounded-ocean',
			category: 'rounded',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.35 } },
			paint: solid('#0a3d62'),
			background: solid('#f1f7fb'),
			eyes: eyes('extra-rounded', 'rounded-centre', undefined, { radius: 0.6 }),
		},
		{
			id: 'rounded-forest',
			category: 'rounded',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'squircle' },
			paint: solid('#1b4332'),
			background: solid('#f4f9f4'),
			eyes: eyes('squircle', 'squircle-centre'),
		},
		{
			id: 'rounded-plum',
			category: 'rounded',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.4 } },
			paint: solid('#3c1642'),
			background: solid('#fdf7ff'),
			eyes: eyes(
				'cushion',
				'rounded-centre',
				undefined,
				{ radius: 0.5 },
				{ inner: solid('#6b1d5e') },
			),
		},
		{
			id: 'rounded-terracotta',
			category: 'rounded',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.25 } },
			paint: solid('#6e2a12'),
			background: solid('#fff8f2'),
			eyes: eyes('leaf', 'leaf-centre'),
		},
		{
			id: 'rounded-link',
			category: 'rounded',
			minSizeMm: 22,
			ecLevels: HIGH,
			ecLevel: 'Q',
			shape: { id: 'rounded', params: { radius: 0.3 } },
			paint: solid('#0a3d62'),
			background: WHITE,
			eyes: eyes('extra-rounded', 'squircle-centre'),
			logo: {
				source: { kind: 'icon', id: 'link' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: { paint: WHITE, shape: 'rounded' },
				paint: solid('#0a3d62'),
			},
		},
		// Dots.
		{
			id: 'midnight-dots',
			category: 'dots',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'dot', params: { size: 0.95 } },
			paint: solid('#10173a'),
			background: WHITE,
			eyes: eyes('circle', 'circle-centre'),
		},
		{
			id: 'charcoal-dots',
			category: 'dots',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'dot', params: { size: 0.94 } },
			paint: solid('#262626'),
			background: solid('#fafafa'),
			eyes: eyes('dot-ring', 'square-centre', { size: 0.94 }),
		},
		{
			id: 'teal-dots',
			category: 'dots',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'dot', params: { size: 0.95 } },
			paint: solid('#064e57'),
			background: solid('#effaf9'),
			eyes: eyes('circle', 'squircle-centre', undefined, undefined, { inner: solid('#0b3b40') }),
		},
		{
			id: 'berry-dots',
			category: 'dots',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'dot', params: { size: 0.94 } },
			paint: solid('#5b0e2d'),
			background: solid('#fff5f8'),
			eyes: eyes('squircle', 'circle-centre'),
		},
		{
			id: 'confetti-dots',
			category: 'dots',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'dot', params: { size: 0.95 } },
			paint: {
				kind: 'entry',
				ref: {
					id: 'palette-scatter',
					params: {
						'colour-1': '#14213d',
						'colour-2': '#6a1b4d',
						'colour-3': '#1d5c4a',
						'colour-4': '#7a3b00',
						count: 4,
					},
				},
			},
			background: WHITE,
			eyes: eyes('circle', 'circle-centre', undefined, undefined, {
				outer: solid('#14213d'),
				inner: solid('#14213d'),
			}),
		},
		// Hex, the house signature.
		{
			id: 'hex-pro-blue',
			category: 'hex',
			minSizeMm: 20,
			ecLevels: MEDIUM_UP,
			shape: { id: 'hex' },
			paint: solid('#0a4f96'),
			background: WHITE,
			eyes: eyes('octagon', 'octagon-centre', undefined, undefined, { outer: solid('#333333') }),
		},
		{
			id: 'hex-graphite',
			category: 'hex',
			minSizeMm: 20,
			ecLevels: MEDIUM_UP,
			shape: { id: 'hex', params: { orientation: 'flat' } },
			paint: solid('#1f2933'),
			background: WHITE,
			eyes: SQUARE_EYES,
		},
		{
			id: 'hex-honey',
			category: 'hex',
			minSizeMm: 20,
			ecLevels: MEDIUM_UP,
			shape: { id: 'hex' },
			paint: solid('#3d2600'),
			background: solid('#fff8e7'),
			eyes: eyes('octagon', 'octagon-centre'),
		},
		{
			id: 'hex-night',
			category: 'hex',
			minSizeMm: 20,
			ecLevels: MEDIUM_UP,
			shape: { id: 'hex', params: { size: 1 } },
			paint: solid('#0d1b2a'),
			background: solid('#eef2f7'),
			eyes: eyes('square', 'octagon-centre'),
		},
		// Fluid.
		{
			id: 'fluid-ink',
			category: 'fluid',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'fluid' },
			paint: solid('#111827'),
			background: WHITE,
			eyes: eyes('extra-rounded', 'rounded-centre', undefined, { radius: 0.6 }),
		},
		{
			id: 'fluid-lagoon',
			category: 'fluid',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'fluid', params: { radius: 0.4 } },
			paint: linear(45, '#0b3954', '#055c5e'),
			background: WHITE,
			eyes: eyes('extra-rounded', 'squircle-centre', undefined, undefined, {
				outer: solid('#0b3954'),
			}),
		},
		{
			id: 'fluid-aubergine',
			category: 'fluid',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'fluid' },
			paint: solid('#3b0d3b'),
			background: solid('#fbf5fb'),
			eyes: eyes('squircle', 'squircle-centre'),
		},
		{
			id: 'classy-slate',
			category: 'fluid',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'classy' },
			paint: solid('#263238'),
			background: WHITE,
			eyes: eyes('leaf', 'leaf-centre'),
		},
		{
			id: 'cobalt-bars',
			category: 'fluid',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'bars-vertical' },
			paint: solid('#0d2c6c'),
			background: WHITE,
			eyes: eyes('rounded', 'rounded-centre'),
		},
		// Bold.
		{
			id: 'poster-yellow',
			category: 'bold',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#000000'),
			background: solid('#ffd23f'),
			eyes: SQUARE_EYES,
			frame: { ref: { id: 'banner-bottom' }, paint: solid('#000000') },
		},
		{
			id: 'bold-tomato',
			category: 'bold',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.2 } },
			paint: solid('#1a1a1a'),
			background: solid('#ffe3d8'),
			eyes: eyes('rounded', 'square-centre', undefined, undefined, { outer: solid('#8a1c0a') }),
			frame: { ref: { id: 'rounded-card' }, paint: solid('#c2410c') },
		},
		{
			id: 'bold-crosses',
			category: 'bold',
			minSizeMm: 20,
			ecLevels: MEDIUM_UP,
			shape: { id: 'cross', params: { thickness: 0.6 } },
			paint: solid('#101010'),
			background: WHITE,
			eyes: SQUARE_EYES,
		},
		{
			id: 'slate-bars',
			category: 'bold',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'bars-horizontal', params: { thickness: 0.85 } },
			paint: solid('#0f172a'),
			background: solid('#f1f5f9'),
			eyes: eyes('square', 'rounded-centre'),
		},
		{
			id: 'red-badge',
			category: 'bold',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#111111'),
			background: WHITE,
			eyes: eyes('square', 'square-centre', undefined, undefined, { outer: solid('#8b1111') }),
			frame: { ref: { id: 'badge-circle' }, paint: solid('#b91c1c') },
		},
		{
			id: 'chat-bubble',
			category: 'bold',
			minSizeMm: 20,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.35 } },
			paint: solid('#1e1b4b'),
			background: WHITE,
			eyes: eyes('rounded', 'rounded-centre'),
			frame: { ref: { id: 'speech-bubble' }, paint: solid('#1e1b4b') },
		},
		// Minimal.
		{
			id: 'minimal-tiny',
			category: 'minimal',
			minSizeMm: 25,
			ecLevels: MEDIUM_UP,
			shape: { id: 'tiny-square', params: { scale: 0.7 } },
			paint: solid('#222222'),
			background: WHITE,
			eyes: SQUARE_EYES,
		},
		{
			id: 'minimal-diamond',
			category: 'minimal',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'diamond' },
			paint: solid('#2d2d2d'),
			background: solid('#fbfbf8'),
			eyes: eyes('octagon', 'octagon-centre'),
		},
		{
			id: 'minimal-brackets',
			category: 'minimal',
			minSizeMm: 16,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid('#1c1c1c'),
			background: WHITE,
			eyes: SQUARE_EYES,
			frame: { ref: { id: 'corner-brackets' }, paint: solid('#1c1c1c') },
		},
		{
			id: 'minimal-stars',
			category: 'minimal',
			minSizeMm: 25,
			ecLevels: MEDIUM_UP,
			shape: { id: 'star', params: { inner: 0.6 } },
			paint: solid('#1e1b4b'),
			background: WHITE,
			// Star modules read everywhere; a star finder centre does not. Under a
			// realistic capture (a few degrees of roll, sub-pixel phase, light blur
			// and noise) jsQR read this preset 0 times in 8 at version 3 with a star
			// centre, and 8 in 8 with a rounded one. The look survives the swap.
			eyes: eyes('square', 'rounded-centre'),
			subEyes: SQUARE_EYES,
		},
		// Colour.
		{
			id: 'sunset-gradient',
			category: 'colour',
			minSizeMm: 20,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.3 } },
			paint: linear(45, '#5c1530', '#87300f'),
			background: solid('#fff8f0'),
			eyes: eyes('rounded', 'rounded-centre', undefined, undefined, {
				outer: solid('#4a0d24'),
				inner: solid('#4a0d24'),
			}),
		},
		{
			id: 'deep-sea-gradient',
			category: 'colour',
			minSizeMm: 20,
			ecLevels: ALL,
			shape: { id: 'squircle' },
			paint: linear(90, '#0b3c5d', '#1b4d3e'),
			background: WHITE,
			eyes: eyes('squircle', 'squircle-centre', undefined, undefined, { outer: solid('#0b3c5d') }),
		},
		{
			id: 'two-tone',
			category: 'colour',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: {
				kind: 'entry',
				ref: {
					id: 'two-tone-diagonal',
					params: { 'colour-1': '#14213d', 'colour-2': '#6b1d3a', angle: 45 },
				},
			},
			background: WHITE,
			eyes: SQUARE_EYES,
		},
		{
			id: 'violet-glow',
			category: 'colour',
			minSizeMm: 20,
			ecLevels: ALL,
			shape: { id: 'dot', params: { size: 0.95 } },
			paint: {
				kind: 'radial',
				cx: 0.5,
				cy: 0.5,
				radius: 0.7,
				space: 'symbol',
				stops: [
					{ offset: 0, ink: '#4c1d95' },
					{ offset: 1, ink: '#2a0a4a' },
				],
			},
			background: solid('#fdfbff'),
			eyes: eyes('circle', 'circle-centre', undefined, undefined, { outer: solid('#2a0a4a') }),
		},
		{
			id: 'mosaic-tiles',
			category: 'colour',
			minSizeMm: 22,
			ecLevels: MEDIUM_UP,
			shape: { id: 'mosaic' },
			paint: {
				kind: 'entry',
				ref: {
					id: 'palette-scatter',
					params: { 'colour-1': '#1d3557', 'colour-2': '#3d1f4f', 'colour-3': '#264027', count: 3 },
				},
			},
			background: solid('#fbfaf6'),
			eyes: eyes('square', 'square-centre', undefined, undefined, {
				outer: solid('#1d3557'),
				inner: solid('#1d3557'),
			}),
		},
		{
			id: 'teal-and-rust',
			category: 'colour',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.2 } },
			paint: solid('#064e57'),
			background: WHITE,
			eyes: eyes('extra-rounded', 'circle-centre', undefined, undefined, {
				outer: solid('#7c2d12'),
				inner: solid('#7c2d12'),
			}),
		},
		{
			id: 'shop-tag',
			category: 'colour',
			minSizeMm: 24,
			ecLevels: HIGH,
			ecLevel: 'Q',
			shape: { id: 'squircle' },
			paint: solid('#14532d'),
			background: WHITE,
			eyes: eyes('squircle', 'squircle-centre'),
			logo: {
				source: { kind: 'icon', id: 'shop' },
				size: 0.22,
				clear: 'shape',
				padding: 1,
				plate: { paint: WHITE, shape: 'circle' },
				paint: solid('#14532d'),
			},
			frame: { ref: { id: 'hang-tag' }, paint: solid('#14532d') },
		},
		// Print, with ink values beside the screen colours.
		{
			id: 'print-black',
			category: 'print',
			minSizeMm: 15,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid({ srgb: '#000000', cmyk: [0, 0, 0, 1] }),
			background: solid({ srgb: '#ffffff', cmyk: [0, 0, 0, 0] }),
			eyes: SQUARE_EYES,
			colourSpace: 'cmyk',
		},
		{
			id: 'print-navy',
			category: 'print',
			minSizeMm: 15,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid({ srgb: '#13294b', cmyk: [1, 0.75, 0.2, 0.55] }),
			background: solid({ srgb: '#ffffff', cmyk: [0, 0, 0, 0] }),
			eyes: SQUARE_EYES,
			colourSpace: 'cmyk',
		},
		{
			id: 'print-ticket',
			category: 'print',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'rounded', params: { radius: 0.2 } },
			paint: solid({ srgb: '#1a1a1a', cmyk: [0, 0, 0, 0.9] }),
			background: solid({ srgb: '#ffffff', cmyk: [0, 0, 0, 0] }),
			eyes: eyes('rounded', 'rounded-centre'),
			frame: { ref: { id: 'ticket' }, paint: solid({ srgb: '#7f1d1d', cmyk: [0, 0.9, 0.8, 0.5] }) },
			colourSpace: 'cmyk',
		},
		{
			id: 'print-stamp',
			category: 'print',
			minSizeMm: 18,
			ecLevels: ALL,
			shape: { id: 'square' },
			paint: solid({ srgb: '#1f2a44', cmyk: [0.9, 0.7, 0.3, 0.6] }),
			background: solid({ srgb: '#fffdf7', cmyk: [0, 0, 0.03, 0] }),
			eyes: SQUARE_EYES,
			frame: {
				ref: { id: 'stamp' },
				paint: solid({ srgb: '#1f2a44', cmyk: [0.9, 0.7, 0.3, 0.6] }),
			},
			colourSpace: 'cmyk',
		},
	];
}

/** The built-in presets, built afresh. */
export function builtInPresets(): readonly Preset[] {
	return Object.freeze(specs().map(preset));
}
