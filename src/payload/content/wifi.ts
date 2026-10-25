/**
 * A Wi-Fi network to join: the WIFI: string.
 *
 * Two descriptions of this string exist and they mostly agree. ZXing
 * introduced it (ZXing wiki, "Barcode Contents", Wi-Fi network config), and
 * Android reads that form (WifiUriParser.java in AOSP's Wi-Fi module). The
 * Wi-Fi Alliance later defined a "WIFI URI" in the WPA3 Specification
 * (v3.5, section 7) with the same field letters and a fixed order: T, R, S,
 * H, I, P, K. This writes the fields in the specification's order, which
 * ZXing's and Android's readers do not mind.
 *
 * Where the two disagree, this follows what phones read:
 *
 * - Escaping. The specification percent-encodes a semicolon and any octet
 *   outside printable ASCII. ZXing and Android put a backslash before
 *   \ ; , : and " instead, and Android never percent-decodes, so a
 *   percent-encoded semicolon would reach it as three characters of the
 *   password. Backslashes are written and read; percent signs are left as
 *   they are.
 * - WPA3 only. The specification has one type, WPA, and marks a network as
 *   WPA3 only with R: (Transition Disable, bit 0). Android writes T:SAE for
 *   such a network and reads both. T:SAE is written, and T:WPA with bit 0 of
 *   R: set is read as SAE.
 *
 * Security values: nopass (open, or Enhanced Open), WEP, WPA (WPA2 Personal,
 * and WPA3 in transition mode, which takes the same passphrase), SAE (WPA3
 * Personal only), and WPA2-EAP, ZXing's extension for enterprise networks with
 * its E, A, I and PH2 fields. The letter I is an EAP identity under WPA2-EAP
 * and an SAE password identifier under the WPA3 URI; only the first is
 * offered, and which one a parsed I: is follows from T.
 *
 * An SSID is up to 32 bytes (IEEE 802.11), so its limit is counted in UTF-8
 * bytes rather than characters. A WPA passphrase is 8 to 63 printable ASCII
 * characters, or exactly 64 hexadecimal digits for a raw key (IEEE 802.11i,
 * Annex H.4).
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { backslashEscape, backslashUnescape, splitUnescaped } from '../escape.js';
import { booleanOf, textOf } from '../fields.js';

const ID = 'wifi';
const RESERVED = '\\;,:"';

export type WifiValue = {
	readonly ssid: string;
	readonly security: string;
	readonly password: string;
	readonly hidden: boolean;
	readonly eapMethod: string;
	readonly phase2: string;
	readonly identity: string;
	readonly anonymousIdentity: string;
};

/** Our option values, lower case for the message keys, and the T: value each writes. */
const SECURITY_T: Readonly<Record<string, string>> = {
	nopass: 'nopass',
	wep: 'WEP',
	wpa: 'WPA',
	sae: 'SAE',
	'wpa2-eap': 'WPA2-EAP',
};

/** T: values as found in codes, upper case, to our option values. */
const T_SECURITY: Readonly<Record<string, string>> = {
	NOPASS: 'nopass',
	'': 'nopass',
	WEP: 'wep',
	WPA: 'wpa',
	WPA2: 'wpa',
	SAE: 'sae',
	WPA3: 'sae',
	'WPA2-EAP': 'wpa2-eap',
};

const EAP_METHODS = ['peap', 'tls', 'ttls', 'pwd', 'sim', 'aka', 'aka-prime'] as const;
const PHASE2_METHODS = ['pap', 'mschap', 'mschapv2', 'gtc', 'sim', 'aka', 'aka-prime'] as const;

/** EAP method names as Android's WifiEnterpriseConfig spells them. */
function eapName(value: string): string {
	return value.toUpperCase().replace('-', '_');
}

function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

function passwordIssues(security: string, password: string): Issue[] {
	const path = ['fields', 'password'];
	if (security === 'nopass') return [];
	if (password === '') return [issue('payload.wifi.issue.password-required', path)];
	if (security === 'wep') {
		// 40-bit and 104-bit keys, as 5 or 13 ASCII characters or 10 or 26 hex digits.
		const ascii =
			(password.length === 5 || password.length === 13) && /^[\x20-\x7e]+$/.test(password);
		const hex =
			(password.length === 10 || password.length === 26) && /^[0-9A-Fa-f]+$/.test(password);
		return ascii || hex ? [] : [issue('payload.wifi.issue.wep-key', path)];
	}
	if (security === 'wpa') {
		if (password.length === 64 && /^[0-9A-Fa-f]+$/.test(password)) return [];
		if (!/^[\x20-\x7e]*$/.test(password)) return [issue('payload.wifi.issue.wpa-ascii', path)];
		if (password.length < 8 || password.length > 63) {
			return [
				issue('payload.wifi.issue.wpa-length', path, 'error', {
					length: password.length,
					min: 8,
					max: 63,
				}),
			];
		}
	}
	return [];
}

function rules(value: WifiValue, flagged: (key: string) => boolean): Issue[] {
	const found: Issue[] = [];
	const ssid = textOf(value, 'ssid');
	if (!flagged('ssid') && utf8Length(ssid) > 32) {
		found.push(
			issue('payload.wifi.issue.ssid-too-long', ['fields', 'ssid'], 'error', {
				length: utf8Length(ssid),
				max: 32,
			}),
		);
	}
	// ZXing's Android app joins an SSID made only of hexadecimal digits as raw
	// bytes (WifiConfigManager's quoteNonHex), so "12345678" becomes the four
	// bytes 12 34 56 78. Android's own reader does not, and quoting it the way
	// ZXing's wiki suggests breaks Android's newer reader, so the readers
	// cannot all be satisfied and the person is told.
	if (!flagged('ssid') && /^[0-9A-Fa-f]+$/.test(ssid)) {
		found.push(issue('payload.wifi.issue.hex-ssid', ['fields', 'ssid'], 'warning'));
	}
	const security = textOf(value, 'security');
	if (!flagged('security') && !flagged('password'))
		found.push(...passwordIssues(security, textOf(value, 'password')));
	if (security === 'wpa2-eap') {
		if (textOf(value, 'eapMethod') === '')
			found.push(issue('payload.issue.required', ['fields', 'eapMethod']));
	} else if (
		['eapMethod', 'phase2', 'identity', 'anonymousIdentity'].some(
			(key) => textOf(value, key) !== '',
		)
	) {
		found.push(issue('payload.wifi.issue.eap-ignored', ['fields', 'eapMethod'], 'warning'));
	}
	if (security === 'nopass' && textOf(value, 'password') !== '') {
		found.push(issue('payload.wifi.issue.password-ignored', ['fields', 'password'], 'warning'));
	}
	return found;
}

function write(value: WifiValue): string {
	const security = textOf(value, 'security');
	const escape = (text: string) => backslashEscape(text, RESERVED);
	const parts = [`T:${SECURITY_T[security] as string}`, `S:${escape(textOf(value, 'ssid'))}`];
	if (booleanOf(value, 'hidden')) parts.push('H:true');
	if (security === 'wpa2-eap') {
		parts.push(`E:${eapName(textOf(value, 'eapMethod'))}`);
		const anonymous = textOf(value, 'anonymousIdentity');
		const identity = textOf(value, 'identity');
		const phase2 = textOf(value, 'phase2');
		if (anonymous !== '') parts.push(`A:${escape(anonymous)}`);
		if (identity !== '') parts.push(`I:${escape(identity)}`);
		if (phase2 !== '') parts.push(`PH2:${eapName(phase2)}`);
	}
	if (security !== 'nopass') parts.push(`P:${escape(textOf(value, 'password'))}`);
	return `WIFI:${parts.join(';')};;`;
}

function parse(text: string): WifiValue {
	if (!/^WIFI:/i.test(text)) throw unparseable(ID, 'not-wifi');
	const fields = new Map<string, string>();
	for (const piece of splitUnescaped(text.slice(5), ';')) {
		const colon = piece.indexOf(':');
		if (colon <= 0) continue;
		// The specification's own examples have a stray space before a field
		// name ("WIFI: S:MyNet;;"), so names are trimmed.
		const name = piece.slice(0, colon).trim().toUpperCase();
		// The first occurrence wins, as in ZXing's reader.
		if (!fields.has(name)) fields.set(name, backslashUnescape(piece.slice(colon + 1)));
	}
	const ssid = fields.get('S');
	if (ssid === undefined || ssid === '') throw unparseable(ID, 'missing-ssid');
	const t = (fields.get('T') ?? '').toUpperCase();
	// Transition Disable bit 0 is "WPA3-Personal only" (WPA3 Specification
	// v3.5, table 6).
	const transitionDisable = Number.parseInt(fields.get('R') ?? '0', 16);
	const wpa3Only =
		t === 'WPA' && Number.isInteger(transitionDisable) && (transitionDisable & 1) === 1;
	const security = wpa3Only ? 'sae' : (T_SECURITY[t] ?? t.toLowerCase());
	const enterprise = security === 'wpa2-eap';
	// ZXing once used H: for the phase 2 method. Its reader still treats an H:
	// that is not "true" or "false" as one when no PH2: is given, and so does
	// this.
	const h = fields.get('H');
	const hBoolean = h === undefined || /^(?:true|false)$/i.test(h);
	const phase2Raw = fields.get('PH2') ?? (hBoolean ? '' : (h as string));
	const lowerName = (raw: string) => raw.toLowerCase().replace('_', '-');
	return {
		ssid,
		security,
		password: security === 'nopass' ? '' : (fields.get('P') ?? ''),
		hidden: hBoolean && h !== undefined && h.toLowerCase() === 'true',
		eapMethod: enterprise ? lowerName(fields.get('E') ?? '') : '',
		phase2: enterprise ? lowerName(phase2Raw) : '',
		identity: enterprise ? (fields.get('I') ?? '') : '',
		anonymousIdentity: enterprise ? (fields.get('A') ?? '') : '',
	};
}

export const wifiType = definePayload<WifiValue>({
	id: ID,
	category: 'network',
	compatibility: [
		{
			// WifiUriParser matches T: with startsWith("WPA"), so WPA2-EAP is
			// taken for a password network and the EAP fields are not read.
			// https://android.googlesource.com/platform/packages/modules/Wifi/+/refs/heads/main/framework/java/android/net/wifi/WifiUriParser.java
			reader: 'android',
			noteKey: 'payload.wifi.compat.enterprise',
		},
	],
	fields: [
		field(ID, 'ssid', 'text', { required: true, hint: true }),
		field(ID, 'security', 'select', {
			required: true,
			options: ['wpa', 'sae', 'wep', 'nopass', 'wpa2-eap'],
			default: 'wpa',
			hint: true,
		}),
		field(ID, 'password', 'secret', { maxLength: 256 }),
		field(ID, 'hidden', 'boolean', { default: false, hint: true }),
		field(ID, 'eapMethod', 'select', { options: [...EAP_METHODS], advanced: true, group: 'eap' }),
		field(ID, 'phase2', 'select', { options: [...PHASE2_METHODS], advanced: true, group: 'eap' }),
		field(ID, 'identity', 'text', { maxLength: 256, advanced: true, group: 'eap' }),
		field(ID, 'anonymousIdentity', 'text', { maxLength: 256, advanced: true, group: 'eap' }),
	],
	rules,
	write,
	detect: (text) => {
		try {
			parse(text);
			return 1;
		} catch {
			return 0;
		}
	},
	parse,
	safety: (value) =>
		textOf(value, 'security') === 'nopass'
			? [{ code: 'payload/open-wifi', severity: 'caution' }]
			: [],
});
