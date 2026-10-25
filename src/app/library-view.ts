/**
 * The library, as the offline file has it: codes saved in this tab, kept by
 * saving a library file and brought back by opening one. Also a single
 * design, saved to a file or opened from one, which is the way to share a
 * look without its content.
 *
 * Everything here goes through the studio's library commands, so when the
 * file store from the library milestone replaces the stand-in, this view does
 * not change.
 */

import { downloadBytes } from '../dom/output.js';
import { studioError } from '../studio/index.js';
import type { LibraryItemSummary, StudioSnapshot } from '../studio/index.js';
import { button, field } from './controls.js';
import type { AppContext } from './context.js';
import type { Panel } from './design-panels.js';
import { fileBytes, fileText, h, replace, setText } from './dom.js';
import { LIBRARY_SUFFIX } from './library-file.js';
import { keepNativeUndo } from './shortcuts.js';
import { errorText, t, when } from './text.js';

export interface LibraryView extends Panel {
	/** Open a library file the person dropped on the page. */
	openFile(file: Blob): Promise<void>;
	/** Open a design file the person dropped. */
	openDesign(file: Blob): Promise<void>;
}

export function createLibrary(ctx: AppContext): LibraryView {
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
	const name = field(t('app.library.name'), nameInput);
	const saveCode = button(t('app.library.save-code'), {
		icon: 'save',
		primary: true,
		onClick: async () => {
			const result = await ctx.studio.run({
				type: 'library/save',
				name: nameInput.value.trim() === '' ? t('app.library.untitled') : nameInput.value.trim(),
			});
			if (!result.ok) {
				ctx.announce(errorText(studioError(result.error)));
				return;
			}
			nameInput.value = '';
			ctx.announce(t('app.library.saved'));
		},
	});
	const list = h('ul', { className: 'library__list' });
	const empty = h('p', { className: 'field__hint', text: t('app.library.empty') });
	const dirty = h('p', { className: 'note note--warning', text: t('app.library.unsaved') });
	dirty.hidden = true;

	const libraryInput = h('input', {
		attrs: { type: 'file', accept: `${LIBRARY_SUFFIX},application/json` },
	});
	libraryInput.hidden = true;
	const designInput = h('input', { attrs: { type: 'file', accept: '.json,application/json' } });
	designInput.hidden = true;

	async function openFile(file: Blob): Promise<void> {
		const added = await ctx.library.fromFile(await fileBytes(file));
		if (!added.ok) {
			ctx.announce(errorText(studioError(added.error)));
			return;
		}
		// The studio learns of the new items by asking the store again.
		await ctx.studio.run({ type: 'library/enable' });
		ctx.announce(t('app.library.opened', { count: added.value }));
	}

	async function openDesign(file: Blob): Promise<void> {
		const text = await fileText(file);
		const before = ctx.snapshot().document.design;
		ctx.dispatch({ type: 'design/replace', design: text });
		const after = ctx.snapshot();
		if (after.document.design !== before) ctx.announce(t('app.design.applied'));
		else if (after.refusal !== null)
			ctx.announce(
				after.refusal.issues.map((found) => t(found.code, found.params ?? {})).join(' '),
			);
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
		onClick: () => {
			const file = ctx.library.toFile();
			const saved = downloadBytes(file.bytes, file.filename, 'application/json');
			if (saved.ok) ctx.announce(t('app.export.saved', { filename: file.filename }));
			else ctx.announce(errorText(studioError(saved.error)));
			update(ctx.snapshot());
		},
	});
	const openLibrary = button(t('app.library.open-file'), {
		icon: 'open',
		onClick: () => libraryInput.click(),
	});
	const saveDesign = button(t('app.design.save-file'), {
		icon: 'save',
		onClick: () => {
			const design = ctx.snapshot().document.design;
			const bytes = new TextEncoder().encode(JSON.stringify(design, null, '\t'));
			const saved = downloadBytes(bytes, 'qr-design.json', 'application/json');
			if (saved.ok) ctx.announce(t('app.export.saved', { filename: 'qr-design.json' }));
		},
	});
	const openDesignButton = button(t('app.design.open-file'), {
		icon: 'open',
		onClick: () => designInput.click(),
	});

	const root = h('div', { className: 'panel library' }, [
		h('p', { className: 'field__hint', text: t('app.library.intro') }),
		h('div', { className: 'library__save' }, [name.root, saveCode]),
		dirty,
		empty,
		list,
		h('div', { className: 'library__files' }, [saveFile, openLibrary, libraryInput]),
		h('h3', { className: 'notes__title', text: t('app.design.title') }),
		h('p', { className: 'field__hint', text: t('app.design.intro') }),
		h('div', { className: 'library__files' }, [saveDesign, openDesignButton, designInput]),
	]);

	function itemRow(item: LibraryItemSummary, snapshot: StudioSnapshot): HTMLElement {
		const type = snapshot.catalogue.payloadTypes
			.flatMap((group) => group.types)
			.find((found) => found.id === item.typeId);
		return h('li', { className: 'library__item' }, [
			h('div', { className: 'library__about' }, [
				h('span', { className: 'library__name', text: item.name }),
				h('span', {
					className: 'library__when',
					text: t('app.library.saved-at', {
						type: type === undefined ? '' : t(type.labelKey),
						date: when(item.savedAt),
					}),
				}),
			]),
			h('div', { className: 'library__actions' }, [
				button(t('app.library.open'), {
					small: true,
					attrs: { 'aria-label': t('app.library.open-named', { name: item.name }) },
					onClick: async () => {
						const result = await ctx.studio.run({ type: 'library/load', id: item.id });
						ctx.announce(
							result.ok
								? t('app.library.loaded', { name: item.name })
								: errorText(studioError(result.error)),
						);
					},
				}),
				button(t('app.library.use-design'), {
					small: true,
					attrs: { 'aria-label': t('app.library.use-design-named', { name: item.name }) },
					onClick: async () => {
						// SEAM(library): the studio has no command that applies only an item's
						// design, so its document is read from the store and its design
						// replaces the current one, as one undoable step.
						const loaded = await ctx.library.load(item.id);
						if (!loaded.ok) {
							ctx.announce(errorText(studioError(loaded.error)));
							return;
						}
						ctx.dispatch({ type: 'design/replace', design: loaded.value.document.design });
						ctx.announce(t('app.design.applied'));
					},
				}),
				button(t('app.library.remove'), {
					small: true,
					icon: 'minus',
					attrs: { 'aria-label': t('app.library.remove-named', { name: item.name }) },
					onClick: async () => {
						await ctx.studio.run({ type: 'library/remove', id: item.id });
						ctx.announce(t('app.library.removed', { name: item.name }));
					},
				}),
			]),
		]);
	}

	let shownLibrary: unknown = null;
	function update(snapshot: StudioSnapshot): void {
		const library = snapshot.library;
		dirty.hidden = !ctx.library.dirty;
		if (library === shownLibrary) return;
		shownLibrary = library;
		const on = library.status === 'on';
		saveCode.disabled = !on;
		if (library.status === 'failed') {
			setText(empty, errorText(library.error));
			empty.hidden = false;
			replace(list, []);
			return;
		}
		if (library.status !== 'on') {
			setText(
				empty,
				library.status === 'unavailable' ? t('app.library.unavailable') : t('app.library.empty'),
			);
			empty.hidden = false;
			replace(list, []);
			return;
		}
		setText(empty, t('app.library.empty'));
		empty.hidden = library.items.length > 0;
		replace(
			list,
			library.items.map((item) => itemRow(item, snapshot)),
		);
	}

	return {
		root,
		update,
		meta: (snapshot) =>
			snapshot.library.status === 'on'
				? t('app.library.count', { count: snapshot.library.items.length })
				: '',
		openFile,
		openDesign,
	};
}
