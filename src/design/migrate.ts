/**
 * Bringing an older design document up to the current version.
 *
 * Version 1 is the only one so far, so migrating a version 1 document is a
 * copy. The framework is here so that version 2 is one entry in `MIGRATIONS`
 * (from 1, and how) rather than a change to every reader: each step takes the
 * plain object one version on, they run in order until the document is
 * current, and a document from a version this build does not know, newer or
 * older, is refused rather than guessed at.
 *
 * Migration only changes shape. Whether the result is a good design is
 * `validateDesign`'s question, so a migrated document is validated before it
 * is used.
 */

import { QrStudioError } from '../core/errors.js';
import { DESIGN_VERSION, LIMITS } from './document.js';
import type { QrDesignV1 } from './types.js';

type Plain = Record<string, unknown>;

export interface Migration {
	/** The version this step reads; it writes `from + 1`. */
	readonly from: number;
	readonly migrate: (document: Plain) => Plain;
}

/** Every step, oldest first. Empty while version 1 is the only version. */
const MIGRATIONS: readonly Migration[] = [];

function unsupported(version?: number): QrStudioError {
	return new QrStudioError(
		'design/unsupported-schema',
		'This design was made by a different version of the studio and cannot be opened here.',
		version === undefined ? {} : { version },
	);
}

/**
 * A copy of plain JSON data: objects, arrays, strings, finite numbers,
 * booleans and null. Anything else is left out, as JSON would leave it out,
 * and a `__proto__` key is never copied, so a copy can never change what an
 * object inherits.
 */
function copy(value: unknown, depth: number): unknown {
	if (depth > LIMITS.depth) {
		throw new QrStudioError('design/invalid', 'This design file nests too deeply to be a design.', {
			limit: LIMITS.depth,
		});
	}
	if (Array.isArray(value)) {
		return value.map((item) => {
			const copied = copy(item, depth + 1);
			return copied === undefined ? null : copied;
		});
	}
	if (typeof value === 'object' && value !== null) {
		const out: Plain = {};
		for (const key of Object.keys(value)) {
			if (key === '__proto__') continue;
			const copied = copy((value as Plain)[key], depth + 1);
			if (copied !== undefined) out[key] = copied;
		}
		return out;
	}
	if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return undefined;
}

/**
 * Run `steps` over a copy of `input` from its version up to `current`. The
 * engine behind `migrateDesign`, taking its steps and target as arguments so
 * the chain can be exercised before there is a second version.
 */
export function runMigrations(
	input: unknown,
	steps: readonly Migration[],
	current: number,
): Record<string, unknown> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) throw unsupported();
	const record = input as Plain;
	if (record.schema !== 'qr-design') throw unsupported();
	const version = record.version;
	if (typeof version !== 'number' || !Number.isInteger(version)) throw unsupported();
	if (version < 1 || version > current) {
		throw unsupported(version >= 0 && version <= 1000 ? version : undefined);
	}
	let document = copy(record, 0) as Plain;
	for (let at = version; at < current; at += 1) {
		const step = steps.find((migration) => migration.from === at);
		if (step === undefined) throw unsupported(at);
		document = { ...step.migrate(document), version: at + 1 };
	}
	return document;
}

/** Any earlier version to the current one. Throws 'design/unsupported-schema' for anything unrecognised. */
export function migrateDesign(input: unknown): QrDesignV1 {
	return runMigrations(input, MIGRATIONS, DESIGN_VERSION) as unknown as QrDesignV1;
}
