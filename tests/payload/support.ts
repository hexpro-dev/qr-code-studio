/**
 * Values for the property tests, generated from each type's field schema.
 *
 * Every field gets a generator for its kind, so a new field is covered the
 * moment it is added. A few types have fields that depend on each other (a
 * Wi-Fi password depends on the security, a Swiss QR reference on the
 * account), and for those a `refine` step adjusts the generated record so
 * that a useful share of values validate. Nothing here is a real person's
 * data: names come from a fixed alphabet, addresses are at example.com, and
 * numbers are generated digits.
 */

import fc from 'fast-check';
import { creditorReferenceFor, ibanWithCheckDigits } from '../../src/payload/banking.js';
import { base58CheckEncode } from '../../src/payload/base58.js';
import { bech32Encode, convertBits } from '../../src/payload/bech32.js';
import { gs1CheckDigit, mod10Recursive } from '../../src/payload/check-digits.js';
import { addDays } from '../../src/payload/content/event.js';
import type {
	FieldSchema,
	FieldValue,
	PayloadType,
	PayloadValue,
} from '../../src/payload/types.js';

/** Characters every escaping rule has an opinion about, plus some that need UTF-8. */
const TEXT_CHARS = [...'abcXYZ019 \\;,:"\'&=?#%+/-.éü中😀'];
const LATIN_CHARS = [...'abcXYZ019 ;,:"\'&=?#%+/-.éüßŠ€'];

const text = (max: number, chars: readonly string[] = TEXT_CHARS, min = 0) =>
	fc.string({ unit: fc.constantFrom(...chars), minLength: min, maxLength: Math.max(min, max) });

const digits = (min: number, max = min) =>
	fc
		.array(fc.constantFrom(...'0123456789'), { minLength: min, maxLength: max })
		.map((d) => d.join(''));

const tel = digits(6, 12).map((d) => `+6${d}`);

const email = fc
	.tuple(
		fc.stringMatching(/^[a-z0-9]{1,8}$/),
		fc.constantFrom('', '+tag', '.x', '%y'),
		fc.constantFrom('example.com', 'example.org'),
	)
	.map(([local, extra, domain]) => `${local}${extra}@${domain}`);

const url = fc
	.tuple(
		fc.constantFrom('https', 'http'),
		fc.constantFrom('example.com', 'example.org', 'sub.example.com'),
		fc.stringMatching(/^[a-z0-9/-]{0,12}$/),
		fc.option(fc.stringMatching(/^[a-z]{1,4}=[a-z0-9%]{0,4}$/), { nil: undefined }),
		fc.option(fc.stringMatching(/^[a-z]{1,4}$/), { nil: undefined }),
	)
	.map(([scheme, host, path, query, fragment]) => {
		const clean = path.replace(/%(?![0-9A-F]{2})/g, '');
		return `${scheme}://${host}/${clean}${query === undefined ? '' : `?${query.replace(/%/g, '')}`}${fragment === undefined ? '' : `#${fragment}`}`;
	});

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

const date = fc
	.tuple(
		fc.integer({ min: 1900, max: 2100 }),
		fc.integer({ min: 1, max: 12 }),
		fc.integer({ min: 1, max: 28 }),
	)
	.map(([y, m, d]) => `${y}-${pad(m)}-${pad(d)}`);

const datetime = fc
	.tuple(
		date,
		fc.integer({ min: 0, max: 23 }),
		fc.integer({ min: 0, max: 59 }),
		fc.integer({ min: 0, max: 59 }),
	)
	.map(([d, h, m, s]) => `${d}T${pad(h)}:${pad(m)}${s === 0 ? '' : `:${pad(s)}`}`);

const iban = fc.oneof(
	digits(18).map((bban) => ibanWithCheckDigits('DE', bban)),
	digits(17).map((bban) => ibanWithCheckDigits('CH', bban)),
	fc
		.tuple(fc.stringMatching(/^[A-Z]{4}$/), digits(14))
		.map(([bank, rest]) => ibanWithCheckDigits('GB', `${bank}${rest}`)),
);

const bic = fc.stringMatching(/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/);

function generic(field: FieldSchema): fc.Arbitrary<FieldValue> {
	const max = Math.min(field.maxLength ?? 24, 24);
	switch (field.kind) {
		case 'text':
			return text(max);
		case 'multiline':
			return text(max, [...TEXT_CHARS, '\n', '\t']);
		case 'secret':
			return fc.stringMatching(/^[\x20-\x7e]{8,20}$/);
		case 'url':
			return url;
		case 'email':
			return email;
		case 'tel':
			return tel;
		case 'date':
			return date;
		case 'datetime':
			return datetime;
		case 'select':
			return fc.constantFrom(...(field.options ?? []).map((option) => option.value));
		case 'boolean':
			return fc.boolean();
		case 'iban':
			return iban;
		case 'bic':
			return bic;
		case 'currency':
			return fc.constant('EUR');
		case 'country':
			return fc.constantFrom('CH', 'LI', 'DE', 'AU');
		case 'latitude':
			return fc.integer({ min: -90_000_000, max: 90_000_000 }).map((n) => n / 1e6);
		case 'longitude':
			return fc.integer({ min: -180_000_000, max: 180_000_000 }).map((n) => n / 1e6);
		case 'amount': {
			const min = Math.ceil((field.min ?? 0.01) * 100);
			const top = Math.floor((field.max ?? 1e6) * 100);
			return fc.integer({ min, max: Math.min(top, 99_999_999_999) }).map((cents) => cents / 100);
		}
		case 'integer':
			return fc.integer({ min: field.min ?? -1000, max: field.max ?? 1000 });
		case 'number':
			return fc.double({
				min: field.min ?? -1e6,
				max: field.max ?? 1e6,
				noNaN: true,
				noDefaultInfinity: true,
			});
	}
}

function empty(field: FieldSchema): FieldValue {
	if (field.multiple) return [];
	if (field.kind === 'boolean') return false;
	return ['number', 'integer', 'amount', 'latitude', 'longitude'].includes(field.kind) ? null : '';
}

/** A generator for one field: its kind's generator, a list of them, or sometimes empty when optional. */
export function fieldArbitrary(
	field: FieldSchema,
	override?: fc.Arbitrary<FieldValue>,
): fc.Arbitrary<FieldValue> {
	const one = override ?? generic(field);
	// A list field's items are text of its kind, so the array is a FieldValue.
	const value: fc.Arbitrary<FieldValue> = field.multiple
		? (fc.array(one, { maxLength: Math.min(field.maxItems ?? 3, 3) }) as fc.Arbitrary<FieldValue>)
		: one;
	if (field.required || field.kind === 'boolean' || field.kind === 'select') return value;
	return fc.oneof(
		{ arbitrary: fc.constant(empty(field)), weight: 1 },
		{ arbitrary: value, weight: 2 },
	);
}

interface Tuning {
	readonly overrides?: Readonly<Record<string, fc.Arbitrary<FieldValue>>>;
	/** Adjust a generated record so its dependent fields agree; gets a second random record to draw from. */
	readonly refine?: (value: Record<string, FieldValue>) => fc.Arbitrary<Record<string, FieldValue>>;
}

const qrIban = digits(12).map((rest) => ibanWithCheckDigits('CH', `30000${rest}`));
const plainChIban = digits(12).map((rest) => ibanWithCheckDigits('CH', `00762${rest}`));
const qrReference = digits(26).map((body) => `${body}${mod10Recursive(body)}`);
const creditorReference = fc.stringMatching(/^[A-Z0-9]{1,15}$/).map(creditorReferenceFor);

const btcAddress = fc.oneof(
	fc
		.tuple(fc.constantFrom(0x00, 0x05), fc.uint8Array({ minLength: 20, maxLength: 20 }))
		.map(([version, hash]) => base58CheckEncode(Uint8Array.from([version, ...hash]))),
	fc
		.uint8Array({ minLength: 20, maxLength: 20 })
		.map((program) =>
			bech32Encode('bc', [0, ...(convertBits([...program], 8, 5, true) as number[])], 'bech32'),
		),
	fc
		.uint8Array({ minLength: 32, maxLength: 32 })
		.map((program) =>
			bech32Encode('bc', [1, ...(convertBits([...program], 8, 5, true) as number[])], 'bech32m'),
		),
);

const invoice = fc
	.tuple(
		fc.constantFrom('', '10u', '2500u', '1m', '20n'),
		fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 111, maxLength: 200 }),
	)
	.map(([amount, words]) => bech32Encode(`lnbc${amount}`, words, 'bech32'));

const gtin = fc
	.oneof(digits(13), digits(12), digits(11), digits(7))
	.map((body) => `${body}${gs1CheckDigit(body)}`);

const set82 = text(10, [...'abcXYZ019!"%&\'()*+,-./:;<=>?_']);
const gs1Date = fc
	.tuple(
		fc.integer({ min: 0, max: 99 }),
		fc.integer({ min: 1, max: 12 }),
		fc.integer({ min: 0, max: 28 }),
	)
	.map(([y, m, d]) => `${pad(y)}${pad(m)}${pad(d)}`);

const TUNING: Readonly<Record<string, Tuning>> = {
	email: {
		refine: (value) =>
			fc.constant(
				[value.to, value.cc, value.bcc].every((list) => (list as string[]).length === 0)
					? { ...value, to: ['someone@example.com'] }
					: value,
			),
	},
	telegram: {
		overrides: { username: fc.stringMatching(/^[A-Za-z0-9_]{5,12}$/) },
		refine: (value) =>
			value.target === 'phone'
				? tel.map((phone) => ({ ...value, username: '', phone }))
				: fc
						.stringMatching(/^[A-Za-z0-9_]{5,12}$/)
						.map((username) => ({ ...value, username, phone: '' })),
	},
	facetime: { overrides: { contact: fc.oneof(tel, email) } },
	wifi: {
		overrides: { ssid: text(8, TEXT_CHARS, 1) },
		refine: (value) => {
			const eap = { eapMethod: '', phase2: '', identity: '', anonymousIdentity: '' };
			switch (value.security) {
				case 'nopass':
					return fc.constant({ ...value, password: '', ...eap });
				case 'wep':
					return fc
						.stringMatching(/^[\x20-\x7e]{5}$/)
						.map((password) => ({ ...value, password, ...eap }));
				case 'wpa2-eap':
					return fc.constant({
						...value,
						eapMethod: value.eapMethod === '' ? 'peap' : value.eapMethod,
					});
				default:
					return fc.constant({ ...value, ...eap });
			}
		},
	},
	vcard: {
		refine: (value) =>
			fc.constant(
				value.givenName === '' && value.organisation === ''
					? { ...value, givenName: 'Alex' }
					: value,
			),
	},
	mecard: {
		refine: (value) =>
			fc.constant(
				value.familyName === '' && value.givenName === ''
					? { ...value, familyName: 'Example' }
					: value,
			),
	},
	event: {
		refine: (value) => {
			if (value.timing === 'all-day') {
				return fc
					.tuple(date, fc.option(fc.integer({ min: 0, max: 400 }), { nil: undefined }))
					.map(([startDate, days]) => ({
						...value,
						start: '',
						end: '',
						startDate,
						endDate: days === undefined ? '' : addDays(startDate, days),
					}));
			}
			return fc.tuple(datetime, fc.boolean()).map(([start, withEnd]) => ({
				...value,
				start,
				end: withEnd ? `${String(Number(start.slice(0, 4)) + 1)}${start.slice(4)}` : '',
				startDate: '',
				endDate: '',
			}));
		},
	},
	bitcoin: { overrides: { address: btcAddress } },
	lightning: { overrides: { invoice } },
	epc: {
		overrides: {
			reference: creditorReference,
			purpose: fc.stringMatching(/^[A-Z]{4}$/),
		},
		refine: (value) =>
			fc.constant({
				...value,
				message: value.reference === '' ? value.message : '',
				version: value.bic === '' ? '002' : value.version,
			}),
	},
	'swiss-qr-bill': {
		overrides: Object.fromEntries(
			[
				'creditorName',
				'creditorStreet',
				'creditorBuilding',
				'debtorName',
				'debtorStreet',
				'debtorBuilding',
				'message',
				'billingInformation',
				'alternative1',
				'alternative2',
			].map((key) => [key, text(16, LATIN_CHARS)]),
		),
		refine: (value) =>
			fc
				.tuple(
					fc.boolean(),
					qrIban,
					plainChIban,
					qrReference,
					creditorReference,
					fc.boolean(),
					text(10, LATIN_CHARS, 1),
					text(10, LATIN_CHARS, 1),
				)
				.map(([useQr, qr, plain, qrr, scor, withDebtor, postcode, town]) => {
					const debtor: Record<string, FieldValue> = withDebtor
						? {
								debtorName: 'Pia Example',
								debtorPostcode: postcode,
								debtorTown: town,
								debtorCountry: 'CH',
							}
						: {
								debtorName: '',
								debtorStreet: '',
								debtorBuilding: '',
								debtorPostcode: '',
								debtorTown: '',
								debtorCountry: '',
							};
					const reference: Record<string, FieldValue> = useQr
						? { iban: qr, referenceType: 'qrr', reference: qrr, currency: 'chf' }
						: value.referenceType === 'scor'
							? { iban: plain, reference: scor }
							: { iban: plain, referenceType: 'non', reference: '' };
					return {
						...value,
						creditorName: value.creditorName === '' ? 'Example AG' : value.creditorName,
						creditorPostcode: postcode,
						creditorTown: town,
						creditorAddressType: 's',
						debtorAddressType: 's',
						...debtor,
						...reference,
					};
				}),
	},
	pix: {
		overrides: {
			key: fc.oneof(
				fc.uuid().map((id) => id.toLowerCase()),
				email,
				digits(11).map((d) => `+55${d}`),
			),
			name: text(25, [...'abcXYZ019 .-']),
			city: text(15, [...'abcXYZ ']),
			txid: fc.stringMatching(/^[A-Za-z0-9]{1,25}$/),
			description: text(20, [...'abcXYZ019 .-']),
		},
		refine: (value) =>
			fc.constant({
				...value,
				name: value.name === '' ? 'Example' : value.name,
				city: value.city === '' ? 'Example' : value.city,
			}),
	},
	upi: { overrides: { address: fc.stringMatching(/^[a-z0-9.]{3,10}@[a-z]{3,8}$/) } },
	'gs1-digital-link': {
		overrides: {
			domain: fc.constantFrom('id.gs1.org', 'example.com', 'example.com/gs1'),
			gtin,
			batch: set82,
			serial: set82,
			expiry: gs1Date,
			bestBefore: gs1Date,
		},
	},
};

/** A generator of values for a type, from its schema and its tuning. */
export function valueArbitrary(type: PayloadType): fc.Arbitrary<PayloadValue> {
	const tuning = TUNING[type.id] ?? {};
	const record = fc.record(
		Object.fromEntries(
			type.fields.map((field) => [field.key, fieldArbitrary(field, tuning.overrides?.[field.key])]),
		),
	) as fc.Arbitrary<Record<string, FieldValue>>;
	return tuning.refine ? record.chain(tuning.refine) : record;
}

/**
 * The value a type is expected to read back: what it wrote, less the
 * differences that carry no meaning. Each is a normalisation the type's own
 * comments describe.
 */
export function canonical(type: PayloadType, input: PayloadValue): PayloadValue {
	// Negative zero is written as 0, and reads back as 0.
	const value = Object.fromEntries(
		Object.entries(input).map(([key, item]) => [key, Object.is(item, -0) ? 0 : item]),
	) as PayloadValue;
	switch (type.id) {
		case 'vcard': {
			const parts = ['prefix', 'givenName', 'additionalNames', 'familyName', 'suffix']
				.map((key) => value[key] as string)
				.filter(Boolean);
			const derived = parts.length > 0 ? parts.join(' ') : (value.organisation as string);
			const hasAddress = ['street', 'locality', 'region', 'postcode', 'country'].some(
				(key) => value[key] !== '',
			);
			return {
				...value,
				formattedName: value.formattedName === derived ? '' : value.formattedName,
				addressType: hasAddress ? (value.addressType === 'home' ? 'home' : 'work') : 'work',
			};
		}
		case 'swiss-qr-bill': {
			const hasDebtor = [
				'debtorName',
				'debtorStreet',
				'debtorBuilding',
				'debtorPostcode',
				'debtorTown',
			].some((key) => value[key] !== '');
			return { ...value, debtorCountry: hasDebtor ? value.debtorCountry : '' };
		}
		case 'gs1-digital-link':
			return { ...value, gtin: (value.gtin as string).padStart(14, '0') };
		default:
			return value;
	}
}
