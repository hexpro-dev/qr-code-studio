/**
 * A frame's caption, set by the text layer into the box the frame reserves.
 *
 * The caption becomes filled paths in the scene, never live text, so an SVG,
 * a PNG, a PDF and an EPS of one design all carry the same outlines, the scan
 * check sees exactly what is printed, and nothing in a file can be searched
 * or copied back out of it.
 *
 * It is set as large as the box allows: one line filling the box's height,
 * shrunk until it fits on the frame's lines, down to a floor of half the size
 * at which those lines fill the box. Past the floor it is drawn at the floor,
 * clipped to the box so it never reaches the quiet zone, with a warning. A
 * character the font cannot draw is left out and reported, never swapped for
 * one from another font, because a caption that silently says something else
 * is worse than one that says what is missing.
 *
 * Unless the design paints it, the caption takes the frame's ink for where
 * it sits: on the frame's own artwork (a banner's band, a card's foot) it is
 * knocked out in the design's background, white when that is transparent, as
 * the quiet zone is; beside the artwork (under corner brackets, beside a
 * speech bubble's tail) it is drawn in the frame's paint. Which of the two a
 * box is, is measured from the frame's drawing rather than declared, so a
 * frame written to the contract alone gets the right one.
 *
 * Nothing here puts the caption's text into an issue or a title: an issue
 * carries a count at most.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Prng } from '../core/prng.js';
import { PathBuilder } from '../geometry/path.js';
import { rasterise } from '../render/raster.js';
import type { SceneNode, ScenePaint } from '../render/types.js';
import { layoutText } from '../text/layout.js';
import { createFontRegistry } from '../text/registry.js';
import type { FontRegistry } from '../text/types.js';
import { LIMITS } from './document.js';
import { resolvePaint } from './paint.js';
import type {
	DesignFrame,
	DesignPaint,
	DesignRegistries,
	FrameEntry,
	FrameLayout,
} from './types.js';

/** CSS's usual line height, the least a caption is set at. */
const MIN_LINE_HEIGHT = 1.2;
/** Pixels across the caption box when measuring whether it sits on the frame's artwork. */
const ON_ARTWORK_SAMPLES = 24;
/** The most pixels that measurement draws, however small the box is against the artwork. */
const ON_ARTWORK_PIXELS = 16384;

const WHITE: DesignPaint = { kind: 'solid', ink: '#ffffff' };

/** Code points, so a caption's length is what a person counts. */
export function codePoints(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i += 1) {
		const unit = text.charCodeAt(i);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) i += 1;
		}
		count += 1;
	}
	return count;
}

/**
 * Whether most of the caption box is covered by the frame's own drawing.
 *
 * The frame is drawn alone at about ON_ARTWORK_SAMPLES pixels across the box,
 * and the coverage of the pixels whose centres fall in the box is averaged.
 * A box thinner than a pixel is judged by the pixel at its centre.
 */
function onArtwork(layout: FrameLayout, box: NonNullable<FrameLayout['textBox']>): boolean {
	const scale = Math.min(
		ON_ARTWORK_SAMPLES / box.width,
		Math.sqrt(ON_ARTWORK_PIXELS / (layout.width * layout.height)),
	);
	const width = Math.max(1, Math.ceil(layout.width * scale));
	const height = Math.max(1, Math.ceil(layout.height * scale));
	// The scene is sized to whole pixels at exactly `scale`, so a pixel's
	// centre maps back to the frame's units without rounding.
	const image = rasterise(
		{
			width: width / scale,
			height: height / scale,
			background: null,
			layers: [...layout.nodes, ...(layout.over ?? [])],
		},
		{ width, height },
	);
	const alpha = (x: number, y: number): number =>
		(image.data[(y * width + x) * 4 + 3] as number) / 255;
	let sum = 0;
	let count = 0;
	const x0 = Math.max(0, Math.ceil(box.x * scale - 0.5));
	const x1 = Math.min(width - 1, Math.floor((box.x + box.width) * scale - 0.5));
	const y0 = Math.max(0, Math.ceil(box.y * scale - 0.5));
	const y1 = Math.min(height - 1, Math.floor((box.y + box.height) * scale - 0.5));
	for (let y = y0; y <= y1; y += 1) {
		for (let x = x0; x <= x1; x += 1) {
			sum += alpha(x, y);
			count += 1;
		}
	}
	if (count === 0) {
		const cx = Math.min(width - 1, Math.floor((box.x + box.width / 2) * scale));
		const cy = Math.min(height - 1, Math.floor((box.y + box.height / 2) * scale));
		return alpha(cx, cy) >= 0.5;
	}
	return sum / count >= 0.5;
}

export interface CaptionContext {
	readonly frame: FrameEntry;
	readonly layout: FrameLayout;
	readonly text: NonNullable<DesignFrame['text']>;
	readonly fonts: FontRegistry | undefined;
	readonly registries: DesignRegistries;
	/** The frame's paint as drawn, for a caption beside the artwork. */
	readonly framePaint: ScenePaint;
	/** The design's background, already checked, or null when it is transparent. */
	readonly background: DesignPaint | null;
	/** Checks an entry paint: null, with an issue, when its fill is missing. */
	readonly paint: (paint: DesignPaint) => DesignPaint | null;
	readonly prng: Prng;
}

/** The caption as scene nodes for the frame's `over` layer, and what went wrong setting it. */
export function drawCaption(ctx: CaptionContext): {
	readonly nodes: readonly SceneNode[];
	readonly issues: readonly Issue[];
} {
	const { frame, layout, text } = ctx;
	const at = ['frame', 'text'];
	const issues: Issue[] = [];
	const box = layout.textBox;
	const limits = frame.text;
	if (limits === null || box === null || !(box.width > 0) || !(box.height > 0)) {
		issues.push(issue('design.issue.caption-unsupported', at, 'warning'));
		return { nodes: [], issues };
	}
	const length = codePoints(text.content);
	const max = Math.min(limits.maxChars, LIMITS.caption);
	if (length > max) {
		// validateDesign refuses this; a design that skipped it is drawn
		// without the caption rather than with one the frame cannot hold.
		issues.push(issue('design.issue.too-long', [...at, 'content'], 'warning', { length, max }));
		return { nodes: [], issues };
	}
	const fonts = ctx.fonts ?? createFontRegistry();
	const font = fonts.get(text.fontId);
	if (font === undefined) {
		issues.push(issue('design.issue.font-unavailable', [...at, 'fontId'], 'warning'));
		return { nodes: [], issues };
	}

	// The line is at least as tall as the font's own line box, so no glyph
	// reaches past the caption box while the caption fits it.
	const lineHeight = Math.max(MIN_LINE_HEIGHT, (font.ascender - font.descender) / font.unitsPerEm);
	const size = box.height / lineHeight;
	const result = layoutText(text.content, {
		fonts,
		fontId: font.id,
		size,
		box,
		align: box.align,
		maxLines: limits.maxLines,
		lineHeight,
		shrinkToFit: true,
		minSize: size / (2 * limits.maxLines),
	});
	if (result.missing.length > 0) {
		issues.push(
			issue('design.issue.caption-missing-glyphs', [...at, 'content'], 'warning', {
				count: result.missing.length,
			}),
		);
	}
	if (result.overflow)
		issues.push(issue('design.issue.caption-overflow', [...at, 'content'], 'warning'));

	const out = new PathBuilder();
	for (const path of result.paths) out.append(path);
	if (out.empty) return { nodes: [], issues };

	// A paint whose fill this registry lacks falls back to the frame's ink,
	// as a missing paint anywhere else falls back to the plain one.
	const area = { x: box.x, y: box.y, width: box.width, height: box.height };
	const own = text.paint === undefined ? null : ctx.paint(text.paint);
	let paint: ScenePaint;
	if (own !== null) paint = resolvePaint(own, area, ctx.registries.fills, ctx.prng);
	else if (onArtwork(layout, box)) {
		paint = resolvePaint(ctx.background ?? WHITE, area, ctx.registries.fills, ctx.prng);
	} else paint = ctx.framePaint;
	const node: SceneNode = { kind: 'path', path: out.build(), paint, role: 'caption' };
	if (!result.overflow) return { nodes: [node], issues };
	// What does not fit is cut at the box, which the frame keeps clear of
	// the quiet zone.
	return {
		nodes: [
			{
				kind: 'group',
				children: [node],
				clip: new PathBuilder().rect(box.x, box.y, box.width, box.height).build(),
			},
		],
		issues,
	};
}
