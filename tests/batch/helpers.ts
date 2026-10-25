/**
 * What the batch tests share: the registries bag, a reference CSV writer
 * that is not the package's own, ZIP reading through yauzl, and driving a
 * batch to its end.
 *
 * Every payload here is synthetic: example.com links, Example names and
 * +61 400 000 000 numbers.
 */

import yauzl from 'yauzl';
import type { BatchOutcome, BatchProgress, BatchRegistries } from '../../src/batch/types.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';

export function registries(): BatchRegistries {
	return {
		symbologies: createSymbologyRegistry(),
		payloads: createPayloadRegistry(),
		design: createDesignRegistries(),
	};
}

/**
 * A CSV writer written to RFC 4180 independently of the package: every cell
 * quoted when it must be, or always when `quoteAll`, quotes doubled, records
 * ended by `eol`.
 */
export function referenceCsv(
	rows: readonly (readonly string[])[],
	options: { delimiter?: string; eol?: string; quoteAll?: boolean; bom?: boolean } = {},
): string {
	const delimiter = options.delimiter ?? ',';
	const eol = options.eol ?? '\r\n';
	const needs = (cell: string): boolean =>
		options.quoteAll === true ||
		cell.includes(delimiter) ||
		cell.includes('"') ||
		cell.includes('\r') ||
		cell.includes('\n') ||
		cell === '';
	const line = (row: readonly string[]): string =>
		row.map((cell) => (needs(cell) ? `"${cell.split('"').join('""')}"` : cell)).join(delimiter);
	return `${options.bom === true ? '\ufeff' : ''}${rows.map(line).join(eol)}${eol}`;
}

/** Drive a batch generator to its end: every progress event, the outcomes, and the bytes. */
export function drain(generator: Generator<BatchProgress, Uint8Array>): {
	readonly bytes: Uint8Array;
	readonly progress: readonly BatchProgress[];
	readonly outcomes: readonly BatchOutcome[];
} {
	const progress: BatchProgress[] = [];
	for (;;) {
		const step = generator.next();
		if (step.done === true) {
			return {
				bytes: step.value,
				progress,
				outcomes: progress.flatMap((event) => (event.row === undefined ? [] : [event.row])),
			};
		}
		progress.push(step.value);
	}
}

export interface ZipRead {
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly compressed: boolean;
}

/** Every entry of a ZIP, read and checked by yauzl, in order. */
export function readZip(bytes: Uint8Array): Promise<ZipRead[]> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(
			Buffer.from(bytes),
			{ lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true },
			(error, zip) => {
				if (error || !zip) {
					reject(error ?? new Error('no zip'));
					return;
				}
				const out: ZipRead[] = [];
				zip.on('error', reject);
				zip.on('end', () => resolve(out));
				zip.on('entry', (entry: yauzl.Entry) => {
					zip.openReadStream(entry, (streamError, stream) => {
						if (streamError || !stream) {
							reject(streamError ?? new Error('no stream'));
							return;
						}
						const chunks: Buffer[] = [];
						stream.on('data', (chunk: Buffer) => chunks.push(chunk));
						stream.on('error', reject);
						stream.on('end', () => {
							out.push({
								name: entry.fileName,
								bytes: new Uint8Array(Buffer.concat(chunks)),
								compressed: entry.compressionMethod === 8,
							});
							zip.readEntry();
						});
					});
				});
				zip.readEntry();
			},
		);
	});
}

/** The text of a UTF-8 file, without its byte order mark. */
export function utf8Text(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
