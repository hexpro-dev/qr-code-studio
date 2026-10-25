/**
 * Every registry the package fills with built-ins, gathered in one bag.
 *
 * The layers each have a factory of their own (`createSymbologyRegistry`,
 * `createPayloadRegistry`, `createDesignRegistries`), and this is the one
 * place they meet, because a verify job, a batch run and the studio all need
 * all three at once. Fresh instances every call, never module-level lists:
 * `sideEffects: false` lets a bundler drop an import whose only purpose was to
 * register something, so a registration has to be something a caller does to
 * an instance it holds.
 */

import type { Registry } from './core/registry.js';
import { createDesignRegistries } from './design/registries.js';
import type { DesignRegistries } from './design/types.js';
import { createPayloadRegistry } from './payload/registry.js';
import type { PayloadRegistry } from './payload/registry.js';
import { createSymbologyRegistry } from './symbology/registry.js';
import type { SymbologyEntry } from './symbology/types.js';

/** The bag `createRegistries()` returns: symbologies, content types and the design registries. */
export interface Registries {
	readonly symbologies: Registry<SymbologyEntry>;
	readonly payloads: PayloadRegistry;
	readonly design: DesignRegistries;
}

/** New registries holding every built-in. Each call returns fresh instances, shared with nothing. */
export function createRegistries(): Registries {
	return {
		symbologies: createSymbologyRegistry(),
		payloads: createPayloadRegistry(),
		design: createDesignRegistries(),
	};
}
