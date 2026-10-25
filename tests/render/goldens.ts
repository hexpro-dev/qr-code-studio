/**
 * Golden renders: the bytes the geometry and render layers must produce, the
 * same in Node, Chromium, WebKit and Firefox.
 *
 * This module is deliberately plain. It imports only `src/`, uses no Node API
 * and no browser API beyond `TextEncoder`, and computes SHA-256 itself in
 * 32 bit integer arithmetic, so a browser harness can bundle it, call
 * `checkGoldens()` and report what it returns without any glue of its own.
 * `tests/render/determinism.test.ts` runs the same check in Node and holds the
 * SHA-256 here against `node:crypto`.
 *
 * When a change to the renderer moves these bytes on purpose, the new digests
 * go in with the change and the commit says why. A digest that moves without
 * a reason is the bug this file exists to catch.
 */

import { PathBuilder } from '../../src/geometry/path.js';
import { traceGrid } from '../../src/geometry/trace.js';
import { parseColour } from '../../src/render/colour.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { RgbaImage, Scene, Stop } from '../../src/render/types.js';

const K = Uint32Array.from([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4) of `bytes`, as lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
	const length = bytes.length;
	const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
	padded.set(bytes);
	padded[length] = 0x80;
	const view = new DataView(padded.buffer);
	// The bit length as a 64 bit big endian number, split so it never needs
	// more than 53 bits of integer.
	view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
	view.setUint32(padded.length - 4, (length * 8) >>> 0);

	const h = Uint32Array.from([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const w = new Uint32Array(64);
	const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
	for (let block = 0; block < padded.length; block += 64) {
		for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block + i * 4);
		for (let i = 16; i < 64; i += 1) {
			const a = w[i - 15] as number;
			const b = w[i - 2] as number;
			const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
			const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
			w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = h as unknown as [
			number,
			number,
			number,
			number,
			number,
			number,
			number,
			number,
		];
		for (let i = 0; i < 64; i += 1) {
			const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const choose = (e & f) ^ (~e & g);
			const t1 = (hh + s1 + choose + (K[i] as number) + (w[i] as number)) >>> 0;
			const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (s0 + majority) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}
		h[0] = ((h[0] as number) + a) >>> 0;
		h[1] = ((h[1] as number) + b) >>> 0;
		h[2] = ((h[2] as number) + c) >>> 0;
		h[3] = ((h[3] as number) + d) >>> 0;
		h[4] = ((h[4] as number) + e) >>> 0;
		h[5] = ((h[5] as number) + f) >>> 0;
		h[6] = ((h[6] as number) + g) >>> 0;
		h[7] = ((h[7] as number) + hh) >>> 0;
	}
	let out = '';
	for (const word of h) out += word.toString(16).padStart(8, '0');
	return out;
}

/** mulberry32, so the module grid below is the same everywhere. */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function bytesOf(image: RgbaImage): Uint8Array {
	return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

const blue = parseColour('#0b76d9');
const grey = parseColour('#9f9f9f');
const white = parseColour('#ffffff');

function moduleGrid(): Scene {
	const random = seeded(20261025);
	const cells = Array.from({ length: 29 * 29 }, () => random() < 0.5);
	const grid = traceGrid(29, 29, (x, y) => cells[y * 29 + x] === true);
	const stops: Stop[] = [
		{ offset: 0, colour: parseColour('#101820') },
		{ offset: 1, colour: blue },
	];
	return {
		width: 37,
		height: 37,
		background: { kind: 'solid', colour: white },
		layers: [
			{
				kind: 'path',
				path: new PathBuilder().transform([1, 0, 0, 1, 4, 4]).append(grid).build(),
				paint: { kind: 'linear', x1: 4, y1: 4, x2: 33, y2: 33, stops },
			},
		],
	};
}

function dots(): Scene {
	const builder = new PathBuilder();
	const random = seeded(7);
	for (let y = 0; y < 21; y += 1) {
		for (let x = 0; x < 21; x += 1) {
			if (random() < 0.5) builder.circle(x + 4.5, y + 4.5, 0.47);
		}
	}
	return {
		width: 29,
		height: 29,
		background: {
			kind: 'radial',
			cx: 14.5,
			cy: 14.5,
			r: 20,
			stops: [
				{ offset: 0, colour: white },
				{ offset: 1, colour: grey },
			],
		},
		layers: [
			{
				kind: 'path',
				path: builder.build(),
				paint: { kind: 'solid', colour: parseColour('#000000e0') },
			},
		],
	};
}

function groups(withImage: boolean): Scene {
	const plate = new PathBuilder().roundedRect(8, 8, 16, 16, [4, 1, 4, 1]).build();
	const ring = new PathBuilder()
		.circle(16, 16, 10)
		.transform([-1, 0, 0, 1, 32, 0])
		.circle(16, 16, 6)
		.build();
	const image: RgbaImage = {
		width: 3,
		height: 2,
		data: new Uint8ClampedArray([
			255, 0, 0, 255, 0, 255, 0, 200, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 255, 128, 255, 0, 255,
			255,
		]),
	};
	return {
		width: 32,
		height: 32,
		background: { kind: 'solid', colour: white },
		title: 'Golden & groups',
		layers: [
			{
				kind: 'group',
				opacity: 0.8,
				clip: new PathBuilder().circle(16, 16, 13.3).build(),
				children: [
					{ kind: 'path', path: ring, paint: { kind: 'solid', colour: blue } },
					{
						kind: 'group',
						opacity: 0.5,
						children: [
							{
								kind: 'path',
								path: plate,
								paint: {
									kind: 'linear',
									x1: 8,
									y1: 8,
									x2: 24,
									y2: 8,
									stops: [
										{ offset: 0, colour: grey },
										{ offset: 0.5, colour: parseColour('#ff990080') },
										{ offset: 1, colour: blue },
									],
								},
							},
						],
					},
				],
			},
			...(withImage
				? [
						{
							kind: 'image' as const,
							image,
							x: 10.25,
							y: 12.5,
							width: 11.5,
							height: 7,
							clip: plate,
						},
					]
				: []),
		],
	};
}

export interface Golden {
	readonly name: string;
	readonly render: () => Uint8Array;
	readonly sha256: string;
}

export const GOLDENS: readonly Golden[] = [
	{
		name: 'module grid, linear gradient, 5.4 px a module',
		render: () => bytesOf(rasterise(moduleGrid(), { width: 200 })),
		sha256: '930dfeb9034875393c1c887d14828f41db411c517320df424f8374539ea3f349',
	},
	{
		name: 'module grid at an integer scale',
		render: () => bytesOf(rasterise(moduleGrid(), { width: 148 })),
		sha256: '37d31a190ddf07922eec7af362c4d3f76a35ba7a4ea513e280ba85168e7c1ee9',
	},
	{
		name: 'translucent dots over a radial background',
		render: () => bytesOf(rasterise(dots(), { width: 97 })),
		sha256: '23a1a47ee000ec996c524902d8a0e1c943c06260148ae52a5d4a6dbeec092972',
	},
	{
		name: 'nested groups, clips, opacity and an image',
		render: () => bytesOf(rasterise(groups(true), { width: 75, height: 61 })),
		sha256: 'b3253520004c5298e3f577486d201686ba498c387bbb5c5ed42a428b871d342c',
	},
	{
		name: 'nested groups, clips and opacity as SVG',
		render: () =>
			new TextEncoder().encode(sceneToSvg(groups(false), { idPrefix: 'g', pretty: true })),
		sha256: '9ff8c7106d066272af0fd73279727582ed352ced8861d3a9b15394d75b24662c',
	},
	{
		name: 'module grid as SVG',
		render: () => new TextEncoder().encode(sceneToSvg(moduleGrid())),
		sha256: 'b5d842c7afd50a4fb64aac1acdc7dfe3b90181839bf15d969c93fcbfc3d93bdb',
	},
];

export interface GoldenResult {
	readonly name: string;
	readonly expected: string;
	readonly actual: string;
	readonly stable: boolean;
}

/** Render every golden twice and report each one that moved, or that differed between runs. */
export function checkGoldens(): readonly GoldenResult[] {
	const out: GoldenResult[] = [];
	for (const golden of GOLDENS) {
		const first = sha256Hex(golden.render());
		const second = sha256Hex(golden.render());
		if (first !== golden.sha256 || second !== first) {
			out.push({
				name: golden.name,
				expected: golden.sha256,
				actual: first,
				stable: first === second,
			});
		}
	}
	return out;
}
