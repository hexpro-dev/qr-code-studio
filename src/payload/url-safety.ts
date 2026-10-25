/**
 * What a browser will do with a link, explained before anybody opens it.
 *
 * Everything here works from what `new URL()` makes of the text, because that
 * is the WHATWG parser every browser uses, and the place an attack lives is
 * the gap between what a link looks like and what it parses to. A tab typed
 * into the middle of "javascript:" disappears; "3232235777" is the address 192.168.1.1; an
 * address with an "@" in it goes to whatever comes after the "@". Reading the
 * text with a regular expression would miss all three.
 *
 * Findings carry the host in `params`, because showing the person where a
 * code goes is the whole job. Nothing here ever goes into an error message.
 */

import { DYNAMIC_QR_HOSTS, SHORTENER_HOSTS } from './data/hosts.js';
import type { RedirectHost } from './data/hosts.js';
import { hostToUnicode } from './punycode.js';
import { isMixedScript, isWholeScriptLookalike } from './scripts.js';
import type { SafetyFinding, UrlAnalysis } from './types.js';

/**
 * Schemes that run code or reach the local machine rather than going to a
 * site: script, inline documents, local files and in-memory objects. No QR
 * code has a good reason to carry one.
 */
const DANGEROUS_SCHEMES: ReadonlySet<string> = new Set([
	'javascript',
	'data',
	'vbscript',
	'file',
	'blob',
]);

/**
 * Schemes the content types in this layer read and explain themselves. They
 * are not web navigation, so the host checks below do not apply to them.
 */
const CONTENT_SCHEMES: ReadonlySet<string> = new Set([
	'mailto',
	'tel',
	'sms',
	'smsto',
	'mms',
	'mmsto',
	'geo',
	'facetime',
	'facetime-audio',
	'bitcoin',
	'lightning',
	'upi',
	'wifi',
	'matmsg',
	'mecard',
	'tg',
	'whatsapp',
	'sgnl',
]);

/**
 * Query parameters that exist to say where a visitor came from, rather than
 * what they asked for. Removing them leaves the same page. Sources: Google
 * Analytics campaign parameters (support.google.com/analytics/answer/10917952),
 * Google Ads auto-tagging gclid, gbraid and wbraid
 * (support.google.com/google-ads/answer/9744275), Campaign Manager dclid,
 * Meta's fbclid (developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc),
 * Microsoft Advertising msclkid (help.ads.microsoft.com, "What is Microsoft
 * Click ID"), Mailchimp mc_cid and mc_eid, HubSpot _hsenc and _hsmi, Marketo
 * mkt_tok, Instagram igshid, Yandex yclid, TikTok ttclid, X twclid, LinkedIn
 * li_fat_id and Google's cross-domain _gl.
 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'utm_id',
	'utm_source_platform',
	'utm_creative_format',
	'utm_marketing_tactic',
	'gclid',
	'gbraid',
	'wbraid',
	'dclid',
	'fbclid',
	'msclkid',
	'mc_cid',
	'mc_eid',
	'_hsenc',
	'_hsmi',
	'mkt_tok',
	'igshid',
	'yclid',
	'ttclid',
	'twclid',
	'li_fat_id',
	'_gl',
]);

/**
 * Past this a link is longer than any phone's address bar shows, so the part
 * a person can see may not be the part that matters. Not from a standard:
 * chosen to be well above the length of an ordinary link with a campaign tag.
 */
export const VERY_LONG_URL = 512;

const EMPTY: UrlAnalysis = Object.freeze({
	findings: Object.freeze([]),
	displayHost: null,
	unicodeHost: null,
});

function parseUrl(text: string): URL | undefined {
	try {
		return new URL(text);
	} catch {
		return undefined;
	}
}

function matches(host: string, list: readonly RedirectHost[]): boolean {
	return list.some((entry) => host === entry.host || host.endsWith(`.${entry.host}`));
}

export function isTrackingParam(name: string): boolean {
	return TRACKING_PARAMS.has(name.toLowerCase());
}

function hostFindings(url: URL, host: string, findings: SafetyFinding[]): string | null {
	if (url.username !== '' || url.password !== '') {
		// "https://bank.example@other.example/" goes to other.example. The part
		// before the "@" is a user name, and it is there to be read as a host.
		findings.push({ code: 'url/userinfo', severity: 'danger', params: { host } });
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) {
		findings.push({ code: 'host/ip-literal', severity: 'caution', params: { host } });
	}
	const unicode = hostToUnicode(host);
	const unicodeHost = unicode === host ? null : unicode;
	if (unicodeHost !== null) {
		findings.push({ code: 'host/punycode', severity: 'caution', params: { host, unicodeHost } });
	}
	const labels = unicode.split('.');
	if (labels.some(isMixedScript)) {
		findings.push({ code: 'host/mixed-script', severity: 'danger', params: { host: unicode } });
	} else if (labels.some(isWholeScriptLookalike)) {
		findings.push({ code: 'host/lookalike', severity: 'danger', params: { host: unicode } });
	}
	if (matches(host, SHORTENER_HOSTS)) {
		findings.push({ code: 'host/shortener', severity: 'caution', params: { host } });
	} else if (matches(host, DYNAMIC_QR_HOSTS)) {
		findings.push({ code: 'host/dynamic-qr', severity: 'caution', params: { host } });
	}
	return unicodeHost;
}

/** Every finding about a link, the host it goes to, and that host in Unicode when it differs. */
export function analyseUrl(text: string): UrlAnalysis {
	const url = parseUrl(text);
	if (url === undefined) return EMPTY;
	const scheme = url.protocol.slice(0, -1);
	const findings: SafetyFinding[] = [];
	if (DANGEROUS_SCHEMES.has(scheme)) {
		findings.push({ code: 'scheme/dangerous', severity: 'danger', params: { scheme } });
		return { findings, displayHost: null, unicodeHost: null };
	}
	if (CONTENT_SCHEMES.has(scheme)) return EMPTY;
	if (scheme === 'http') findings.push({ code: 'url/insecure', severity: 'caution' });
	else if (scheme !== 'https')
		findings.push({ code: 'scheme/unusual', severity: 'caution', params: { scheme } });

	const host = url.hostname;
	const unicodeHost = host === '' ? null : hostFindings(url, host, findings);

	let tracking = 0;
	for (const name of url.searchParams.keys()) if (isTrackingParam(name)) tracking += 1;
	if (tracking > 0) {
		findings.push({ code: 'url/tracking-params', severity: 'note', params: { count: tracking } });
	}
	if (text.length > VERY_LONG_URL) {
		findings.push({ code: 'url/very-long', severity: 'note', params: { length: text.length } });
	}
	return { findings, displayHost: host === '' ? null : host, unicodeHost };
}

function decodedName(part: string): string {
	const equals = part.indexOf('=');
	const raw = (equals === -1 ? part : part.slice(0, equals)).replace(/\+/g, ' ');
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

/**
 * The link without its tracking parameters, otherwise exactly as written. The
 * text comes back unchanged when it is not a URL or has nothing to remove.
 */
export function cleanUrl(text: string): string {
	if (parseUrl(text) === undefined) return text;
	const hash = text.indexOf('#');
	const fragment = hash === -1 ? '' : text.slice(hash);
	const beforeFragment = hash === -1 ? text : text.slice(0, hash);
	const mark = beforeFragment.indexOf('?');
	if (mark === -1) return text;
	const parts = beforeFragment.slice(mark + 1).split('&');
	const kept = parts.filter((part) => !isTrackingParam(decodedName(part)));
	if (kept.length === parts.length) return text;
	const query = kept.filter((part) => part !== '').join('&');
	return `${beforeFragment.slice(0, mark)}${query === '' ? '' : `?${query}`}${fragment}`;
}
