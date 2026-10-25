/**
 * A place: the geo: URI (RFC 5870), geo:latitude,longitude[,altitude][;u=metres].
 *
 * Coordinates are WGS 84, the RFC's default, so ;crs= is never written and a
 * code that names another system is refused rather than drawn in the wrong
 * place. Numbers are written in plain decimal, never in exponent form.
 *
 * Map links from Google Maps, Apple Maps and OpenStreetMap are read too, when
 * the coordinates are in the link itself, because that is how most printed
 * "find us" codes are made. A link that names only a place or an address
 * cannot be turned into coordinates without asking the map service, so it is
 * left to the plain link type. The forms read are those in each service's
 * own documentation: Google Maps URLs (developers.google.com/maps/documentation/urls/get-started),
 * Apple Map Links (developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html)
 * and OpenStreetMap's permalinks (wiki.openstreetmap.org/wiki/Browsing#Sharing_a_link_to_the_maps).
 */

import { definePayload, field, unparseable } from '../define.js';
import { numberOf, plainNumber } from '../fields.js';

const ID = 'geo';

export type GeoValue = {
	readonly latitude: number | null;
	readonly longitude: number | null;
	readonly altitude: number | null;
	readonly uncertainty: number | null;
};

function write(value: GeoValue): string {
	const coordinates = [numberOf(value, 'latitude'), numberOf(value, 'longitude')] as number[];
	const altitude = numberOf(value, 'altitude');
	if (altitude !== null) coordinates.push(altitude);
	const uncertainty = numberOf(value, 'uncertainty');
	return `geo:${coordinates.map(plainNumber).join(',')}${uncertainty === null ? '' : `;u=${plainNumber(uncertainty)}`}`;
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;

function coordinatePair(lat: string, lon: string): GeoValue | undefined {
	if (!NUMBER.test(lat) || !NUMBER.test(lon)) return undefined;
	const latitude = Number(lat);
	const longitude = Number(lon);
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
	return { latitude, longitude, altitude: null, uncertainty: null };
}

function parseGeoUri(text: string): GeoValue {
	const [withoutQuery = '', query] = text.slice(4).split('?');
	const [coordinates = '', ...params] = withoutQuery.split(';');
	const parts = coordinates.split(',');
	if (parts.length < 2 || parts.length > 3) throw unparseable(ID, 'coordinates');
	const pair = coordinatePair(parts[0] as string, parts[1] as string);
	if (pair === undefined) throw unparseable(ID, 'coordinates');
	let altitude: number | null = null;
	if (parts.length === 3) {
		if (!NUMBER.test(parts[2] as string)) throw unparseable(ID, 'altitude');
		altitude = Number(parts[2]);
	}
	let uncertainty: number | null = null;
	for (const param of params) {
		const [name = '', raw = ''] = param.split('=');
		const key = name.toLowerCase();
		if (key === 'crs' && raw.toLowerCase() !== 'wgs84') throw unparseable(ID, 'unsupported-crs');
		if (key === 'u') {
			if (!/^\d+(?:\.\d+)?$/.test(raw)) throw unparseable(ID, 'uncertainty');
			uncertainty = Number(raw);
		}
	}
	// Android writes geo:0,0?q=lat,lng(label) to drop a pin, which is not in
	// RFC 5870 but is the common way to carry a marker. The pin is the place.
	if (pair.latitude === 0 && pair.longitude === 0 && query !== undefined) {
		const pin = /^q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(query);
		const marked = pin ? coordinatePair(pin[1] as string, pin[2] as string) : undefined;
		if (marked) return { ...marked, altitude, uncertainty };
	}
	return { ...pair, altitude, uncertainty };
}

/** "lat,lng" as Google's q= and query= and Apple's ll= carry it. */
function pairFrom(text: string | null): GeoValue | undefined {
	if (text === null) return undefined;
	const [lat = '', lon = '', ...rest] = text.split(',').map((part) => part.trim());
	return rest.length === 0 ? coordinatePair(lat, lon) : undefined;
}

function fromMapLink(text: string): GeoValue | undefined {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
	const host = url.hostname.replace(/^www\./, '');
	const query = url.searchParams;
	if (host === 'google.com' || host === 'maps.google.com') {
		if (host === 'google.com' && !url.pathname.startsWith('/maps')) return undefined;
		const at = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
		return (
			pairFrom(query.get('query')) ??
			pairFrom(query.get('q')) ??
			pairFrom(query.get('ll')) ??
			(at ? coordinatePair(at[1] as string, at[2] as string) : undefined)
		);
	}
	if (host === 'maps.apple.com') return pairFrom(query.get('ll')) ?? pairFrom(query.get('q'));
	if (host === 'openstreetmap.org') {
		const marker = coordinatePair(query.get('mlat') ?? '', query.get('mlon') ?? '');
		if (marker) return marker;
		const map = /^#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
		return map ? coordinatePair(map[1] as string, map[2] as string) : undefined;
	}
	return undefined;
}

function parse(text: string): GeoValue {
	if (/^geo:/i.test(text)) return parseGeoUri(text);
	const fromLink = fromMapLink(text);
	if (fromLink === undefined) throw unparseable(ID, 'not-geo');
	return fromLink;
}

export const geoType = definePayload<GeoValue>({
	id: ID,
	category: 'place',
	fields: [
		field(ID, 'latitude', 'latitude', { required: true }),
		field(ID, 'longitude', 'longitude', { required: true }),
		field(ID, 'altitude', 'number', { advanced: true, min: -11000, max: 100000, hint: true }),
		field(ID, 'uncertainty', 'number', { advanced: true, min: 0, max: 20000000, hint: true }),
	],
	write,
	detect: (text) => {
		if (/^geo:/i.test(text)) return 1;
		return fromMapLink(text) === undefined ? 0 : 0.7;
	},
	parse,
	vectors: [
		{
			text: 'geo:13.4125,103.8667',
			value: { latitude: 13.4125, longitude: 103.8667, altitude: null, uncertainty: null },
			source: 'RFC 5870 section 1.',
		},
		{
			text: 'geo:48.2010,16.3695,183',
			value: { latitude: 48.201, longitude: 16.3695, altitude: 183, uncertainty: null },
			source: 'RFC 5870 section 6.2.',
		},
		{
			text: 'geo:48.198634,16.371648;crs=wgs84;u=40',
			value: { latitude: 48.198634, longitude: 16.371648, altitude: null, uncertainty: 40 },
			source: 'RFC 5870 section 6.2.',
		},
	],
});
