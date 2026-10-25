/**
 * Which text controls keep the browser's own undo.
 *
 * Every content field is the studio's: its value is the document's, so
 * Cmd/Ctrl+Z there is the studio's undo, which puts back a whole run of
 * typing at once and the code with it. A few inputs are not part of the
 * document at all (a pasted spreadsheet, the name a code is saved under), and
 * for those the browser's undo is the right one.
 */

const own = new WeakSet<Element>();

export function keepNativeUndo(node: Element): void {
	own.add(node);
}

export function hasNativeUndo(node: EventTarget | null): boolean {
	return node instanceof Element && own.has(node);
}
