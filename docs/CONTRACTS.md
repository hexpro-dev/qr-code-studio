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

// checksums.ts: the two the containers need. Check digits for content
// (EMVCo CRC-16, IBAN MOD 97-10, the Swiss QR reference, GS1, Luhn) belong to
// the content types that use them, in payload/check-digits.ts.
export function crc32(bytes: Uint8Array, seed?: number): number;
export function adler32(bytes: Uint8Array): number;

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

// image.ts: the pixel container every layer shares, structurally an ImageData.
export interface RgbaImage {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray;
}

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
/** Throws QrStudioError 'decode/unreadable' (params { stage: 'segments' }) on a malformed bitstream, and 'decode/unsupported' (params { stage: 'segments', feature: 'eci' | 'kanji' }) rather than guessing a character set it cannot decode. ECI 'auto' never writes an ECI; 'utf-8' writes ECI 26 in every symbol. */
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
	readonly versions: readonly string[]; // smallest first (by area for rMQR)
	ecLevels(version: string): readonly EcLevel[];
	size(version: string): { width: number; height: number };
	profile(version: string): BitstreamProfile;
	blocks(version: string, ec: EcLevel): BlockLayout;
	/** Cached. `ec` matters only where the bit mapping depends on the level (Micro QR M3, whose 4-bit codeword moves); elsewhere one object serves every level. */
	layout(version: string, ec?: EcLevel): SymbolLayout;
	masks(version: string): readonly number[]; // 0..7 for QR; 0..3 for Micro (ISO's references, QR masks 1, 4, 6, 7); [0] for rMQR (fixed, QR mask 4)
	/** Takes the DATA codewords (the padded bitstream; for M1 and M3 the last is a nibble in the high bits of its byte). Adds Reed-Solomon, interleaves (symbology/qr exports interleaveBlocks and decodeBlocks for reuse), places, masks or chooses a mask, writes format and version information. BuiltSymbol.codewords is the full interleaved sequence. */
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

As built, `DecodeOptions` also takes `polarity` (strict reads only this one; lenient tries it
first), `clock`, `budget.maxMs` (needs a clock; the default is no time budget) and
`onTelemetry` (stage frames, never content). A strict refusal after a successful read reports
`params.stage: 'margin'`. Erasures reach `read` as a per-module flag map.
`decodeFailureKey(error)` maps a failure to its message key.

The strict profile, `strict-v1`, exists for the scan check and must be at
least as hard to satisfy as the phone readers people use: one binariser, a
single sample per module, no mirroring, the design's own polarity only, finder
ratio tolerance 0.35 of a module, at most one bit corrected in format
information with both copies agreeing, version information required, no
erasures, and a margin of `ceil(0.25 * t)` left unused in every block.

As measured and settled (m4-decode `0b5020a`): finder ratios 0.35 of a module on the axes and
0.5 on the diagonals; a fixed-pattern split between thresholds is forgiven only where the 3x3
neighbourhood keeps 0.75 of the symbol's contrast (a centre on a drawn edge, not glare); the grid
is the one whose timing reads straightest, with a least-squares projective fit along the
diagonal's alignment patterns; finder rings must be ones zxing-cpp traces (dotted rings refused,
round rings refused at a slant or under smear); finder centres must close; from version 7 a
zxing-cpp style tiled grid must read the same bytes; geometry floors of 2.25 px a module (3 px from
version 7) and foreshortening of at most 1.8; a plain-reader second opinion. Refusals after a read
report `stage: 'margin'`. Exports `ringKind`, `strictFindsFinder`, `finderSmear`, `foreshortening`,
`strictSamples` let design hold its region shapes to the same tests. The property (strict implies
zxing-wasm and jsQR) holds over the default corpora with zero exceptions; the nightlies allow two
documented glare and blur cases that zxing-cpp reads only with denoising. A test
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
	/** EPC and the Swiss QR-bill carry their character set in a field and must not have an ECI header. */
	readonly eci?: 'never';
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
	/** Spec vectors, run by the conformance suite. `source` cites where each came from. A vector whose text is not in the form `build` writes (an `sms:` read where `SMSTO:` is written) checks parse only, plus parse(build(value)). */
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
// check-digits.ts
export function crc16CcittFalse(bytes: Uint8Array): number; // poly 0x1021, init 0xffff, no reflection (EMVCo MPM)
export function mod97(digits: string): number; // ISO 7064 MOD 97-10 (IBAN, creditor reference)
export function mod10Recursive(digits: string): number; // Swiss QR-bill QR reference check digit
export function gs1CheckDigit(digits: string): number; // GTIN and the other GS1 keys
export function luhn(digits: string): number;

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

### Settled when the vectors moved (m7-vectors)

- `PayloadType.vectors` is optional, and no built-in type carries it. The built-ins' vectors live in
  `./payload/vectors` as `BUILT_IN_VECTORS` (keyed by type id), with `REDIRECT_HOST_SOURCES`
  holding the redirect host citations. Nothing at runtime imports that subpath, so the offline
  file carries no test data and only the addresses it builds.
- `CompatibilityNote.source` is optional (built-in citations are comments). `RedirectHost` is
  `{ host, operator }`.
- `checkPayloadType(type, vectors?)` in `./conformance` checks vectors (source, parse, build,
  round trip) and returns `Violation[]`. The schema-generated round trip stays in the property
  tests.

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

## text

As built: `parseTrueType(bytes, { id, labelKey? })` throws `FontMalformedError` ('font/malformed',
params { table, reason }); `createFontRegistry()` holds the built-ins `plex-sans-regular` and
`plex-sans-bold` (labelled "Sans" and "Sans bold", because the OFL reserves "Plex" for unmodified
fonts); `layoutText(text, { fontId, size, box, align = 'centre', maxLines = 1, lineHeight,
shrinkToFit, minSize = size / 2, fonts? })` returns `{ paths, lines, missing, overflow, size }`;
`textToPaths` throws 'font/missing-glyphs' with { count }. Kerning sums every lookup, as HarfBuzz
does. NFC, breaks at U+0020 and line feeds only, no shaping. A page that bundles the tables shows
`FONT_LICENCE`.

## print (render)

As built: `sceneToPdf`, `sheetToPdf`, `sceneToEps`, `epsIssues`, `imposeSheet(cells, template,
{ fit: 'none' | 'contain', skip })` returning `{ template, pages: { cells, marks }[], issues }`,
`imposeCopies`, `printSheetTemplate`, `cropMarks`, `builtInSheets`, `PAPER`. CMYK uses
`Colour.cmyk` when present; otherwise k = 1 - max(r, g, b), and every neutral goes to black ink
alone (black is exactly `0 0 0 1 k`). This is not a colour-managed conversion. EPS refuses
transparency ('render/format-unavailable', { format: 'eps', reason: 'transparency', count }),
and `epsIssues` lists each part, so the studio offers PDF instead. Crop marks are 5 mm long,
max(bleed, 3 mm) off the trim, in registration black.

## design

The design document is plain JSON so it can be saved as a file, put in a link
and checked by a person. It never holds the content of the code: a design is
reusable across codes, and a design link must be safe to share.

```ts
/** An sRGB hex colour, or one with a print value beside it. */
export type Ink =
	string | { readonly srgb: string; readonly cmyk: readonly [number, number, number, number] };
export interface DesignStop {
	readonly offset: number;
	readonly ink: Ink;
}
export type DesignPaint =
	| { readonly kind: 'solid'; readonly ink: Ink }
	| {
			readonly kind: 'linear';
			readonly angle: number;
			readonly stops: readonly DesignStop[];
			readonly space: 'symbol' | 'module';
	  }
	| {
			readonly kind: 'radial';
			readonly cx: number;
			readonly cy: number;
			readonly radius: number;
			readonly stops: readonly DesignStop[];
			readonly space: 'symbol' | 'module';
	  }
	| {
			readonly kind: 'conic';
			readonly cx: number;
			readonly cy: number;
			readonly angle: number;
			readonly stops: readonly DesignStop[];
			readonly space: 'symbol' | 'module';
	  }
	| { readonly kind: 'entry'; readonly ref: EntryRef };
// Angles in degrees, 0 = left to right, clockwise. cx, cy, radius as fractions of the box.

export interface EntryRef {
	readonly id: string;
	readonly params?: Readonly<Record<string, number | string | boolean>>;
}

export interface RegionStyle {
	readonly outer: EntryRef;
	readonly inner: EntryRef;
	readonly outerPaint?: DesignPaint; // defaults to modules.paint
	readonly innerPaint?: DesignPaint;
}

export interface QrDesignV1 {
	readonly schema: 'qr-design';
	readonly version: 1;
	readonly symbol: {
		readonly symbology: string;
		readonly ecLevel?: EcLevel;
		readonly boostEc?: boolean;
		readonly minVersion?: string;
		readonly maxVersion?: string;
		readonly mask?: number | 'auto';
		readonly segmentation?: Partial<SegmentationPolicy>;
	};
	readonly quietZone: number; // modules; the scan check holds it to the symbology's minimum
	readonly background: DesignPaint | null; // null is transparent
	readonly modules: {
		readonly shape: EntryRef;
		readonly paint: DesignPaint;
		/** Drawn light modules, for designs on a busy background. Null draws nothing. */
		readonly light: { readonly shape: EntryRef; readonly paint: DesignPaint } | null;
	};
	readonly regions: Readonly<
		Partial<Record<'finder' | 'sub-finder' | 'corner-finder', RegionStyle>>
	>;
	readonly logo: {
		readonly source:
			| { readonly kind: 'icon'; readonly id: string }
			| { readonly kind: 'asset'; readonly id: string };
		readonly size: number; // fraction of the symbol's width, 0.05 to 0.4
		readonly clear: 'none' | 'box' | 'shape'; // which modules are left out under it
		readonly padding: number; // modules of clear space around it
		readonly plate: {
			readonly paint: DesignPaint;
			readonly shape: 'square' | 'rounded' | 'circle';
		} | null;
		readonly paint?: DesignPaint; // icons only
	} | null;
	readonly frame: {
		readonly ref: EntryRef;
		readonly paint?: DesignPaint;
		readonly text?: {
			readonly content: string;
			readonly fontId: string;
			readonly paint?: DesignPaint;
		};
	} | null;
	readonly output: {
		readonly sizeMm?: number;
		readonly dpi?: number;
		readonly colourSpace: 'srgb' | 'cmyk';
	};
	/** Embedded images: always PNG, re-encoded by this package on import so any build can decode them. */
	readonly assets?: Readonly<
		Record<
			string,
			{ readonly png: string /* base64 */; readonly width: number; readonly height: number }
		>
	>;
	readonly name?: string;
}

export interface ParamSchema {
	readonly key: string;
	readonly kind: 'number' | 'integer' | 'boolean' | 'select' | 'colour' | 'angle';
	readonly labelKey: MessageKey;
	readonly default: number | string | boolean;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly options?: readonly { readonly value: string; readonly labelKey: MessageKey }[];
}
export type ResolvedParams = Readonly<Record<string, number | string | boolean>>;

/** Which of the eight neighbours are dark, bit 0 = north, clockwise to bit 7 = north-west. */
export type Neighbours = number;

export interface ModuleShape {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	/** Draws towards dark neighbours (bars, fluid). Conformance allows it to leave the cell only on those sides. */
	readonly connects: boolean;
	/** Draw one module into the unit cell (0,0)-(1,1). `prng` is seeded per module from the design, so a mosaic is reproducible. */
	path(
		ctx: { readonly neighbours: Neighbours; readonly params: ResolvedParams; readonly prng: Prng },
		out: PathBuilder,
	): void;
}
export interface RegionShape {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	readonly kinds: readonly StyleableRegion['kind'][];
	readonly part: 'outer' | 'inner';
	/** Draw into the region's own box in modules: 7x7 for concentric-7 (outer ring 7, inner 3x3 at 2,2). */
	path(
		ctx: { readonly kind: StyleableRegion['kind']; readonly params: ResolvedParams },
		out: PathBuilder,
	): void;
}
export interface FillEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	resolve(
		params: ResolvedParams,
		box: { x: number; y: number; width: number; height: number },
		prng: Prng,
	): ScenePaint;
}
export interface FrameLayout {
	readonly width: number;
	readonly height: number; // the whole artwork, in modules
	readonly symbol: { readonly x: number; readonly y: number }; // where the symbol's quiet zone starts
	readonly nodes: readonly SceneNode[]; // drawn beneath the symbol
	readonly over?: readonly SceneNode[]; // drawn above it, outside the quiet zone
	readonly textBox: {
		x: number;
		y: number;
		width: number;
		height: number;
		align: 'start' | 'centre' | 'end';
	} | null;
}
export interface FrameEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	readonly text: { readonly maxLines: number; readonly maxChars: number } | null;
	/** Must never place anything inside the quiet zone; conformance checks it. */
	layout(ctx: {
		readonly symbolSize: { width: number; height: number };
		readonly quietZone: number;
		readonly params: ResolvedParams;
		readonly paint: ScenePaint;
	}): FrameLayout;
}
export interface LogoIcon {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly path: Path; /* unit box */
}
export interface Preset {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly category:
		'classic' | 'rounded' | 'dots' | 'hex' | 'fluid' | 'bold' | 'minimal' | 'colour' | 'print';
	readonly design: QrDesignV1;
	readonly minSizeMm: number; // at the design's own level
	readonly ecLevels: readonly EcLevel[];
	readonly sizesMm?: Readonly<Partial<Record<EcLevel, number>>>; // per allowed level
}

export interface DesignRegistries {
	readonly moduleShapes: Registry<ModuleShape>;
	readonly regionShapes: Registry<RegionShape>;
	readonly fills: Registry<FillEntry>;
	readonly frames: Registry<FrameEntry>;
	readonly icons: Registry<LogoIcon>;
	readonly presets: Registry<Preset>;
}
export function createDesignRegistries(): DesignRegistries;

export function defaultDesign(): QrDesignV1;
/** Every problem at once. `design` is the input made valid where that is unambiguous, or null. */
export function validateDesign(
	input: unknown,
	registries: DesignRegistries,
): { readonly design: QrDesignV1 | null; readonly issues: readonly Issue[] };
/** Any earlier version to the current one. Throws 'design/unsupported-schema' for anything unrecognised. */
export function migrateDesign(input: unknown): QrDesignV1;
export function applyConstraints(
	design: QrDesignV1,
	constraints: PayloadConstraints | undefined,
): { readonly design: QrDesignV1; readonly issues: readonly Issue[] };

export interface BuiltScene {
	readonly scene: Scene;
	/** 1 where a module is hidden or altered by the logo or plate, row major over the symbol. */
	readonly obscured: Uint8Array;
	/** Fraction of each dark module's cell the shape actually inks, for the distance check. */
	readonly inkFraction: number;
	readonly issues: readonly Issue[];
}
export function buildScene(
	symbol: BuiltSymbol,
	design: QrDesignV1,
	context: {
		readonly registries: DesignRegistries;
		readonly assets?: (id: string) => RgbaImage | undefined; // decoded PNG assets; render/decodePng does it
		readonly fonts?: FontRegistry;
		readonly seed?: number;
	},
): BuiltScene;

/** A design link: `v1.` followed by base64url(deflate(JSON)). Content is never included. */
export function encodeDesignLink(design: QrDesignV1): string;
export function decodeDesignLink(fragment: string): QrDesignV1; // throws design/invalid
```

### Settled when the design layer was built

- `ModuleShape.fillsCell?(params)`: when true the builder traces runs of cells as one outline,
  so a classic square code is one path.
- `FillEntry.space?: 'symbol' | 'module'`: whether `resolve` runs once per module or once over
  the symbol.
- `DesignConstraints` is a structural copy of `PayloadConstraints` (design may not import payload).
- `designLink(design)` returns `{ link, issues }` (pictures are left out of links, with an issue);
  `encodeDesignLink` returns `.link`. `decodeDesignLink(fragment, registries?)`.
- Region shapes share one registry, so centres are named `*-centre`. Conformance for region
  shapes is pair based: a ring and a centre make a finder together. `regionPairConforms` is
  checked by `validateDesign`, `buildScene` and every preset.
- `checkPreset(preset, verify?: PresetVerifier | null, registries?)` is the hook verify plugs into.
- QR alignment patterns are drawn by the finder's ring and centre as concentric-5, never by the
  module shape, because jsQR misread 9 in 10 dotted or starred alignment patterns from v2 up.
- Micro QR and rMQR keep square rings; only the main finder's centre takes the style. rMQR is
  drawn without a frame (a warning), because zxing-cpp lost framed rMQR erratically.
- With a frame, `FrameLayout.nodes` go beneath everything, the design background becomes a
  plate over the quiet zone box, and `Scene.background` is null.
- The logo shrinks two modules at a time until it and its plate clear every function pattern
  except the central alignment patterns, with an info issue.
- Limits: design links at most 4096 characters and 32 KiB of JSON; at most 4 assets, each up to
  512 KiB of PNG and 1024 px a side.
- Seams: captions (`SEAM(M9)` in scene.ts, issue `caption-pending`); the Swiss QR-bill cross
  (issue `overlay-required`).

### Settled when finder rings met the strict reader (m6-rings)

- `RegionShape.ringKind?: 'cornered' | 'round' | 'dotted'` (default cornered) and `ringKindOf()`.
  `validateDesign` gives `design.issue.ring-not-traceable` (error) for a dotted ring as a QR
  finder, and `design.issue.ring-round` (warning) for a round one; neither for Micro QR or rMQR,
  which draw that ring square.
- Conformance imports decode (design does not, so the root bundle stays free of it).
  `checkRegionShape` requires every pair the 4 px model accepts to be found by
  `strictFindsFinder`, and every ring to measure as the kind it declares (`ringKind`);
  `checkPreset` puts the preset's finder pair through the same tests.
- `dot-ring` stays in the registry for saved designs but pairs with nothing at concentric-7, so
  views that list only rings with pairs never offer it.

### Settled when the catalogue met captures and levels (m6-catalogue)

- Finder pairs are held to captures, not only to sharp pictures. `ModuleFamily` is
  `'square' | 'dot' | 'hex'`; `ModuleShape.family?` names a shape's (default square: dots,
  diamonds, stars, small squares and mosaic are dot, the hexagon hex). `RegionShape.unpaired?`
  lists, per family, the centres a ring makes no QR finder with there. `regionPairConforms`
  takes the family as an optional sixth argument (default square) and applies `unpaired` at
  concentric-7 only; the validator, the scene builder, the studio and shuffle pass the design's
  own (`moduleFamilyOf(shape)`).
- `checkRegionCaptures(registries, read, options?)` in conformance reads every pair the table
  offers on each family, at default params, among that family's module shape (`FAMILY_MODULES`:
  square, dot, hex), with a reader verify supplies (`regionCaptureReader`): a short and a long
  link at their own level, 6, 8 and 10 px a module, clean and with ink spread or starved by
  0.05, eight seeds each (96 captures). One miss fails the pair; the ring then lists the centre
  as `unpaired` for that family. An entry that misses in every family is cut: the leaf ring and
  the star centre were. The studio catalogue gives each ring and centre `pairsByFamily` (and
  `pairs`, the square family's), and each module entry its `family`.
- A preset records a size per allowed level, `sizesMm`, with `minSizeMm` the one at its own
  level; `presetSizeMm(preset, level?)` reads it, and `PresetCatalogueEntry.sizesMm` carries it
  to views, which show the size for the level the design will be built at. `calibratePreset`
  takes `ecLevel`; `pnpm verify:sizes [--write]` calibrates every preset at every level.
  `presetVerifier` with `levels: 'all'` checks each level at its own size, and the nightly run
  checks each recorded size reproduces. `checkPreset` refuses a size for a level the preset
  does not allow, one that is not a positive number, and an own-level size that is not
  `minSizeMm`.
- The two contrast checks are named apart: `VERIFY_MESSAGE_KEYS.gradeNames` and
  `checkNameKey(check)` in verify, `checkKey(id, grade?)` in the studio. Symbol contrast is
  "Overall contrast", modulation "Clear squares". Since m10-text-fixes both return the same
  keys (see the studio section).

Conformance (in `./conformance`, pure, returning `Violation[]`):

- `checkModuleShape(shape)`: for every neighbour combination and seeded
  params, rasterised at 16 px a module: the five-point centre cross (0.5 plus
  or minus 0.2 on each axis) is inked at 0.98 or more; nothing is inked outside
  the cell except across an edge shared with a dark neighbour when `connects`;
  nothing enters a light neighbour's centre disc of radius 0.3; same output
  twice.
- `checkRegionShape(shape)`: outer and inner together, rasterised at 4 px a
  module, give runs of 1:1:3:1:1 within 0.35 of a module along both axes and
  both diagonals through the centre (concentric kinds), and keep the ring and
  the centre separated by a light ring at least 0.6 modules wide.
- `checkFrame(frame)`: nothing inside the quiet zone, for the default and
  extreme params.
- `checkPreset(preset, verify)`: the strict scan check passes at the preset's size for each
  level (`presetSizeMm`) for small, medium and large versions at each allowed level.
- `checkRegionCaptures(registries, read)`: every pair the table offers on a family reads in
  every capture among that family's modules (see the m6-catalogue notes above).
- `checkPayloadType(type)`: vectors reproduce; schema-generated values
  round-trip.

---

## verify

```ts
export type CaptureAxis =
	'distance' | 'focus' | 'motion' | 'noise' | 'angle' | 'light' | 'glare' | 'ink' | 'contrast';
export interface VerifyConditions {
	readonly sizeMm: number | null; // printed width of the symbol including its quiet zone
	readonly dpi: number | null; // for screen use, or for a raster export
	readonly distanceMm: number | null; // the furthest a person is expected to scan from
}
/** Structured-cloneable, so a website can post it to a worker. The worker re-encodes from it. */
export interface VerifyJob {
	readonly content: string;
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
	readonly seed: number;
	readonly requires: readonly string[]; // registry ids the design uses; a worker missing one refuses
	readonly assets?: Readonly<Record<string, RgbaImage>>;
}
export interface VerifyProgress {
	readonly done: number;
	readonly total: number;
	readonly axis: CaptureAxis | 'static';
}
export type CheckId =
	| 'quiet-zone'
	| 'contrast'
	| 'polarity'
	| 'function-patterns'
	| 'logo-budget'
	| 'module-size'
	| 'finder-shape'
	| 'colour-red-channel'
	| 'reader-support';
export interface VerifyCheck {
	readonly id: CheckId;
	readonly status: 'pass' | 'warn' | 'fail';
	readonly measured: number;
	readonly threshold: number;
	readonly grade?: 'SC' | 'MOD' | 'FPD' | 'UEC'; // ISO/IEC 15415 parameter it corresponds to
	readonly messageKey: MessageKey;
}
export interface VerifyReport {
	readonly schema: 1;
	readonly profile: 'strict-v1';
	readonly seed: number;
	readonly verdict: 'pass' | 'warn' | 'fail';
	readonly symbol: {
		readonly symbology: string;
		readonly version: string;
		readonly ecLevel: EcLevel;
		readonly mask: number;
		readonly modules: readonly [number, number];
	};
	readonly conditions: VerifyConditions;
	readonly checks: readonly VerifyCheck[];
	readonly blocks: readonly {
		readonly index: number;
		readonly ec: number;
		readonly p: number;
		readonly t: number;
		readonly coveredWorst: number;
		readonly coveredExpected: number;
		readonly margin: number;
	}[];
	readonly captures: readonly {
		readonly axis: CaptureAxis;
		readonly worstPassed: number | null;
		readonly firstFailed: number | null;
		readonly minMargin: number | null;
		readonly seeds: number;
	}[];
	readonly limits: {
		readonly maxDistanceMm: number | null;
		readonly minModuleMm: number | null;
		readonly inkFraction: number;
	};
}
export interface Fix {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly patch: DesignPatch;
}
/** Drive it in time slices: each `next()` does one capture. The website runs the same generator in a worker. */
export function runVerifyJob(
	job: VerifyJob,
	registries: Registries,
): Generator<VerifyProgress, VerifyReport>;
export function verify(job: VerifyJob, registries: Registries): VerifyReport;
export function suggestFixes(report: VerifyReport, design: QrDesignV1): readonly Fix[];
```

`Registries` is the bag `createRegistries()` returns at the root: symbologies,
payload types and the design registries together.

---

## inspect

```ts
export interface InspectedSymbol {
	readonly symbology: string;
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly corners: readonly Point[];
	readonly segments: readonly DecodedSegment[];
	readonly text: string;
	readonly textSource: DecodedBitstream['textSource'];
	readonly structuredAppend: {
		readonly index: number;
		readonly total: number;
		readonly parity: number;
	} | null;
	readonly gs1: readonly { readonly ai: string; readonly value: string }[] | null;
	readonly quality: {
		readonly errorsPerBlock: readonly number[];
		readonly capacityPerBlock: readonly number[];
		readonly erasuresUsed: number;
		readonly formatErrors: number;
		readonly mirrored: boolean;
		readonly inverted: boolean;
		readonly minConfidence: number;
	};
}
export interface InspectReport {
	readonly symbols: readonly InspectedSymbol[];
	readonly sets: readonly {
		readonly parity: number;
		readonly complete: boolean;
		readonly text: string | null;
		readonly missing: readonly number[];
	}[];
	/** For the first symbol, or the completed set: what kind of content it is and what it says. */
	readonly payload: {
		readonly typeId: string;
		readonly value: Readonly<Record<string, FieldValue>>;
		readonly issues: readonly Issue[];
	} | null;
	readonly safety: ReturnType<typeof analyseUrl> | null;
}
export function inspectImage(
	image: RgbaImage,
	registries: Registries,
	options?: DecodeOptions,
): Result<InspectReport>;
export function inspectText(text: string, registries: Registries): InspectReport;
```

---

## batch

```ts
export interface CsvTable {
	readonly headers: readonly string[];
	readonly rows: readonly (readonly string[])[];
}
/** RFC 4180 with a BOM, CRLF or LF, and `;` or tab sniffed when asked. Throws 'batch/malformed-csv' with { row, column }. */
export function parseCsv(
	text: string,
	options?: { readonly delimiter?: ',' | ';' | '\t' | 'auto'; readonly maxRows?: number },
): CsvTable;
export interface BatchMapping {
	readonly typeId: string;
	/** Each field from a column, or from a template such as `https://example.com/t/{id}`. */
	readonly fields: Readonly<
		Record<string, { readonly column: string } | { readonly template: string }>
	>;
	readonly filename: string; // template; sanitised; duplicates numbered
}
export interface BatchRow {
	readonly index: number;
	readonly filename: string;
	readonly content: string | null;
	readonly issues: readonly Issue[];
}
export function planBatch(
	table: CsvTable,
	mapping: BatchMapping,
	registries: Registries,
): readonly BatchRow[];
export type BatchOutput =
	| {
			readonly kind: 'zip';
			readonly format: 'svg' | 'png' | 'pdf' | 'eps';
			readonly widthPx?: number;
			readonly sizeMm?: number;
	  }
	| { readonly kind: 'sheet'; readonly template: string; readonly colourSpace: 'srgb' | 'cmyk' };
export function runBatch(
	rows: readonly BatchRow[],
	design: QrDesignV1,
	output: BatchOutput,
	registries: Registries,
): Generator<{ done: number; total: number }, Uint8Array>;
```

The manifest written into a ZIP neutralises spreadsheet formulas (a cell
starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an
apostrophe), because a person opens it in a spreadsheet.

As built, rows are checked only through an injected `verifyRow` (the fifth
argument). `scanCheckVerifier(registries, generator = runVerifyJob)` in
`batch/verify.ts` is the scan check, stepped one capture a slice: 'all' at 2
seeds a row, 'sampled' at verify's full 8 on at most ten rows and the longest,
and `verifySeeds` on the output to change either. `run.ts` never imports
verify, so the `./batch` subpath carries no scan check of its own; the caller
decides.

---

## studio

```ts
export function createStudio(options?: {
	readonly registries?: Registries;
	readonly verifyRunner?: VerifyRunner; // default: the generator in time slices on the main thread
	readonly scheduler?: Scheduler; // default: setTimeout(0) slices of about 8 ms
	readonly clock?: () => number;
	readonly library?: LibraryStore | null;
	readonly fonts?: FontRegistry;
	readonly initial?: string | StudioDocument; // a design link fragment, or a document
	readonly historyLimit?: number; // default 200
	readonly verifyDebounceMs?: number; // default 250
}): Studio;
export interface Studio {
	getSnapshot(): StudioSnapshot;
	subscribe(listener: () => void): () => void;
	dispatch(action: StudioAction): void;
	run<C extends StudioCommand>(command: C): Promise<Result<CommandResult<C>>>;
	dispose(): void;
}
export interface StudioDocument {
	readonly mode: 'create' | 'scan' | 'bulk';
	readonly typeId: string;
	readonly fields: Readonly<Record<string, FieldValue>>;
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
}
export type StudioAction =
	| { readonly type: 'mode'; readonly mode: StudioDocument['mode'] }
	| { readonly type: 'payload/type'; readonly typeId: string }
	| { readonly type: 'payload/field'; readonly key: string; readonly value: FieldValue }
	| { readonly type: 'payload/raw'; readonly text: string }
	| { readonly type: 'design/patch'; readonly patch: DesignPatch; readonly coalesce?: string }
	| { readonly type: 'design/preset'; readonly id: string }
	| { readonly type: 'design/replace'; readonly design: unknown }
	| { readonly type: 'design/shuffle'; readonly seed: number }
	| { readonly type: 'conditions'; readonly conditions: Partial<VerifyConditions> }
	| { readonly type: 'history/undo' }
	| { readonly type: 'history/redo' }
	| { readonly type: 'history/begin'; readonly key: string }
	| { readonly type: 'history/commit'; readonly key: string }
	| { readonly type: 'history/cancel' }
	| { readonly type: 'verify/request' }
	| { readonly type: 'verify/cancel' }
	| { readonly type: 'fix/apply'; readonly fixId: string };
/** A shallow, path-addressed change: `{ path: ['modules', 'shape'], value: { id: 'dot' } }`. */
export interface DesignPatch {
	readonly path: readonly (string | number)[];
	readonly value: unknown;
}
export type StudioCommand =
	| {
			readonly type: 'export';
			readonly format: 'svg' | 'png' | 'pdf' | 'eps' | 'jpeg' | 'webp';
			readonly options: ExportOptions;
	  }
	| { readonly type: 'inspect/image'; readonly image: RgbaImage }
	| { readonly type: 'inspect/text'; readonly text: string }
	| {
			readonly type: 'batch';
			readonly csv: string;
			readonly mapping: BatchMapping;
			readonly output: BatchOutput;
	  }
	| { readonly type: 'design-link' }
	| { readonly type: 'library/enable' }
	| { readonly type: 'library/disable' }
	| { readonly type: 'library/save'; readonly name: string }
	| { readonly type: 'library/load'; readonly id: string };
export interface StudioSnapshot {
	readonly revision: number;
	readonly document: StudioDocument;
	readonly form: FormView; // fields with values, issues and visibility, from the type's schema
	readonly payloadIssues: readonly Issue[];
	readonly symbol:
		| { readonly status: 'ok'; readonly view: SymbolView }
		| { readonly status: 'stale'; readonly view: SymbolView; readonly issue: Issue }
		| { readonly status: 'empty' };
	readonly preview: { readonly svg: string; readonly scene: Scene } | null;
	readonly verify:
		| { readonly status: 'idle' }
		| { readonly status: 'running'; readonly progress: number; readonly revision: number }
		| {
				readonly status: 'done';
				readonly report: VerifyReport;
				readonly fixes: readonly Fix[];
				readonly stale: boolean;
		  };
	readonly history: { readonly canUndo: boolean; readonly canRedo: boolean };
	readonly catalogue: Catalogue; // identity changes only when a registry's version changes
	readonly inspect: InspectState;
	readonly batch: BatchState;
	readonly library: LibraryState;
}
export interface VerifyRunner {
	run(
		job: VerifyJob,
		signal: AbortSignal,
		progress: (p: VerifyProgress) => void,
	): Promise<Result<VerifyReport>>;
}
```

`symbol.status === 'stale'` is the "never goes blank" rule: while the content
is invalid or too long, the last good code stays on screen with the issue
beside it.

Snapshots are immutable and structurally shared: a slice that did not change
keeps its identity, so `React.memo` and a vanilla view's own diffing both work.
Async results carry the revision they were computed for and are dropped if a
newer one has started.

The batch command's rows follow the studio's verify seam. With a
`verifyGenerator` (verify's `runVerifyJob` unless one is given) it passes
`scanCheckVerifier(registries, verifyGenerator)` to `runBatch`, so rows are
checked by the same check as the code on screen; with `verifyGenerator: null`
it passes none, and a batch asked to check its rows fails with
'platform/unavailable' (`{ feature: 'verify' }`), as a single code's check
does.

### Settled when the translators read the studio (m10-text-fixes)

- A scan check has one name. `checkKey(id, grade?)` returns verify's `checkNameKey({ id, grade })`,
  `verify.check-name.<id>` (modulation `verify.check-name.modulation`), and the studio has no
  `studio.check.*` keys of its own: the offline app and the website showed the studio's names
  beside the report's, which called the same check something else. The names are Clear margin,
  Overall contrast, Clear squares, Dark on light, Patterns readers look for, Logo size, Print
  size, Corner square shape, Colours under red light and Phone support. `studio.axis.*`, what the
  check is doing while it runs, is unchanged.
- A sentence chooses its words by count. The catalogue's sentences may use the ICU subset the
  website's formatter reads (`@hex-pro/i18n/message`): `{name}`, `{n, plural, =0 {...} one {...}
other {...}}` with `#` for the count, and `{k, select, a {...} other {...}}`, nested.
  `message()` in `./messages` renders them through `src/messages/format.ts` with English plural
  rules (`=N`, then `one` at exactly 1, then `other`), no `Intl`, and leaves a block it cannot
  fill as written. A count that chooses a branch is passed as a number. Where a count before a
  plural noun can be 1 the sentence has a block; where it cannot (a fixed limit, a minimum of 2
  or 4, a count only over a limit) it is written plainly and listed with its reason in
  `tests/messages/plurals.test.ts`, which fails on a new "1 squares".
