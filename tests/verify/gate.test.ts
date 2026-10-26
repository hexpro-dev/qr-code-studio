import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { GATE_SHARDS } from './gate.js';
import { SIZE_SHARDS } from './sizes.js';

describe('the scan check gate', () => {
	it('has one file for every shard, so every preset is checked', () => {
		const files = readdirSync(import.meta.dirname).filter((name) =>
			/^gate-\d+\.test\.ts$/.test(name),
		);
		expect(files.sort()).toEqual(
			Array.from({ length: GATE_SHARDS }, (_, i) => `gate-${i}.test.ts`),
		);
	});

	it('has one file for every shard of the nightly size check, so every preset is calibrated', () => {
		const files = readdirSync(import.meta.dirname).filter((name) =>
			/^sizes-\d+\.test\.ts$/.test(name),
		);
		expect(files.sort()).toEqual(
			Array.from({ length: SIZE_SHARDS }, (_, i) => `sizes-${i}.test.ts`),
		);
	});
});
