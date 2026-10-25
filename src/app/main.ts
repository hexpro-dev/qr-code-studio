/**
 * The offline application: one HTML file that makes, designs, checks and reads
 * QR codes with the network off.
 *
 * A thin view over the headless studio (src/studio). Every change a person
 * makes is an action dispatched to it, every file is a command run on it, and
 * every view draws from the snapshot it hands back; nothing here keeps a copy
 * of the document. The page is built from nodes rather than parsed markup
 * (see dom.ts), and every word on it comes from the English catalogue.
 *
 * The URL fragment can preselect a mode (`#scan`), a content type (`#wifi`)
 * or a design (`#v1.` and a design link), alone or together (`#create/wifi`).
 * The page never writes the fragment back: there is nothing to keep, and a
 * file opened from disk has no history worth adding to.
 */

import { decodeDesignLink } from '../design/link.js';
import type { QrDesignV1 } from '../design/types.js';
import { LIBRARY_EXTENSION, createFileLibrary } from '../dom/file-library.js';
import { canvasRasterEncoder } from '../dom/raster-encoder.js';
import { FONT_LICENCE } from '../fonts/latin.js';
import { createRegistries } from '../registries.js';
import { DEFAULT_CONDITIONS, createStudio } from '../studio/index.js';
import type { StudioDocument, StudioMode } from '../studio/index.js';
import { createBulk } from './bulk.js';
import { createCheck, createStrip } from './check.js';
import { createContent } from './content.js';
import type { AppContext, View } from './context.js';
import { button, card } from './controls.js';
import type { Card } from './controls.js';
import {
	createColour,
	createEyes,
	createFrame,
	createGallery,
	createLogo,
	createModules,
	createPrint,
	matchPreset,
} from './design-panels.js';
import type { Panel } from './design-panels.js';
import { byId, h, replace, setText } from './dom.js';
import { createLibrary } from './library-view.js';
import { createProof } from './proof.js';
import { createSaver } from './save.js';
import { createScan } from './scan.js';
import { hasNativeUndo } from './shortcuts.js';
import { issueText, t } from './text.js';

declare const __VERSION__: string;

const MODES: readonly StudioMode[] = ['create', 'scan', 'bulk'];

// The fragment.

interface Fragment {
	readonly design: string | null;
	readonly mode: StudioMode | null;
	readonly typeId: string | null;
}

function readFragment(hash: string, isType: (id: string) => boolean): Fragment {
	let raw = hash.replace(/^#/, '');
	try {
		raw = decodeURIComponent(raw);
	} catch {
		// A fragment that is not valid percent-encoding is read as it stands.
	}
	let design: string | null = null;
	let mode: StudioMode | null = null;
	let typeId: string | null = null;
	for (const part of raw.split(/[/&]/)) {
		const token = part.replace(/^(?:mode|type|design)=/, '');
		if (token.startsWith('v1.')) design = token;
		else if ((MODES as readonly string[]).includes(token)) mode = token as StudioMode;
		else if (token !== '' && isType(token)) typeId = token;
	}
	return { design, mode, typeId };
}

// The studio.

const registries = createRegistries();
// The library is a file the person saves and opens, checked against the same
// registries the studio uses so a design it can draw is one the library keeps.
const library = createFileLibrary({ registries });
const isType = (id: string): boolean => {
	const type = registries.payloads.get(id);
	return type !== undefined && type.generate !== false;
};
const fragment = readFragment(location.hash, isType);
let initialNotice: string | null = null;

/** What the studio opens with: a design link alone, or a whole document when the fragment names more. */
function initial(): string | StudioDocument | undefined {
	if (fragment.mode === null && fragment.typeId === null) return fragment.design ?? undefined;
	let design: QrDesignV1 | undefined;
	if (fragment.design !== null) {
		try {
			design = decodeDesignLink(fragment.design, registries.design);
		} catch {
			initialNotice = t('studio.issue.design-link');
		}
	}
	// documentFrom fills what is left out: the type's empty fields, and the
	// standard design when the link gave none.
	return {
		mode: fragment.mode ?? 'create',
		typeId: fragment.typeId ?? 'url',
		fields: {},
		...(design === undefined ? {} : { design }),
		conditions: DEFAULT_CONDITIONS,
	} as unknown as StudioDocument;
}

const studio = createStudio({
	registries,
	library,
	rasterEncoder: canvasRasterEncoder(),
	initial: initial(),
	// SEAM(verify), SEAM(inspect): once those layers merge, the studio's own
	// defaults light up the scan check and the inspector with no change here.
});

const status = h('p', { className: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } });
status.dataset.shown = 'false';
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const ctx: AppContext = {
	studio,
	registries,
	library,
	dispatch: (action) => studio.dispatch(action),
	snapshot: () => studio.getSnapshot(),
	announce(text) {
		// Cleared first, so the same sentence twice is still read out twice.
		status.textContent = '';
		status.dataset.shown = 'true';
		requestAnimationFrame(() => {
			status.textContent = text;
		});
		if (toastTimer !== null) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			status.dataset.shown = 'false';
		}, 6000);
	},
};

// The footer the template carries, with its words from the catalogue.

byId('version').textContent = __VERSION__;
byId('font-licence').textContent = FONT_LICENCE;
setText(byId('about-title'), t('app.about.title'));
setText(byId('facts-title'), t('app.about.facts'));
setText(byId('version-label'), t('app.about.version'));
setText(byId('source-label'), t('app.about.source'));
setText(byId('licence-title'), t('app.about.licence'));
setText(byId('licence-intro'), t('app.about.licence-intro'));
setText(byId('check-it'), t('app.about.check'));

const printImg = h('img', { className: 'print-sheet__img', attrs: { alt: '' } });
document.body.appendChild(h('div', { className: 'print-sheet' }, [printImg]));

// The proof, and the save buttons under it.

const stripHost = h('div', { className: 'strip-host' });
const actionsHost = h('div', { className: 'actions-host' });
let proofView: ReturnType<typeof createProof> | null = null;
const saver = createSaver(ctx, () => proofView, printImg);
const proof = createProof(ctx, actionsHost, stripHost);
proofView = proof;
const strip = createStrip(ctx, proof);
stripHost.appendChild(strip.root);
actionsHost.appendChild(saver.actions);

// The masthead: the heading, the modes, and the tools that work in every mode.

function undo(): void {
	if (!studio.getSnapshot().history.canUndo) return;
	studio.dispatch({ type: 'history/undo' });
	ctx.announce(t('app.history.undone'));
}

function redo(): void {
	if (!studio.getSnapshot().history.canRedo) return;
	studio.dispatch({ type: 'history/redo' });
	ctx.announce(t('app.history.redone'));
}

const undoButton = button(t('app.history.undo'), {
	icon: 'undo',
	small: true,
	attrs: { 'aria-keyshortcuts': 'Control+Z Meta+Z', 'aria-label': t('app.history.undo') },
	onClick: undo,
});
const redoButton = button(t('app.history.redo'), {
	icon: 'redo',
	small: true,
	attrs: {
		'aria-keyshortcuts': 'Control+Shift+Z Meta+Shift+Z',
		'aria-label': t('app.history.redo'),
	},
	onClick: redo,
});
const linkButton = button(t('app.link.copy'), {
	icon: 'link',
	small: true,
	attrs: { 'aria-label': t('app.link.copy') },
	onClick: async () => {
		const result = await studio.run({ type: 'design-link' });
		if (!result.ok) {
			ctx.announce(t('error.design.invalid'));
			return;
		}
		// The fragment alone: the address of a file opened from disk names the
		// folder it is in, which is nobody else's business.
		const text = `#${result.value.link}`;
		try {
			await navigator.clipboard.writeText(text);
			ctx.announce([t('app.link.copied'), ...result.value.issues.map(issueText)].join(' '));
		} catch {
			ctx.announce(t('app.link.copy-failed'));
		}
	},
});

const MODE_LABELS: Readonly<Record<StudioMode, string>> = {
	create: 'app.mode.create',
	scan: 'app.mode.scan',
	bulk: 'app.mode.bulk',
};
const MODE_HINTS: Readonly<Record<StudioMode, string>> = {
	create: 'app.mode.create-hint',
	scan: 'app.mode.scan-hint',
	bulk: 'app.mode.bulk-hint',
};

const tabs = MODES.map((mode) => {
	const tab = h(
		'button',
		{
			className: 'tab',
			id: `tab-${mode}`,
			attrs: { type: 'button', role: 'tab', 'aria-controls': `panel-${mode}` },
			on: {
				click: () => studio.dispatch({ type: 'mode', mode }),
				keydown: (event) => {
					const at = MODES.indexOf(mode);
					let next = -1;
					if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
						next = (at + 1) % MODES.length;
					else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
						next = (at + MODES.length - 1) % MODES.length;
					else if (event.key === 'Home') next = 0;
					else if (event.key === 'End') next = MODES.length - 1;
					if (next === -1) return;
					event.preventDefault();
					const target = MODES[next] as StudioMode;
					studio.dispatch({ type: 'mode', mode: target });
					document.getElementById(`tab-${target}`)?.focus();
				},
			},
		},
		[
			h('span', { className: 'tab__label', text: t(MODE_LABELS[mode]) }),
			h('span', { className: 'tab__hint', text: t(MODE_HINTS[mode]) }),
		],
	);
	return { mode, tab };
});

const masthead = h('header', { className: 'masthead' }, [
	h('div', { className: 'masthead__words' }, [
		h('p', { className: 'eyebrow', text: t('app.masthead.eyebrow') }),
		h('h1', { className: 'masthead__title', text: t('app.masthead.title') }),
		h('p', { className: 'masthead__lede', text: t('app.masthead.lede') }),
	]),
	h('div', { className: 'masthead__tools' }, [
		h(
			'div',
			{ className: 'tabs', attrs: { role: 'tablist', 'aria-label': t('app.mode.label') } },
			tabs.map((entry) => entry.tab),
		),
		h('div', { className: 'tools', attrs: { role: 'group', 'aria-label': t('app.tools.label') } }, [
			undoButton,
			redoButton,
			linkButton,
		]),
	]),
]);

// Create: the cards down one side, the proof beside them.

interface Section {
	readonly card: Card;
	readonly panel: Panel;
}

const content = createContent(ctx);
const contentPanel: Panel = { root: content.root, update: content.update, meta: content.meta };
const styleCard = card(2, t('app.section.style'), true, 'card-style');
const libraryPanel = createLibrary(ctx, (design) => matchPreset(ctx, design));
const sections: readonly Section[] = [
	{ card: card(1, t('app.section.content'), true, 'card-content'), panel: contentPanel },
	{ card: styleCard, panel: createGallery(ctx, styleCard.root) },
	{ card: card(3, t('app.section.modules'), false, 'card-modules'), panel: createModules(ctx) },
	{ card: card(4, t('app.section.eyes'), false, 'card-eyes'), panel: createEyes(ctx) },
	{ card: card(5, t('app.section.colour'), false, 'card-colour'), panel: createColour(ctx) },
	{ card: card(6, t('app.section.logo'), false, 'card-logo'), panel: createLogo(ctx) },
	{ card: card(7, t('app.section.frame'), false, 'card-frame'), panel: createFrame(ctx) },
	{ card: card(8, t('app.section.print'), false, 'card-print'), panel: createPrint(ctx) },
	{ card: card(9, t('app.section.check'), false, 'card-check'), panel: createCheck(ctx) },
	{ card: card(10, t('app.section.export'), false, 'card-export'), panel: saver.panel },
	{ card: card(11, t('app.section.library'), false, 'card-library'), panel: libraryPanel },
];
for (const section of sections) section.card.body.appendChild(section.panel.root);

const notice = h('div', { className: 'notice', attrs: { role: 'alert' } });
notice.hidden = true;
const sentinel = h('span', { className: 'proof-sentinel', attrs: { 'aria-hidden': 'true' } });
const proofDock = h('div', { className: 'create__proof' }, [proof.root]);
proofDock.dataset.compact = 'false';
const spacer = h('span', { className: 'proof-spacer', attrs: { 'aria-hidden': 'true' } });
const createPanel = h(
	'section',
	{
		className: 'mode',
		id: 'panel-create',
		attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-create' },
	},
	[
		sentinel,
		// The controls come first in the document, so focus moves through them
		// before the proof beside them; on a phone the stylesheet puts the proof on top.
		h('div', { className: 'create' }, [
			h('div', { className: 'create__controls' }, [
				notice,
				...sections.map((section) => section.card.root),
			]),
			proofDock,
			spacer,
		]),
	],
);

const phone = window.matchMedia('(max-width: 699px)');

// On a phone the proof is pinned at the top and shrinks once the page scrolls
// past where it started, so the code stays in view while the fields are
// filled. The sentinel sits above the proof, so the proof's own change of
// height never moves it; the spacer takes up exactly the height the proof
// gave back, so nothing below it jumps.
if (typeof IntersectionObserver === 'function') {
	new IntersectionObserver(([entry]) => {
		const past =
			phone.matches &&
			entry !== undefined &&
			!entry.isIntersecting &&
			entry.boundingClientRect.top < 0;
		if (String(past) === proofDock.dataset.compact) return;
		const before = proofDock.offsetHeight;
		proofDock.dataset.compact = String(past);
		const after = proofDock.offsetHeight;
		spacer.style.setProperty('height', past ? `${Math.max(0, before - after)}px` : '0px');
	}).observe(sentinel);
}

// On a phone the strip and the save buttons move into their cards, so the
// pinned proof is the code alone; the bar along the bottom carries Download.
const cardOf = (id: string): Card | undefined =>
	sections.find((section) => section.card.root.id === id)?.card;
const toolbarHost = proof.toolbar.parentElement as HTMLElement;
function arrange(): void {
	if (phone.matches) {
		cardOf('card-check')?.body.prepend(strip.root);
		cardOf('card-export')?.body.appendChild(saver.actions);
		cardOf('card-print')?.body.prepend(proof.toolbar);
	} else {
		stripHost.appendChild(strip.root);
		actionsHost.appendChild(saver.actions);
		toolbarHost.appendChild(proof.toolbar);
		proofDock.dataset.compact = 'false';
		spacer.style.setProperty('height', '0px');
	}
}
arrange();
phone.addEventListener('change', arrange);

// Scan and Bulk.

const scan = createScan(ctx);
const bulk = createBulk(ctx);
const scanPanel = h(
	'section',
	{
		className: 'mode',
		id: 'panel-scan',
		attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-scan' },
	},
	[scan.root],
);
const bulkPanel = h(
	'section',
	{
		className: 'mode',
		id: 'panel-bulk',
		attrs: { role: 'tabpanel', 'aria-labelledby': 'tab-bulk' },
	},
	[bulk.root],
);
const panels: Readonly<Record<StudioMode, HTMLElement>> = {
	create: createPanel,
	scan: scanPanel,
	bulk: bulkPanel,
};

const veil = h('div', { className: 'veil', attrs: { 'aria-hidden': 'true' } }, [
	h('div', { className: 'veil__card' }, [
		h('p', { className: 'veil__title', text: t('app.drop.title') }),
		h('p', { className: 'veil__text', text: t('app.drop.text') }),
	]),
]);
veil.dataset.shown = 'false';

replace(byId('app'), [masthead, createPanel, scanPanel, bulkPanel]);
document.body.appendChild(saver.dock);
document.body.appendChild(status);
document.body.appendChild(veil);

// Dropping a file anywhere: a design, a library, a picture of a code, or a spreadsheet.

let dragDepth = 0;
const hasFiles = (event: DragEvent): boolean =>
	[...(event.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (event) => {
	if (!hasFiles(event)) return;
	dragDepth += 1;
	veil.dataset.shown = 'true';
});
window.addEventListener('dragleave', () => {
	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) veil.dataset.shown = 'false';
});
window.addEventListener('dragover', (event) => {
	if (hasFiles(event)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
	event.preventDefault();
	dragDepth = 0;
	veil.dataset.shown = 'false';
	const file = event.dataTransfer?.files[0];
	if (file !== undefined) void openDropped(file);
});

async function openDropped(file: File): Promise<void> {
	const name = file.name.toLowerCase();
	if (name.endsWith(LIBRARY_EXTENSION)) {
		await libraryPanel.openFile(file);
		return;
	}
	if (name.endsWith('.json') || file.type === 'application/json') {
		await libraryPanel.openDesign(file);
		return;
	}
	if (file.type.startsWith('image/')) {
		studio.dispatch({ type: 'mode', mode: 'scan' });
		await scan.readBlob(file);
		return;
	}
	if (/\.(csv|tsv|txt)$/.test(name) || file.type === 'text/csv') {
		studio.dispatch({ type: 'mode', mode: 'bulk' });
		await bulk.readFile(file);
		return;
	}
	ctx.announce(t('app.drop.unknown'));
}

// Undo and redo from the keyboard, in every mode.

document.addEventListener('keydown', (event) => {
	if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
	if (hasNativeUndo(event.target)) return;
	const key = event.key.toLowerCase();
	if (key === 'z') {
		event.preventDefault();
		if (event.shiftKey) redo();
		else undo();
	} else if (key === 'y' && event.ctrlKey && !event.metaKey) {
		event.preventDefault();
		redo();
	}
});

// A design link opened into a page that is already open.

window.addEventListener('hashchange', () => {
	const next = readFragment(location.hash, isType);
	if (next.mode !== null) studio.dispatch({ type: 'mode', mode: next.mode });
	if (next.typeId !== null) studio.dispatch({ type: 'payload/type', typeId: next.typeId });
	if (next.design !== null) {
		try {
			const design = decodeDesignLink(next.design, registries.design);
			studio.dispatch({ type: 'design/replace', design });
			ctx.announce(t('app.design.applied'));
		} catch {
			ctx.announce(t('studio.issue.design-link'));
		}
	}
});

// Drawing.

let shownMode: StudioMode | null = null;
let shownRefusal: unknown = null;

function render(): void {
	const snapshot = studio.getSnapshot();
	const mode = snapshot.document.mode;
	if (mode !== shownMode) {
		shownMode = mode;
		document.body.dataset.mode = mode;
		for (const { mode: tabMode, tab } of tabs) {
			const selected = tabMode === mode;
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected ? 0 : -1;
			panels[tabMode].hidden = !selected;
		}
	}
	undoButton.disabled = !snapshot.history.canUndo;
	redoButton.disabled = !snapshot.history.canRedo;

	if (snapshot.refusal !== shownRefusal) {
		shownRefusal = snapshot.refusal;
		const refusal = snapshot.refusal;
		if (refusal === null || refusal.issues.length === 0) notice.hidden = true;
		else {
			setText(notice, refusal.issues.map(issueText).join(' '));
			notice.hidden = false;
		}
	}

	if (mode === 'create') {
		proof.update(snapshot);
		strip.update(snapshot);
		for (const section of sections) {
			// A closed card is drawn when it opens; the line beside its title is kept current.
			if (section.card.root.open) section.panel.update(snapshot);
			setText(section.card.meta, section.panel.meta(snapshot));
		}
	}
	saver.panel.update(snapshot);
	const views: readonly View[] = [scan, bulk];
	for (const view of views) view.update(snapshot);
}

for (const section of sections) {
	section.card.root.addEventListener('toggle', () => {
		if (section.card.root.open) section.panel.update(studio.getSnapshot());
	});
}

let scheduled = false;
studio.subscribe(() => {
	if (scheduled) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		render();
	});
});

render();
// The scan check runs after every change once it has been asked for. It is
// asked for at once, so the strip under the proof is never out of date.
studio.dispatch({ type: 'verify/request' });
if (initialNotice !== null) ctx.announce(initialNotice);

window.addEventListener('pagehide', () => {
	scan.stopCamera();
});
