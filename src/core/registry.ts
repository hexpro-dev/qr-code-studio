/**
 * A named set of entries: module shapes, frames, content types, symbologies.
 *
 * An instance, never a module-level list. `sideEffects: false` lets a bundler
 * drop an import whose only purpose was to register something, so nothing
 * here registers itself at import: `createRegistries()` in the layers above
 * builds instances filled with the built-ins, and a test can build an empty
 * one.
 *
 * Ids are kebab-case because they travel: into design files, into message
 * keys the website translates, into the list a verify job sends to say which
 * entries it needs. One spelling per entry keeps all of those in step.
 */

import { UnknownEntryError } from './errors.js';

export interface RegistryEntry {
	readonly id: string;
}

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function checkKebab(value: unknown, what: string): void {
	if (typeof value !== 'string' || !KEBAB.test(value)) {
		throw new TypeError(
			`${what} must be kebab-case: lowercase words of letters and digits joined by hyphens`,
		);
	}
}

export class Registry<T extends RegistryEntry> {
	readonly kind: string;
	private readonly entries = new Map<string, T>();
	private ordered: readonly T[] = Object.freeze([]);
	private names: readonly string[] = Object.freeze([]);
	private registrations = 0;

	constructor(kind: string, entries: readonly T[] = []) {
		checkKebab(kind, 'a registry kind');
		this.kind = kind;
		for (const entry of entries) this.register(entry);
	}

	/** Increments on every register, so a cache keyed on it knows when to rebuild. */
	get version(): number {
		return this.registrations;
	}

	/** Throws TypeError on an id that is not kebab-case or is already taken. */
	register(entry: T): void {
		checkKebab(entry.id, `a ${this.kind} id`);
		if (this.entries.has(entry.id)) {
			throw new TypeError(`this ${this.kind} registry already has an entry with that id`);
		}
		this.entries.set(entry.id, entry);
		this.ordered = Object.freeze([...this.ordered, entry]);
		this.names = Object.freeze([...this.names, entry.id]);
		this.registrations += 1;
	}

	get(id: string): T | undefined {
		return this.entries.get(id);
	}

	/**
	 * Throws `UnknownEntryError` ('design/unknown-entry', params { kind, id })
	 * when it is missing.
	 *
	 * The id comes back in params only if it is a well-formed id; otherwise
	 * params.id is empty. An id usually arrives from a design file, and a file
	 * can put anything in that field, so arbitrary text from it is never echoed
	 * into an error that might end up in a bug report.
	 */
	require(id: string): T {
		const found = this.entries.get(id);
		if (found === undefined) {
			const safe = typeof id === 'string' && id.length <= 64 && KEBAB.test(id) ? id : '';
			throw new UnknownEntryError(this.kind, safe);
		}
		return found;
	}

	has(id: string): boolean {
		return this.entries.has(id);
	}

	/** Every entry, in registration order. Frozen. */
	list(): readonly T[] {
		return this.ordered;
	}

	/** Every id, in registration order. Frozen. */
	ids(): readonly string[] {
		return this.names;
	}
}
