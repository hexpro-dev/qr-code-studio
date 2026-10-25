/**
 * Neighbour masks: which of a module's eight neighbours are drawn.
 *
 * Bit 0 is north and the bits go clockwise, so the four edge neighbours are
 * the even bits and the corners the odd ones. A connecting shape (bars,
 * fluid) reads the mask to decide which sides to join and which corners to
 * round, and conformance draws every one of the 256 masks.
 */

export const NORTH = 1 << 0;
export const NORTH_EAST = 1 << 1;
export const EAST = 1 << 2;
export const SOUTH_EAST = 1 << 3;
export const SOUTH = 1 << 4;
export const SOUTH_WEST = 1 << 5;
export const WEST = 1 << 6;
export const NORTH_WEST = 1 << 7;

/** The offset of each bit's neighbour, in bit order. */
export const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = Object.freeze([
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
]);

/**
 * The mask of every cell in a grid, over `drawn`, one byte a cell, row
 * major. Anything outside the grid counts as not drawn, as the quiet zone is.
 */
export function neighbourMasks(width: number, height: number, drawn: Uint8Array): Uint8Array {
	const masks = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let mask = 0;
			for (let bit = 0; bit < 8; bit += 1) {
				const [dx, dy] = NEIGHBOUR_OFFSETS[bit] as readonly [number, number];
				const nx = x + dx;
				const ny = y + dy;
				if (nx >= 0 && ny >= 0 && nx < width && ny < height && drawn[ny * width + nx] === 1) {
					mask |= 1 << bit;
				}
			}
			masks[y * width + x] = mask;
		}
	}
	return masks;
}
