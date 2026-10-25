/**
 * Safety codes as a list, and the message key each one is explained by.
 *
 * The union in types.ts is the contract; this list is what a catalogue test
 * or a translation file enumerates, and the type annotation keeps the two
 * the same.
 */

import type { MessageKey } from '../core/issue.js';
import type { SafetyCode } from './types.js';

export const SAFETY_CODES: readonly SafetyCode[] = Object.freeze([
	'scheme/dangerous',
	'scheme/unusual',
	'host/ip-literal',
	'host/mixed-script',
	'host/punycode',
	'host/lookalike',
	'url/userinfo',
	'host/shortener',
	'host/dynamic-qr',
	'url/tracking-params',
	'url/insecure',
	'url/very-long',
	'payload/open-wifi',
	'payload/payment',
	'payload/sends-message',
] satisfies SafetyCode[]);

/** 'host/dynamic-qr' is explained by 'payload.safety.host.dynamic-qr'. */
export function safetyMessageKey(code: SafetyCode): MessageKey {
	return `payload.safety.${code.replace('/', '.')}`;
}
