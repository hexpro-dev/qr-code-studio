/**
 * Explaining text: every content type's spec vectors, the dangerous corpus
 * the URL analyser was built against, and types that misbehave.
 *
 * The test content is synthetic or a specification's published example, as
 * the vectors are.
 */

import { describe, expect, it } from 'vitest';
import { issue } from '../../src/core/issue.js';
import { Registry } from '../../src/core/registry.js';
import { textType } from '../../src/payload/content/text.js';
import { detectPayload } from '../../src/payload/detect.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import type { PayloadType, SafetyCode } from '../../src/payload/types.js';
import { isWebLink } from '../../src/inspect/explain.js';
import { inspectText } from '../../src/inspect/inspect.js';
import { registries } from './helpers.js';

const codes = (text: string): SafetyCode[] =>
	(inspectText(text, registries).safety?.findings ?? []).map((finding) => finding.code);

describe('every content type', () => {
	for (const type of createPayloadRegistry().list()) {
		it(`${type.id}: its vectors are explained as the type that claims them`, () => {
			for (const vector of type.vectors) {
				const report = inspectText(vector.text, registries);
				const detected = detectPayload(vector.text, registries.payloads).type;
				expect(report.symbols).toEqual([]);
				expect(report.sets).toEqual([]);
				expect(report.payload?.typeId, vector.source).toBe(detected.id);
				const value = detected.parse(vector.text);
				expect(report.payload?.value).toEqual(value);
				expect(report.payload?.issues).toEqual(detected.validate(value));
				for (const finding of detected.safety?.(value) ?? []) {
					expect(report.safety?.findings).toContainEqual(finding);
				}
			}
		});
	}
});

describe('safety', () => {
	it('analyses any web link as written, even where a more specific type claims it', () => {
		const report = inspectText('https://id.gs1.org/01/09520123456788/10/ABC1', registries);
		expect(report.payload?.typeId).toBe('gs1-digital-link');
		expect(report.safety?.displayHost).toBe('id.gs1.org');
		const shortened = inspectText('https://bit.ly/01/09520123456788', registries);
		expect(shortened.safety?.findings.map((f) => f.code)).toContain('host/shortener');
	});

	it('flags the schemes that run code', () => {
		for (const text of [
			'javascript:alert(1)',
			'JAVASCRIPT:alert(1)',
			'java\tscript:alert(1)',
			'data:text/html,<p>hi</p>',
			'vbscript:msgbox',
			'file:///etc/hosts',
			'blob:https://example.com/0',
			'itms-services://?action=download-manifest&url=https://example.com/app.plist',
		]) {
			expect(inspectText(text, registries).safety?.findings, JSON.stringify(text)).toContainEqual(
				expect.objectContaining({ code: 'scheme/dangerous', severity: 'danger' }),
			);
		}
	});

	it('finds the real host and everything suspicious about it', () => {
		const behind = inspectText('https://bank.example@other.example/login', registries);
		expect(behind.safety?.displayHost).toBe('other.example');
		expect(behind.safety?.findings).toContainEqual({
			code: 'url/userinfo',
			severity: 'danger',
			params: { host: 'other.example' },
		});
		expect(inspectText('http://3232235777/', registries).safety?.displayHost).toBe('192.168.1.1');
		expect(codes('http://3232235777/')).toEqual(['url/insecure', 'host/ip-literal']);
		expect(codes('https://xn--80ak6aa92e.com/')).toEqual(['host/punycode', 'host/lookalike']);
		expect(
			inspectText('https://xn--80ak6aa92e.com/', registries).safety?.unicodeHost,
		).not.toBeNull();
		expect(codes('https://p\u0430ypal.com/')).toContain('host/mixed-script');
		expect(codes('https://bit.ly/abc')).toEqual(['host/shortener']);
		expect(codes('https://qrco.de/x')).toEqual(['host/dynamic-qr']);
		expect(codes('https://example.com/?utm_source=poster&fbclid=1')).toEqual([
			'url/tracking-params',
		]);
		expect(codes(`https://example.com/${'a'.repeat(600)}`)).toEqual(['url/very-long']);
	});

	it('says what other content does', () => {
		expect(codes('WIFI:T:nopass;S:Example Network;;')).toEqual(['payload/open-wifi']);
		expect(codes('bitcoin:BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ?amount=0.01')).toContain(
			'payload/payment',
		);
		expect(codes('SMSTO:+61400000000:Hello')).toEqual(['payload/sends-message']);
		expect(codes('tel:*21*0400000000#')).toEqual(['payload/service-code']);
	});

	it('reports a finding once, though the type and the raw link both find it', () => {
		const findings = inspectText('http://example.com/', registries).safety?.findings ?? [];
		expect(findings).toEqual([{ code: 'url/insecure', severity: 'caution' }]);
	});

	it('leaves plain text alone, colon and all', () => {
		const report = inspectText('Note: buy milk', registries);
		expect(report.payload?.typeId).toBe('text');
		expect(report.safety).toEqual({ findings: [], displayHost: null, unicodeHost: null });
		expect(isWebLink(' \u0001https://example.com')).toBe(true);
		expect(isWebLink('see https://example.com')).toBe(false);
	});
});

function fake(overrides: Partial<PayloadType>): PayloadType {
	return {
		...(textType as PayloadType),
		id: 'fake',
		detect: () => 1,
		...overrides,
	};
}

describe('content types that misbehave', () => {
	const withFake = (type: PayloadType, text = true) => ({
		symbologies: registries.symbologies,
		payloads: new Registry<PayloadType>(
			'payload-type',
			text ? [type, textType as PayloadType] : [type],
		),
	});

	it('explains as text what a type claims and cannot read', () => {
		const report = inspectText(
			'something',
			withFake(
				fake({
					parse: () => {
						throw new TypeError('a bug in a third party type');
					},
				}),
			),
		);
		expect(report.payload).toEqual({
			typeId: 'text',
			value: { text: 'something' },
			issues: [issue('inspect.issue.unreadable-as-type', [], 'warning', { typeId: 'fake' })],
		});
	});

	it('survives a type whose checks throw', () => {
		const angry = () => {
			throw new Error('no');
		};
		const report = inspectText('something', withFake(fake({ validate: angry, safety: angry })));
		expect(report.payload).toMatchObject({ typeId: 'fake', issues: [] });
		expect(report.safety?.findings).toEqual([]);
	});

	it('falls back to the built-in text type when the registry has none, or nothing parses', () => {
		const broken = fake({
			parse: () => {
				throw new Error('no');
			},
		});
		const report = inspectText('something', withFake(broken, false));
		expect(report.payload?.typeId).toBe('text');
		const neither = fake({
			id: 'text',
			parse: () => {
				throw new Error('no');
			},
		});
		const last = inspectText('x', {
			symbologies: registries.symbologies,
			payloads: new Registry<PayloadType>('payload-type', [neither]),
		});
		expect(last.payload?.value).toEqual({ text: 'x' });
	});

	it('refuses what is not text, or registries that are not', () => {
		expect(() => inspectText(5 as never, registries)).toThrow(TypeError);
		expect(() => inspectText('x', null as never)).toThrow(TypeError);
		expect(() => inspectText('x', { symbologies: registries.symbologies } as never)).toThrow(
			TypeError,
		);
	});
});
