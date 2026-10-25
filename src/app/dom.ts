/**
 * Building the page out of nodes.
 *
 * The document's policy names the sha256 of its one script and its one
 * stylesheet and nothing else, so markup parsed from a string at runtime is
 * not something this file can rely on, and it would be the one route by
 * which a person's own content could become markup. Every node is made with
 * createElement or createElementNS and every piece of text goes in through
 * textContent. There is no innerHTML anywhere in the application.
 *
 * Styles are never written as an attribute either: the policy refuses a
 * `style` attribute, while a write through the CSSOM (`node.style.setProperty`)
 * is the script's own and is allowed.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export type Child = Node | string | null | undefined | false;

type Listeners = {
	readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
};

export interface Props {
	readonly className?: string;
	readonly id?: string;
	readonly text?: string;
	/** Attributes, set with setAttribute. A null, undefined or false value is left off. */
	readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
	readonly on?: Listeners;
}

function append(node: Node, children: readonly Child[]): void {
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	}
}

function setAttrs(node: Element, attrs: Props['attrs']): void {
	if (attrs === undefined) return;
	for (const [name, value] of Object.entries(attrs)) {
		if (value === null || value === undefined || value === false) continue;
		node.setAttribute(name, value === true ? '' : String(value));
	}
}

/** An element, its class, attributes, listeners and children in one call. */
export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Props = {},
	children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (props.className !== undefined) node.className = props.className;
	if (props.id !== undefined) node.id = props.id;
	if (props.text !== undefined) node.textContent = props.text;
	setAttrs(node, props.attrs);
	if (props.on !== undefined) {
		for (const [type, listener] of Object.entries(props.on)) {
			node.addEventListener(type, listener as EventListener);
		}
	}
	append(node, children);
	return node;
}

/** An SVG element. */
export function s<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Readonly<Record<string, string | number>> = {},
	children: readonly Child[] = [],
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
	append(node, children);
	return node;
}

/** An element the template must have. Throws while the program starts, where a test sees it. */
export function byId<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (found === null) throw new Error(`missing element #${id}`);
	return found as T;
}

/** Replace every child of `node`. */
export function replace(node: Node, children: readonly Child[]): void {
	while (node.firstChild !== null) node.removeChild(node.firstChild);
	append(node, children);
}

/** Set text only when it changed, so a screen reader is not told the same thing twice. */
export function setText(node: Node, text: string): void {
	if (node.textContent !== text) node.textContent = text;
}

/** A short id, unique on this page, for tying a label or a description to a control. */
let nextId = 0;
export function uid(prefix: string): string {
	nextId += 1;
	return `${prefix}-${nextId}`;
}

/**
 * The icons, as path data on a 24 unit grid, drawn with a 1.75 unit stroke.
 * Every one sits beside a word or carries an accessible name of its own:
 * none is the only way a meaning is given.
 */
const ICONS = {
	undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
	redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
	link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.1 1.1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1',
	download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14',
	copy: 'M9 9h10v11H9zM5 15V4h10',
	print:
		'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
	camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
	image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
	file: 'M14 3H6v18h12V7zM14 3v4h4',
	pass: 'm5 12.5 4.5 4.5L19 7.5',
	fail: 'M6 6l12 12M18 6 6 18',
	warn: 'M12 4 2.8 20h18.4zM12 10v4.5M12 17.5h.01',
	pending: 'M12 4a8 8 0 1 0 8 8M12 8v4l3 2',
	shuffle:
		'M4 7h3.5c3 0 4.5 10 8 10H20m0 0-3-3m3 3-3 3M4 17h3.5c1.2 0 2.1-1.4 2.8-3M20 7h-4.5c-1.2 0-2.1 1.4-2.8 3M20 7l-3-3m3 3-3 3',
	plus: 'M12 5v14M5 12h14',
	chevron: 'm6 9 6 6 6-6',
	minus: 'M5 12h14',
	eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
	ruler: 'M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2',
	open: 'M4 6h6l2 2h8v11H4zM4 10h16',
	save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
	stop: 'M7 7h10v10H7z',
	close: 'M6 6l12 12M18 6 6 18',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, extraClass?: string): SVGSVGElement {
	const svg = s('svg', {
		viewBox: '0 0 24 24',
		class: extraClass === undefined ? 'icon' : `icon ${extraClass}`,
		'aria-hidden': 'true',
	});
	svg.setAttribute('focusable', 'false');
	svg.appendChild(s('path', { d: ICONS[name] }));
	return svg;
}

/** Read a file the person chose or dropped, as text or as bytes. */
export async function fileText(file: Blob): Promise<string> {
	return file.text();
}

export async function fileBytes(file: Blob): Promise<Uint8Array> {
	return new Uint8Array(await file.arrayBuffer());
}
