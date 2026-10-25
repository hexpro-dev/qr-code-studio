/**
 * The content type registry and the built-in types.
 *
 * TEMPORARY: `LocalRegistry` stands in for `core/registry.ts`'s `Registry`,
 * which is being written on another branch to the contract in
 * docs/CONTRACTS.md (`core`). It has the same constructor and members and
 * the same errors, so switching is an import change and the removal of this
 * class. Nothing outside this file names it.
 */

import { QrStudioError } from '../core/errors.js';
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

/** The shape of `core/registry.ts`'s `Registry`, which this module depends on. */
export interface PayloadRegistry {
	readonly kind: string;
	register(entry: PayloadType): void;
	get(id: string): PayloadType | undefined;
	require(id: string): PayloadType;
	has(id: string): boolean;
	list(): readonly PayloadType[];
	ids(): readonly string[];
	readonly version: number;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class LocalRegistry implements PayloadRegistry {
	readonly kind: string;
	readonly #entries = new Map<string, PayloadType>();
	#version = 0;

	constructor(kind: string, entries: readonly PayloadType[] = []) {
		this.kind = kind;
		for (const entry of entries) this.register(entry);
	}

	get version(): number {
		return this.#version;
	}

	register(entry: PayloadType): void {
		if (!KEBAB.test(entry.id)) throw new TypeError(`A ${this.kind} id is lower-case kebab-case.`);
		if (this.#entries.has(entry.id))
			throw new TypeError(`That ${this.kind} id is already registered.`);
		this.#entries.set(entry.id, entry);
		this.#version += 1;
	}

	get(id: string): PayloadType | undefined {
		return this.#entries.get(id);
	}

	require(id: string): PayloadType {
		const entry = this.#entries.get(id);
		if (entry === undefined) {
			throw new QrStudioError(
				'design/unknown-entry',
				'That needs something this copy does not have.',
				{
					kind: this.kind,
					id,
				},
			);
		}
		return entry;
	}

	has(id: string): boolean {
		return this.#entries.has(id);
	}

	list(): readonly PayloadType[] {
		return Object.freeze([...this.#entries.values()]);
	}

	ids(): readonly string[] {
		return Object.freeze([...this.#entries.keys()]);
	}
}

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
	return new LocalRegistry('payload type', BUILT_IN_PAYLOAD_TYPES);
}
