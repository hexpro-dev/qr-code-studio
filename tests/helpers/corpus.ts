/**
 * A seeded corpus of captures: QR symbols from independent encoders, drawn,
 * then damaged at a graded severity.
 *
 * Severity runs 0 to 1 for every kind of damage, scaled so that 0 is a clean
 * render and 1 is past what any reader recovers, which puts the readers'
 * cliffs somewhere in the middle where a test can see them. Every capture is
 * a function of its seed alone.
 */

import type { BitMatrix } from '../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../src/core/image.js';
import { createPrng } from '../../src/core/prng.js';
import type { Prng } from '../../src/core/prng.js';
import {
	blur,
	contrast,
	dim,
	glare,
	gradient,
	invert,
	mirror,
	noise,
	paint,
	place,
	rotate,
	shrink,
} from './damage.js';
import { drawGrid } from './draw.js';
import type { EcLevel } from './oracles.js';
import { bwipMatrix, generatorMatrix, qrcodeMatrix } from './oracles.js';

export const DAMAGE_KINDS = [
	'rotation',
	'perspective',
	'blur',
	'noise',
	'glare',
	'gradient',
	'contrast',
	'dim',
	'resolution',
	'logo',
	'combined',
] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

export interface Capture {
	readonly seed: number;
	readonly text: string;
	readonly ecLevel: EcLevel;
	readonly encoder: 'qrcode' | 'qrcode-generator' | 'bwip-js';
	readonly kind: DamageKind;
	readonly severity: number;
	readonly image: RgbaImage;
}

const HOSTS = ['example.com', 'example.org', 'example.net', 'menu.example.com'];
const WORDS = ['menu', 'table', 'order', 'event', 'ticket', 'room', 'guest', 'item', 'page'];

/** Synthetic content of the kinds people print: links, digits, short text. */
function content(random: Prng): string {
	switch (random.int(4)) {
		case 0: {
			let path = '';
			for (let i = 0, n = 1 + random.int(4); i < n; i += 1) {
				path += `/${WORDS[random.int(WORDS.length)]}${random.int(1000)}`;
			}
			return `https://${HOSTS[random.int(HOSTS.length)]}${path}`;
		}
		case 1:
			return String(random.int(1_000_000_000)).padStart(1 + random.int(40), '7');
		case 2:
			return `WIFI:T:WPA;S:Example Network ${random.int(100)};P:example-${random.int(100000)};;`;
		default: {
			let text = '';
			for (let i = 0, n = 2 + random.int(30); i < n; i += 1) {
				text += `${WORDS[random.int(WORDS.length)]} `;
			}
			return text.trim();
		}
	}
}

function matrixFor(text: string, ecLevel: EcLevel, encoder: Capture['encoder']): BitMatrix {
	if (encoder === 'qrcode') return qrcodeMatrix(text, { ecLevel });
	if (encoder === 'qrcode-generator') return generatorMatrix(text, ecLevel);
	return bwipMatrix(text, ecLevel);
}

/** Linear interpolation, for severity to a parameter. */
function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Apply one kind of damage at a severity, with the generator for any choices it makes. */
export function damage(
	image: RgbaImage,
	kind: DamageKind,
	severity: number,
	random: Prng,
	modulePixels: number,
): RgbaImage {
	switch (kind) {
		case 'rotation':
			return rotate(image, lerp(0, 45, severity) * (random.int(2) === 0 ? 1 : -1));
		case 'perspective':
			return place(image, {
				yaw: lerp(0, 70, severity) * (random.next() - 0.5) * 2,
				pitch: lerp(0, 70, severity) * (random.next() - 0.5) * 2,
				distance: lerp(8, 2.5, severity),
				fill: 0.8,
				background: 240,
			}).image;
		case 'blur':
			return blur(image, Math.round(lerp(0, 0.9, severity) * modulePixels));
		case 'noise':
			return noise(image, lerp(0, 255, severity), random.int(0x7fffffff));
		case 'glare':
			return glare(image, lerp(0, 320, severity), {
				x: 0.2 + random.next() * 0.6,
				y: 0.2 + random.next() * 0.6,
			});
		case 'gradient':
			return gradient(image, lerp(0, 520, severity) * (random.int(2) === 0 ? 1 : -1));
		case 'contrast':
			return contrast(image, lerp(1, 0.03, severity), 100 + random.int(56));
		case 'dim':
			return noise(dim(image, lerp(1, 0.06, severity), random.int(12)), 6, random.int(0x7fffffff));
		case 'resolution':
			return shrink(image, lerp(1, modulePixels / 1.1, severity));
		case 'logo': {
			const side = lerp(0, 0.6, severity);
			return paint(
				image,
				{ x: 0.5 - side / 2, y: 0.5 - side / 2, width: side, height: side },
				96 + random.int(64),
			);
		}
		case 'combined': {
			let out = image;
			out = rotate(out, lerp(0, 20, severity) * (random.next() - 0.5) * 2);
			out = blur(out, Math.round(lerp(0, 0.4, severity) * modulePixels));
			out = gradient(out, lerp(0, 200, severity));
			out = noise(out, lerp(0, 90, severity), random.int(0x7fffffff));
			return contrast(out, lerp(1, 0.4, severity));
		}
	}
}

export interface CaptureOptions {
	/** Restrict to one kind; default a seeded choice among all of them. */
	readonly kind?: DamageKind;
	/** Fix the severity; default a seeded choice in [0, 1]. */
	readonly severity?: number;
	/** Apply after the damage: invert or mirror the capture. */
	readonly invert?: boolean;
	readonly mirror?: boolean;
}

/** The capture for a seed. */
export function capture(seed: number, options: CaptureOptions = {}): Capture {
	const random = createPrng(seed);
	const text = content(random.fork(1));
	const ecLevel = (['L', 'M', 'Q', 'H'] as const)[random.int(4)] as EcLevel;
	const encoder = (['qrcode', 'qrcode-generator', 'bwip-js'] as const)[
		random.int(3)
	] as Capture['encoder'];
	const kind = options.kind ?? (DAMAGE_KINDS[random.int(DAMAGE_KINDS.length)] as DamageKind);
	const severity = options.severity ?? random.next();
	const matrix = matrixFor(text, ecLevel, encoder);
	// Two to seven pixels a module, keeping the picture a size a test can afford.
	const modulePixels =
		Math.max(2, Math.min(7, Math.floor(420 / (matrix.width + 8)))) - random.int(2);
	let image = drawGrid(matrix, { scale: Math.max(2, modulePixels), quiet: 4 });
	image = damage(image, kind, severity, random.fork(2), Math.max(2, modulePixels));
	if (options.invert === true) image = invert(image);
	if (options.mirror === true) image = mirror(image);
	return { seed, text, ecLevel, encoder, kind, severity, image };
}
