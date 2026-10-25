/**
 * The message key for a failed read, so a view can say why without the
 * library writing a sentence.
 *
 * `decodeImage` fails with 'decode/not-found' or 'decode/unreadable', each
 * with `params.stage`, the furthest stage reached, or passes on the
 * symbology's own 'decode/unsupported', which names the feature in
 * `params.feature`. The English for every key is in
 * `src/messages/en/decode.ts`, and `tests/decode/messages.test.ts` provokes
 * each failure and fails on a key missing there.
 */

import type { QrStudioError } from '../core/errors.js';
import type { MessageKey } from '../core/issue.js';

export function decodeFailureKey(error: QrStudioError): MessageKey {
	const { stage, feature } = error.params;
	if (error.code === 'decode/unsupported') {
		return typeof feature === 'string' ? `decode.unsupported.${feature}` : 'decode.unsupported';
	}
	if (error.code === 'decode/not-found') {
		return stage === 'geometry' ? 'decode.not-found.geometry' : 'decode.not-found';
	}
	return typeof stage === 'string' ? `decode.unreadable.${stage}` : 'decode.unreadable';
}
