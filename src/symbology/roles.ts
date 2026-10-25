/**
 * Module roles as small integers, so a layout's role map is one byte a module.
 *
 * `data` is 0, which makes a fresh `Uint8Array` a map of data modules that
 * the function patterns are then stamped onto. The codes are part of the
 * layout's contract (design and verify read them), so they never change once
 * written; a new role gets the next number.
 */

import type { ModuleRole } from './types.js';

export const ROLE_CODES: Readonly<Record<ModuleRole, number>> = Object.freeze({
	data: 0,
	finder: 1,
	separator: 2,
	timing: 3,
	alignment: 4,
	format: 5,
	version: 6,
	'dark-module': 7,
	'sub-finder': 8,
	'corner-finder': 9,
});

/** The inverse of ROLE_CODES: index a code to get its role. */
export const ROLES: readonly ModuleRole[] = Object.freeze(
	(Object.keys(ROLE_CODES) as ModuleRole[]).sort((a, b) => ROLE_CODES[a] - ROLE_CODES[b]),
);

/** The role of the module at x, y. */
export function roleAt(
	layout: { readonly width: number; readonly height: number; readonly roles: Uint8Array },
	x: number,
	y: number,
): ModuleRole {
	if (
		!Number.isInteger(x) ||
		!Number.isInteger(y) ||
		x < 0 ||
		y < 0 ||
		x >= layout.width ||
		y >= layout.height
	) {
		throw new RangeError(`${x}, ${y} is outside a ${layout.width} by ${layout.height} layout`);
	}
	return ROLES[layout.roles[y * layout.width + x] as number] as ModuleRole;
}
