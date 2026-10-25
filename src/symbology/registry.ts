/**
 * The symbology registry factory.
 *
 * An instance, filled when asked for, never a module-level list: see
 * `core/registry.ts` for why nothing registers itself at import.
 */

import { Registry } from '../core/registry.js';
import { createQrSymbology } from './qr/entry.js';
import type { SymbologyEntry } from './types.js';

/** A registry holding the built-in symbologies, QR first so anything that tries each in turn tries it first. */
export function createSymbologyRegistry(): Registry<SymbologyEntry> {
	return new Registry<SymbologyEntry>('symbology', [
		createQrSymbology(),
		// Micro QR and rMQR join here, one line each, when their entries land:
		// createMicroQrSymbology(), createRmqrSymbology().
	]);
}
