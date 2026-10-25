/**
 * A batch of 2,000 rows, the size of a real product range, start to finish:
 * every row written, the archive reads back, no slice of work is long enough
 * to freeze a page, and memory stays bounded while it runs.
 *
 * The bounds are a smoke alarm for a batch that holds every picture at once
 * or compresses everything in one go, not a benchmark: this one takes about
 * two seconds and peaks under 40 MB of heap on a laptop, and the limits are
 * many times that.
 */

import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import { planBatch } from '../../src/batch/plan.js';
import { runBatch } from '../../src/batch/run.js';
import { defaultDesign } from '../../src/design/document.js';
import { readZip, registries, utf8Text } from './helpers.js';

const ROWS = 2000;

describe('a batch of 2,000 rows', () => {
	it('writes every row within bounded time and memory', async () => {
		const reg = registries();
		let csv = 'sku,name\r\n';
		for (let i = 0; i < ROWS; i += 1)
			csv += `EX-${String(i).padStart(5, '0')},Example product ${i}\r\n`;
		const rows = planBatch(
			parseCsv(csv),
			{
				typeId: 'url',
				fields: { url: { template: 'https://example.com/p/{sku}?utm_source=label' } },
				filename: 'label-{sku}',
			},
			reg,
		);
		const generator = runBatch(rows, defaultDesign(), { kind: 'zip', format: 'svg' }, reg);
		const started = performance.now();
		const heapBefore = process.memoryUsage().heapUsed;
		let peak = 0;
		let longest = 0;
		let last = started;
		let written = 0;
		let step = generator.next();
		while (step.done !== true) {
			const now = performance.now();
			longest = Math.max(longest, now - last);
			last = now;
			if (step.value.row?.status === 'written') written += 1;
			if (step.value.done % 200 === 0)
				peak = Math.max(peak, process.memoryUsage().heapUsed - heapBefore);
			step = generator.next();
		}
		const elapsed = performance.now() - started;
		expect(written).toBe(ROWS);
		expect(elapsed).toBeLessThan(60_000);
		expect(longest).toBeLessThan(2_000);
		expect(peak).toBeLessThan(400 * 1024 * 1024);

		const entries = await readZip(step.value);
		expect(entries).toHaveLength(ROWS + 1);
		expect(entries[0]?.name).toBe('label-EX-00000.svg');
		expect(entries[ROWS]?.name).toBe('manifest.csv');
		const manifest = parseCsv(utf8Text(entries[ROWS]?.bytes as Uint8Array));
		expect(manifest.rows).toHaveLength(ROWS);
		expect(manifest.rows.every((row) => row[3] === 'written')).toBe(true);
	}, 120_000);
});
