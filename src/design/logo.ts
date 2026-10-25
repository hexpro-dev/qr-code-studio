/**
 * Placing a logo, and working out which modules it costs.
 *
 * The logo box is a whole number of modules, centred exactly, so the logo's
 * edges fall on module edges and the modules round it are either wholly
 * clear or wholly drawn: a module half under a plate is a module a reader
 * gets wrong half the time. Then `clear` decides what is left out:
 *
 * - 'none' keeps every module and draws the logo over them;
 * - 'box' leaves out every module under the padded box (and the plate);
 * - 'shape' leaves out the modules under the logo's own silhouette, holes
 *   filled, grown by the padding (and under the plate).
 *
 * `obscured` is every module the logo or its plate hides or changes, light
 * or dark, because what verify needs to know is which codeword bits a reader
 * cannot see, whatever colour they were meant to be. Padding is in modules
 * and may be fractional; a module counts as under an area when any part of
 * it, with area, is.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { RgbaImage } from '../core/image.js';
import type { Prng } from '../core/prng.js';
import type { DesignRegistries } from './types.js';
import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { rasterise } from '../render/raster.js';
import type { SceneNode } from '../render/types.js';
import { ROLE_CODES } from '../symbology/roles.js';
import { LIMITS } from './document.js';
import { resolvePaint } from './paint.js';
import type { Box, DesignLogo, DesignPaint, QrDesignV1 } from './types.js';

/** Samples a module the silhouette is taken at. */
const SAMPLES = 8;

export interface LogoPlacement {
	/** 1 where the module shape is not drawn, row major over the symbol. */
	readonly removed: Uint8Array;
	readonly obscured: Uint8Array;
	/** The plate, then the logo, in scene units. */
	readonly nodes: readonly SceneNode[];
	readonly issues: readonly Issue[];
	/** The logo box and padded box, in symbol modules, when a logo was placed. */
	readonly box: Box | null;
	readonly padded: Box | null;
}

/** The largest whole number of modules near `target` that centres exactly in `side`. */
export function snapToGrid(target: number, side: number, limit: number): number {
	let n = Math.round(target);
	if ((side - n) % 2 !== 0) n += n < target ? 1 : -1;
	while (n > limit) n -= 2;
	return n;
}

/** Does the module square at (x, y) share area with the rectangle? */
function hitsRect(x: number, y: number, r: Box): boolean {
	return x < r.x + r.width && x + 1 > r.x && y < r.y + r.height && y + 1 > r.y;
}

/** The distance from a point to the module square at (x, y). */
function toSquare(px: number, py: number, x: number, y: number): number {
	const dx = px < x ? x - px : px > x + 1 ? px - x - 1 : 0;
	const dy = py < y ? y - py : py > y + 1 ? py - y - 1 : 0;
	return Math.sqrt(dx * dx + dy * dy);
}

/** The distance between the module square at (x, y) and a rectangle. */
function squareToRect(x: number, y: number, r: Box): number {
	const dx = Math.max(r.x - (x + 1), x - (r.x + r.width), 0);
	const dy = Math.max(r.y - (y + 1), y - (r.y + r.height), 0);
	return Math.sqrt(dx * dx + dy * dy);
}

interface Plate {
	readonly path: Path;
	/** True where the plate covers part of the module square at (x, y). */
	readonly hits: (x: number, y: number) => boolean;
	readonly box: Box;
}

function plateFor(
	shape: 'square' | 'rounded' | 'circle',
	padded: Box,
	logo: Box,
	icon: boolean,
): Plate {
	if (shape === 'square') {
		return {
			path: new PathBuilder().rect(padded.x, padded.y, padded.width, padded.height).build(),
			hits: (x, y) => hitsRect(x, y, padded),
			box: padded,
		};
	}
	if (shape === 'rounded') {
		const r = Math.min(padded.width, padded.height) * 0.2;
		const core: Box = {
			x: padded.x + r,
			y: padded.y + r,
			width: padded.width - 2 * r,
			height: padded.height - 2 * r,
		};
		return {
			path: new PathBuilder()
				.roundedRect(padded.x, padded.y, padded.width, padded.height, r)
				.build(),
			hits: (x, y) => squareToRect(x, y, core) < r,
			box: padded,
		};
	}
	// An icon's artwork is round enough for the circle inside its box; a
	// picture fills its box to the corners, so its circle goes round them.
	const pad = (padded.width - logo.width) / 2;
	const r =
		(icon
			? Math.max(logo.width, logo.height) / 2
			: Math.sqrt(logo.width * logo.width + logo.height * logo.height) / 2) + pad;
	const cx = logo.x + logo.width / 2;
	const cy = logo.y + logo.height / 2;
	return {
		path: new PathBuilder().circle(cx, cy, r).build(),
		hits: (x, y) => toSquare(cx, cy, x, y) < r,
		box: { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r },
	};
}

/**
 * The logo's silhouette over its box, `SAMPLES` a module: 1 where it is
 * inked. For 'shape' the holes are filled, by marking everything the box's
 * edge can reach without crossing ink and keeping the rest.
 */
function silhouette(
	logo: Box,
	draw: { readonly path: Path } | { readonly image: RgbaImage; readonly fit: Box },
	fill: boolean,
): { readonly cells: Uint8Array; readonly width: number; readonly height: number } {
	const width = logo.width * SAMPLES;
	const height = logo.height * SAMPLES;
	const cells = new Uint8Array(width * height);
	if ('path' in draw) {
		// The icon is drawn in its unit box, so it is scaled straight onto the
		// sample grid over the logo box.
		const placed = new PathBuilder()
			.transform([logo.width * SAMPLES, 0, 0, logo.height * SAMPLES, 0, 0])
			.append(draw.path)
			.build();
		const image = rasterise(
			{
				width,
				height,
				background: null,
				layers: [
					{
						kind: 'path',
						path: placed,
						paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
					},
				],
			},
			{ width, height },
		);
		for (let i = 0; i < cells.length; i += 1)
			cells[i] = (image.data[i * 4 + 3] as number) >= 128 ? 1 : 0;
	} else {
		const { image, fit } = draw;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const ux = logo.x + (x + 0.5) / SAMPLES;
				const uy = logo.y + (y + 0.5) / SAMPLES;
				if (ux < fit.x || uy < fit.y || ux >= fit.x + fit.width || uy >= fit.y + fit.height)
					continue;
				const px = Math.min(Math.floor(((ux - fit.x) / fit.width) * image.width), image.width - 1);
				const py = Math.min(
					Math.floor(((uy - fit.y) / fit.height) * image.height),
					image.height - 1,
				);
				if ((image.data[(py * image.width + px) * 4 + 3] as number) >= 128)
					cells[y * width + x] = 1;
			}
		}
	}
	if (!fill) return { cells, width, height };
	const outside = new Uint8Array(width * height);
	const stack: number[] = [];
	const visit = (x: number, y: number): void => {
		const at = y * width + x;
		if (cells[at] === 1 || outside[at] === 1) return;
		outside[at] = 1;
		stack.push(at);
	};
	for (let x = 0; x < width; x += 1) {
		visit(x, 0);
		visit(x, height - 1);
	}
	for (let y = 0; y < height; y += 1) {
		visit(0, y);
		visit(width - 1, y);
	}
	while (stack.length > 0) {
		const at = stack.pop() as number;
		const x = at % width;
		const y = (at - x) / width;
		if (x > 0) visit(x - 1, y);
		if (x < width - 1) visit(x + 1, y);
		if (y > 0) visit(x, y - 1);
		if (y < height - 1) visit(x, y + 1);
	}
	const filled = new Uint8Array(width * height);
	for (let i = 0; i < filled.length; i += 1) filled[i] = outside[i] === 1 ? 0 : 1;
	return { cells: filled, width, height };
}

/** Roles a logo is never allowed over: everything a reader uses to find and orient the code. */
const PROTECTED = new Set<number>([
	ROLE_CODES.finder,
	ROLE_CODES.separator,
	ROLE_CODES.timing,
	ROLE_CODES.format,
	ROLE_CODES.version,
	ROLE_CODES['dark-module'],
	ROLE_CODES['sub-finder'],
	ROLE_CODES['corner-finder'],
]);

export interface LogoContext {
	readonly width: number;
	readonly height: number;
	/** The symbol's role map, which the logo is kept off the patterns of. */
	readonly roles: Uint8Array;
	/** Where the symbol's first module sits in the scene. */
	readonly sx: number;
	readonly sy: number;
	readonly registries: DesignRegistries;
	readonly assets: ((id: string) => RgbaImage | undefined) | undefined;
	readonly prng: Prng;
	/** Checks an entry paint and replaces it when its fill is missing. */
	readonly paint: (paint: DesignPaint, path: readonly (string | number)[]) => DesignPaint;
	/** The module colour, for an icon with no paint of its own. */
	readonly modulesPaint: DesignPaint;
}

function nothing(width: number, height: number, issues: Issue[]): LogoPlacement {
	return {
		removed: new Uint8Array(width * height),
		obscured: new Uint8Array(width * height),
		nodes: [],
		issues,
		box: null,
		padded: null,
	};
}

/** Where the logo goes, what it hides and what it draws. */
export function placeLogo(design: QrDesignV1, ctx: LogoContext): LogoPlacement {
	const { width, height, sx, sy } = ctx;
	const issues: Issue[] = [];
	const logo: DesignLogo | null = design.logo;
	if (logo === null) return nothing(width, height, issues);

	let draw: { readonly path: Path } | { readonly image: RgbaImage } | null = null;
	if (logo.source.kind === 'icon') {
		const icon = ctx.registries.icons.get(logo.source.id);
		if (icon === undefined) {
			issues.push(
				issue('design.issue.unknown-entry', ['logo', 'source', 'id'], 'warning', { kind: 'icon' }),
			);
		} else draw = { path: icon.path };
	} else {
		const image =
			design.assets?.[logo.source.id] === undefined ? undefined : ctx.assets?.(logo.source.id);
		if (image === undefined) {
			issues.push(issue('design.issue.asset-unavailable', ['logo', 'source', 'id'], 'warning'));
		} else draw = { image };
	}
	if (draw === null) return nothing(width, height, issues);

	const size = Math.min(Math.max(logo.size, LIMITS.logoSize.min), LIMITS.logoSize.max);
	const pad = Math.min(Math.max(logo.padding, LIMITS.logoPadding.min), LIMITS.logoPadding.max);
	const aspect = 'image' in draw ? draw.image.width / draw.image.height : 1;
	const icon = 'path' in draw;
	/** The logo box `across` modules wide, centred, and what it covers. */
	const placement = (across: number): { box: Box; padded: Box; plate: Plate | null } | null => {
		let boxWidth = snapToGrid(across, width, width - 2);
		let boxHeight = snapToGrid(boxWidth / aspect, height, height - 2);
		if (icon) {
			const side = Math.min(boxWidth, boxHeight);
			boxWidth = snapToGrid(side, width, width - 2);
			boxHeight = snapToGrid(side, height, height - 2);
		}
		if (boxWidth < 1 || boxHeight < 1) return null;
		const box: Box = {
			x: (width - boxWidth) / 2,
			y: (height - boxHeight) / 2,
			width: boxWidth,
			height: boxHeight,
		};
		const padded: Box = {
			x: box.x - pad,
			y: box.y - pad,
			width: box.width + 2 * pad,
			height: box.height + 2 * pad,
		};
		const plate = logo.plate === null ? null : plateFor(logo.plate.shape, padded, box, icon);
		return { box, padded, plate };
	};
	/** Does anything this placement covers belong to a pattern a reader finds the code by? */
	const blocks = (placed: { padded: Box; plate: Plate | null }): boolean => {
		const area = placed.plate === null ? placed.padded : placed.plate.box;
		const x0 = Math.max(Math.floor(Math.min(area.x, placed.padded.x)), 0);
		const y0 = Math.max(Math.floor(Math.min(area.y, placed.padded.y)), 0);
		const x1 = Math.min(
			Math.ceil(Math.max(area.x + area.width, placed.padded.x + placed.padded.width)),
			width,
		);
		const y1 = Math.min(
			Math.ceil(Math.max(area.y + area.height, placed.padded.y + placed.padded.height)),
			height,
		);
		for (let y = y0; y < y1; y += 1) {
			for (let x = x0; x < x1; x += 1) {
				if (!PROTECTED.has(ctx.roles[y * width + x] as number)) continue;
				if (hitsRect(x, y, placed.padded) || (placed.plate !== null && placed.plate.hits(x, y)))
					return true;
			}
		}
		return false;
	};
	// The logo is made smaller, two modules at a time so it stays centred,
	// until it and its plate are clear of the finders, timing, format and
	// version information. A reader can do without data a logo hides; it
	// cannot do without those.
	let across = size * width;
	let placed = placement(across);
	let shrunk = false;
	while (placed !== null && blocks(placed)) {
		across = placed.box.width - 2;
		placed = placement(across);
		shrunk = true;
	}
	if (placed === null) {
		issues.push(issue('design.issue.logo-too-small', ['logo', 'size'], 'warning'));
		return nothing(width, height, issues);
	}
	if (shrunk) issues.push(issue('design.issue.logo-shrunk', ['logo', 'size'], 'info'));
	const { box, padded, plate } = placed;

	// A picture keeps its proportions inside the box.
	let fit: Box = box;
	if ('image' in draw) {
		const scale = Math.min(box.width / draw.image.width, box.height / draw.image.height);
		const w = draw.image.width * scale;
		const h = draw.image.height * scale;
		fit = { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };
	}

	const removed = new Uint8Array(width * height);
	const obscured = new Uint8Array(width * height);
	const mark = (x: number, y: number, remove: boolean): void => {
		if (x < 0 || y < 0 || x >= width || y >= height) return;
		obscured[y * width + x] = 1;
		if (remove) removed[y * width + x] = 1;
	};
	const remove = logo.clear !== 'none';
	if (plate !== null) {
		const b = plate.box;
		for (let y = Math.floor(b.y); y < Math.ceil(b.y + b.height); y += 1) {
			for (let x = Math.floor(b.x); x < Math.ceil(b.x + b.width); x += 1) {
				if (plate.hits(x, y)) mark(x, y, remove);
			}
		}
	}
	if (logo.clear === 'box') {
		for (let y = Math.floor(padded.y); y < Math.ceil(padded.y + padded.height); y += 1) {
			for (let x = Math.floor(padded.x); x < Math.ceil(padded.x + padded.width); x += 1) {
				if (hitsRect(x, y, padded)) mark(x, y, true);
			}
		}
	} else {
		const shape = silhouette(
			box,
			'path' in draw ? draw : { image: draw.image, fit },
			logo.clear === 'shape',
		);
		const grow = logo.clear === 'shape' ? pad : 0;
		for (let j = 0; j < shape.height; j += 1) {
			for (let i = 0; i < shape.width; i += 1) {
				if (shape.cells[j * shape.width + i] !== 1) continue;
				const px = box.x + (i + 0.5) / SAMPLES;
				const py = box.y + (j + 0.5) / SAMPLES;
				const x0 = Math.floor(px - grow);
				const x1 = Math.floor(px + grow);
				const y0 = Math.floor(py - grow);
				const y1 = Math.floor(py + grow);
				for (let y = y0; y <= y1; y += 1) {
					for (let x = x0; x <= x1; x += 1) {
						if (grow === 0 || toSquare(px, py, x, y) < grow) mark(x, y, remove);
					}
				}
			}
		}
	}

	const nodes: SceneNode[] = [];
	const move = (path: Path): Path =>
		new PathBuilder().transform([1, 0, 0, 1, sx, sy]).append(path).build();
	const shift = (b: Box): Box => ({ x: b.x + sx, y: b.y + sy, width: b.width, height: b.height });
	if (plate !== null && logo.plate !== null) {
		const paint = ctx.paint(logo.plate.paint, ['logo', 'plate', 'paint']);
		nodes.push({
			kind: 'path',
			path: move(plate.path),
			paint: resolvePaint(paint, shift(plate.box), ctx.registries.fills, ctx.prng.fork(1)),
			role: 'logo-plate',
		});
	}
	if ('path' in draw) {
		// The icon is drawn in its unit box, so it is scaled straight onto the
		// sample grid over the logo box.
		const placed = new PathBuilder()
			.transform([box.width, 0, 0, box.height, box.x + sx, box.y + sy])
			.append(draw.path)
			.build();
		const paint = ctx.paint(logo.paint ?? ctx.modulesPaint, ['logo', 'paint']);
		nodes.push({
			kind: 'path',
			path: placed,
			paint: resolvePaint(paint, shift(box), ctx.registries.fills, ctx.prng.fork(2)),
			role: 'logo',
		});
	} else {
		nodes.push({ kind: 'image', image: draw.image, ...shift(fit) });
	}
	return { removed, obscured, nodes, issues, box, padded };
}
