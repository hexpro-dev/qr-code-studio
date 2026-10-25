/**
 * Paths: the one vector shape everything in this package is drawn with.
 *
 * Module shapes, finder rings, logo plates, frames and caption glyphs all end
 * up as a `Path`, and every writer (SVG, the rasteriser, later PDF and EPS)
 * reads the same commands. So the writers agree about a shape because there is
 * only one description of it, rather than because four of them were kept in
 * step by hand.
 *
 * Paths are filled with the nonzero rule and every subpath is closed for
 * filling, as SVG and PDF fill them. There are no strokes: an outline that
 * must look the same in a scan check and in a print shop is a filled shape.
 *
 * Coordinates are float64 and must be finite. NaN or an infinity throws a
 * TypeError where it enters, because a NaN that reaches a writer comes out as
 * the text `NaN` in an SVG attribute, or as a pixel nobody can explain.
 */

import { checkMatrix, identity, isIdentity } from './matrix.js';
import type { Matrix } from './matrix.js';

/** A path in user units: commands with their points, nonzero winding. */
export interface Path {
	/** PATH_MOVE, PATH_LINE, PATH_QUAD, PATH_CUBIC, PATH_CLOSE. */
	readonly commands: Uint8Array;
	/** x, y pairs: one per move and line, two per quad, three per cubic, none per close. */
	readonly points: Float64Array;
}

export const PATH_MOVE = 0,
	PATH_LINE = 1,
	PATH_QUAD = 2,
	PATH_CUBIC = 3,
	PATH_CLOSE = 4;

/** Points each command carries, indexed by command. */
const POINTS_PER: readonly number[] = [1, 1, 2, 3, 0];

/**
 * The control point distance for a quarter circle drawn as one cubic.
 *
 * 4/3 (sqrt 2 - 1), the value that puts the midpoint of the arc exactly on the
 * circle. The radius elsewhere is at most 0.027 percent long, which is a
 * thousandth of a pixel on a module 4 pixels across.
 */
export const KAPPA = 0.5522847498307936;

/**
 * Receives a path one command at a time, already normalised.
 *
 * `walkPath` promises the order a writer needs: every segment comes after a
 * `move` in the same subpath, a `close` only ever follows a segment, and a
 * move with nothing drawn from it is never reported. SVG path data has to
 * begin with a move, and a writer that had to handle a stray line first would
 * be a writer with a bug in it.
 */
export interface PathVisitor {
	move(x: number, y: number): void;
	line(x: number, y: number): void;
	quad(cx: number, cy: number, x: number, y: number): void;
	cubic(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
	close(): void;
}

function isNumberList(value: unknown): value is ArrayLike<number> {
	// Any typed array is an honest list of numbers, and a path that arrives
	// from somewhere else may have been built with a different one.
	return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

/**
 * Check that a value is a path this package can draw, and throw a TypeError if
 * not.
 *
 * Paths reach the writers from registry entries and from structured clones out
 * of a worker, so the type system's word for it is not enough: the commands
 * have to be known ones, the points have to be the right number, and every
 * coordinate has to be finite.
 */
export function checkPath(path: Path, where: string): void {
	if (typeof path !== 'object' || path === null) {
		throw new TypeError(`${where}: a path is an object with commands and points.`);
	}
	const { commands, points } = path;
	if (!isNumberList(commands) || !isNumberList(points)) {
		throw new TypeError(`${where}: a path's commands and points must both be number arrays.`);
	}
	let expected = 0;
	for (let i = 0; i < commands.length; i += 1) {
		const command = commands[i] as number;
		if (!Number.isInteger(command) || command < PATH_MOVE || command > PATH_CLOSE) {
			throw new TypeError(`${where}: command ${i} is not one of the five path commands.`);
		}
		expected += (POINTS_PER[command] as number) * 2;
	}
	if (points.length !== expected) {
		throw new TypeError(
			`${where}: the commands need ${expected} coordinates and the path has ${points.length}.`,
		);
	}
	for (let i = 0; i < points.length; i += 1) {
		if (!Number.isFinite(points[i])) {
			throw new TypeError(`${where}: coordinate ${i} is not a finite number.`);
		}
	}
}

/**
 * Report a path's commands to `visitor`, normalised (see `PathVisitor`).
 *
 * Validates first, so a visitor never sees half a path before a TypeError.
 *
 * A segment with no current point starts a subpath at its own first point, as
 * a canvas does: a line becomes a move to its end, and a curve moves to its
 * first control point and draws from there. After a close, the next segment
 * starts from the closed subpath's first point, as in SVG.
 */
export function walkPath(path: Path, visitor: PathVisitor, where = 'walkPath'): void {
	checkPath(path, where);
	const { commands, points } = path;
	let at = 0;
	let startX = 0;
	let startY = 0;
	let hasCurrent = false;
	// The move that began this subpath is held back until something is drawn
	// from it, which is how a run of moves collapses to the last one.
	let pending = false;
	let drawn = false;

	const begin = (x: number, y: number): void => {
		startX = x;
		startY = y;
		hasCurrent = true;
		pending = true;
		drawn = false;
	};
	const flush = (): void => {
		if (pending) visitor.move(startX, startY);
		pending = false;
		drawn = true;
	};

	for (let i = 0; i < commands.length; i += 1) {
		const command = commands[i] as number;
		if (command === PATH_CLOSE) {
			if (drawn) visitor.close();
			if (hasCurrent) begin(startX, startY);
			continue;
		}
		const x0 = points[at] as number;
		const y0 = points[at + 1] as number;
		if (command === PATH_MOVE || (command === PATH_LINE && !hasCurrent)) {
			begin(x0, y0);
			at += 2;
			continue;
		}
		if (!hasCurrent) begin(x0, y0);
		flush();
		if (command === PATH_LINE) {
			visitor.line(x0, y0);
			at += 2;
		} else if (command === PATH_QUAD) {
			visitor.quad(x0, y0, points[at + 2] as number, points[at + 3] as number);
			at += 4;
		} else {
			visitor.cubic(
				x0,
				y0,
				points[at + 2] as number,
				points[at + 3] as number,
				points[at + 4] as number,
				points[at + 5] as number,
			);
			at += 6;
		}
	}
}

function finite(value: number, method: string, name: string): void {
	if (!Number.isFinite(value)) {
		throw new TypeError(`PathBuilder.${method}: ${name} is not a finite number.`);
	}
}

/**
 * Builds a `Path`.
 *
 * Every method that adds points runs them through the current transform, so a
 * module shape can be drawn in its own unit cell and placed by whoever calls
 * it. `transform` replaces the matrix rather than composing with it, which is
 * what makes placing one shape after another safe: setting the next cell's
 * translation cannot inherit the last one's. Compose with `multiply` first when
 * that is what is wanted.
 *
 * The output is normalised as it is built: every subpath begins with a move, a
 * run of moves keeps only the last, and a move with nothing drawn from it is
 * dropped.
 */
export class PathBuilder {
	private readonly commands: number[] = [];
	private readonly points: number[] = [];
	private matrix: Matrix = identity();
	private plain = true;
	/** The subpath's first point, already transformed, for whatever follows a close. */
	private startX = 0;
	private startY = 0;
	private hasCurrent = false;
	/** True while the last command is a move nothing has been drawn from yet. */
	private pending = false;
	private segments = 0;

	/** True until something that draws has been added. */
	get empty(): boolean {
		return this.segments === 0;
	}

	moveTo(x: number, y: number): this {
		finite(x, 'moveTo', 'x');
		finite(y, 'moveTo', 'y');
		const [tx, ty] = this.apply(x, y);
		this.begin(tx, ty);
		return this;
	}

	lineTo(x: number, y: number): this {
		finite(x, 'lineTo', 'x');
		finite(y, 'lineTo', 'y');
		if (!this.hasCurrent) return this.moveTo(x, y);
		this.segment(PATH_LINE, x, y);
		return this;
	}

	quadTo(cx: number, cy: number, x: number, y: number): this {
		finite(cx, 'quadTo', 'cx');
		finite(cy, 'quadTo', 'cy');
		finite(x, 'quadTo', 'x');
		finite(y, 'quadTo', 'y');
		if (!this.hasCurrent) this.moveTo(cx, cy);
		this.segment(PATH_QUAD, cx, cy, x, y);
		return this;
	}

	cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
		finite(c1x, 'cubicTo', 'c1x');
		finite(c1y, 'cubicTo', 'c1y');
		finite(c2x, 'cubicTo', 'c2x');
		finite(c2y, 'cubicTo', 'c2y');
		finite(x, 'cubicTo', 'x');
		finite(y, 'cubicTo', 'y');
		if (!this.hasCurrent) this.moveTo(c1x, c1y);
		this.segment(PATH_CUBIC, c1x, c1y, c2x, c2y, x, y);
		return this;
	}

	close(): this {
		if (!this.hasCurrent) return this;
		// A subpath that drew nothing has nothing to close; its held move stays
		// where it is and is replaced or dropped like any other.
		if (!this.pending) this.commands.push(PATH_CLOSE);
		this.begin(this.startX, this.startY);
		return this;
	}

	/** Four corners, clockwise as seen (y down) when w and h are positive. */
	rect(x: number, y: number, w: number, h: number): this {
		finite(x, 'rect', 'x');
		finite(y, 'rect', 'y');
		finite(w, 'rect', 'w');
		finite(h, 'rect', 'h');
		return this.moveTo(x, y)
			.lineTo(x + w, y)
			.lineTo(x + w, y + h)
			.lineTo(x, y + h)
			.close();
	}

	/**
	 * A rectangle with rounded corners, wound the same way as `rect`.
	 *
	 * `radii` is one radius or four, for the corners at (x, y), (x + w, y),
	 * (x + w, y + h) and (x, y + h): top left, top right, bottom right and
	 * bottom left when w and h are positive. Each is clamped to between zero and
	 * half the shorter side, so a radius that would make neighbouring corners
	 * overlap gives a stadium or a circle rather than a bow tie.
	 */
	roundedRect(
		x: number,
		y: number,
		w: number,
		h: number,
		radii: number | readonly [number, number, number, number],
	): this {
		finite(x, 'roundedRect', 'x');
		finite(y, 'roundedRect', 'y');
		finite(w, 'roundedRect', 'w');
		finite(h, 'roundedRect', 'h');
		const list: readonly number[] =
			typeof radii === 'number' ? [radii, radii, radii, radii] : radii;
		if (!Array.isArray(list) || list.length !== 4) {
			throw new TypeError('PathBuilder.roundedRect: radii is one number or four.');
		}
		const limit = Math.min(Math.abs(w), Math.abs(h)) / 2;
		const r = list.map((value, i) => {
			finite(value, 'roundedRect', `radius ${i}`);
			return Math.min(Math.max(value, 0), limit);
		}) as [number, number, number, number];

		// The signs carry the direction of travel, so negative sizes mirror the
		// shape the way they mirror `rect`.
		const sx = w < 0 ? -1 : 1;
		const sy = h < 0 ? -1 : 1;
		const right = x + w;
		const bottom = y + h;
		let atX = x + sx * r[0];
		let atY = y;
		this.moveTo(atX, atY);

		const lineTo = (px: number, py: number): void => {
			if (px === atX && py === atY) return;
			this.lineTo(px, py);
			atX = px;
			atY = py;
		};
		// A quarter arc into the corner (cx, cy): `in` is the direction travelled
		// into it and `out` the direction out, both unit and axis aligned. With
		// no radius it is the corner itself.
		const arc = (
			cx: number,
			cy: number,
			inX: number,
			inY: number,
			outX: number,
			outY: number,
			radius: number,
		): void => {
			if (radius === 0) {
				lineTo(cx, cy);
				return;
			}
			const ax = cx - inX * radius;
			const ay = cy - inY * radius;
			const bx = cx + outX * radius;
			const by = cy + outY * radius;
			const k = KAPPA * radius;
			lineTo(ax, ay);
			this.cubicTo(ax + inX * k, ay + inY * k, bx - outX * k, by - outY * k, bx, by);
			atX = bx;
			atY = by;
		};

		arc(right, y, sx, 0, 0, sy, r[1]);
		arc(right, bottom, 0, sy, -sx, 0, r[2]);
		arc(x, bottom, -sx, 0, 0, -sy, r[3]);
		// A square last corner is where the walk began, and the close draws the
		// side that leads to it.
		if (r[0] > 0) arc(x, y, 0, -sy, sx, 0, r[0]);
		return this.close();
	}

	/** A circle as four cubic arcs, wound the same way as `rect`. */
	circle(cx: number, cy: number, r: number): this {
		finite(cx, 'circle', 'cx');
		finite(cy, 'circle', 'cy');
		finite(r, 'circle', 'r');
		const k = KAPPA * r;
		return this.moveTo(cx + r, cy)
			.cubicTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
			.cubicTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
			.cubicTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
			.cubicTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
			.close();
	}

	/** A closed polygon through `points`, given as x, y pairs. */
	polygon(points: readonly number[]): this {
		if (!Array.isArray(points) || points.length % 2 !== 0) {
			throw new TypeError('PathBuilder.polygon: points is a list of x, y pairs.');
		}
		for (let i = 0; i < points.length; i += 1) {
			finite(points[i] as number, 'polygon', `coordinate ${i}`);
		}
		if (points.length === 0) return this;
		this.moveTo(points[0] as number, points[1] as number);
		for (let i = 2; i < points.length; i += 2) {
			this.lineTo(points[i] as number, points[i + 1] as number);
		}
		return this.close();
	}

	/**
	 * Set the matrix applied to every point added from here on.
	 *
	 * Replaces the current one; see the class comment for why it does not
	 * compose. Points already added stay where they are.
	 */
	transform(m: Matrix): this {
		checkMatrix(m, 'PathBuilder.transform');
		this.matrix = [m[0], m[1], m[2], m[3], m[4], m[5]];
		this.plain = isIdentity(this.matrix);
		return this;
	}

	/** Add another path's commands, through the current transform. */
	append(path: Path): this {
		walkPath(
			path,
			{
				move: (x, y) => this.moveTo(x, y),
				line: (x, y) => this.lineTo(x, y),
				quad: (cx, cy, x, y) => this.quadTo(cx, cy, x, y),
				cubic: (c1x, c1y, c2x, c2y, x, y) => this.cubicTo(c1x, c1y, c2x, c2y, x, y),
				close: () => this.close(),
			},
			'PathBuilder.append',
		);
		return this;
	}

	/** A fresh path holding everything added so far. The builder can carry on. */
	build(): Path {
		let count = this.commands.length;
		let pointCount = this.points.length;
		// A trailing move with nothing drawn from it is not part of any shape.
		if (this.pending) {
			count -= 1;
			pointCount -= 2;
		}
		return {
			commands: Uint8Array.from(this.commands.slice(0, count)),
			points: Float64Array.from(this.points.slice(0, pointCount)),
		};
	}

	private apply(x: number, y: number): [number, number] {
		if (this.plain) return [x, y];
		const m = this.matrix;
		const tx = m[0] * x + m[2] * y + m[4];
		const ty = m[1] * x + m[3] * y + m[5];
		// Finite numbers can still overflow through a large matrix.
		if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
			throw new TypeError('PathBuilder: a point overflowed to infinity through the transform.');
		}
		return [tx, ty];
	}

	/** Start a subpath at a point already in output space. */
	private begin(tx: number, ty: number): void {
		if (this.pending) {
			// A move with nothing drawn from it is replaced by this one.
			this.commands.pop();
			this.points.length -= 2;
		}
		this.commands.push(PATH_MOVE);
		this.points.push(tx, ty);
		this.startX = tx;
		this.startY = ty;
		this.hasCurrent = true;
		this.pending = true;
	}

	private segment(command: number, ...coordinates: number[]): void {
		// Transform everything before writing anything, so an overflow leaves
		// the builder as it was.
		const out: number[] = [];
		for (let i = 0; i < coordinates.length; i += 2) {
			out.push(...this.apply(coordinates[i] as number, coordinates[i + 1] as number));
		}
		this.commands.push(command);
		this.points.push(...out);
		this.pending = false;
		this.segments += 1;
	}
}
