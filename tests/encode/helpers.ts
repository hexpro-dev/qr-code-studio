/**
 * Small things the encode tests share: reading a symbol back, and a fake
 * symbology built on QR, for the parts of encode that only matter once Micro
 * QR and rMQR are registered (preferences between rectangles, profiles
 * without FNC1 or structured append, versions whose modes cannot carry the
 * content).
 */

import { Registry } from '../../src/core/registry.js';
import type { BitstreamProfile, EcLevel } from '../../src/segment/types.js';
import { createQrSymbology } from '../../src/symbology/qr/entry.js';
import type { BuiltSymbol, MatrixRead, SymbologyEntry } from '../../src/symbology/types.js';

const qr = createQrSymbology();

export function readBack(symbol: BuiltSymbol, strict = true): MatrixRead {
	return qr.read(symbol.matrix, { strict });
}

export interface FakeVersion {
	readonly name: string;
	/** The QR version that does the work. */
	readonly qr: string;
	readonly width: number;
	readonly height: number;
	readonly profile?: (profile: BitstreamProfile) => BitstreamProfile;
	readonly ecLevels?: readonly EcLevel[];
}

/** A symbology whose versions are QR versions under other names, sizes and profiles. */
export function fakeRegistry(
	versions: readonly FakeVersion[],
	id = 'fake',
): Registry<SymbologyEntry> {
	const find = (name: string): FakeVersion => {
		const found = versions.find((v) => v.name === name);
		if (found === undefined) throw new TypeError('not a fake version');
		return found;
	};
	const entry: SymbologyEntry = {
		...qr,
		id,
		versions: versions.map((v) => v.name),
		ecLevels: (name) => find(name).ecLevels ?? ['L', 'M', 'Q', 'H'],
		size: (name) => ({ width: find(name).width, height: find(name).height }),
		profile: (name) => {
			const v = find(name);
			const base = qr.profile(v.qr);
			return v.profile === undefined ? base : v.profile(base);
		},
		blocks: (name, ec) => qr.blocks(find(name).qr, ec),
		layout: (name) => qr.layout(find(name).qr),
		masks: (name) => qr.masks(find(name).qr),
		build: (codewords, name, ec, mask) => ({
			...qr.build(codewords, find(name).qr, ec, mask),
			symbology: id,
			version: name,
		}),
	};
	return new Registry<SymbologyEntry>('symbology', [qr, entry]);
}

/** A profile cache, so a fake profile is the same object every time, as real ones are. */
export function cached(
	make: (profile: BitstreamProfile) => BitstreamProfile,
): (profile: BitstreamProfile) => BitstreamProfile {
	const seen = new Map<BitstreamProfile, BitstreamProfile>();
	return (profile) => {
		let found = seen.get(profile);
		if (found === undefined) {
			found = make(profile);
			seen.set(profile, found);
		}
		return found;
	};
}
