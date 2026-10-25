/**
 * Links and messages: web links, email, phone, SMS, WhatsApp, Telegram,
 * Signal, FaceTime, places and plain text. The forms each one reads beyond
 * the one it writes, and what each says about safety.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { emailType } from '../../src/payload/content/email.js';
import { facetimeType } from '../../src/payload/content/facetime.js';
import { geoType } from '../../src/payload/content/geo.js';
import { phoneType } from '../../src/payload/content/phone.js';
import { signalType } from '../../src/payload/content/signal.js';
import { smsType } from '../../src/payload/content/sms.js';
import { telegramType } from '../../src/payload/content/telegram.js';
import { textType } from '../../src/payload/content/text.js';
import { urlType } from '../../src/payload/content/url.js';
import { whatsappType } from '../../src/payload/content/whatsapp.js';
import type { PayloadType, PayloadValue } from '../../src/payload/types.js';
import { VALID } from './cases.js';

function refuses(type: PayloadType, text: string, code = 'payload/unparseable'): void {
	try {
		type.parse(text);
		expect.unreachable(`${type.id} read ${JSON.stringify(text)}`);
	} catch (error) {
		expect(error, text).toBeInstanceOf(QrStudioError);
		expect((error as QrStudioError).code, text).toBe(code);
	}
}

const build = (type: PayloadType, change: PayloadValue = {}) =>
	type.build({ ...VALID[type.id], ...change } as never).text;

describe('url', () => {
	it('scores links by how specific they are', () => {
		expect(urlType.detect('https://example.com/')).toBe(0.5);
		expect(urlType.detect('http://example.com/')).toBe(0.5);
		expect(urlType.detect('javascript:alert(1)')).toBe(0.4);
		expect(urlType.detect('intent://scan/#Intent;end')).toBe(0.2);
		expect(urlType.detect('Note:buy milk')).toBe(0);
		expect(urlType.detect('https://example.com/a b')).toBe(0);
		expect(urlType.detect('not a link')).toBe(0);
	});

	it('adds campaign tags to the link as written, and takes them back off', () => {
		const text = build(urlType, {
			url: 'https://example.com/menu?table=4#drinks',
			utmSource: 'poster',
			utmMedium: 'qr',
			utmCampaign: 'spring sale',
			utmTerm: 'a&b',
			utmContent: 'v2',
		});
		expect(text).toBe(
			'https://example.com/menu?table=4&utm_source=poster&utm_medium=qr&utm_campaign=spring%20sale&utm_term=a%26b&utm_content=v2#drinks',
		);
		expect(urlType.parse(text)).toEqual({
			url: 'https://example.com/menu?table=4#drinks',
			utmSource: 'poster',
			utmMedium: 'qr',
			utmCampaign: 'spring sale',
			utmTerm: 'a&b',
			utmContent: 'v2',
		});
	});

	it('reads a dangerous link so it can be explained, and refuses to make one', () => {
		const value = urlType.parse('javascript:alert(1)');
		expect(value.url).toBe('javascript:alert(1)');
		expect(urlType.safety?.(value)).toEqual([
			{ code: 'scheme/dangerous', severity: 'danger', params: { scheme: 'javascript' } },
		]);
		expect(() => urlType.build(value)).toThrow(TypeError);
		refuses(urlType, 'plain words');
	});

	it('analyses the link the person typed, not the tags they added', () => {
		expect(
			urlType.safety?.({ ...VALID.url, url: 'https://example.com/', utmSource: 'a' } as never),
		).toEqual([]);
	});
});

describe('email', () => {
	it('writes every header RFC 6068 allows a phone to use', () => {
		const text = build(emailType, {
			to: ['a+tag@example.com', 'b@example.com'],
			cc: ['c@example.com'],
			bcc: ['d@example.com'],
			subject: 'Hello & welcome?',
			body: 'One\nTwo',
		});
		expect(text).toBe(
			'mailto:a+tag@example.com,b@example.com?cc=c@example.com&bcc=d@example.com&subject=Hello%20%26%20welcome%3F&body=One%0D%0ATwo',
		);
		expect(emailType.parse(text)).toEqual({
			to: ['a+tag@example.com', 'b@example.com'],
			cc: ['c@example.com'],
			bcc: ['d@example.com'],
			subject: 'Hello & welcome?',
			body: 'One\nTwo',
		});
		expect(build(emailType, { subject: '', body: '' })).toBe('mailto:someone@example.com');
	});

	it('reads recipients from the query as well, and ignores other headers', () => {
		expect(
			emailType.parse('MAILTO:?to=a@example.com,%20b@example.com&In-Reply-To=%3Cx%3E&Subject=Hi'),
		).toEqual({ to: ['a@example.com', 'b@example.com'], cc: [], bcc: [], subject: 'Hi', body: '' });
		refuses(emailType, 'mailto:a%ZZ@example.com');
		refuses(emailType, 'mailto:a@example.com?subject=%ZZ');
		refuses(emailType, 'someone@example.com');
	});

	it("reads DoCoMo's MATMSG form", () => {
		expect(emailType.detect('MATMSG:TO:a@example.com;;')).toBe(0.95);
		expect(emailType.parse('MATMSG:TO:a@example.com;SUB:Hi\\; there;BODY:Text;junk;;')).toEqual({
			to: ['a@example.com'],
			cc: [],
			bcc: [],
			subject: 'Hi; there',
			body: 'Text',
		});
		refuses(emailType, 'MATMSG:SUB:Hi;;');
		expect(emailType.detect('hello')).toBe(0);
	});

	it('notes that a message is prepared, not sent', () => {
		expect(emailType.safety?.(VALID.email as never)).toEqual([
			{ code: 'payload/sends-message', severity: 'note' },
		]);
	});
});

describe('phone', () => {
	it('drops spaces, keeps visual separators, and reads parameters off', () => {
		expect(build(phoneType)).toBe('tel:+61400000000');
		expect(build(phoneType, { number: '+61 (2) 9000-0000' })).toBe('tel:+61(2)9000-0000');
		expect(phoneType.parse('tel:+61400000000;ext=12')).toEqual({ number: '+61400000000' });
		expect(phoneType.parse('TEL://+61400000000')).toEqual({ number: '+61400000000' });
		expect(phoneType.parse('tel:%2B61400000000')).toEqual({ number: '+61400000000' });
		refuses(phoneType, 'tel:');
		refuses(phoneType, 'tel:%ZZ');
		refuses(phoneType, '+61400000000');
		expect(phoneType.detect('+61400000000')).toBe(0);
	});
});

describe('sms', () => {
	it('writes SMSTO, with or without a message', () => {
		expect(build(smsType)).toBe('SMSTO:+61400000000:Hello');
		expect(build(smsType, { message: '' })).toBe('SMSTO:+61400000000');
	});

	it('reads SMSTO, MMSTO and the RFC 5724 sms: URI', () => {
		expect(smsType.parse('smsto:+61400000000')).toEqual({ number: '+61400000000', message: '' });
		expect(smsType.parse('MMSTO:+61400000000:Time: 9:30')).toEqual({
			number: '+61400000000',
			message: 'Time: 9:30',
		});
		expect(smsType.parse('sms:+15105550101,+15105550102?body=hello%20there')).toEqual({
			number: '+15105550101',
			message: 'hello there',
		});
		expect(smsType.parse('SMS:+15105550101;via=x')).toEqual({
			number: '+15105550101',
			message: '',
		});
		expect(smsType.parse('sms://+15105550101?BODY=hi')).toEqual({
			number: '+15105550101',
			message: 'hi',
		});
		refuses(smsType, 'SMSTO::hello');
		refuses(smsType, 'sms:?body=hi');
		refuses(smsType, 'sms:+1%ZZ');
		refuses(smsType, 'mms:+1?body=%ZZ');
		refuses(smsType, 'text +61400000000');
		expect(smsType.safety?.(VALID.sms as never)).toEqual([
			{ code: 'payload/sends-message', severity: 'note' },
		]);
	});
});

describe('whatsapp', () => {
	it('writes the digits of an international number, and the message encoded', () => {
		expect(build(whatsappType)).toBe('https://wa.me/61400000000');
		expect(build(whatsappType, { number: '+61 400 000 000', message: 'Hi + bye' })).toBe(
			'https://wa.me/61400000000?text=Hi%20%2B%20bye',
		);
	});

	it("reads wa.me, the older api.whatsapp.com form and the app's own scheme", () => {
		expect(whatsappType.parse('https://wa.me/61400000000/?text=Hi+there')).toEqual({
			number: '+61400000000',
			message: 'Hi there',
		});
		expect(
			whatsappType.parse('https://api.whatsapp.com/send?phone=+61%20400%20000%20000&text=Hello'),
		).toEqual({ number: '+61400000000', message: 'Hello' });
		expect(whatsappType.parse('whatsapp://send?phone=61400000000')).toEqual({
			number: '+61400000000',
			message: '',
		});
		refuses(whatsappType, 'https://api.whatsapp.com/send?phone=12');
		refuses(whatsappType, 'https://api.whatsapp.com/send?text=hi');
		refuses(whatsappType, 'https://api.whatsapp.com/send?phone=%ZZ');
		refuses(whatsappType, 'https://wa.me/61400000000?text=%ZZ');
		refuses(whatsappType, 'https://wa.me/message/ABCDEF');
		expect(whatsappType.detect('https://wa.me/61400000000')).toBe(0.9);
		expect(whatsappType.detect('https://example.com/')).toBe(0);
		expect(whatsappType.safety?.(VALID.whatsapp as never)).toHaveLength(1);
	});
});

describe('telegram', () => {
	it('writes a username link or a phone link, with an optional draft', () => {
		expect(build(telegramType)).toBe('https://t.me/example_user');
		expect(
			build(telegramType, { target: 'phone', phone: '+61 400 000 000', message: 'Hi there' }),
		).toBe('https://t.me/+61400000000?text=Hi%20there');
	});

	it("reads t.me, telegram.me and the app's tg://resolve", () => {
		const user = { target: 'username', username: 'example_user', phone: '', message: '' };
		expect(telegramType.parse('t.me/example_user/')).toEqual(user);
		expect(telegramType.parse('https://telegram.me/example_user')).toEqual(user);
		expect(telegramType.parse('tg://resolve?domain=example_user&text=Hi')).toEqual({
			...user,
			message: 'Hi',
		});
		expect(telegramType.parse('tg://resolve?phone=61400000000')).toEqual({
			target: 'phone',
			username: '',
			phone: '+61400000000',
			message: '',
		});
		refuses(telegramType, 'tg://resolve?other=1');
		refuses(telegramType, 'tg://resolve?domain=%ZZ');
		refuses(telegramType, 'https://t.me/+AbCdEfGh');
		refuses(telegramType, 'https://t.me/example_user?text=%ZZ');
		refuses(telegramType, 'https://example.com/example_user');
		expect(telegramType.detect('https://t.me/example_user')).toBe(0.9);
		expect(telegramType.detect('https://t.me/ab')).toBe(0);
	});
});

describe('signal', () => {
	it('writes the number into the fragment and reads both schemes', () => {
		expect(build(signalType, { number: '+61 400 000 000' })).toBe(
			'https://signal.me/#p/+61400000000',
		);
		expect(signalType.parse('sgnl://signal.me/#p/+61400000000')).toEqual({
			number: '+61400000000',
		});
		refuses(signalType, 'https://signal.me/#eu/abcdef');
		expect(signalType.detect('https://signal.me/#eu/abcdef')).toBe(0);
	});
});

describe('facetime', () => {
	it('writes video or audio, to a number or an address', () => {
		expect(build(facetimeType)).toBe('facetime:someone@example.com');
		expect(build(facetimeType, { contact: '+1 408 555 1234', audioOnly: true })).toBe(
			'facetime-audio:+14085551234',
		);
	});

	it("reads Apple's native forms, with their space after the slashes", () => {
		expect(facetimeType.parse('facetime:// 14085551234')).toEqual({
			contact: '14085551234',
			audioOnly: false,
		});
		expect(facetimeType.parse('FACETIME-AUDIO://user@example.com')).toEqual({
			contact: 'user@example.com',
			audioOnly: true,
		});
		refuses(facetimeType, 'facetime:%ZZ');
		refuses(facetimeType, 'facetime:');
		refuses(facetimeType, 'tel:+14085551234');
	});
});

describe('geo', () => {
	it('writes coordinates in plain decimal, with altitude and accuracy when given', () => {
		expect(build(geoType)).toBe('geo:-33.8568,151.2153');
		expect(
			build(geoType, { latitude: 1e-7, longitude: -0.5, altitude: 12.5, uncertainty: 30 }),
		).toBe('geo:0.0000001,-0.5,12.5;u=30');
	});

	it('reads RFC 5870 parameters and refuses what it cannot place', () => {
		expect(geoType.parse('GEO:1,2;CRS=WGS84;u=0.5;foo')).toEqual({
			latitude: 1,
			longitude: 2,
			altitude: null,
			uncertainty: 0.5,
		});
		refuses(geoType, 'geo:1');
		refuses(geoType, 'geo:1,2,3,4');
		refuses(geoType, 'geo:91,0');
		refuses(geoType, 'geo:0,181');
		refuses(geoType, 'geo:a,b');
		refuses(geoType, 'geo:1,2,high');
		refuses(geoType, 'geo:1,2;crs=epsg4326');
		refuses(geoType, 'geo:1,2;u=-5');
	});

	it("reads Android's pin form", () => {
		expect(geoType.parse('geo:0,0?q=-33.8568,151.2153(Example)')).toMatchObject({
			latitude: -33.8568,
			longitude: 151.2153,
		});
		expect(geoType.parse('geo:0,0?q=Example+Street')).toMatchObject({ latitude: 0, longitude: 0 });
		expect(geoType.parse('geo:0,0?q=95,0')).toMatchObject({ latitude: 0, longitude: 0 });
		expect(geoType.parse('geo:1,2?q=3,4')).toMatchObject({ latitude: 1, longitude: 2 });
	});

	it('reads map links that carry their coordinates', () => {
		const place = { latitude: -33.8568, longitude: 151.2153, altitude: null, uncertainty: null };
		for (const link of [
			'https://www.google.com/maps?q=-33.8568,151.2153',
			'https://maps.google.com/?q=-33.8568, 151.2153',
			'https://www.google.com/maps/search/?api=1&query=-33.8568,151.2153',
			'https://www.google.com/maps/@-33.8568,151.2153,15z',
			'https://www.google.com/maps/place/Example/@-33.8568,151.2153,17z/data=x',
			'https://www.google.com/maps?ll=-33.8568,151.2153',
			'https://maps.apple.com/?ll=-33.8568,151.2153&q=Example',
			'https://maps.apple.com/?q=-33.8568,151.2153',
			'https://www.openstreetmap.org/?mlat=-33.8568&mlon=151.2153#map=15/-33.8/151.2',
			'https://www.openstreetmap.org/#map=15/-33.8568/151.2153',
		]) {
			expect(geoType.parse(link), link).toEqual(place);
			expect(geoType.detect(link)).toBe(0.7);
		}
		for (const link of [
			'https://www.google.com/search?q=-33.8568,151.2153',
			'https://www.google.com/maps?q=Example+Place',
			'https://www.google.com/maps?q=1,2,3',
			'https://www.openstreetmap.org/',
			'https://maps.apple.com/?address=Example',
			'https://example.com/?q=1,2',
			'ftp://maps.google.com/?q=1,2',
			'not a link',
		]) {
			expect(geoType.detect(link), link).toBe(0);
			refuses(geoType, link);
		}
	});
});

describe('text', () => {
	it('is anything, never more than possibly', () => {
		expect(textType.detect('')).toBe(0);
		expect(textType.detect('anything')).toBe(0.01);
		expect(textType.parse('a\nb')).toEqual({ text: 'a\nb' });
		expect(textType.build({ text: 'a\nb' }).text).toBe('a\nb');
	});
});
