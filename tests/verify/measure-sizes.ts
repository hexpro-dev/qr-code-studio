/**
 * Calibrate every preset at every level it allows and say what changed
 * against the sizes in src/design/catalogue/presets.ts. `pnpm verify:sizes`
 * prints the differences; `pnpm verify:sizes --write` rewrites each preset's
 * `sizesMm`.
 *
 * Each size is `calibratePreset` at that level, with all eight seeds of
 * every axis up to its everyday level and the recorded shortfalls
 * (tests/verify/shortfalls.ts) left out of the climb, as the nightly run
 * checks. A level that never scans is reported and nothing is written: such
 * a level has no place in the preset's `ecLevels`.
 *
 * The work is split over child processes, one shard of presets each.
 */

import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetSizeMm } from '../../src/design/preset-size.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { EcLevel } from '../../src/segment/types.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import { calibratePreset } from '../../src/verify/preset.js';
import { PRESET_SHORTFALLS } from './shortfalls.js';

const FILE = resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../src/design/catalogue/presets.ts',
);
const LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];

interface Measured {
	readonly id: string;
	readonly level: EcLevel;
	readonly sizeMm: number | null;
}

const registries = { symbologies: createSymbologyRegistry(), design: createDesignRegistries() };

function measure(job: { id: string; level: EcLevel }): Measured {
	const preset = registries.design.presets.require(job.id);
	const calibration = calibratePreset(preset, registries, {
		stopAtTypical: true,
		seeds: 8,
		known: PRESET_SHORTFALLS,
		ecLevel: job.level,
	});
	return { id: job.id, level: job.level, sizeMm: calibration.minSizeMm };
}

function rewrite(
	source: string,
	sizes: ReadonlyMap<string, Readonly<Record<string, number>>>,
): string {
	let out = source;
	for (const [id, byLevel] of sizes) {
		const at = out.indexOf(`id: '${id}',`);
		const end = out.indexOf('\n\t\t},\n', at);
		const block = out.slice(at, end);
		const written = LEVELS.filter((level) => byLevel[level] !== undefined)
			.map((level) => `${level}: ${byLevel[level]}`)
			.join(', ');
		const next = block.replace(/sizesMm: \{[^}]*\}/, `sizesMm: { ${written} }`);
		if (next === block && !block.includes(`sizesMm: { ${written} }`)) {
			throw new Error(`no sizesMm found for ${id}`);
		}
		out = out.slice(0, at) + next + out.slice(end);
	}
	return out;
}

async function main(): Promise<void> {
	const jobs = registries.design.presets
		.list()
		.flatMap((preset) => preset.ecLevels.map((level) => ({ id: preset.id, level })));
	const shardArg = process.argv.find((arg) => arg.startsWith('--shard='));
	if (shardArg !== undefined) {
		const [index, count] = shardArg.slice('--shard='.length).split('/').map(Number) as [
			number,
			number,
		];
		process.send?.(jobs.filter((_, i) => i % count === index).map(measure));
		return;
	}
	const count = Math.max(1, Math.min(10, availableParallelism() - 2));
	const script = fileURLToPath(import.meta.url);
	const results = await Promise.all(
		Array.from(
			{ length: count },
			(_, index) =>
				new Promise<Measured[]>((done, fail) => {
					const child = fork(script, [`--shard=${index}/${count}`], { execArgv: process.execArgv });
					let got: Measured[] = [];
					child.on('message', (message) => {
						got = message as Measured[];
					});
					child.on('exit', (code) =>
						code === 0 ? done(got) : fail(new Error(`shard ${index} exited ${code}`)),
					);
				}),
		),
	);
	const measured = results.flat();
	const sizes = new Map<string, Record<string, number>>();
	const lines: string[] = [];
	const never: string[] = [];
	for (const m of measured) {
		const preset = registries.design.presets.require(m.id);
		if (m.sizeMm === null) {
			never.push(`${m.id} at level ${m.level} never scans`);
			continue;
		}
		(sizes.get(m.id) ?? sizes.set(m.id, {}).get(m.id))![m.level] = m.sizeMm;
		const was = preset.sizesMm?.[m.level];
		if (was !== m.sizeMm) {
			lines.push(
				`${m.id} ${m.level}: ${was ?? 'none'} -> ${m.sizeMm} (own level ${presetSizeMm(preset)})`,
			);
		}
	}
	lines.sort();
	console.log(lines.length === 0 ? 'No change.' : lines.join('\n'));
	if (never.length > 0) console.log(never.sort().join('\n'));
	console.log(`${measured.length} sizes over ${sizes.size} presets.`);
	if (process.argv.includes('--write')) {
		if (never.length > 0) {
			console.log('Nothing written: a level that never scans comes out of ecLevels first.');
			process.exitCode = 1;
			return;
		}
		writeFileSync(FILE, rewrite(readFileSync(FILE, 'utf8'), sizes));
	}
}

await main();
