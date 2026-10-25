/**
 * Handing a finished file to the person: a download, or the clipboard.
 *
 * There is no server, so there is nothing to download from. The file is
 * built in the tab and handed to the browser through an object URL, the one
 * way a page has of saying "save this" about bytes it made itself. Lifted from
 * private-image-converter's src/dom/download.ts, with the browser objects
 * injected so the mechanics are tested without one, and Results in place of
 * throws.
 */

import { QrStudioError } from '../core/errors.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';

/**
 * How long the object URL stays open after the click. Revoking at once is
 * wrong: the browser may not have read the blob when click() returns, and
 * Safari cancels the save. A minute is far longer than a save needs.
 */
export const REVOKE_AFTER_MS = 60_000;

interface AnchorLike {
	href: string;
	download: string;
	rel: string;
	style: { display: string };
	click(): void;
	remove(): void;
}

export interface DownloadDeps {
	readonly document?: {
		createElement(tag: 'a'): AnchorLike;
		readonly body: { appendChild(node: AnchorLike): unknown };
	};
	readonly url?: {
		createObjectURL(blob: Blob): string;
		revokeObjectURL(url: string): void;
	};
	readonly setTimeout?: (task: () => void, ms: number) => unknown;
}

export interface ClipboardDeps {
	readonly clipboard?: {
		write?(items: readonly unknown[]): Promise<void>;
		writeText?(text: string): Promise<void>;
	};
	/** The ClipboardItem constructor. */
	readonly ClipboardItem?: new (items: Record<string, Blob | Promise<Blob>>) => unknown;
}

function unavailable(feature: string): QrStudioError {
	return new QrStudioError('platform/unavailable', 'This browser cannot do that here.', {
		feature,
	});
}

export function downloadBlob(blob: Blob, filename: string, deps: DownloadDeps = {}): Result<null> {
	const doc =
		deps.document ??
		(typeof document === 'undefined'
			? undefined
			: (document as unknown as DownloadDeps['document']));
	const urls =
		deps.url ??
		(typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
			? (URL as unknown as DownloadDeps['url'])
			: undefined);
	if (doc === undefined || urls === undefined) return err(unavailable('download'));
	const later = deps.setTimeout ?? ((task: () => void, ms: number) => setTimeout(task, ms));
	const url = urls.createObjectURL(blob);
	const anchor = doc.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	// In the document rather than detached, because Firefox ignores a click
	// on an element that is not in it.
	anchor.style.display = 'none';
	doc.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	later(() => urls.revokeObjectURL(url), REVOKE_AFTER_MS);
	return ok(null);
}

export function downloadBytes(
	bytes: Uint8Array,
	filename: string,
	mime: string,
	deps: DownloadDeps = {},
): Result<null> {
	return downloadBlob(new Blob([bytes as BlobPart], { type: mime }), filename, deps);
}

function platformClipboard(): ClipboardDeps['clipboard'] {
	return typeof navigator !== 'undefined'
		? (navigator.clipboard as ClipboardDeps['clipboard'])
		: undefined;
}

/**
 * Put a PNG on the clipboard. PNG is the one image type every browser's
 * clipboard is required to take (the Async Clipboard API's mandatory set).
 */
export async function copyImageToClipboard(
	png: Uint8Array | Blob,
	deps: ClipboardDeps = {},
): Promise<Result<null>> {
	const clipboard = deps.clipboard ?? platformClipboard();
	const Item =
		deps.ClipboardItem ??
		(typeof ClipboardItem === 'function'
			? (ClipboardItem as unknown as NonNullable<ClipboardDeps['ClipboardItem']>)
			: undefined);
	if (clipboard?.write === undefined || Item === undefined) return err(unavailable('clipboard'));
	const blob = png instanceof Blob ? png : new Blob([png as BlobPart], { type: 'image/png' });
	try {
		await clipboard.write([new Item({ 'image/png': blob })]);
		return ok(null);
	} catch {
		// Refused: no user gesture, the document not focused, or a permission
		// the person declined. All the same to them: it did not copy.
		return err(unavailable('clipboard'));
	}
}

export async function copyText(text: string, deps: ClipboardDeps = {}): Promise<Result<null>> {
	const clipboard = deps.clipboard ?? platformClipboard();
	if (clipboard?.writeText === undefined) return err(unavailable('clipboard'));
	try {
		await clipboard.writeText(text);
		return ok(null);
	} catch {
		return err(unavailable('clipboard'));
	}
}
