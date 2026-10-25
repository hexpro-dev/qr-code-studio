/**
 * The shapes the reader trades in.
 *
 * `DecodeOptions`, `DecodedSymbol` and `Point` are the contract's (see
 * docs/CONTRACTS.md, decode). The rest is what the reader adds to it: the
 * strict profile's polarity, an injected clock for a time budget, and the
 * telemetry a scanner view draws from.
 */

import type { MatrixRead } from '../symbology/types.js';

export interface Point {
	readonly x: number;
	readonly y: number;
}

/**
 * Which reader to be.
 *
 * `lenient` is the scanner: every binariser, scale and polarity, a
 * five-point vote per module, mirrored reads and erasures. `strict-v1` is the
 * scan check, and exists to be at least as hard to satisfy as the phone
 * readers people use; `strict.ts` lists what it gives up and why.
 */
export type DecodeProfile = 'lenient' | 'strict-v1';

/** Which way round a design is: dark modules on a light ground, or the reverse. */
export type Polarity = 'dark-on-light' | 'light-on-dark';

export interface DecodeBudget {
	/**
	 * Reduce the picture to at most this many pixels before any work, by area
	 * averaging. Default 2,500,000.
	 */
	readonly maxPixels?: number;
	/** Rungs of the ladder to try. Default all of them: nine lenient, one strict. */
	readonly maxAttempts?: number;
	/**
	 * Stop starting new rungs once this many milliseconds have passed by
	 * `DecodeOptions.clock`. Needs the clock: a time budget read from a clock
	 * nobody supplied would make the result depend on the machine.
	 */
	readonly maxMs?: number;
}

export interface DecodeOptions {
	readonly profile?: DecodeProfile;
	/** Symbology ids to look for. Default every registered one the reader can locate. */
	readonly symbologies?: readonly string[];
	/** Default 8. */
	readonly maxSymbols?: number;
	readonly budget?: DecodeBudget;
	/** Lenient only: pass uncertain modules to Reed-Solomon as erasures. Default true. */
	readonly erasures?: boolean;
	/**
	 * The design's polarity. Strict reads this polarity and no other. Lenient
	 * tries it first and the other second; without it, lenient guesses from the
	 * corners of the picture. Default for strict: dark-on-light.
	 */
	readonly polarity?: Polarity;
	/** Milliseconds from any fixed origin, for `budget.maxMs` and the telemetry's timings. */
	readonly clock?: () => number;
	/** Called synchronously at each stage, for a view that draws what the reader sees. */
	readonly onTelemetry?: TelemetrySink;
}

export interface DecodedSymbol {
	readonly symbology: string;
	/** In source pixels: the symbol's own top left, top right, bottom right and bottom left corners. */
	readonly corners: readonly [Point, Point, Point, Point];
	readonly read: MatrixRead;
	/** Read as light modules on a dark ground. */
	readonly inverted: boolean;
	/** 0 to 1: how far the least certain module sat from its threshold, relative to the symbol's contrast. */
	readonly minConfidence: number;
}

/**
 * How far a failed read got, in the order the stages run.
 *
 * `finders`: no symbol's finder patterns were all found. `geometry`: they
 * were, and no grid laid over them landed on a symbol (its timing pattern did
 * not read). The rest are the symbology's own stages, reached on a grid that
 * did land: `format`, `version`, `reed-solomon`, `segments`. And `margin`,
 * the strict profile's alone: the symbol read, and the profile refused it for
 * reading too narrowly (see `strict.ts`).
 */
export type DecodeStage =
	'finders' | 'geometry' | 'format' | 'version' | 'reed-solomon' | 'segments' | 'margin';

export interface TelemetryFinder {
	readonly x: number;
	readonly y: number;
	readonly moduleSize: number;
	/** How many scan lines agreed on this centre. */
	readonly confidence: number;
}

/** One rung of the ladder: how the picture was thresholded, at what scale and which way round. */
export interface Rung {
	readonly binariser: 'hybrid' | 'hybrid-mean' | 'otsu' | 'sauvola';
	readonly scale: 'half' | 'one' | 'double';
	readonly inverted: boolean;
	/** A five-point vote per module rather than one centre sample. */
	readonly majorityVote: boolean;
}

/**
 * What the reader saw, as it saw it.
 *
 * Coordinates are in source pixels. No frame carries content: decoded text
 * never goes through telemetry, because telemetry is the thing that ends up
 * in a bug report.
 */
export type DecodeFrame =
	| {
			readonly stage: 'source';
			readonly width: number;
			readonly height: number;
			/** The size actually worked on, after `maxPixels`. */
			readonly workWidth: number;
			readonly workHeight: number;
	  }
	| {
			readonly stage: 'binarised';
			readonly attempt: number;
			readonly rung: Rung;
			/** Decimated to at most a megapixel: a picture for a person, not data. */
			readonly width: number;
			readonly height: number;
			/** One byte per pixel, 1 dark, in the rung's polarity. */
			readonly bits: Uint8Array;
	  }
	| {
			readonly stage: 'finders';
			readonly attempt: number;
			readonly patterns: readonly TelemetryFinder[];
	  }
	| {
			readonly stage: 'located';
			readonly symbology: string;
			readonly corners: readonly [Point, Point, Point, Point];
			/** Modules across and down. */
			readonly width: number;
			readonly height: number;
			/** Symbol coordinates (module units) to source pixels, as nine numbers; see `Homography`. */
			readonly transform: readonly number[];
	  }
	| {
			readonly stage: 'sampled';
			readonly symbology: string;
			readonly width: number;
			readonly height: number;
			/** Row major, 1 dark. */
			readonly modules: Uint8Array;
			/** Row major, 1 where a sample sat too near its threshold to trust. */
			readonly uncertain: Uint8Array;
	  }
	| {
			readonly stage: 'corrected';
			readonly symbology: string;
			readonly version: string;
			readonly ecLevel: string;
			readonly errorsPerBlock: readonly number[];
			readonly erasuresUsed: number;
	  }
	| {
			readonly stage: 'decoded';
			readonly symbols: number;
			readonly attempts: number;
			/** Null without a clock. */
			readonly ms: number | null;
	  }
	| {
			readonly stage: 'failed';
			readonly code: 'decode/not-found' | 'decode/unreadable' | 'decode/unsupported';
			readonly reached: DecodeStage;
			readonly attempts: number;
			readonly ms: number | null;
	  };

export type TelemetrySink = (frame: DecodeFrame) => void;
