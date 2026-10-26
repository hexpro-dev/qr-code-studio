/**
 * The public shape of the design layer, as docs/CONTRACTS.md (`design`) gives
 * it.
 *
 * Additions to the contract, each optional so an entry written to the
 * contract alone still works, and each listed in the branch report:
 *
 * - `ModuleShape.fillsCell`. A classic code is one clean outline only if the
 *   builder knows a shape is the whole cell, and asking the shape is the one
 *   way that stays true for a third party's square.
 * - `FillEntry.space`. A palette scattered over modules is resolved once per
 *   module, a diagonal split once over the symbol; the resolver cannot tell
 *   which from the signature.
 * - `BuildContext.overlay`, and `applyConstraints` returning the overlay
 *   beside the design. What a content type prints over every code of its
 *   kind (the Swiss QR-bill's cross) belongs to the content, not to a design
 *   a person can reuse on any code and share as a link, so it never enters
 *   the design document; the constraints name it and the caller hands it to
 *   `buildScene`.
 * - `QrDesignV1.output.sizeBasis`: whether `sizeMm` is the whole artwork's
 *   width or the symbol's own. Optional within version 1, so every version 1
 *   document stays valid and means what it meant.
 * - `validateDesign(input, registries, { fonts })`: the registry a caption's
 *   font is checked against, as `BuildContext.fonts` is for the scene.
 * - `DesignConstraints` repeats `PayloadConstraints`, because this layer may
 *   not import the payload layer. The two are structurally the same type.
 */

import type { Issue, MessageKey } from '../core/issue.js';
import type { RgbaImage } from '../core/image.js';
import type { Prng } from '../core/prng.js';
import type { Registry } from '../core/registry.js';
import type { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import type { Scene, SceneNode, ScenePaint } from '../render/types.js';
import type { EcLevel, SegmentationPolicy } from '../segment/types.js';
import type { StyleableRegion } from '../symbology/types.js';
import type { FontRegistry } from '../text/types.js';

export type { FontRegistry } from '../text/types.js';

/** An sRGB hex colour, or one with a print value beside it. */
export type Ink =
	string | { readonly srgb: string; readonly cmyk: readonly [number, number, number, number] };

export interface DesignStop {
	readonly offset: number;
	readonly ink: Ink;
}

/**
 * What fills a part of the design. Angles are in degrees, 0 = left to right,
 * clockwise; cx, cy and radius are fractions of the box being filled.
 */
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

export type ParamValue = number | string | boolean;

export interface EntryRef {
	readonly id: string;
	readonly params?: Readonly<Record<string, ParamValue>>;
}

export interface RegionStyle {
	readonly outer: EntryRef;
	readonly inner: EntryRef;
	/** Defaults to modules.paint. */
	readonly outerPaint?: DesignPaint;
	readonly innerPaint?: DesignPaint;
}

export type RegionRole = StyleableRegion['role'];
export type RegionKind = StyleableRegion['kind'];

export interface LogoPlate {
	readonly paint: DesignPaint;
	readonly shape: 'square' | 'rounded' | 'circle';
}

export interface DesignLogo {
	readonly source:
		| { readonly kind: 'icon'; readonly id: string }
		| { readonly kind: 'asset'; readonly id: string };
	/** Fraction of the symbol's width, 0.05 to 0.4. */
	readonly size: number;
	/** Which modules are left out under it. */
	readonly clear: 'none' | 'box' | 'shape';
	/** Modules of clear space around it. */
	readonly padding: number;
	readonly plate: LogoPlate | null;
	/** Icons only. Defaults to modules.paint. */
	readonly paint?: DesignPaint;
}

export interface DesignFrame {
	readonly ref: EntryRef;
	readonly paint?: DesignPaint;
	readonly text?: {
		readonly content: string;
		readonly fontId: string;
		readonly paint?: DesignPaint;
	};
}

export interface DesignAsset {
	/** Standard base64 of a PNG this package encoded. */
	readonly png: string;
	readonly width: number;
	readonly height: number;
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
	/** Modules; the scan check holds it to the symbology's minimum. */
	readonly quietZone: number;
	/** Null is transparent. */
	readonly background: DesignPaint | null;
	readonly modules: {
		readonly shape: EntryRef;
		readonly paint: DesignPaint;
		/** Drawn light modules, for designs on a busy background. Null draws nothing. */
		readonly light: { readonly shape: EntryRef; readonly paint: DesignPaint } | null;
	};
	readonly regions: Readonly<Partial<Record<RegionRole, RegionStyle>>>;
	readonly logo: DesignLogo | null;
	readonly frame: DesignFrame | null;
	readonly output: {
		/** The printed width, in millimetres, of what `sizeBasis` names. */
		readonly sizeMm?: number;
		/**
		 * What `sizeMm` measures: the whole artwork, quiet zone and frame
		 * included ('artwork', the default), which is what a person cuts out and
		 * sticks down; or the symbol alone, without its quiet zone or frame
		 * ('symbol'), which is how the Swiss QR-bill fixes its 46 mm. A
		 * contract addition, optional within version 1.
		 */
		readonly sizeBasis?: 'artwork' | 'symbol';
		readonly dpi?: number;
		readonly colourSpace: 'srgb' | 'cmyk';
	};
	/** Embedded images: always PNG, re-encoded by this package on import so any build can decode them. */
	readonly assets?: Readonly<Record<string, DesignAsset>>;
	readonly name?: string;
}

export interface ParamOption {
	readonly value: string;
	readonly labelKey: MessageKey;
}

export interface ParamSchema {
	readonly key: string;
	readonly kind: 'number' | 'integer' | 'boolean' | 'select' | 'colour' | 'angle';
	readonly labelKey: MessageKey;
	readonly default: ParamValue;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly options?: readonly ParamOption[];
}

export type ResolvedParams = Readonly<Record<string, ParamValue>>;

/** Which of the eight neighbours are dark, bit 0 = north, clockwise to bit 7 = north-west. */
export type Neighbours = number;

export interface ModuleShapeContext {
	readonly neighbours: Neighbours;
	readonly params: ResolvedParams;
	readonly prng: Prng;
}

/**
 * Which kind of module a finder is drawn among, for the pairs of ring and
 * centre that read there: `square`, modules that fill their cell or join
 * their neighbours; `dot`, modules that leave light all round them (dots,
 * diamonds, stars, small squares, mosaic); `hex`, the hexagon. A styled
 * finder that reads among squares can fail among dots, so the pair table is
 * kept per family (`RegionShape.unpaired`).
 */
export type ModuleFamily = 'square' | 'dot' | 'hex';

export interface ModuleShape {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	/** Draws towards dark neighbours (bars, fluid). Conformance allows it to leave the cell only on those sides. */
	readonly connects: boolean;
	/** The family of finder pairs this shape is drawn with; `square` when left out. A contract addition. */
	readonly family?: ModuleFamily;
	/**
	 * True when the shape is exactly the unit square at these params, whatever
	 * the neighbours, so the builder may trace a run of them as one outline. A
	 * contract addition.
	 */
	readonly fillsCell?: (params: ResolvedParams) => boolean;
	/** Draw one module into the unit cell (0,0)-(1,1). `prng` is seeded per module from the design, so a mosaic is reproducible. */
	path(ctx: ModuleShapeContext, out: PathBuilder): void;
}

export interface RegionShapeContext {
	readonly kind: RegionKind;
	readonly params: ResolvedParams;
}

/**
 * What a reader that traces a finder ring's sides makes of a ring, as the
 * strict profile measures it (decode's `ringKind`): `cornered`, straight sides
 * with corners, which every reader follows; `round`, no corners, which
 * zxing-cpp loses at a slant or under a smear; `dotted`, a scalloped side,
 * which it loses anywhere.
 */
export type RingKind = 'cornered' | 'round' | 'dotted';

export interface RegionShape {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	readonly kinds: readonly RegionKind[];
	readonly part: 'outer' | 'inner';
	/**
	 * For a ring, what its finder ring is to a reader that traces it, at every
	 * setting; `cornered` when left out. Validation refuses a `dotted` ring as
	 * a QR finder and warns about a `round` one. Conformance measures the ring
	 * with the strict reader's own test and fails a shape that says otherwise.
	 * A contract addition.
	 */
	readonly ringKind?: RingKind;
	/**
	 * For a ring, the centres it makes no finder with on a module family,
	 * although the runs measured in design/finder.ts accept the pair: captures
	 * of the pair among that family's modules did not read (see the capture
	 * rule in conformance). A contract addition.
	 */
	readonly unpaired?: Readonly<Partial<Record<ModuleFamily, readonly string[]>>>;
	/** Draw into the region's own box in modules: 7x7 for concentric-7 (outer ring 7, inner 3x3 at 2,2). */
	path(ctx: RegionShapeContext, out: PathBuilder): void;
}

export interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface FillEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	/**
	 * Resolved once over the whole box ('symbol', the default) or once per
	 * module with that module's own seeded stream ('module'). A contract
	 * addition.
	 */
	readonly space?: 'symbol' | 'module';
	resolve(params: ResolvedParams, box: Box, prng: Prng): ScenePaint;
}

export interface FrameTextBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly align: 'start' | 'centre' | 'end';
}

export interface FrameLayout {
	/** The whole artwork, in modules. */
	readonly width: number;
	readonly height: number;
	/** Where the symbol's quiet zone starts. */
	readonly symbol: { readonly x: number; readonly y: number };
	/** Drawn beneath the symbol. */
	readonly nodes: readonly SceneNode[];
	/** Drawn above it, outside the quiet zone. */
	readonly over?: readonly SceneNode[];
	readonly textBox: FrameTextBox | null;
}

export interface FrameLayoutContext {
	/** The symbol in modules, without its quiet zone. */
	readonly symbolSize: { readonly width: number; readonly height: number };
	readonly quietZone: number;
	readonly params: ResolvedParams;
	readonly paint: ScenePaint;
}

export interface FrameEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	readonly text: { readonly maxLines: number; readonly maxChars: number } | null;
	/** Must never place anything inside the quiet zone; conformance checks it. */
	layout(ctx: FrameLayoutContext): FrameLayout;
}

export interface LogoIcon {
	readonly id: string;
	readonly labelKey: MessageKey;
	/** In the unit box (0,0)-(1,1). */
	readonly path: Path;
}

export type PresetCategory =
	'classic' | 'rounded' | 'dots' | 'hex' | 'fluid' | 'bold' | 'minimal' | 'colour' | 'print';

export interface Preset {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly category: PresetCategory;
	readonly design: QrDesignV1;
	/** The smallest printed width that scans, at the level the design asks for. */
	readonly minSizeMm: number;
	readonly ecLevels: readonly EcLevel[];
	/**
	 * The smallest printed width at each level the preset allows: a higher
	 * level fits the same content in a larger symbol, whose modules are
	 * smaller at the same width. A level left out takes `minSizeMm`. The
	 * built-ins give every level they allow. A contract addition.
	 */
	readonly sizesMm?: Readonly<Partial<Record<EcLevel, number>>>;
}

export interface DesignRegistries {
	readonly moduleShapes: Registry<ModuleShape>;
	readonly regionShapes: Registry<RegionShape>;
	readonly fills: Registry<FillEntry>;
	readonly frames: Registry<FrameEntry>;
	readonly icons: Registry<LogoIcon>;
	readonly presets: Registry<Preset>;
}

/** What a content type prints over the middle of every code of its kind. */
export type DesignOverlay = 'swiss-cross';

export interface BuildContext {
	readonly registries: DesignRegistries;
	/** Decoded PNG assets; render/decodePng does it. */
	readonly assets?: (id: string) => RgbaImage | undefined;
	/** Where a caption's font is found. Defaults to the built-in family. */
	readonly fonts?: FontRegistry;
	readonly seed?: number;
	/**
	 * The overlay the content's constraints call for, as `applyConstraints`
	 * returns it. A contract addition: see the module comment.
	 */
	readonly overlay?: DesignOverlay | null;
}

export interface BuiltScene {
	readonly scene: Scene;
	/** 1 where a module is hidden or altered by the logo, its plate or the overlay, row major over the symbol. */
	readonly obscured: Uint8Array;
	/** Fraction of each dark module's cell the shape actually inks, for the distance check. */
	readonly inkFraction: number;
	readonly issues: readonly Issue[];
}

/**
 * The payload layer's `PayloadConstraints`, repeated because design may not
 * import payload. Structurally identical, so a content type's constraints
 * pass straight in.
 */
export interface DesignConstraints {
	readonly ecLevels?: readonly EcLevel[];
	readonly maxVersion?: string;
	readonly symbologies?: readonly string[];
	readonly sizeMm?: number;
	readonly colours?: 'black-on-white';
	readonly designLocked?: boolean;
	readonly overlay?: 'swiss-cross';
	readonly eci?: 'never';
}
