/**
 * Symbols to design over, from this package's own encoder: QR, Micro QR and
 * rMQR.
 */

import { encode } from '../../src/encode/index.js';
import type { EcLevel } from '../../src/segment/types.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';

export function qrSymbol(
	text: string,
	ecLevel: EcLevel = 'M',
	options: { minVersion?: string; maxVersion?: string; mask?: number } = {},
): BuiltSymbol {
	return encode(text, { ecLevel, ...options });
}

/** A Micro QR symbol, at `version` exactly when one is given. */
export function microSymbol(text: string, version?: string, ecLevel: EcLevel = 'L'): BuiltSymbol {
	return encode(text, {
		symbology: 'micro',
		ecLevel,
		...(version === undefined ? {} : { minVersion: version, maxVersion: version }),
	});
}

/** An rMQR symbol at `version` exactly. */
export function rmqrSymbol(text: string, version: string, ecLevel: EcLevel = 'M'): BuiltSymbol {
	return encode(text, { symbology: 'rmqr', ecLevel, minVersion: version, maxVersion: version });
}
