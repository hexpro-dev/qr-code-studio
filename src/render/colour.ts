/**
 * Colours, and the allow-list every colour in an export passes through.
 *
 * A colour reaches an SVG attribute from a design file, and a design file can
 * come from a link somebody was sent. So the only text accepted is hex, by
 * length, and the only text written is `#rrggbb` built from three numbers this
 * module has checked. Nothing a person typed is ever copied into the markup:
 * `rgb()`, named colours, `var()` and `url()` are refused here, before any of
 * them could be a way out of an attribute or out of the document.
 */

import type { Colour } from './types.js';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Parse a colour the allow-list accepts: #rgb, #rgba, #rrggbb, #rrggbbaa. TypeError otherwise. */
export function parseColour(text: string): Colour {
	if (typeof text !== 'string' || !HEX.test(text)) {
		// The value is not repeated back: it came from a design file, and a
		// message is the string that ends up in a bug report.
		throw new TypeError(
			'parseColour: a colour is written #rgb, #rgba, #rrggbb or #rrggbbaa in hex digits.',
		);
	}
	const digits = text.slice(1);
	const short = digits.length <= 4;
	const channel = (i: number): number => {
		if (short) {
			const nibble = parseInt(digits[i] as string, 16);
			return nibble * 17;
		}
		return parseInt(digits.slice(i * 2, i * 2 + 2), 16);
	};
	const hasAlpha = digits.length === 4 || digits.length === 8;
	return {
		r: channel(0),
		g: channel(1),
		b: channel(2),
		a: hasAlpha ? channel(3) / 255 : 1,
	};
}

function hex2(value: number): string {
	return (value < 16 ? '0' : '') + value.toString(16);
}

/**
 * The colour as `#rrggbb`, or `#rrggbbaa` when it is not opaque.
 *
 * Alpha is rounded to the nearest of the 256 steps a hex colour has, so a
 * colour parsed from eight digits comes back as the same eight digits.
 */
export function formatColour(colour: Colour): string {
	checkColour(colour, 'formatColour');
	const rgb = `#${hex2(colour.r)}${hex2(colour.g)}${hex2(colour.b)}`;
	if (colour.a === 1) return rgb;
	return rgb + hex2(Math.round(colour.a * 255));
}

function isChannel(value: unknown): boolean {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Throw a TypeError unless `colour` is one the writers can reproduce exactly.
 *
 * Channels are whole numbers because a hex colour cannot say 127.5, and an SVG
 * that rounded it while the rasteriser did not would draw a different picture.
 */
export function checkColour(colour: Colour, where: string): void {
	if (typeof colour !== 'object' || colour === null) {
		throw new TypeError(`${where}: a colour is an object with r, g, b and a.`);
	}
	if (!isChannel(colour.r) || !isChannel(colour.g) || !isChannel(colour.b)) {
		throw new TypeError(`${where}: r, g and b are whole numbers from 0 to 255.`);
	}
	if (typeof colour.a !== 'number' || !(colour.a >= 0 && colour.a <= 1)) {
		throw new TypeError(`${where}: a is a number from 0 to 1.`);
	}
}
