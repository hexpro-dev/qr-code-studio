/**
 * The library, as the offline file has it: saved designs and brand kits held
 * in this page, kept by saving a library file and brought back by opening
 * one. A library holds the look of a code and never what the code says, so a
 * library file is safe to pass to a colleague.
 *
 * Everything goes through the studio's library commands and is read back from
 * `snapshot.library`, whose 'file' state is this one: Save and Open rather
 * than a switch, and `unsaved` for the warning before the page is left. Using
 * a saved design applies its look and its scan conditions as one undo step,
 * and leaves what the person typed alone; using a brand kit applies its
 * colours and logo by the studio's rule (src/studio/kit.ts).
 */

import { kitFromDesign, studioError } from '../studio/index.js';
import type { KitSummary, LibraryItemSummary, StudioSnapshot } from '../studio/index.js';
import type { QrStudioError } from '../core/errors.js';
import type { QrDesignV1 } from '../design/types.js';
import { LIBRARY_EXTENSION } from '../dom/file-library.js';
import { downloadBytes } from '../dom/output.js';
import { button, field, issueList } from './controls.js';
import type { AppContext } from './context.js';
import type { Panel } from './design-panels.js';
import { fileText, h, replace, setText } from './dom.js';
import { keepNativeUndo } from './shortcuts.js';
import { errorText, issueText, t, when } from './text.js';

export interface LibraryView extends Panel {
	/** Open a library file the person dropped on the page. */
	openFile(file: Blob): Promise<void>;
	/** Open a design file the person dropped. */
	openDesign(file: Blob): Promise<void>;
}

type Shelves = Extract<StudioSnapshot['library'], { status: 'on' | 'file' }>;

function shelves(snapshot: StudioSnapshot): Shelves | null {
	const library = snapshot.library;
	return library.status === 'on' || library.status === 'file' ? library : null;
}

export function createLibrary(
	ctx: AppContext,
	presetOf: (design: QrDesignV1) => string | null,
): LibraryView {
	const fail = (error: QrStudioError): void => ctx.announce(errorText(studioError(error)));

	const nameInput = h('input', {
		className: 'input',
		attrs: {
			type: 'text',
			autocomplete: 'off',
			maxlength: 80,
			placeholder: t('app.library.untitled'),
		},
	});
	keepNativeUndo(nameInput);
	const name = field(t('app.library.name'), nameInput, t('app.library.name-hint'));
	const chosenName = (): string =>
		nameInput.value.trim() === '' ? t('app.library.untitled') : nameInput.value.trim();

	const saveDesign = button(t('app.library.save-design'), {
		icon: 'save',
		primary: true,
		onClick: async () => {
			const result = await ctx.studio.run({ type: 'library/save', name: chosenName() });
			if (!result.ok) return fail(result.error);
			nameInput.value = '';
			ctx.announce(t('app.library.saved'));
		},
	});
	const saveKit = button(t('app.library.save-kit'), {
		icon: 'save',
		onClick: async () => {
			const design = ctx.snapshot().document.design;
			const preset = presetOf(design);
			// The studio's kit has no presets of its own; the preset the design
			// is now, if it is one, is the one this brand prefers.
			const kit = { ...kitFromDesign(design), presets: preset === null ? [] : [preset] };
			const result = await ctx.studio.run({ type: 'library/save-kit', name: chosenName(), kit });
			if (!result.ok) return fail(result.error);
			nameInput.value = '';
			ctx.announce(t('app.library.kit-saved'));
		},
	});

	const designList = h('ul', { className: 'library__list' });
	const kitList = h('ul', { className: 'library__list' });
	const empty = h('p', { className: 'field__hint', text: t('app.library.empty') });
	const unsaved = h('p', { className: 'note note--warning', text: t('app.library.unsaved') });
	unsaved.hidden = true;
	const skipped = h('ul', { className: 'field__issues' });
	skipped.hidden = true;
	const designsTitle = h('h3', { className: 'notes__title', text: t('app.library.designs') });
	const kitsTitle = h('h3', { className: 'notes__title', text: t('app.library.kits') });

	const libraryInput = h('input', {
		attrs: { type: 'file', accept: `${LIBRARY_EXTENSION},application/json` },
	});
	libraryInput.hidden = true;
	const designInput = h('input', { attrs: { type: 'file', accept: '.json,application/json' } });
	designInput.hidden = true;

	async function openFile(file: Blob): Promise<void> {
		const result = await ctx.studio.run({ type: 'library/open-file', file });
		if (!result.ok) return fail(result.error);
		if (!result.value.opened) {
			issueList(skipped, result.value.issues);
			ctx.announce(result.value.issues.map(issueText).join(' '));
			return;
		}
		const now = shelves(ctx.snapshot());
		ctx.announce(
			t('app.library.opened', { designs: now?.items.length ?? 0, kits: now?.kits.length ?? 0 }),
		);
	}

	async function openDesign(file: Blob): Promise<void> {
		const text = await fileText(file);
		const before = ctx.snapshot().document.design;
		ctx.dispatch({ type: 'design/replace', design: text });
		const after = ctx.snapshot();
		if (after.document.design !== before) ctx.announce(t('app.design.applied'));
		else if (after.refusal !== null) ctx.announce(after.refusal.issues.map(issueText).join(' '));
	}

	libraryInput.addEventListener('change', () => {
		const file = libraryInput.files?.[0];
		libraryInput.value = '';
		if (file !== undefined) void openFile(file);
	});
	designInput.addEventListener('change', () => {
		const file = designInput.files?.[0];
		designInput.value = '';
		if (file !== undefined) void openDesign(file);
	});

	const saveFile = button(t('app.library.save-file'), {
		icon: 'download',
		onClick: async () => {
			const result = await ctx.studio.run({ type: 'library/save-file' });
			if (!result.ok) return fail(result.error);
			ctx.announce(t('app.export.saved', { filename: result.value.filename }));
		},
	});
	const openLibrary = button(t('app.library.open-file'), {
		icon: 'open',
		onClick: () => libraryInput.click(),
	});
	const saveDesignFile = button(t('app.design.save-file'), {
		icon: 'save',
		onClick: () => {
			const design = ctx.snapshot().document.design;
			const bytes = new TextEncoder().encode(JSON.stringify(design, null, '\t'));
			const saved = downloadBytes(bytes, 'qr-design.json', 'application/json');
			if (saved.ok) ctx.announce(t('app.export.saved', { filename: 'qr-design.json' }));
			else fail(saved.error);
		},
	});
	const openDesignButton = button(t('app.design.open-file'), {
		icon: 'open',
		onClick: () => designInput.click(),
	});

	const root = h('div', { className: 'panel library' }, [
		h('p', { className: 'field__hint', text: t('app.library.intro') }),
		h('div', { className: 'library__save' }, [name.root, saveDesign, saveKit]),
		unsaved,
		skipped,
		empty,
		designsTitle,
		designList,
		kitsTitle,
		kitList,
		h('div', { className: 'library__files' }, [saveFile, openLibrary, libraryInput]),
		h('h3', { className: 'notes__title', text: t('app.design.title') }),
		h('p', { className: 'field__hint', text: t('app.design.intro') }),
		h('div', { className: 'library__files' }, [saveDesignFile, openDesignButton, designInput]),
	]);

	function row(
		label: string,
		detail: string,
		use: () => Promise<void>,
		remove: () => Promise<void>,
		inUse: boolean,
	): HTMLElement {
		const item = h('li', { className: 'library__item' }, [
			h('div', { className: 'library__about' }, [
				h('span', { className: 'library__name', text: label }),
				h('span', { className: 'library__when', text: detail }),
				inUse ? h('span', { className: 'tag', text: t('app.library.in-use') }) : null,
			]),
			h('div', { className: 'library__actions' }, [
				button(t('app.library.use'), {
					small: true,
					attrs: { 'aria-label': t('app.library.use-named', { name: label }) },
					onClick: () => void use(),
				}),
				button(t('app.library.remove'), {
					small: true,
					icon: 'minus',
					attrs: { 'aria-label': t('app.library.remove-named', { name: label }) },
					onClick: () => void remove(),
				}),
			]),
		]);
		return item;
	}

	function designRow(item: LibraryItemSummary, snapshot: StudioSnapshot): HTMLElement {
		const type = snapshot.catalogue.payloadTypes
			.flatMap((group) => group.types)
			.find((found) => found.id === item.typeId);
		const saved = t('app.library.saved-at', { date: when(item.savedAt) });
		return row(
			item.name,
			type === undefined ? saved : `${t(type.labelKey)}. ${saved}`,
			async () => {
				const result = await ctx.studio.run({ type: 'library/load', id: item.id });
				if (!result.ok) return fail(result.error);
				ctx.announce(t('app.library.used', { name: item.name }));
			},
			async () => {
				const result = await ctx.studio.run({ type: 'library/remove', id: item.id });
				if (!result.ok) return fail(result.error);
				ctx.announce(t('app.library.removed', { name: item.name }));
			},
			false,
		);
	}

	function kitRow(kit: KitSummary, active: string | null): HTMLElement {
		return row(
			kit.name,
			t('app.library.saved-at', { date: when(kit.savedAt) }),
			async () => {
				const result = await ctx.studio.run({ type: 'library/load-kit', id: kit.id });
				if (!result.ok) return fail(result.error);
				ctx.announce(t('app.library.kit-used', { name: kit.name }));
			},
			async () => {
				const result = await ctx.studio.run({ type: 'library/remove-kit', id: kit.id });
				if (!result.ok) return fail(result.error);
				ctx.announce(t('app.library.removed', { name: kit.name }));
			},
			kit.id === active,
		);
	}

	let shown: unknown = null;
	function update(snapshot: StudioSnapshot): void {
		const library = snapshot.library;
		if (library === shown) return;
		shown = library;
		const open = shelves(snapshot);
		const designs = open?.items ?? [];
		const kits = open?.kits ?? [];
		saveDesign.disabled = open === null;
		saveKit.disabled = open === null;
		unsaved.hidden = !(library.status === 'file' && library.unsaved);
		issueList(skipped, open?.skipped ?? []);
		designsTitle.hidden = designs.length === 0;
		kitsTitle.hidden = kits.length === 0;
		if (library.status === 'failed') {
			setText(empty, errorText(library.error));
			empty.hidden = false;
		} else {
			setText(empty, t('app.library.empty'));
			empty.hidden = designs.length > 0 || kits.length > 0;
		}
		replace(
			designList,
			designs.map((item) => designRow(item, snapshot)),
		);
		replace(
			kitList,
			kits.map((kit) => kitRow(kit, open?.kit?.id ?? null)),
		);
	}

	// A warning before the page is left with designs that are in no file yet,
	// which is the one way this library can lose something.
	window.addEventListener('beforeunload', (event) => {
		const library = ctx.snapshot().library;
		if (library.status === 'file' && library.unsaved) {
			event.preventDefault();
			event.returnValue = '';
		}
	});

	return {
		root,
		update,
		meta: (snapshot) => {
			const open = shelves(snapshot);
			return t('app.library.count', {
				designs: open?.items.length ?? 0,
				kits: open?.kits.length ?? 0,
			});
		},
		openFile,
		openDesign,
	};
}
