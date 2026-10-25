/**
 * Printing a code at its physical size, through the browser's print dialog.
 *
 * The code goes into a hidden frame holding a one-page document whose print
 * stylesheet sets the page to exactly the code's size with no margin, so a
 * printer told "actual size" prints 25 mm as 25 mm. The SVG is the studio's
 * own (render's `sceneToSvg`), never a person's, so it carries no script; the
 * frame is sandboxed as well, with only what printing needs.
 *
 * The window is injected, as everything in this layer is, and nothing is
 * touched until `printScene` is called.
 */

import { QrStudioError } from '../core/errors.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';

/** How long the frame is kept if the browser never says printing finished. */
export const PRINT_CLEANUP_MS = 60_000;

interface PrintFrame {
	srcdoc: string;
	style: { cssText: string };
	setAttribute(name: string, value: string): void;
	addEventListener(type: 'load', listener: () => void): void;
	readonly contentWindow: {
		focus?(): void;
		print(): void;
		addEventListener?(type: 'afterprint', listener: () => void): void;
	} | null;
	remove(): void;
}

export interface PrintDeps {
	readonly window: {
		readonly document: {
			createElement(tag: 'iframe'): PrintFrame;
			readonly body: { appendChild(node: PrintFrame): unknown };
		};
		setTimeout(task: () => void, ms: number): unknown;
	};
}

function mm(value: number): string {
	return `${Math.round(value * 1000) / 1000}mm`;
}

/** The SVG's own aspect, from its viewBox. */
function aspect(svg: string): number | null {
	const match = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg);
	if (match === null) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? height / width : null;
}

/** The one-page document a code is printed from. */
export function printDocument(svg: string, widthMm: number, heightMm: number): string {
	const size = `${mm(widthMm)} ${mm(heightMm)}`;
	return [
		'<!doctype html><html><head><meta charset="utf-8"><title>QR code</title><style>',
		`@page{size:${size};margin:0}`,
		'html,body{margin:0;padding:0;background:#fff}',
		`body{width:${mm(widthMm)};height:${mm(heightMm)};overflow:hidden}`,
		`svg{display:block;width:${mm(widthMm)};height:${mm(heightMm)}}`,
		'</style></head><body>',
		svg,
		'</body></html>',
	].join('');
}

/**
 * Open the print dialog for `svg` at `sizeMm`: the width, with the height from
 * the SVG's own proportions, or both.
 */
export function printScene(
	svg: string,
	sizeMm: number | { readonly widthMm: number; readonly heightMm: number },
	deps: PrintDeps,
): Promise<Result<null>> {
	if (typeof svg !== 'string' || !svg.startsWith('<svg') || /<script/i.test(svg)) {
		throw new TypeError("printScene: svg is the studio's own SVG, from sceneToSvg.");
	}
	const widthMm = typeof sizeMm === 'number' ? sizeMm : sizeMm.widthMm;
	const ratio = aspect(svg) ?? 1;
	const heightMm = typeof sizeMm === 'number' ? sizeMm * ratio : sizeMm.heightMm;
	if (
		!(widthMm > 0) ||
		!(heightMm > 0) ||
		!Number.isFinite(widthMm) ||
		!Number.isFinite(heightMm)
	) {
		throw new TypeError('printScene: the size is a number of millimetres greater than zero.');
	}
	const { document, setTimeout } = deps.window;
	const frame = document.createElement('iframe');
	frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
	frame.setAttribute('aria-hidden', 'true');
	frame.style.cssText =
		'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
	return new Promise((resolve) => {
		let removed = false;
		const remove = (): void => {
			if (removed) return;
			removed = true;
			frame.remove();
		};
		frame.addEventListener('load', () => {
			const view = frame.contentWindow;
			if (view === null) {
				remove();
				resolve(
					err(
						new QrStudioError('platform/unavailable', 'This browser cannot print from here.', {
							feature: 'print',
						}),
					),
				);
				return;
			}
			view.addEventListener?.('afterprint', remove);
			setTimeout(remove, PRINT_CLEANUP_MS);
			view.focus?.();
			try {
				view.print();
				resolve(ok(null));
			} catch {
				remove();
				resolve(
					err(
						new QrStudioError('platform/unavailable', 'This browser cannot print from here.', {
							feature: 'print',
						}),
					),
				);
			}
		});
		frame.srcdoc = printDocument(svg, widthMm, heightMm);
		document.body.appendChild(frame);
	});
}
