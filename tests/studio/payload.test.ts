/**
 * The content: choosing a type, filling its fields, remaking a code from
 * scanned text, and the form a view draws for it.
 */

import { describe, expect, it } from 'vitest';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { zatcaVectors } from '../../src/payload/vectors/zatca.js';
import { createRegistries } from '../../src/registries.js';
import { emptyValue, fieldsFor, fitsField, isFieldValue } from '../../src/studio/document.js';
import { formView } from '../../src/studio/form.js';
import type { PayloadType } from '../../src/payload/types.js';
import { studioWith } from './helpers.js';

const payloads = createPayloadRegistry();

describe('payload/type', () => {
	it('switches type, keeping the values the new type has a field of that kind for', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/type', typeId: 'sms' });
		studio.dispatch({ type: 'payload/field', key: 'number', value: '+61 400 000 000' });
		studio.dispatch({ type: 'payload/field', key: 'message', value: 'Example message' });
		studio.dispatch({ type: 'payload/type', typeId: 'whatsapp' });
		expect(studio.getSnapshot().document.fields).toMatchObject({
			number: '+61 400 000 000',
			message: 'Example message',
		});
		studio.dispatch({ type: 'payload/type', typeId: 'phone' });
		const fields = studio.getSnapshot().document.fields;
		expect(fields).toEqual({ number: '+61 400 000 000' });
		expect(Object.keys(fields)).toEqual(payloads.require('phone').fields.map((f) => f.key));
	});

	it('does not carry a Wi-Fi password to a type with no field for it', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/type', typeId: 'wifi' });
		studio.dispatch({ type: 'payload/field', key: 'password', value: 'example-pass' });
		studio.dispatch({ type: 'payload/type', typeId: 'url' });
		expect(JSON.stringify(studio.getSnapshot().document)).not.toContain('example-pass');
	});

	it('refuses a type it does not have, and one it can only read', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/type', typeId: 'no-such-type' });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-type');
		studio.dispatch({ type: 'payload/type', typeId: 5 as never });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-type');
		studio.dispatch({ type: 'payload/type', typeId: 'zatca' });
		expect(studio.getSnapshot().refusal?.issues[0]).toMatchObject({
			code: 'studio.issue.read-only-type',
			params: { type: 'zatca' },
		});
		expect(studio.getSnapshot().document.typeId).toBe('url');
	});
});

describe('payload/field', () => {
	it('refuses a field the type does not have, and a value that is no field value', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/field', key: 'nope', value: 'x' });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-field');
		studio.dispatch({ type: 'payload/field', key: 'url', value: { not: 'a value' } as never });
		expect(studio.getSnapshot().refusal?.issues[0]).toMatchObject({
			code: 'studio.issue.field-value',
			path: ['fields', 'url'],
		});
	});

	it('stores a list as its own frozen copy', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/type', typeId: 'email' });
		const list = ['one@example.com', 'two@example.com'];
		studio.dispatch({ type: 'payload/field', key: 'to', value: list });
		const stored = studio.getSnapshot().document.fields.to;
		expect(stored).toEqual(list);
		expect(stored).not.toBe(list);
		expect(Object.isFrozen(stored)).toBe(true);
	});

	it('keeps a value of the wrong kind for the form to show as wrong', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 42 });
		const field = studio.getSnapshot().form.fields.find((candidate) => candidate.key === 'url');
		expect(field?.issues.map((found) => found.code)).toEqual(['payload.issue.wrong-kind']);
	});
});

describe('payload/raw', () => {
	it('detects the type of scanned text and fills its fields: remake as a static code', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/raw', text: 'WIFI:T:WPA;S:Example Network;P:example-pass;;' });
		const doc = studio.getSnapshot().document;
		expect(doc.typeId).toBe('wifi');
		expect(doc.fields.ssid).toBe('Example Network');
		expect(studio.getSnapshot().symbol.status).toBe('ok');
	});

	it('falls back to plain text for text no type claims, or one that cannot be made', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/raw', text: 'Just some words' });
		expect(studio.getSnapshot().document).toMatchObject({
			typeId: 'text',
			fields: { text: 'Just some words' },
		});
		const zatca = zatcaVectors[0]?.text as string;
		studio.dispatch({ type: 'payload/raw', text: zatca });
		expect(studio.getSnapshot().document.typeId).toBe('text');
	});

	it('falls back to text when the detected type will not parse it after all', () => {
		const registries = { payloads: createPayloadRegistry() };
		const greedy = {
			...payloads.require('url'),
			id: 'greedy',
			detect: () => 1,
			parse: () => {
				throw new Error('cannot');
			},
		} as PayloadType;
		registries.payloads.register(greedy);
		const { studio } = studioWith({
			registries: { ...createRegistriesWith(registries.payloads) },
		});
		studio.dispatch({ type: 'payload/raw', text: 'anything' });
		expect(studio.getSnapshot().document.typeId).toBe('text');
	});

	it('refuses text longer than any code holds, and text nothing can take', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/raw', text: 'x'.repeat(16385) });
		expect(studio.getSnapshot().refusal?.issues[0]).toMatchObject({
			code: 'studio.issue.raw-too-long',
			params: { length: 16385, max: 16384 },
		});
		expect(() => studio.dispatch({ type: 'payload/raw', text: 5 as never })).toThrow(TypeError);
		const bare = createPayloadRegistry();
		const onlyUrl = new (
			bare.constructor as new (kind: string, entries: readonly PayloadType[]) => typeof bare
		)('payload-type', [payloads.require('url')]);
		const lonely = studioWith({ registries: createRegistriesWith(onlyUrl) }).studio;
		lonely.dispatch({ type: 'payload/raw', text: 'not a link at all' });
		expect(lonely.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-type');
	});
});

function createRegistriesWith(payloadRegistry: ReturnType<typeof createPayloadRegistry>) {
	return { ...createRegistries(), payloads: payloadRegistry };
}

describe('the form', () => {
	it("lays out a type's schema with values, issues, groups and the disclosure", () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		studio.dispatch({ type: 'payload/field', key: 'utmSource', value: 'poster' });
		const form = studio.getSnapshot().form;
		expect(form).toMatchObject({
			typeId: 'url',
			labelKey: 'payload.url.label',
			descriptionKey: 'payload.url.description',
			actionKey: 'payload.url.action',
			category: 'link',
			hasAdvanced: true,
			designLocked: false,
		});
		expect(form.groups).toEqual([
			{ id: null, labelKey: null, advanced: false, fields: ['url'] },
			{
				id: 'utm',
				labelKey: 'studio.group.utm',
				advanced: true,
				fields: ['utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'],
			},
		]);
		const url = form.fields[0];
		expect(url).toMatchObject({
			key: 'url',
			kind: 'url',
			required: true,
			value: 'nope',
			secret: false,
		});
		expect(url?.issues.map((found) => found.code)).toEqual(['payload.issue.invalid-url']);
		const source = form.fields[1];
		expect(source?.value).toBe('poster');
		// The missing medium and campaign are issues on their own fields.
		expect(form.fields[2]?.issues.map((found) => found.code)).toEqual([
			'payload.url.issue.utm-incomplete',
		]);
		expect(form.safety).toEqual([]);
	});

	it('masks a secret and says what a scanner will warn about once the value is whole', () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/raw', text: 'WIFI:T:nopass;S:Open Example;;' });
		const form = studio.getSnapshot().form;
		expect(form.fields.find((field) => field.key === 'password')?.secret).toBe(true);
		expect(form.safety.map((finding) => finding.code)).toContain('payload/open-wifi');
	});

	it('puts issues about the whole value beside the form rather than a field', () => {
		const type = payloads.require('text');
		const view = formView(type, { text: 'x' }, [
			{ code: 'payload.issue.wrong-kind', path: ['fields'], severity: 'error' },
		]);
		expect(view.issues).toHaveLength(1);
		expect(view.fields[0]?.issues).toEqual([]);
	});

	it('draws a field missing from the values as empty, and survives a safety check that throws', () => {
		const url = payloads.require('url');
		const view = formView(
			{
				...url,
				safety: () => {
					throw new Error('broken');
				},
			} as PayloadType,
			{},
			[],
		);
		expect(view.fields[0]?.value).toBe('');
		expect(view.safety).toEqual([]);
		const plain = formView(
			{ ...url, safety: undefined } as unknown as PayloadType,
			{ url: 'https://example.com/' },
			[],
		);
		expect(plain.safety).toEqual([]);
	});
});

describe('field values', () => {
	it('starts every kind of field empty, or at its default', () => {
		const vcard = payloads.require('vcard');
		const fields = fieldsFor(vcard);
		for (const field of vcard.fields) expect(fields[field.key]).toEqual(emptyValue(field));
		expect(emptyValue({ key: 'n', kind: 'number', labelKey: 'x' })).toBeNull();
		expect(emptyValue({ key: 'b', kind: 'boolean', labelKey: 'x' })).toBe(false);
		expect(emptyValue({ key: 'm', kind: 'tel', labelKey: 'x', multiple: true })).toEqual([]);
		expect(emptyValue({ key: 'd', kind: 'text', labelKey: 'x', default: 'hi' })).toBe('hi');
	});

	it('moves a value only to a field of its kind', () => {
		const select = {
			key: 's',
			kind: 'select' as const,
			labelKey: 'x',
			options: [{ value: 'a', labelKey: 'y' }],
		};
		expect(fitsField(select, 'a')).toBe(true);
		expect(fitsField(select, 'b')).toBe(false);
		expect(fitsField(select, '')).toBe(true);
		expect(fitsField({ key: 'n', kind: 'number', labelKey: 'x' }, null)).toBe(true);
		expect(fitsField({ key: 't', kind: 'text', labelKey: 'x' }, null)).toBe(false);
		expect(fitsField({ key: 't', kind: 'text', labelKey: 'x' }, ['a'])).toBe(false);
		expect(fitsField({ key: 't', kind: 'text', labelKey: 'x', multiple: true }, ['a'])).toBe(true);
		expect(fitsField({ key: 'b', kind: 'boolean', labelKey: 'x' }, true)).toBe(true);
		expect(fitsField({ key: 'n', kind: 'number', labelKey: 'x' }, 'one')).toBe(false);
		expect(fitsField({ key: 't', kind: 'text', labelKey: 'x' }, 1)).toBe(false);
		expect(isFieldValue(['a', 1])).toBe(false);
		expect(isFieldValue(undefined)).toBe(false);
		expect(isFieldValue(Number.NaN)).toBe(true);
	});
});
