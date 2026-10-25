# Contracts

The public shape of every layer, written before the layer is. Each section is
binding on its implementation: names, fields and behaviour below are what the
layers above rely on. Change a contract here first, in the same commit as the
code, and say why in the commit message.

General rules for every layer:

- Pure functions over plain data. No classes in a public signature except the
  error classes, `BitMatrix`, `BitBuffer` and `Registry`.
- Inputs are never mutated. Outputs are fresh objects; arrays a caller receives
  may be frozen.
- Lengths and positions are integers; coordinates are `number` (float64).
- Pure parsers throw a `QrStudioError` subclass; attempt-shaped operations
  return `Result`; caller mistakes throw `TypeError`; validation returns
  `Issue[]`.
- Nothing reads a clock, `Math.random`, `Intl` or the DOM inside the
  determinism zone (see CLAUDE.md).

---

## core

```ts
// errors.ts, result.ts, issue.ts: already written, see the source.

// bits.ts
export class BitBuffer {
	readonly length: number; // bits written so far
	append(value: number, bits: number): void; // 0 <= bits <= 32, most significant bit first
	appendBits(other: BitBuffer): void;
	bit(index: number): 0 | 1;
	toBytes(): Uint8Array; // padded with zero bits to a whole byte
}
export class BitReader {
	constructor(bytes: Uint8Array, bitLength?: number);
	readonly remaining: number;
	read(bits: number): number; // throws RangeError past the end (a bug, not input)
}

// bit-matrix.ts: rectangular, because rMQR is.
export class BitMatrix {
	constructor(width: number, height: number, data?: Uint8Array);
	readonly width: number;
	readonly height: number;
	get(x: number, y: number): 0 | 1;
	set(x: number, y: number, dark: boolean): void;
	xor(x: number, y: number): void;
	setRegion(x: number, y: number, w: number, h: number, dark: boolean): void;
	clone(): BitMatrix;
	inverted(): BitMatrix;
	mirrored(): BitMatrix; // transpose for square matrices; flips x for rectangular
	countDark(): number;
	equals(other: BitMatrix): boolean;
	readonly data: Uint8Array; // row major, one byte per module, 0 or 1
}

// field.ts: finite fields, so Reed-Solomon is not QR's alone.
export interface Field {
	readonly size: number; // 256 for GF(2^8), 929 for GF(929)
	readonly generator: number; // primitive element used for exp/log
	add(a: number, b: number): number;
	sub(a: number, b: number): number;
	mul(a: number, b: number): number;
	div(a: number, b: number): number; // throws RangeError on b = 0
	inv(a: number): number;
	exp(i: number): number; // generator^i, i taken mod (size - 1)
	log(a: number): number; // throws RangeError on 0
}
export function binaryField(m: number, primitive: number, generator?: number): Field;
export function primeField(p: number, generator: number): Field;
export const QR_FIELD: Field; // binaryField(8, 0x11d)

// reed-solomon.ts
export interface RsCode {
	readonly field: Field;
	readonly ecCount: number; // check symbols per block
	readonly firstRoot: number; // 0 for QR, 1 for Data Matrix
}
export function rsEncode(code: RsCode, data: ArrayLike<number>): number[]; // the ecCount check symbols
export interface RsDecodeOptions {
	readonly erasures?: readonly number[]; // positions known to be unreliable
	/** Refuse more than this many errors even if the code could correct them (misdecode protection). */
	readonly maxErrors?: number;
}
export interface RsDecoded {
	readonly codewords: number[]; // corrected, data and check symbols
	readonly errors: number; // symbol errors corrected (erasures not counted)
	readonly erasures: number; // erasures used
}
/** Throws `RsDecodeError` (code 'decode/unreadable', params { stage: 'reed-solomon' }) when 2e + f > ecCount, or the result fails its own syndrome check. */
export function rsDecode(
	code: RsCode,
	received: ArrayLike<number>,
	options?: RsDecodeOptions,
): RsDecoded;

// bch.ts
export function bchEncode(data: number, dataBits: number, generator: number): number; // data followed by remainder
/** The codeword in `table` nearest `received` by Hamming distance, if within `maxDistance`. */
export function bchNearest(
	received: number,
	table: readonly number[],
	maxDistance: number,
): { index: number; distance: number } | undefined;

// checksums.ts
export function crc32(bytes: Uint8Array, seed?: number): number;
export function adler32(bytes: Uint8Array): number;
export function crc16CcittFalse(bytes: Uint8Array): number; // poly 0x1021, init 0xffff (EMVCo MPM)
export function mod97(digits: string): number; // ISO 7064 MOD 97-10 over a digit string (IBAN, Swiss QR reference)
export function mod10Recursive(digits: string): number; // Swiss QR-bill QR reference check digit
export function gs1CheckDigit(digits: string): number; // GTIN and GS1 keys
export function luhn(digits: string): number;

// deflate.ts: synchronous and deterministic.
export function deflateRaw(bytes: Uint8Array, options?: { level?: 0 | 1 | 6 | 9 }): Uint8Array;
export function zlibWrap(bytes: Uint8Array, options?: { level?: 0 | 1 | 6 | 9 }): Uint8Array; // header + deflate + adler32
/** Throws 'archive/malformed' on a bad stream and 'archive/too-large' past maxOutput. */
export function inflateRaw(bytes: Uint8Array, options: { maxOutput: number }): Uint8Array;
export function zlibUnwrap(bytes: Uint8Array, options: { maxOutput: number }): Uint8Array;

// zip.ts: writer only. Stored or deflated entries, fixed timestamps.
export interface ZipEntry {
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly compress?: boolean;
}
export function writeZip(
	entries: readonly ZipEntry[],
	options?: { date?: { year: number; month: number; day: number } },
): Uint8Array;

// prng.ts
export interface Prng {
	next(): number;
	/* [0, 1) */ int(maxExclusive: number): number;
	fork(label: number): Prng;
}
export function createPrng(seed: number): Prng; // xoshiro128**, seeded by splitmix32

// math.ts: deterministic replacements, accurate to better than 1e-12 relative.
export function sin(x: number): number;
export function cos(x: number): number;
export function atan2(y: number, x: number): number;
export function hypot(x: number, y: number): number; // sqrt(x*x + y*y) with scaling
export function exp(x: number): number;
export function ln(x: number): number;
export function pow(base: number, exponent: number): number;
export const PI: number;
export const TAU: number;

// registry.ts
export interface RegistryEntry {
	readonly id: string;
}
export class Registry<T extends RegistryEntry> {
	constructor(kind: string, entries?: readonly T[]);
	readonly kind: string;
	register(entry: T): void; // TypeError on a duplicate id or an id that is not kebab-case
	get(id: string): T | undefined;
	require(id: string): T; // throws QrStudioError 'design/unknown-entry' with params { kind, id }
	has(id: string): boolean;
	list(): readonly T[]; // registration order
	ids(): readonly string[];
	readonly version: number; // increments on every register, for caches
}
```

---

## segment

```ts
export type EcLevel = 'L' | 'M' | 'Q' | 'H';
export type Mode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji';

/** What one symbology version allows in its bitstream. */
export interface BitstreamProfile {
	readonly modes: readonly Mode[]; // modes this version can carry
	readonly modeIndicatorBits: number; // 4 for QR, 0 to 3 for Micro QR, 3 for rMQR
	modeIndicator(
		mode: Mode | 'eci' | 'fnc1-first' | 'fnc1-second' | 'structured-append',
	): number | undefined;
	charCountBits(mode: Mode): number;
	readonly terminatorBits: number; // 4 for QR; 3, 5, 7, 9 for M1 to M4; 3 for rMQR
	readonly eci: boolean;
	readonly fnc1: boolean;
	readonly structuredAppend: boolean;
}

export interface Segment {
	readonly mode: Mode;
	readonly chars: number; // character count as the bitstream records it
	readonly data: Uint8Array; // byte values for byte mode, code units otherwise
	/** For byte mode: the ECI designator in force, if one was written before this segment. */
	readonly eci?: number;
}

export interface SegmentationPolicy {
	readonly kanji: 'never' | 'when-smaller' | 'always';
	readonly eci: 'auto' | 'never' | 'utf-8';
}

/** Split text into the segments that need the fewest bits. Exact, by dynamic programming. */
export function segmentText(
	text: string,
	profile: BitstreamProfile,
	policy: SegmentationPolicy,
): Segment[];
export function segmentBytes(bytes: Uint8Array, profile: BitstreamProfile): Segment[];
export function segmentsBitLength(segments: readonly Segment[], profile: BitstreamProfile): number;
export function writeSegments(
	segments: readonly Segment[],
	profile: BitstreamProfile,
	out: BitBuffer,
	header?: SegmentHeader,
): void;

export interface SegmentHeader {
	readonly structuredAppend?: { index: number; total: number; parity: number };
	readonly fnc1?: 'gs1' | { applicationIndicator: number };
}

export interface DecodedSegment {
	readonly mode: Mode;
	readonly eci: number | null;
	readonly length: number;
}
export interface DecodedBitstream {
	readonly text: string;
	readonly bytes: Uint8Array; // the payload as stored, before any text decoding
	readonly textSource: 'utf-8' | 'latin1-fallback' | 'shift-jis' | `eci-${number}`;
	readonly segments: readonly DecodedSegment[];
	readonly structuredAppend: { index: number; total: number; parity: number } | null;
	readonly fnc1: 'gs1' | { applicationIndicator: number } | null;
}
/** Throws QrStudioError 'decode/unreadable' (params { stage: 'segments' }) on a malformed bitstream. */
export function readSegments(
	bytes: Uint8Array,
	bitLength: number,
	profile: BitstreamProfile,
): DecodedBitstream;

/** The Shift_JIS code for a character, only where WHATWG, Shift_JIS and CP932 agree. Built lazily. */
export function kanjiCode(codePoint: number): number | undefined;
export function kanjiAvailable(): boolean;
```

---

## symbology

```ts
export type ModuleRole =
	| 'data'
	| 'finder'
	| 'separator'
	| 'timing'
	| 'alignment'
	| 'format'
	| 'version'
	| 'dark-module'
	| 'sub-finder'
	| 'corner-finder';
export const ROLE_CODES: Readonly<Record<ModuleRole, number>>; // role -> small integer stored in SymbolLayout.roles

export interface StyleableRegion {
	readonly role: 'finder' | 'sub-finder' | 'corner-finder';
	readonly kind: 'concentric-7' | 'concentric-5' | 'corner-l';
	readonly x: number;
	readonly y: number; // top-left module
	readonly width: number;
	readonly height: number;
	readonly rotation: 0 | 90 | 180 | 270; // for asymmetric kinds (corner-l)
}

export interface SymbolLayout {
	readonly width: number;
	readonly height: number;
	readonly roles: Uint8Array; // ROLE_CODES per module, row major
	/** For data modules: codeword index * 8 + bit (7 = most significant). -1 for anything else. */
	readonly dataBits: Int32Array;
	readonly regions: readonly StyleableRegion[];
}

export interface BlockLayout {
	readonly blocks: readonly { readonly dataCount: number; readonly ecCount: number }[];
	readonly totalCodewords: number;
	/** Misdecode protection codewords (ISO 18004 Table 9): errors correctable per block is floor((ec - p) / 2). */
	readonly p: number;
	/** M1 and M3 end their data with a 4-bit codeword. */
	readonly lastDataCodewordBits: 8 | 4;
	readonly dataBits: number; // capacity for the bitstream, in bits
}

export interface BuiltSymbol {
	readonly symbology: string; // 'qr' | 'micro' | 'rmqr'
	readonly version: string; // '1'..'40', 'M1'..'M4', 'R7x43'..'R17x139'
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly matrix: BitMatrix;
	readonly layout: SymbolLayout;
	readonly blocks: BlockLayout;
	readonly codewords: Uint8Array; // interleaved, as placed
}

export interface MatrixRead {
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly bitstream: DecodedBitstream;
	readonly errorsPerBlock: readonly number[];
	readonly capacityPerBlock: readonly number[]; // floor((ec - p) / 2)
	readonly erasuresUsed: number;
	readonly formatErrors: number; // bits corrected in format information
	readonly mirrored: boolean;
}

export interface SymbologyEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly quietZone: number; // minimum, in modules: 4 for QR, 2 for Micro and rMQR
	readonly phoneReadable: boolean; // false for Micro QR and rMQR
	readonly versions: readonly string[]; // smallest first
	ecLevels(version: string): readonly EcLevel[];
	size(version: string): { width: number; height: number };
	profile(version: string): BitstreamProfile;
	blocks(version: string, ec: EcLevel): BlockLayout;
	layout(version: string): SymbolLayout; // cached; the same object for the same version
	masks(version: string): readonly number[]; // 0..7 for QR, 0..3 for Micro, [0] for rMQR (fixed)
	/** Place codewords, apply the mask (or choose one), write format and version information. */
	build(codewords: Uint8Array, version: string, ec: EcLevel, mask: number | 'auto'): BuiltSymbol;
	/** Read a sampled matrix. Pure: throws QrStudioError 'decode/unreadable' with params { stage }. */
	read(matrix: BitMatrix, options: { strict: boolean; erasures?: Uint8Array }): MatrixRead;
}

/** A registry holding the three built-in symbologies. Each layer with entries has a factory like this; `createRegistries()` at the root gathers them. */
export function createSymbologyRegistry(): Registry<SymbologyEntry>;
```

---

## encode

```ts
export interface EncodeOptions {
	readonly symbology?: string; // default 'qr'
	readonly ecLevel?: EcLevel; // default 'M'
	/** Raise the level as far as it goes without needing a larger symbol. Default false. */
	readonly boostEc?: boolean;
	readonly minVersion?: string;
	readonly maxVersion?: string;
	readonly mask?: number | 'auto';
	readonly segmentation?: Partial<SegmentationPolicy>;
	readonly fnc1?: 'gs1' | { applicationIndicator: number };
	/** rMQR only: prefer the shortest height that fits, or the shortest width. Default 'area'. */
	readonly rmqrPreference?: 'area' | 'height' | 'width';
}
/** Throws TooMuchDataError when nothing allowed fits. */
export function encode(
	input: string | Uint8Array,
	options?: EncodeOptions,
	symbologies?: Registry<SymbologyEntry>,
): BuiltSymbol;
/** Up to 16 symbols with a shared parity byte. Throws TooMuchDataError past 16. */
export function encodeStructuredAppend(
	input: string | Uint8Array,
	options?: EncodeOptions & { maxSymbols?: number },
	symbologies?: Registry<SymbologyEntry>,
): BuiltSymbol[];
```

---

## decode

```ts
export interface RgbaImage {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray;
}

export interface DecodeOptions {
	readonly profile?: 'lenient' | 'strict-v1'; // default 'lenient'
	readonly symbologies?: readonly string[]; // default all registered
	readonly maxSymbols?: number; // default 8
	readonly budget?: { readonly maxPixels?: number; readonly maxAttempts?: number };
	readonly erasures?: boolean; // lenient only; default true
}
export interface DecodedSymbol {
	readonly symbology: string;
	readonly corners: readonly [Point, Point, Point, Point];
	readonly read: MatrixRead;
	readonly inverted: boolean;
	readonly minConfidence: number; // 0..1, the least certain module sample
}
export interface Point {
	readonly x: number;
	readonly y: number;
}
export function decodeImage(
	image: RgbaImage,
	options?: DecodeOptions,
	symbologies?: Registry<SymbologyEntry>,
): Result<readonly DecodedSymbol[]>;
export function decodeMatrix(
	matrix: BitMatrix,
	options?: { strict?: boolean },
	symbologies?: Registry<SymbologyEntry>,
): MatrixRead;
```

The strict profile, `strict-v1`, exists for the scan check and must be at
least as hard to satisfy as the phone readers people use: one binariser, a
single sample per module, no mirroring, the design's own polarity only, finder
ratio tolerance 0.35 of a module, at most one bit corrected in format
information with both copies agreeing, version information required, no
erasures, and a margin of `ceil(0.25 * t)` left unused in every block. A test
holds it to that: every capture the strict profile reads, `zxing-wasm` and
`jsqr` read too.

---

## payload

```ts
export type FieldValue = string | number | boolean | null | readonly string[];
export type FieldKind =
	| 'text'
	| 'multiline'
	| 'url'
	| 'email'
	| 'tel'
	| 'number'
	| 'integer'
	| 'select'
	| 'boolean'
	| 'date'
	| 'datetime'
	| 'iban'
	| 'bic'
	| 'amount'
	| 'currency'
	| 'country'
	| 'latitude'
	| 'longitude'
	| 'secret'; // shown masked, never logged

export interface FieldSchema {
	readonly key: string;
	readonly kind: FieldKind;
	readonly labelKey: MessageKey;
	readonly hintKey?: MessageKey;
	readonly required?: boolean;
	readonly maxLength?: number;
	readonly min?: number;
	readonly max?: number;
	readonly options?: readonly { readonly value: string; readonly labelKey: MessageKey }[];
	readonly default?: FieldValue;
	readonly group?: string; // fields shown together, e.g. 'address'
	readonly advanced?: boolean; // behind a disclosure
}

export type PayloadCategory =
	'link' | 'contact' | 'message' | 'network' | 'event' | 'place' | 'payment' | 'commerce' | 'text';

export interface PayloadConstraints {
	readonly ecLevels?: readonly EcLevel[];
	readonly maxVersion?: string;
	readonly symbologies?: readonly string[];
	readonly sizeMm?: number;
	readonly colours?: 'black-on-white';
	readonly designLocked?: boolean;
	readonly overlay?: 'swiss-cross';
}

export interface PayloadType<
	V extends Readonly<Record<string, FieldValue>> = Readonly<Record<string, FieldValue>>,
> {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly descriptionKey: MessageKey;
	readonly category: PayloadCategory;
	readonly fields: readonly FieldSchema[];
	readonly constraints?: PayloadConstraints;
	/** What a phone does with it, as a message key with params from the value: "Joins the network {ssid}" is NOT allowed; "Joins a Wi-Fi network" is. */
	readonly actionKey: MessageKey;
	readonly compatibility?: readonly {
		readonly reader: string;
		readonly noteKey: MessageKey;
		readonly source: string;
	}[];
	validate(value: V): readonly Issue[];
	/** Call only on a value with no error issues; throws TypeError otherwise. */
	build(value: V): { readonly text: string };
	/** 0 when the text is certainly not this type, 1 when it certainly is. */
	detect(text: string): number;
	/** Throws QrStudioError 'payload/unparseable'. */
	parse(text: string): V;
	safety?(value: V): readonly SafetyFinding[];
	/** Spec vectors, run by the conformance suite. `source` cites where each came from. */
	readonly vectors: readonly {
		readonly text: string;
		readonly value: V;
		readonly source: string;
	}[];
}

export type SafetyCode =
	| 'scheme/dangerous'
	| 'scheme/unusual'
	| 'host/ip-literal'
	| 'host/mixed-script'
	| 'host/punycode'
	| 'host/lookalike'
	| 'url/userinfo'
	| 'host/shortener'
	| 'host/dynamic-qr'
	| 'url/tracking-params'
	| 'url/insecure'
	| 'url/very-long'
	| 'payload/open-wifi'
	| 'payload/payment'
	| 'payload/sends-message';
export interface SafetyFinding {
	readonly code: SafetyCode;
	readonly severity: 'danger' | 'caution' | 'note';
	readonly params?: Readonly<Record<string, number | string>>; // host names may appear here; they are what the person needs to see
}
export function analyseUrl(text: string): {
	readonly findings: readonly SafetyFinding[];
	readonly displayHost: string | null;
	readonly unicodeHost: string | null;
};
```

`params` on a safety finding is the one place content may appear (a host
name), because showing the person where a code goes is the whole job. It is
still never put into an error message.

---

## geometry

```ts
/** A path in user units: commands with their points, nonzero winding. */
export interface Path {
	readonly commands: Uint8Array; // PATH_MOVE, PATH_LINE, PATH_QUAD, PATH_CUBIC, PATH_CLOSE
	readonly points: Float64Array; // x, y pairs, 1 per move/line, 2 per quad, 3 per cubic
}
export const PATH_MOVE = 0,
	PATH_LINE = 1,
	PATH_QUAD = 2,
	PATH_CUBIC = 3,
	PATH_CLOSE = 4;

export class PathBuilder {
	moveTo(x: number, y: number): this;
	lineTo(x: number, y: number): this;
	quadTo(cx: number, cy: number, x: number, y: number): this;
	cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this;
	close(): this;
	rect(x: number, y: number, w: number, h: number): this;
	roundedRect(
		x: number,
		y: number,
		w: number,
		h: number,
		radii: number | readonly [number, number, number, number],
	): this;
	circle(cx: number, cy: number, r: number): this; // four cubic arcs, kappa constant
	polygon(points: readonly number[]): this;
	transform(m: Matrix): this; // applies to points added after
	append(path: Path): this;
	build(): Path;
	readonly empty: boolean;
}
export type Matrix = readonly [number, number, number, number, number, number]; // a b c d e f
export function bounds(path: Path): { x: number; y: number; width: number; height: number } | null;
export function area(path: Path): number; // signed, by flattening
/** Merge a grid of dark cells into the fewest closed outlines (holes wound the other way). */
export function traceGrid(
	width: number,
	height: number,
	dark: (x: number, y: number) => boolean,
): Path;
```

---

## render

```ts
export interface Colour {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
	readonly cmyk?: readonly [number, number, number, number];
}
export interface Stop {
	readonly offset: number;
	readonly colour: Colour;
}
export type ScenePaint =
	| { readonly kind: 'solid'; readonly colour: Colour }
	| {
			readonly kind: 'linear';
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly stops: readonly Stop[];
	  }
	| {
			readonly kind: 'radial';
			readonly cx: number;
			readonly cy: number;
			readonly r: number;
			readonly stops: readonly Stop[];
	  }
	| {
			readonly kind: 'conic';
			readonly cx: number;
			readonly cy: number;
			readonly angle: number;
			readonly stops: readonly Stop[];
	  };

export type SceneNode =
	| {
			readonly kind: 'path';
			readonly path: Path;
			readonly paint: ScenePaint;
			readonly role?: string;
	  }
	| {
			readonly kind: 'image';
			readonly image: RgbaImage;
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly clip?: Path;
	  }
	| {
			readonly kind: 'group';
			readonly children: readonly SceneNode[];
			readonly clip?: Path;
			readonly opacity?: number;
	  };

/** A layer is composited as a whole: shapes within one layer never overlap, so coverage never double counts. */
export interface Scene {
	readonly width: number; // user units
	readonly height: number;
	readonly unitsPerMm?: number; // set when the design has a physical size
	readonly background: ScenePaint | null;
	readonly layers: readonly SceneNode[];
	readonly title?: string; // accessible name in SVG; never the payload
}

export function sceneToSvg(scene: Scene, options?: { idPrefix?: string; pretty?: boolean }): string;
export function rasterise(
	scene: Scene,
	options: { width: number; height?: number; background?: Colour },
): RgbaImage;
export function encodePng(
	image: RgbaImage,
	options?: { dpi?: number; level?: 0 | 1 | 6 | 9 },
): Uint8Array;
export function sceneToPdf(scene: Scene, options: PdfOptions): Uint8Array;
export function sceneToEps(scene: Scene, options: EpsOptions): string;
export interface PdfOptions {
	readonly colour: 'srgb' | 'cmyk';
	readonly widthMm: number;
	readonly heightMm?: number;
	readonly bleedMm?: number;
	readonly cropMarks?: boolean;
	readonly title?: string;
}
export interface EpsOptions {
	readonly colour: 'srgb' | 'cmyk';
	readonly widthMm: number;
}
/** Parse a colour the allow-list accepts: #rgb, #rgba, #rrggbb, #rrggbbaa. TypeError otherwise. */
export function parseColour(text: string): Colour;
export function formatColour(colour: Colour): string; // #rrggbb or #rrggbbaa
```

---

## design, verify, inspect, batch, studio

Sketched in the plan and refined when their milestones start (M6, M7, M8,
M10). They will be added here before their code is written.
