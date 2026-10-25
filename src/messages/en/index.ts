/**
 * The whole English catalogue, for the offline app.
 *
 * The website keeps its own catalogue in seven languages and never uses this
 * one; the offline app has no translation layer and looks every key up here.
 * Each area keeps its own file so a layer's sentences sit beside the test
 * that provokes them; this gathers them into one frozen record, and
 * tests/messages/catalogue.test.ts checks that no two areas claim a key, that
 * every key any layer can emit has a sentence, and that nothing here is left
 * unused.
 */

import { BATCH_MESSAGES } from './batch.js';
import { DECODE_MESSAGES } from './decode.js';
import { DESIGN_MESSAGES } from './design.js';
import { DOM_MESSAGES } from './dom.js';
import { ENCODE_MESSAGES } from './encode.js';
import { LIBRARY_MESSAGES } from './library.js';
import { MICRO_MESSAGES } from './micro.js';
import { OWN_LINK_MESSAGES } from './own-link.js';
import { PAYLOAD_MESSAGES } from './payload.js';
import { RMQR_MESSAGES } from './rmqr.js';
import { STUDIO_MESSAGES } from './studio.js';
import { SYMBOLOGY_MESSAGES } from './symbology.js';
import { TEXT_MESSAGES } from './text.js';

/** Every area's catalogue, by area, for a check that no two claim one key. */
export const MESSAGE_AREAS: Readonly<Record<string, Readonly<Record<string, string>>>> =
	Object.freeze({
		batch: BATCH_MESSAGES,
		decode: DECODE_MESSAGES,
		design: DESIGN_MESSAGES,
		dom: DOM_MESSAGES,
		encode: ENCODE_MESSAGES,
		library: LIBRARY_MESSAGES,
		micro: MICRO_MESSAGES,
		'own-link': OWN_LINK_MESSAGES,
		payload: PAYLOAD_MESSAGES,
		rmqr: RMQR_MESSAGES,
		studio: STUDIO_MESSAGES,
		symbology: SYMBOLOGY_MESSAGES,
		text: TEXT_MESSAGES,
	});

export const EN_MESSAGES: Readonly<Record<string, string>> = Object.freeze(
	Object.assign({}, ...Object.values(MESSAGE_AREAS)) as Record<string, string>,
);

/**
 * The English sentence for `key`, its `{name}` placeholders filled from
 * `params`. A key with no sentence comes back as itself, so a gap shows as a
 * key a tester can search for rather than as an empty space; a placeholder
 * with no param is left as written, for the same reason.
 */
export function message(
	key: string,
	params: Readonly<Record<string, number | string>> = {},
): string {
	const sentence = Object.prototype.hasOwnProperty.call(EN_MESSAGES, key)
		? EN_MESSAGES[key]
		: undefined;
	if (sentence === undefined) return key;
	return sentence.replace(/\{(\w+)\}/g, (whole, name: string) =>
		Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
	);
}

export {
	BATCH_MESSAGES,
	DECODE_MESSAGES,
	DESIGN_MESSAGES,
	DOM_MESSAGES,
	ENCODE_MESSAGES,
	LIBRARY_MESSAGES,
	MICRO_MESSAGES,
	OWN_LINK_MESSAGES,
	PAYLOAD_MESSAGES,
	RMQR_MESSAGES,
	STUDIO_MESSAGES,
	SYMBOLOGY_MESSAGES,
	TEXT_MESSAGES,
};
