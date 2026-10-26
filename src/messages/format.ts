/**
 * Filling a message's placeholders: the subset of ICU MessageFormat the
 * website's formatter reads (`@hex-pro/i18n/message` in hex-web), so one
 * English sentence works in both.
 *
 *   {name}                                         a value, as given
 *   {count, plural, =0 {...} one {...} other {...}}  a branch by count; `#` is the count
 *   {kind, select, photo {...} other {...}}           a branch by value
 *
 * Blocks nest. Plural rules are English only, which is all this catalogue is
 * written in: `=N` first, then `one` for exactly 1, then `other`. No `Intl`,
 * because English needs none. A value is never formatted, `#` included: it
 * is written as the param was given, so a view that wants 10,000 passes it
 * that way and a count that selects a branch is passed as a number.
 *
 * Anything that cannot be filled is left as it was written: a `{name}` with
 * no param, a block whose param is missing or (for a plural) not a number, a
 * block with no branch that applies, and a brace that starts nothing this
 * reads. A gap then shows as the bug it is rather than as a missing word.
 */

type Params = Readonly<Record<string, number | string>>;

type Node =
	| string
	| { readonly kind: 'pound' }
	| { readonly kind: 'argument'; readonly name: string; readonly source: string }
	| {
			readonly kind: 'plural' | 'select';
			readonly name: string;
			readonly source: string;
			readonly branches: ReadonlyMap<string, readonly Node[]>;
	  };

const POUND: Node = Object.freeze({ kind: 'pound' });

/** `{name}`, or the start of `{name, plural,` or `{name, select,`. Sticky, so it reads at one place. */
const HEAD = /\{\s*(\w+)\s*(?:(\})|,\s*(plural|select)\s*,)/y;
/** A branch's selector and its opening brace. */
const SELECTOR = /\s*(=\d+(?:\.\d+)?|[\w-]+)\s*\{/y;
const CLOSE = /\s*\}/y;

interface Cursor {
	readonly source: string;
	pos: number;
}

/** Text, arguments and blocks up to the end, or up to the `}` that closes the branch being read. */
function parseNodes(
	cursor: Cursor,
	inBranch: boolean,
	inPlural: boolean,
): { nodes: Node[]; closed: boolean } {
	const nodes: Node[] = [];
	let text = '';
	const flush = (): void => {
		if (text !== '') nodes.push(text);
		text = '';
	};
	while (cursor.pos < cursor.source.length) {
		const char = cursor.source[cursor.pos] as string;
		if (char === '{') {
			const block = parseBlock(cursor, inPlural);
			if (block !== null) {
				flush();
				nodes.push(block);
				continue;
			}
		} else if (char === '}' && inBranch) {
			flush();
			return { nodes, closed: true };
		} else if (char === '#' && inPlural) {
			flush();
			nodes.push(POUND);
			cursor.pos += 1;
			continue;
		}
		text += char;
		cursor.pos += 1;
	}
	flush();
	return { nodes, closed: false };
}

/** One `{...}` at the cursor, or null with the cursor where it was, for the brace to be read as text. */
function parseBlock(cursor: Cursor, inPlural: boolean): Node | null {
	const start = cursor.pos;
	HEAD.lastIndex = start;
	const head = HEAD.exec(cursor.source);
	if (head === null) return null;
	const name = head[1] as string;
	cursor.pos = HEAD.lastIndex;
	if (head[2] !== undefined) {
		return { kind: 'argument', name, source: cursor.source.slice(start, cursor.pos) };
	}
	const kind = head[3] as 'plural' | 'select';
	const branches = new Map<string, readonly Node[]>();
	for (;;) {
		CLOSE.lastIndex = cursor.pos;
		if (branches.size > 0 && CLOSE.test(cursor.source)) {
			cursor.pos = CLOSE.lastIndex;
			return { kind, name, source: cursor.source.slice(start, cursor.pos), branches };
		}
		SELECTOR.lastIndex = cursor.pos;
		const selector = SELECTOR.exec(cursor.source);
		if (selector === null) break;
		cursor.pos = SELECTOR.lastIndex;
		const body = parseNodes(cursor, true, inPlural || kind === 'plural');
		if (!body.closed) break;
		cursor.pos += 1;
		// The first branch for a selector wins, as in the website's formatter.
		if (!branches.has(selector[1] as string)) branches.set(selector[1] as string, body.nodes);
	}
	cursor.pos = start;
	return null;
}

function parse(template: string): readonly Node[] {
	return parseNodes({ source: template, pos: 0 }, false, false).nodes;
}

function has(params: Params, name: string): boolean {
	return Object.prototype.hasOwnProperty.call(params, name);
}

/** English: `=N`, then `one` for exactly 1, then `other`. */
function pluralBranch(
	branches: ReadonlyMap<string, readonly Node[]>,
	count: number,
): readonly Node[] | undefined {
	return (
		branches.get(`=${count}`) ??
		(count === 1 ? branches.get('one') : undefined) ??
		branches.get('other')
	);
}

function render(nodes: readonly Node[], params: Params, pound: string | undefined): string {
	let out = '';
	for (const node of nodes) {
		if (typeof node === 'string') {
			out += node;
			continue;
		}
		switch (node.kind) {
			case 'pound':
				// `#` is read as the count only inside a plural branch, which passes its count.
				out += pound as string;
				break;
			case 'argument':
				out += has(params, node.name) ? String(params[node.name]) : node.source;
				break;
			case 'select': {
				const branch = has(params, node.name)
					? (node.branches.get(String(params[node.name])) ?? node.branches.get('other'))
					: undefined;
				out += branch === undefined ? node.source : render(branch, params, pound);
				break;
			}
			case 'plural': {
				const value = has(params, node.name) ? params[node.name] : undefined;
				const count =
					typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
						? Number(value)
						: Number.NaN;
				const branch = Number.isFinite(count) ? pluralBranch(node.branches, count) : undefined;
				out += branch === undefined ? node.source : render(branch, params, String(value));
				break;
			}
		}
	}
	return out;
}

/** `template` with its placeholders filled from `params`, and its blocks' branches chosen. */
export function formatMessage(template: string, params: Params = {}): string {
	if (!template.includes('{')) return template;
	return render(parse(template), params, undefined);
}

/**
 * Every param a message reads, at any depth: each `{name}`, and each plural's
 * and select's own. A catalogue test checks each is one the key is given.
 */
export function messageArguments(template: string): readonly string[] {
	const names = new Set<string>();
	const visit = (nodes: readonly Node[]): void => {
		for (const node of nodes) {
			if (typeof node === 'string' || node.kind === 'pound') continue;
			names.add(node.name);
			if (node.kind !== 'argument') for (const branch of node.branches.values()) visit(branch);
		}
	};
	visit(parse(template));
	return [...names];
}
