import { describe, expect, it } from 'vitest';
import { DYNAMIC_QR_HOSTS, SHORTENER_HOSTS } from '../../src/payload/data/hosts.js';
import {
	analyseUrl,
	cleanUrl,
	isTrackingParam,
	VERY_LONG_URL,
} from '../../src/payload/url-safety.js';
import type { SafetyCode } from '../../src/payload/types.js';
import { REDIRECT_HOST_SOURCES } from '../../src/payload/vectors/index.js';

const codes = (text: string): SafetyCode[] =>
	analyseUrl(text).findings.map((finding) => finding.code);

describe('analyseUrl', () => {
	it('finds nothing to say about an ordinary https link', () => {
		expect(analyseUrl('https://example.com/menu')).toEqual({
			findings: [],
			displayHost: 'example.com',
			unicodeHost: null,
		});
	});

	it('flags schemes that run code or reach the device, whatever they are made to look like', () => {
		for (const text of [
			'javascript:alert(1)',
			'JAVASCRIPT:alert(1)',
			// A tab inside the scheme is removed by the URL parser, as browsers do.
			'java\tscript:alert(1)',
			'data:text/html,<p>hi</p>',
			'vbscript:msgbox',
			'file:///etc/hosts',
			'blob:https://example.com/0',
			'itms-services://?action=download-manifest&url=https://example.com/app.plist',
		]) {
			expect(analyseUrl(text).findings, JSON.stringify(text)).toEqual([
				{
					code: 'scheme/dangerous',
					severity: 'danger',
					params: { scheme: new URL(text).protocol.slice(0, -1) },
				},
			]);
		}
	});

	it('leaves the content schemes to their own types', () => {
		for (const text of [
			'mailto:someone@example.com',
			'tel:+61400000000',
			'WIFI:S:Example;;',
			'geo:0,0',
		]) {
			expect(analyseUrl(text)).toEqual({ findings: [], displayHost: null, unicodeHost: null });
		}
	});

	it('notes an insecure link and an unusual scheme', () => {
		expect(codes('http://example.com/')).toEqual(['url/insecure']);
		expect(analyseUrl('intent://scan/#Intent;scheme=zxing;end').findings[0]).toEqual({
			code: 'scheme/unusual',
			severity: 'caution',
			params: { scheme: 'intent' },
		});
		expect(analyseUrl('market:details').displayHost).toBeNull();
	});

	it('finds the real host behind an @', () => {
		const result = analyseUrl('https://bank.example@other.example/login');
		expect(result.displayHost).toBe('other.example');
		expect(result.findings).toContainEqual({
			code: 'url/userinfo',
			severity: 'danger',
			params: { host: 'other.example' },
		});
		expect(codes('https://:secret@example.com/')).toContain('url/userinfo');
	});

	it('sees through the ways of writing an IP address', () => {
		// WHATWG normalises a decimal or hexadecimal IPv4 host to dotted form.
		expect(analyseUrl('http://3232235777/').displayHost).toBe('192.168.1.1');
		expect(analyseUrl('http://0x7f.1/').findings).toContainEqual({
			code: 'host/ip-literal',
			severity: 'caution',
			params: { host: '127.0.0.1' },
		});
		expect(codes('https://[::1]/')).toContain('host/ip-literal');
	});

	it('shows a punycode host in Unicode and flags mixed scripts', () => {
		// "paypal" with a Cyrillic a.
		const mixed = analyseUrl('https://pаypal.com/');
		expect(mixed.displayHost).toBe('xn--pypal-4ve.com');
		expect(mixed.unicodeHost).toBe('pаypal.com');
		expect(mixed.findings).toEqual([
			{
				code: 'host/punycode',
				severity: 'caution',
				params: { host: 'xn--pypal-4ve.com', unicodeHost: 'pаypal.com' },
			},
			{ code: 'host/mixed-script', severity: 'danger', params: { host: 'pаypal.com' } },
		]);
	});

	it('flags a host written entirely in look-alike letters', () => {
		// "apple" in Cyrillic.
		expect(codes('https://аррӏе.com/')).toEqual(['host/punycode', 'host/lookalike']);
		// A real Cyrillic word is not flagged beyond being punycode.
		expect(codes('https://пример.example/')).toEqual(['host/punycode']);
	});

	it('names redirect services and dynamic code hosts, subdomains included', () => {
		expect(analyseUrl('https://bit.ly/example').findings).toEqual([
			{ code: 'host/shortener', severity: 'caution', params: { host: 'bit.ly' } },
		]);
		expect(codes('https://maps.app.goo.gl/example')).toEqual(['host/shortener']);
		expect(analyseUrl('https://qrco.de/example').findings).toEqual([
			{ code: 'host/dynamic-qr', severity: 'caution', params: { host: 'qrco.de' } },
		]);
		expect(codes('https://notbit.ly/')).toEqual([]);
		// A fully qualified name with its trailing dot is the same host.
		expect(codes('https://bit.ly./abc')).toEqual(['host/shortener']);
		expect(codes('https://qrco.de./x')).toEqual(['host/dynamic-qr']);
	});

	it('counts tracking parameters and notes a very long link', () => {
		expect(analyseUrl('https://example.com/?utm_source=a&fbclid=b&q=c').findings).toEqual([
			{ code: 'url/tracking-params', severity: 'note', params: { count: 2 } },
		]);
		const long = `https://example.com/${'a'.repeat(VERY_LONG_URL)}`;
		expect(analyseUrl(long).findings).toEqual([
			{ code: 'url/very-long', severity: 'note', params: { length: long.length } },
		]);
	});

	it('answers nothing for text that is not a URL', () => {
		expect(analyseUrl('not a link')).toEqual({
			findings: [],
			displayHost: null,
			unicodeHost: null,
		});
		expect(analyseUrl('')).toEqual({ findings: [], displayHost: null, unicodeHost: null });
	});
});

describe('cleanUrl', () => {
	it('removes tracking parameters and nothing else', () => {
		expect(cleanUrl('https://example.com/a?id=7&utm_source=x&fbclid=y#part')).toBe(
			'https://example.com/a?id=7#part',
		);
		expect(cleanUrl('https://example.com/?gclid=1')).toBe('https://example.com/');
		expect(cleanUrl('https://example.com/?UTM_Source=1&%ZZ=2')).toBe('https://example.com/?%ZZ=2');
		expect(cleanUrl('https://example.com/?a=1&&utm_medium=2')).toBe('https://example.com/?a=1');
		expect(cleanUrl('https://example.com/?utm_term+x=1')).toBe('https://example.com/?utm_term+x=1');
	});

	it('leaves a link with nothing to remove, or text that is not a link, exactly as it was', () => {
		expect(cleanUrl('https://EXAMPLE.com/a?b=1')).toBe('https://EXAMPLE.com/a?b=1');
		expect(cleanUrl('https://example.com/a#utm_source=x')).toBe(
			'https://example.com/a#utm_source=x',
		);
		expect(cleanUrl('not a link ?utm_source=x')).toBe('not a link ?utm_source=x');
	});

	it('matches tracking parameter names without regard to case', () => {
		expect(isTrackingParam('UTM_CAMPAIGN')).toBe(true);
		expect(isTrackingParam('utm')).toBe(false);
	});
});

describe('the redirect host table', () => {
	it('cites the operator for every host, and lists each host once', () => {
		const all = [...SHORTENER_HOSTS, ...DYNAMIC_QR_HOSTS];
		for (const entry of all) {
			expect(entry.host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
			expect(entry.operator.length).toBeGreaterThan(0);
			expect(REDIRECT_HOST_SOURCES[entry.host], entry.host).toMatch(/^https:\/\/[^\s]+$/);
		}
		expect(new Set(all.map((entry) => entry.host)).size).toBe(all.length);
		expect(Object.isFrozen(SHORTENER_HOSTS)).toBe(true);
		expect(Object.isFrozen(DYNAMIC_QR_HOSTS)).toBe(true);
	});

	it('keeps a citation only for a host the table still lists', () => {
		// The citations are kept apart from the table, off the runtime path, so
		// a host taken out of the table could otherwise leave its page behind.
		const hosts = [...SHORTENER_HOSTS, ...DYNAMIC_QR_HOSTS].map((entry) => entry.host);
		expect(Object.keys(REDIRECT_HOST_SOURCES)).toEqual(hosts);
		expect(Object.isFrozen(REDIRECT_HOST_SOURCES)).toBe(true);
	});

	it('carries no citation in the table itself', () => {
		for (const entry of [...SHORTENER_HOSTS, ...DYNAMIC_QR_HOSTS]) {
			expect(Object.keys(entry), entry.host).toEqual(['host', 'operator']);
		}
	});
});
