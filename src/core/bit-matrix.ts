/**
 * A rectangular grid of modules: a symbol, a sampled grid, or a binarised
 * image.
 *
 * Rectangular rather than square because rMQR is, and because a binarised
 * camera frame is. One byte per module rather than a packed bitset: the
 * largest symbol is 177 by 177 (31 kB), and the unpacked form removes a class
 * of shift-and-mask bug from code that is dense enough already.
 *
 * Coordinates are checked. An unchecked `y * width + x` with x one past the
 * edge reads the first module of the next row, which is a valid module with a
 * plausible value, and the bug it causes shows up three layers later as a
 * symbol that decodes in one orientation and not another.
 */
export class BitMatrix {
	readonly width: number;
	readonly height: number;
	/** Row major, one byte per module, 0 for light and 1 for dark. */
	readonly data: Uint8Array;

	/**
	 * `data`, when given, is copied, so the matrix never writes into memory the
	 * caller still holds. It must have exactly `width * height` bytes, each 0 or
	 * 1.
	 */
	constructor(width: number, height: number, data?: Uint8Array) {
		if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
			throw new RangeError('a matrix is at least 1 by 1 with whole-number sides');
		}
		this.width = width;
		this.height = height;
		if (data === undefined) {
			this.data = new Uint8Array(width * height);
			return;
		}
		if (data.length !== width * height) {
			throw new RangeError(
				`a ${width} by ${height} matrix holds ${width * height} modules, not ${data.length}`,
			);
		}
		for (let i = 0; i < data.length; i += 1) {
			if ((data[i] as number) > 1) {
				throw new RangeError(`module ${i} is neither 0 nor 1`);
			}
		}
		// Not `data.slice()`: on a Node Buffer that is a view of the same memory.
		this.data = new Uint8Array(data);
	}

	get(x: number, y: number): 0 | 1 {
		return this.data[this.index(x, y)] as 0 | 1;
	}

	set(x: number, y: number, dark: boolean): void {
		this.data[this.index(x, y)] = dark ? 1 : 0;
	}

	/** Flip one module, which is how a mask is applied. */
	xor(x: number, y: number): void {
		const at = this.index(x, y);
		this.data[at] = (this.data[at] as number) ^ 1;
	}

	setRegion(x: number, y: number, w: number, h: number, dark: boolean): void {
		if (
			!Number.isInteger(w) ||
			!Number.isInteger(h) ||
			w < 0 ||
			h < 0 ||
			!Number.isInteger(x) ||
			!Number.isInteger(y) ||
			x < 0 ||
			y < 0 ||
			x + w > this.width ||
			y + h > this.height
		) {
			throw new RangeError(
				`a ${w} by ${h} region at ${x}, ${y} does not fit a ${this.width} by ${this.height} matrix`,
			);
		}
		const fill = dark ? 1 : 0;
		for (let row = y; row < y + h; row += 1) {
			this.data.fill(fill, row * this.width + x, row * this.width + x + w);
		}
	}

	clone(): BitMatrix {
		const out = new BitMatrix(this.width, this.height);
		out.data.set(this.data);
		return out;
	}

	/**
	 * Every module flipped.
	 *
	 * The cheapest answer to a dark-mode screenshot: rather than guess the
	 * polarity, a reader tries both.
	 */
	inverted(): BitMatrix {
		const out = new BitMatrix(this.width, this.height);
		for (let i = 0; i < this.data.length; i += 1) {
			out.data[i] = (this.data[i] as number) ^ 1;
		}
		return out;
	}

	/**
	 * The symbol as it reads in a mirror.
	 *
	 * For a square symbol that is the transpose. Mirroring is invisible to the
	 * finder geometry (a reflected QR code has its three finders in the same L),
	 * so it cannot be detected before sampling; once sampled, a mirrored square
	 * symbol is exactly the transpose of a readable one.
	 *
	 * A rectangular symbol cannot be transposed into one of its own shape, and
	 * rMQR's finder and sub-finder sit at opposite ends of the long side, so a
	 * reflection there is a flip along x.
	 */
	mirrored(): BitMatrix {
		const { width, height } = this;
		if (width === height) {
			const out = new BitMatrix(width, height);
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					out.data[x * width + y] = this.data[y * width + x] as number;
				}
			}
			return out;
		}
		const out = new BitMatrix(width, height);
		for (let y = 0; y < height; y += 1) {
			const row = y * width;
			for (let x = 0; x < width; x += 1) {
				out.data[row + width - 1 - x] = this.data[row + x] as number;
			}
		}
		return out;
	}

	countDark(): number {
		let count = 0;
		for (let i = 0; i < this.data.length; i += 1) {
			count += this.data[i] as number;
		}
		return count;
	}

	equals(other: BitMatrix): boolean {
		if (other.width !== this.width || other.height !== this.height) return false;
		for (let i = 0; i < this.data.length; i += 1) {
			if (this.data[i] !== other.data[i]) return false;
		}
		return true;
	}

	private index(x: number, y: number): number {
		// `(x | 0) === x` is false for fractions, NaN and anything past 2^31, all
		// of which are bugs here, in one comparison.
		if ((x | 0) !== x || (y | 0) !== y || x < 0 || y < 0 || x >= this.width || y >= this.height) {
			throw new RangeError(`${x}, ${y} is outside a ${this.width} by ${this.height} matrix`);
		}
		return y * this.width + x;
	}
}
