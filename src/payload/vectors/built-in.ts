/**
 * The specification vectors of every built-in content type, by type id, in
 * the registry's order.
 *
 * They used to sit on each type as `vectors`, which put them into every
 * bundle that offers a content type: tens of kilobytes of test data shipped
 * to every visitor, and with them the addresses of the documents they cite,
 * each one something the offline file's build tests then had to explain.
 * Here they are reached only through `./payload/vectors`, which nothing on
 * the runtime path imports (tests/payload/vectors.test.ts holds that), and
 * the conformance gate hands each list to `checkPayloadType`.
 */

import type { PayloadVector } from '../types.js';
import { bitcoinVectors } from './bitcoin.js';
import { emailVectors } from './email.js';
import { epcVectors } from './epc.js';
import { eventVectors } from './event.js';
import { facetimeVectors } from './facetime.js';
import { geoVectors } from './geo.js';
import { gs1DigitalLinkVectors } from './gs1-digital-link.js';
import { lightningVectors } from './lightning.js';
import { mecardVectors } from './mecard.js';
import { phoneVectors } from './phone.js';
import { pixVectors } from './pix.js';
import { signalVectors } from './signal.js';
import { smsVectors } from './sms.js';
import { swissQrBillVectors } from './swiss-qr-bill.js';
import { telegramVectors } from './telegram.js';
import { textVectors } from './text.js';
import { upiVectors } from './upi.js';
import { urlVectors } from './url.js';
import { vcardVectors } from './vcard.js';
import { whatsappVectors } from './whatsapp.js';
import { wifiVectors } from './wifi.js';
import { zatcaVectors } from './zatca.js';

export const BUILT_IN_VECTORS: Readonly<Record<string, readonly PayloadVector[]>> = Object.freeze({
	wifi: wifiVectors,
	vcard: vcardVectors,
	mecard: mecardVectors,
	event: eventVectors,
	email: emailVectors,
	phone: phoneVectors,
	sms: smsVectors,
	whatsapp: whatsappVectors,
	telegram: telegramVectors,
	signal: signalVectors,
	facetime: facetimeVectors,
	geo: geoVectors,
	bitcoin: bitcoinVectors,
	lightning: lightningVectors,
	epc: epcVectors,
	'swiss-qr-bill': swissQrBillVectors,
	pix: pixVectors,
	upi: upiVectors,
	zatca: zatcaVectors,
	'gs1-digital-link': gs1DigitalLinkVectors,
	url: urlVectors,
	text: textVectors,
});
