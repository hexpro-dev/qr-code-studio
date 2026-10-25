/**
 * What some text is: the content type that claims it most strongly.
 *
 * Every type scores the text from 0 to 1 and the highest wins, earlier
 * registration breaking a tie. A type whose `detect` throws scores 0: one
 * broken entry must not stop a scanned code from being explained. When
 * nothing scores above 0, or the registry holds nothing that claims the
 * text, the answer is plain text with the confidence text gives itself.
 */

import { textType } from './content/text.js';
import type { PayloadRegistry } from './registry.js';
import type { PayloadDetection, PayloadType } from './types.js';

function score(type: PayloadType, text: string): number {
	try {
		const value = type.detect(text);
		return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
	} catch {
		return 0;
	}
}

export function detectPayload(text: string, registry: PayloadRegistry): PayloadDetection {
	let best: PayloadDetection | undefined;
	for (const type of registry.list()) {
		const confidence = score(type, text);
		if (confidence > 0 && (best === undefined || confidence > best.confidence))
			best = { type, confidence };
	}
	if (best !== undefined) return best;
	const fallback = registry.get('text') ?? (textType as PayloadType);
	return { type: fallback, confidence: score(fallback, text) };
}
