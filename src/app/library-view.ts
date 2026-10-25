/**
 * The library, as the offline file has it: saved designs and brand kits held
 * in this page, kept by saving a library file and brought back by opening
 * one. A library holds the look of a code and never what the code says, so a
 * library file is safe to pass to a colleague.
 *
 * The store is the dom layer's file library (src/dom/file-library.ts), the
 * same one the studio was given. Designs go through the studio's library
 * commands. SEAM(library): brand kits, saving and opening the file, and the
 * unsaved mark go to the store directly until the studio grows commands and a
 * snapshot state for them; applying a saved design reads its record and
 * replaces the design, rather than `library/load`, which until then replaces
 * the whole document and would wipe what the person typed.
 */

import type { Issue } from '../core/issue.js';
import { LIBRARY_EXTENSION, libraryErrorKey } from '../dom/file-library.js';
import type { BrandKit, KitSummary, LibraryInk } from '../dom/file-library.js';
import { downloadBytes } from '../dom/output.js';
import type { DesignPaint, QrDesignV1 } from '../design/types.js';
import { LOGO_ASSET_ID, logoPatches, studioError } from '../studio/index.js';
import type { DesignPatch, LibraryItemSummary, StudioSnapshot } from '../studio/index.js';
import type { QrStudioError } from '../core/errors.js';
import { button, field, issueList } from './controls.js';
import type { AppContext } from './context.js';
import type { Panel } from './design-panels.js';
import { fileText, h, replace, setText } from './dom.js';
import { keepNativeUndo } from './shortcuts.js';
import { t, when } from './text.js';

export interface LibraryView extends Panel {
	/** Open a library file the person dropped on the page. */
	openFile(file: Blob): Promise<void>;
	/** Open a design file the person dropped. */
	openDesign(file: Blob): Promise<void>;
}

/** The solid inks a design uses, for a brand kit's palette. */
function paletteOf(design: QrDesignV1): LibraryInk[] {
	const inks: LibraryInk[] = [];
	const add = (paint: DesignPaint | null | undefined): void => {
		if (paint === null || paint === undefined) return;
		if (paint.kind === 'solid') inks.push(paint.ink);
		else if (paint.kind !== 'entry') for (const stop of paint.stops) inks.push(stop.ink);
	};
	add(design.modules.paint);
	add(design.regions.finder?.outerPaint);
	add(design.regions.finder?.innerPaint);
	add(design.background);
	const seen = new Set<string>();
	return inks.filter((ink) => {
		const key = JSON.stringify(ink);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function inkCss(ink: LibraryInk): string {
	return typeof ink === 'string' ? ink : ink.srgb;
}

export function createLibrary(
	ctx: AppContext,
	presetOf: (design: QrDesignV1) => string | null,
): LibraryView {
	const store = ctx.library;
	const fail = (error: QrStudioError): void => {
		const shown = studioError(error);
		ctx.announce(t(libraryErrorKey(error), shown.params));
	};

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
			if (!result.ok) {
				fail(result.error);
				return;
			}
			nameInput.value = '';
			ctx.announce(t('app.library.saved'));
			update(ctx.snapshot());
		},
	});
	const saveKit = button(t('app.library.save-kit'), {
		icon: 'save',
		onClick: async () => {
			const design = ctx.snapshot().document.design;
			const preset = presetOf(design);
			const kit: BrandKit = {
				palette: paletteOf(design).slice(0, 32),
				logo:
					design.logo?.source.kind === 'asset' ? (design.assets?.[LOGO_ASSET_ID] ?? null) : null,
				presets: preset === null ? [] : [preset],
			};
			const saved = await store.saveKit({ name: chosenName(), kit });
			if (!saved.ok) {
				fail(saved.error);
				return;
			}
			nameInput.value = '';
			ctx.announce(t('app.library.kit-saved'));
			await refreshKits();
		},
	});

	const designList = h('ul', { className: 'library__list' });
	const kitList = h('ul', { className: 'library__list' });
	const empty = h('p', { className: 'field__hint', text: t('app.library.empty') });
	const unsaved = h('p', { className: 'note note--warning', text: t('app.library.unsaved') });
	unsaved.hidden = true;
	const skipped = h('ul', { className: 'field__issues' });
	skipped.hidden = true;
	const kitsTitle = h('h3', { className: 'notes__title', text: t('app.library.kits') });
	const designsTitle = h('h3', { className: 'notes__title', text: t('app.library.designs') });

	const libraryInput = h('input', {
		attrs: { type: 'file', accept: `${LIBRARY_EXTENSION},application/json` },
	});
	libraryInput.hidden = true;
	const designInput = h('input', { attrs: { type: 'file', accept: '.json,application/json' } });
	designInput.hidden = true;

	let kits: readonly KitSummary[] = [];

	async function refreshKits(): Promise<void> {
		const listed = await store.listKits();
		kits = listed.ok ? listed.value : [];
		drawKits();
		update(ctx.snapshot());
	}

	async function openFile(file: Blob): Promise<void> {
		const opened = await store.openFile(file);
		issueList(skipped, opened.issues as readonly Issue[]);
		if (!opened.opened) {
			ctx.announce(opened.issues.map((found) => t(found.code, found.params ?? {})).join(' '));
			return;
		}
		// The studio learns of the new designs by asking the store again.
		await ctx.studio.run({ type: 'library/enable' });
		await refreshKits();
		const count = ctx.snapshot().library;
		ctx.announce(
			t('app.library.opened', {
				designs: count.status === 'on' ? count.items.length : 0,
				kits: kits.length,
			}),
		);
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
			const saved = store.saveFile();
			if (saved.ok) ctx.announce(t('app.export.saved', { filename: saved.value.filename }));
			else fail(saved.error);
			update(ctx.snapshot());
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

	function itemActions(
		label: string,
		use: () => Promise<void>,
		remove: () => Promise<void>,
	): HTMLElement {
		return h('div', { className: 'library__actions' }, [
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
		]);
	}

	function designRow(item: LibraryItemSummary, snapshot: StudioSnapshot): HTMLElement {
		const type = snapshot.catalogue.payloadTypes
			.flatMap((group) => group.types)
			.find((found) => found.id === item.typeId);
		return h('li', { className: 'library__item' }, [
			h('div', { className: 'library__about' }, [
				h('span', { className: 'library__name', text: item.name }),
				h('span', {
					className: 'library__when',
					text: `${type === undefined ? '' : `${t(type.labelKey)}. `}${t('app.library.saved-at', { date: when(item.savedAt) })}`,
				}),
			]),
			itemActions(
				item.name,
				async () => {
					const loaded = await store.load(item.id);
					if (!loaded.ok) {
						fail(loaded.error);
						return;
					}
					ctx.dispatch({ type: 'design/replace', design: loaded.value.document.design });
					ctx.dispatch({ type: 'conditions', conditions: loaded.value.document.conditions });
					ctx.announce(t('app.library.used', { name: item.name }));
				},
				async () => {
					await ctx.studio.run({ type: 'library/remove', id: item.id });
					ctx.announce(t('app.library.removed', { name: item.name }));
				},
			),
		]);
	}

	/** A kit in one click: its first preset, then its logo and its first colour on the modules, as one step. */
	async function useKit(id: string, label: string): Promise<void> {
		const loaded = await store.loadKit(id);
		if (!loaded.ok) {
			fail(loaded.error);
			return;
		}
		const kit = loaded.value.kit;
		const preset = kit.presets.find((candidate) => ctx.registries.design.presets.get(candidate));
		if (preset !== undefined) ctx.dispatch({ type: 'design/preset', id: preset });
		const design = ctx.snapshot().document.design;
		const patches: DesignPatch[] = [];
		const first = kit.palette[0];
		if (first !== undefined)
			patches.push({ path: ['modules', 'paint'], value: { kind: 'solid', ink: first } });
		if (kit.logo !== null) patches.push(...logoPatches(design, kit.logo));
		if (patches.length > 0) ctx.dispatch({ type: 'design/patch', patch: patches });
		ctx.announce(t('app.library.used', { name: label }));
	}

	function drawKits(): void {
		replace(
			kitList,
			kits.map((kit) =>
				h('li', { className: 'library__item' }, [
					h('div', { className: 'library__about' }, [
						h('span', { className: 'library__name', text: kit.name }),
						h('span', {
							className: 'library__when',
							text: t('app.library.saved-at', { date: when(kit.savedAt) }),
						}),
					]),
					itemActions(
						kit.name,
						() => useKit(kit.id, kit.name),
						async () => {
							await store.removeKit(kit.id);
							ctx.announce(t('app.library.removed', { name: kit.name }));
							await refreshKits();
						},
					),
				]),
			),
		);
		// The palette under each kit's name, drawn once its record is read.
		kits.forEach((kit, index) => {
			void store.loadKit(kit.id).then((loaded) => {
				if (!loaded.ok) return;
				const row = kitList.children[index]?.querySelector('.library__about');
				row?.appendChild(
					h(
						'span',
						{ className: 'library__palette', attrs: { 'aria-hidden': 'true' } },
						loaded.value.kit.palette.slice(0, 8).map((ink) => {
							const chip = h('span', { className: 'library__ink' });
							chip.style.setProperty('--ink-swatch', inkCss(ink));
							return chip;
						}),
					),
				);
			});
		});
	}

	let shownLibrary: unknown = null;
	function update(snapshot: StudioSnapshot): void {
		unsaved.hidden = !store.hasUnsavedChanges();
		const library = snapshot.library;
		const designs = library.status === 'on' ? library.items : [];
		designsTitle.hidden = designs.length === 0;
		kitsTitle.hidden = kits.length === 0;
		empty.hidden = designs.length > 0 || kits.length > 0;
		saveDesign.disabled = library.status !== 'on';
		if (library === shownLibrary) return;
		shownLibrary = library;
		if (library.status === 'failed') {
			setText(empty, t(library.error.messageKey, library.error.params));
			empty.hidden = false;
		} else setText(empty, t('app.library.empty'));
		replace(
			designList,
			designs.map((item) => designRow(item, snapshot)),
		);
	}

	void refreshKits();

	return {
		root,
		update,
		meta: (snapshot) => {
			const designs = snapshot.library.status === 'on' ? snapshot.library.items.length : 0;
			return t('app.library.count', { designs, kits: kits.length });
		},
		openFile,
		openDesign,
	};
}
