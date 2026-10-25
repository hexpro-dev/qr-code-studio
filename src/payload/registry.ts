/**
 * The content type registry and the built-in types.
 *
 * A fresh `Registry` from core per call, filled with the built-ins, so a
 * caller that registers a type of its own changes no other registry and
 * nothing is registered at import.
 */

import { Registry } from '../core/registry.js';
import { bitcoinType } from './content/bitcoin.js';
import { emailType } from './content/email.js';
import { epcType } from './content/epc.js';
import { eventType } from './content/event.js';
import { facetimeType } from './content/facetime.js';
import { geoType } from './content/geo.js';
import { gs1DigitalLinkType } from './content/gs1-digital-link.js';
import { lightningType } from './content/lightning.js';
import { mecardType } from './content/mecard.js';
import { phoneType } from './content/phone.js';
import { pixType } from './content/pix.js';
import { signalType } from './content/signal.js';
import { smsType } from './content/sms.js';
import { swissQrBillType } from './content/swiss-qr-bill.js';
import { telegramType } from './content/telegram.js';
import { textType } from './content/text.js';
import { upiType } from './content/upi.js';
import { urlType } from './content/url.js';
import { vcardType } from './content/vcard.js';
import { whatsappType } from './content/whatsapp.js';
import { wifiType } from './content/wifi.js';
import { zatcaType } from './content/zatca.js';
import type { PayloadType } from './types.js';

/** A registry of content types. */
export type PayloadRegistry = Registry<PayloadType>;

/**
 * The built-in content types, most specific first. Detection breaks a tie in
 * this order, so a type that lives at a particular host comes before the
 * generic link, and plain text comes last.
 */
export const BUILT_IN_PAYLOAD_TYPES: readonly PayloadType[] = Object.freeze([
	wifiType,
	vcardType,
	mecardType,
	eventType,
	emailType,
	phoneType,
	smsType,
	whatsappType,
	telegramType,
	signalType,
	facetimeType,
	geoType,
	bitcoinType,
	lightningType,
	epcType,
	swissQrBillType,
	pixType,
	upiType,
	zatcaType,
	gs1DigitalLinkType,
	urlType,
	textType,
] as PayloadType[]);

/** A new registry holding every built-in content type. Each call returns a fresh instance. */
export function createPayloadRegistry(): PayloadRegistry {
	return new Registry<PayloadType>('payload-type', BUILT_IN_PAYLOAD_TYPES);
}
