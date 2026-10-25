/**
 * Pictures of codes, from the SVG strings the studio draws.
 *
 * Each goes into an `<img>` through an object URL, which the policy allows
 * (`img-src blob:`) and which keeps the markup free of the drawing. An SVG
 * shown through an image element cannot run script or reach anything outside
 * itself, whatever it contains, so a design file somebody sent cannot do more
 * than draw. Every URL is revoked when its picture is replaced, so a session
 * of typing does not leave a thousand drawings held in memory.
 */

interface Shown {
	readonly url: string;
	readonly svg: string;
}

const owned = new WeakMap<HTMLImageElement, Shown>();
const cache = new Map<string, string>();

/** Show `svg` in `img`, revoking the URL it had before. Does nothing when the drawing is the same. */
export function showSvg(img: HTMLImageElement, svg: string): void {
	const before = owned.get(img);
	// The studio hands back the same string object for an unchanged drawing,
	// so this is usually an identity check rather than a comparison of 40 kB.
	if (before !== undefined && before.svg === svg) return;
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	owned.set(img, { url, svg });
	img.src = url;
	if (before !== undefined) URL.revokeObjectURL(before.url);
}

/** The URL `img` is showing, for a second view of the same picture (the print copy, the strip). */
export function shownUrl(img: HTMLImageElement): string | null {
	return owned.get(img)?.url ?? null;
}

/** Take the picture out of `img` and let its URL go. */
export function clearImage(img: HTMLImageElement): void {
	const before = owned.get(img);
	if (before !== undefined) URL.revokeObjectURL(before.url);
	owned.delete(img);
	img.removeAttribute('src');
}

/**
 * A URL for a drawing that never changes (a catalogue thumbnail), kept for
 * the life of the page and shared by every image that shows it.
 */
export function staticUrl(id: string, draw: () => string): string {
	let url = cache.get(id);
	if (url === undefined) {
		url = URL.createObjectURL(new Blob([draw()], { type: 'image/svg+xml' }));
		cache.set(id, url);
	}
	return url;
}
