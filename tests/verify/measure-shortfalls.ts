/**
 * Re-measure every preset's shortfalls and say what changed against
 * tests/verify/shortfalls.ts. `pnpm verify:shortfalls` prints the
 * differences; `pnpm verify:shortfalls --write` rewrites the file.
 *
 * For each preset and each of the three contents, the scan check runs at
 * 40 mm (past the size where printing larger stops changing the captures)
 * with all eight seeds up to every axis's everyday level, through a reader
 * that records which capture failed. Each shortfall is then the first level
 * a seed failed at on that axis, and the eight captures of that level are
 * read again by zxing-cpp and jsQR. A case is tagged `decode` when strict
 * reads fewer of them than both oracles do (the strict profile alone
 * refuses), and `design` otherwise (jsQR misses them too, so the design is
 * weak there).
 *
 * The work is split over child processes, one shard of presets each.
 */

import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDesignRegistries } from '../../src/design/registries.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import type { CaptureSpec } from '../../src/verify/capture.js';
import { renderCapture } from '../../src/verify/capture.js';
import { masterResolution, runPrepared } from '../../src/verify/job.js';
import { LADDERS, framingPxPerModule } from '../../src/verify/ladders.js';
import { prepare, renderMaster } from '../../src/verify/prepare.js';
import type { ContentSize } from '../../src/verify/preset.js';
import { PRESET_CONTENT, shortfalls } from '../../src/verify/preset.js';
import { strictRead } from '../../src/verify/read.js';
import type { VerifyReport } from '../../src/verify/types.js';
import { jsqrText, zxingTexts } from '../design/oracles.js';
import type { ShortfallCase } from './shortfalls.js';
import { SHORTFALL_CASES } from './shortfalls.js';

const SIZE_MM = 40;
const SEEDS = 8;
const JOB_SEED = 1;
const FILE = resolve(fileURLToPath(new URL('.', import.meta.url)), 'shortfalls.ts');
const ORDER = ['baseline', ...LADDERS.map((ladder) => ladder.axis)];

const registries = { symbologies: createSymbologyRegistry(), design: createDesignRegistries() };

async function measurePreset(id: string): Promise<ShortfallCase[]> {
	const preset = registries.design.presets.require(id);
	const level = preset.design.symbol.ecLevel ?? 'M';
	const cases: ShortfallCase[] = [];
	for (const content of ['small', 'medium', 'large'] as const) {
		const text = PRESET_CONTENT[content];
		const prepared = prepare(
			{
				content: text,
				design: { ...preset.design, symbol: { ...preset.design.symbol, ecLevel: level } },
				conditions: { sizeMm: SIZE_MM, dpi: null, distanceMm: null },
				seed: JOB_SEED,
				requires: [],
				captureSeeds: SEEDS,
			},
			registries,
		);
		const failed: CaptureSpec[] = [];
		const run = runPrepared(prepared, {
			stopAtTypical: true,
			reader: (capture, p, spec) => {
				const read = strictRead(capture.image, p);
				if (!read.read) failed.push(spec);
				return read;
			},
		});
		let report: VerifyReport;
		for (;;) {
			const step = run.next();
			if (step.done === true) {
				report = step.value;
				break;
			}
		}
		const across = prepared.symbol.matrix.width + 2 * prepared.quietZone;
		const master = renderMaster(
			prepared,
			masterResolution(framingPxPerModule(across, prepared.moduleMm)),
		);
		const { width, height } = prepared.built.scene;
		for (const axis of shortfalls(report)) {
			const first = failed.find((spec) => spec.axis === axis) as CaptureSpec;
			let strict = 0;
			let zxing = 0;
			let jsqr = 0;
			let both = 0;
			for (let seed = 0; seed < SEEDS; seed += 1) {
				const { image } = renderCapture(master, width, height, JOB_SEED, { ...first, seed });
				const s = strictRead(image, prepared).read;
				const z = (await zxingTexts(image)).includes(text);
				const j = jsqrText(image) === text;
				if (s) strict += 1;
				if (z) zxing += 1;
				if (j) jsqr += 1;
				if (z && j) both += 1;
			}
			cases.push({
				preset: id,
				content,
				version: prepared.symbol.version,
				axis,
				level: axis === 'distance' ? first.pxPerModule : first.level,
				seeds: SEEDS,
				strict,
				zxing,
				jsqr,
				tag: strict < both ? 'decode' : 'design',
			});
		}
	}
	return cases;
}

function key(c: ShortfallCase): string {
	return `${c.preset} ${c.content} ${c.axis}`;
}

function describeCase(c: ShortfallCase): string {
	const unit = c.axis === 'distance' ? ' px/module' : '';
	return `${key(c)} v${c.version} at ${c.level}${unit}: strict ${c.strict}/${c.seeds}, zxing ${c.zxing}, jsQR ${c.jsqr} (${c.tag})`;
}

function source(cases: readonly ShortfallCase[]): string {
	const file = readFileSync(FILE, 'utf8');
	const start = file.indexOf('export const SHORTFALL_CASES');
	const end = file.indexOf('\n];\n', start) + '\n];\n'.length;
	const rows = cases.map(
		(c) =>
			`\t{ preset: '${c.preset}', content: '${c.content}', version: '${c.version}', axis: '${c.axis}', level: ${c.level}, seeds: ${c.seeds}, strict: ${c.strict}, zxing: ${c.zxing}, jsqr: ${c.jsqr}, tag: '${c.tag}' },`,
	);
	return `${file.slice(0, start)}export const SHORTFALL_CASES: readonly ShortfallCase[] = [\n${rows.join('\n')}\n];\n${file.slice(end)}`;
}

function sortCases(cases: ShortfallCase[]): ShortfallCase[] {
	const sizes: ContentSize[] = ['small', 'medium', 'large'];
	return cases.sort(
		(a, b) =>
			(a.preset < b.preset ? -1 : a.preset > b.preset ? 1 : 0) ||
			sizes.indexOf(a.content) - sizes.indexOf(b.content) ||
			ORDER.indexOf(a.axis) - ORDER.indexOf(b.axis),
	);
}

async function main(): Promise<void> {
	const shardArg = process.argv.find((arg) => arg.startsWith('--shard='));
	const ids = registries.design.presets.list().map((preset) => preset.id);
	if (shardArg !== undefined) {
		const [index, count] = shardArg.slice('--shard='.length).split('/').map(Number) as [
			number,
			number,
		];
		const mine = ids.filter((_, i) => i % count === index);
		const cases: ShortfallCase[] = [];
		for (const id of mine) cases.push(...(await measurePreset(id)));
		process.send?.(cases);
		return;
	}
	const count = Math.max(1, Math.min(10, availableParallelism() - 2));
	const script = fileURLToPath(import.meta.url);
	const results = await Promise.all(
		Array.from(
			{ length: count },
			(_, index) =>
				new Promise<ShortfallCase[]>((done, fail) => {
					const child = fork(script, [`--shard=${index}/${count}`], { execArgv: process.execArgv });
					let got: ShortfallCase[] = [];
					child.on('message', (message) => {
						got = message as ShortfallCase[];
					});
					child.on('exit', (code) =>
						code === 0 ? done(got) : fail(new Error(`shard ${index} exited ${code}`)),
					);
				}),
		),
	);
	const measured = sortCases(results.flat());
	const before = new Map(SHORTFALL_CASES.map((c) => [key(c), c]));
	const after = new Map(measured.map((c) => [key(c), c]));
	const lines: string[] = [];
	for (const c of measured) {
		const old = before.get(key(c));
		if (old === undefined) lines.push(`+ ${describeCase(c)}`);
		else if (describeCase(old) !== describeCase(c))
			lines.push(`~ ${describeCase(old)}\n  now ${describeCase(c)}`);
	}
	for (const c of SHORTFALL_CASES) if (!after.has(key(c))) lines.push(`- ${describeCase(c)}`);
	console.log(lines.length === 0 ? 'No change.' : lines.join('\n'));
	console.log(
		`${measured.length} cases: ${measured.filter((c) => c.tag === 'decode').length} decode, ${measured.filter((c) => c.tag === 'design').length} design.`,
	);
	if (process.argv.includes('--write')) writeFileSync(FILE, source(measured));
}

await main();
