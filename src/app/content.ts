/**
 * Content: what kind of code, its fields, what a phone does with it, and how
 * full the symbol is.
 *
 * The form is drawn from the studio's FormView alone, so a content type added
 * to the registry gets a working form here with no code of its own. It is
 * rebuilt only when the type or its set of fields changes; otherwise values
 * and issues are updated in place, which keeps the caret where the person
 * left it while the code redraws under each keystroke.
 */

import type { Issue } from '../core/issue.js';
import type { FieldValue } from '../payload/types.js';
import { safetyMessageKey } from '../payload/safety.js';
import type { FieldView, FormView, StudioSnapshot, SymbolView } from '../studio/index.js';
import { button, choiceGroup, field, issueList } from './controls.js';
import type { AppContext, View } from './context.js';
import { h, icon, replace, setText, uid } from './dom.js';
import { t, whole } from './text.js';

/** The kinds most people want, as chips. The rest are under "More kinds". */
const COMMON = [
	'url',
	'text',
	'wifi',
	'vcard',
	'email',
	'phone',
	'sms',
	'whatsapp',
	'geo',
	'event',
];

const NUMBER_KINDS = new Set(['number', 'integer', 'amount', 'latitude', 'longitude']);

function inputType(kind: FieldView['kind']): string {
	switch (kind) {
		case 'url':
			return 'url';
		case 'email':
			return 'email';
		case 'tel':
			return 'tel';
		case 'date':
			return 'date';
		case 'datetime':
			return 'datetime-local';
		case 'secret':
			return 'password';
		default:
			return 'text';
	}
}

function inputMode(kind: FieldView['kind']): string | null {
	switch (kind) {
		case 'integer':
			return 'numeric';
		case 'number':
		case 'amount':
		case 'latitude':
		case 'longitude':
			return 'decimal';
		case 'url':
			return 'url';
		case 'email':
			return 'email';
		case 'tel':
			return 'tel';
		default:
			return null;
	}
}

/** Codes and identifiers rather than words: no spelling help, no capitals added. */
function literal(kind: FieldView['kind']): boolean {
	return ['url', 'email', 'tel', 'iban', 'bic', 'currency', 'country', 'secret'].includes(kind);
}

function parseNumber(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === '') return null;
	// A comma as the decimal mark, as much of the world writes it.
	return Number(trimmed.replace(',', '.'));
}

function sameNumber(a: number | null, b: FieldValue): boolean {
	if (a === null) return b === null;
	if (typeof b !== 'number') return false;
	return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

interface FieldControl {
	readonly root: HTMLElement;
	update(view: FieldView, touched: boolean): void;
}

/**
 * A field's issues wait until the person has left it once. While they are
 * still typing, the proof's "not updated" mark already says the content is
 * not finished, and an error under a half-typed address is only noise.
 */
function shownIssues(view: FieldView, touched: boolean): readonly Issue[] {
	return touched ? view.issues : [];
}

function textControl(
	view: FieldView,
	send: (value: FieldValue) => void,
	touch: () => void,
): { control: HTMLInputElement | HTMLTextAreaElement; sync(value: FieldValue): void } {
	const isNumber = NUMBER_KINDS.has(view.kind);
	const control =
		view.kind === 'multiline'
			? h('textarea', { className: 'input input--area', attrs: { rows: 3 } })
			: h('input', { className: 'input', attrs: { type: inputType(view.kind) } });
	control.setAttribute('autocomplete', 'off');
	if (view.maxLength !== null) control.setAttribute('maxlength', String(view.maxLength));
	const mode = inputMode(view.kind);
	if (mode !== null) control.setAttribute('inputmode', mode);
	if (literal(view.kind)) {
		control.setAttribute('spellcheck', 'false');
		control.setAttribute('autocapitalize', 'off');
		control.setAttribute('autocorrect', 'off');
	}
	if (
		view.kind === 'iban' ||
		view.kind === 'bic' ||
		view.kind === 'currency' ||
		view.kind === 'country'
	) {
		control.setAttribute('autocapitalize', 'characters');
	}
	control.addEventListener('input', () => {
		send(isNumber ? parseNumber(control.value) : control.value);
	});
	control.addEventListener('blur', touch);
	return {
		control,
		sync(value) {
			if (isNumber) {
				if (!sameNumber(parseNumber(control.value), value)) {
					control.value = value === null ? '' : String(value);
				}
				return;
			}
			const text = typeof value === 'string' ? value : value === null ? '' : String(value);
			if (control.value !== text) control.value = text;
		},
	};
}

function fieldControl(
	ctx: AppContext,
	first: FieldView,
	touch: (key: string) => void,
): FieldControl {
	const key = first.key;
	const send = (value: FieldValue): void => {
		ctx.dispatch({ type: 'payload/field', key, value });
	};
	const touched = (): void => touch(key);
	const label = t(first.labelKey);
	const hint = first.hintKey === null ? undefined : t(first.hintKey);

	if (first.kind === 'boolean') {
		const input = h('input', {
			attrs: { type: 'checkbox' },
			on: {
				change: () => {
					touched();
					send(input.checked);
				},
			},
		});
		const issues = h('ul', { className: 'field__issues', id: uid('issues') });
		issues.hidden = true;
		input.setAttribute('aria-describedby', issues.id);
		const root = h('div', { className: 'field field--check' }, [
			h('label', { className: 'tick' }, [input, h('span', { text: label })]),
			hint === undefined ? null : h('p', { className: 'field__hint', text: hint }),
			issues,
		]);
		return {
			root,
			update(view, wasTouched) {
				input.checked = view.value === true;
				issueList(issues, shownIssues(view, wasTouched));
			},
		};
	}

	if (first.kind === 'select') {
		const select = h('select', {
			className: 'input input--select',
			on: {
				change: () => {
					touched();
					send(select.value);
				},
			},
		});
		const options = first.options.map((option) =>
			h('option', { text: t(option.labelKey), attrs: { value: option.value } }),
		);
		if (!first.options.some((option) => option.value === '')) {
			options.unshift(h('option', { text: t('app.content.choose'), attrs: { value: '' } }));
		}
		replace(select, options);
		const wrapped = field(label, select, hint);
		if (first.required) wrapped.label.appendChild(requiredTag());
		return {
			root: wrapped.root,
			update(view, wasTouched) {
				const value = typeof view.value === 'string' ? view.value : '';
				if (select.value !== value) select.value = value;
				const shown = shownIssues(view, wasTouched);
				issueList(wrapped.issues, shown);
				select.setAttribute(
					'aria-invalid',
					String(shown.some((found) => found.severity === 'error')),
				);
			},
		};
	}

	if (first.multiple) return listControl(first, send, touched, label, hint);

	const { control, sync } = textControl(first, send, touched);
	const wrapped = field(label, control, hint);
	if (first.required) {
		wrapped.label.appendChild(requiredTag());
		control.setAttribute('aria-required', 'true');
	}
	const extras = h('div', { className: 'field__extras' });
	wrapped.root.insertBefore(extras, wrapped.hint);
	let reveal: HTMLButtonElement | null = null;
	if (first.secret) {
		reveal = button(t('app.content.show-secret'), {
			small: true,
			icon: 'eye',
			attrs: { 'aria-pressed': 'false', 'aria-controls': control.id },
			onClick: () => {
				const shown = control.getAttribute('type') === 'password';
				control.setAttribute('type', shown ? 'text' : 'password');
				reveal?.setAttribute('aria-pressed', String(shown));
			},
		});
		extras.appendChild(reveal);
	}
	// A web address typed without its scheme is the commonest mistake there is,
	// and the fix is the same every time, so it is a button rather than advice.
	const addScheme =
		first.kind === 'url'
			? button(t('app.content.add-scheme'), {
					small: true,
					onClick: () => {
						send(`https://${control.value.trim()}`);
						control.focus();
					},
				})
			: null;
	if (addScheme !== null) {
		addScheme.hidden = true;
		extras.appendChild(addScheme);
	}
	return {
		root: wrapped.root,
		update(view, wasTouched) {
			sync(view.value);
			const shown = shownIssues(view, wasTouched);
			issueList(wrapped.issues, shown);
			control.setAttribute(
				'aria-invalid',
				String(shown.some((found) => found.severity === 'error')),
			);
			if (addScheme !== null) {
				const value = typeof view.value === 'string' ? view.value.trim() : '';
				addScheme.hidden = !(
					value !== '' &&
					!value.includes(':') &&
					/^[^\s/]+\.[^\s]+/.test(value) &&
					view.issues.some((found) => found.code === 'payload.issue.invalid-url')
				);
			}
			extras.hidden = extras.querySelectorAll('button:not([hidden])').length === 0;
		},
	};
}

function requiredTag(): HTMLSpanElement {
	return h('span', { className: 'tag', text: t('app.content.required') });
}

/** A field that holds a list: one input per item, with add and remove. */
function listControl(
	first: FieldView,
	send: (value: FieldValue) => void,
	touched: () => void,
	label: string,
	hint: string | undefined,
): FieldControl {
	const legendId = uid('list');
	const list = h('div', { className: 'list' });
	const issues = h('ul', { className: 'field__issues', id: uid('issues') });
	issues.hidden = true;
	let items: string[] = [];
	const add = button(t('app.content.add-item'), {
		small: true,
		icon: 'plus',
		onClick: () => {
			send([...items, '']);
			// Focus the new row once it is drawn.
			queueMicrotask(() =>
				list.querySelector<HTMLInputElement>('.list__row:last-child input')?.focus(),
			);
		},
	});
	const root = h('fieldset', { className: 'field field--list' }, [
		h('legend', { className: 'field__label', id: legendId, text: label }),
		list,
		hint === undefined ? null : h('p', { className: 'field__hint', text: hint }),
		issues,
		h('div', { className: 'field__extras' }, [add]),
	]);
	const draw = (count: number): void => {
		replace(
			list,
			Array.from({ length: Math.max(1, count) }, (_, index) => {
				const view: FieldView = { ...first };
				const { control } = textControl(
					view,
					(value) => {
						const next = [...items];
						while (next.length <= index) next.push('');
						next[index] = typeof value === 'string' ? value : value === null ? '' : String(value);
						send(next);
					},
					touched,
				);
				control.setAttribute('aria-label', `${label} ${index + 1}`);
				control.setAttribute('aria-describedby', issues.id);
				const remove =
					count > 1
						? button(t('app.content.remove-item'), {
								small: true,
								icon: 'minus',
								attrs: { 'aria-label': t('app.content.remove-numbered', { label, n: index + 1 }) },
								onClick: () => send(items.filter((_, at) => at !== index)),
							})
						: null;
				return h('div', { className: 'list__row' }, [control, remove]);
			}),
		);
	};
	let drawnCount = -1;
	return {
		root,
		update(view, wasTouched) {
			items = Array.isArray(view.value) ? [...view.value] : [];
			const count = Math.max(1, items.length);
			if (count !== drawnCount) {
				draw(count);
				drawnCount = count;
			}
			list.querySelectorAll<HTMLInputElement>('input').forEach((input, index) => {
				const value = items[index] ?? '';
				if (input.value !== value) input.value = value;
			});
			add.hidden = view.maxItems !== null && items.length >= view.maxItems;
			issueList(issues, shownIssues(view, wasTouched));
		},
	};
}

/** The meter and the encoding details: how full the symbol is, and what it is made of. */
function createEncoding(ctx: AppContext): {
	root: HTMLDetailsElement;
	update(snapshot: StudioSnapshot): void;
} {
	const fill = h('span', { className: 'meter__fill' });
	const meter = h(
		'span',
		{
			className: 'meter',
			attrs: {
				role: 'meter',
				'aria-valuemin': 0,
				'aria-valuemax': 100,
				'aria-label': t('app.capacity.label'),
			},
		},
		[fill],
	);
	const reading = h('span', { className: 'encoding__reading' });
	const summary = h('summary', { className: 'encoding__head' }, [
		h('span', { className: 'encoding__title', text: t('app.capacity.label') }),
		meter,
		reading,
	]);
	const symbologies = choiceGroup(
		t('app.encoding.symbology'),
		[],
		(value) => {
			const entry = ctx.snapshot().catalogue.symbologies.find((found) => found.id === value);
			if (entry === undefined) return;
			const level = ctx.snapshot().document.design.symbol.ecLevel;
			const ecLevel =
				level !== undefined && entry.ecLevels.includes(level) ? level : entry.ecLevels[0];
			ctx.dispatch({
				type: 'design/patch',
				patch: {
					path: ['symbol'],
					value: { symbology: value, ...(ecLevel === undefined ? {} : { ecLevel }) },
				},
			});
		},
		'segments',
	);
	const phoneNote = h('p', { className: 'note note--warning' });
	phoneNote.hidden = true;
	const levels = choiceGroup(t('app.encoding.ec'), [], (value) =>
		ctx.dispatch({ type: 'design/patch', patch: { path: ['symbol', 'ecLevel'], value } }),
	);
	const facts = h('dl', { className: 'facts facts--mono' });
	const largest = h('p', { className: 'field__hint' });
	const root = h('details', { className: 'encoding' }, [
		summary,
		h('div', { className: 'encoding__body' }, [
			largest,
			facts,
			symbologies.root,
			phoneNote,
			levels.root,
		]),
	]);
	const LEVEL_KEYS: Readonly<Record<string, string>> = {
		L: 'app.encoding.ec-l',
		M: 'app.encoding.ec-m',
		Q: 'app.encoding.ec-q',
		H: 'app.encoding.ec-h',
	};
	const MODE_KEYS: Readonly<Record<string, string>> = {
		numeric: 'app.encoding.mode-numeric',
		alphanumeric: 'app.encoding.mode-alphanumeric',
		byte: 'app.encoding.mode-byte',
		kanji: 'app.encoding.mode-kanji',
	};
	let shownCatalogue: unknown = null;
	let shownLevels = '';
	return {
		root,
		update(snapshot) {
			const catalogue = snapshot.catalogue;
			const design = snapshot.design.effective;
			if (shownCatalogue !== catalogue) {
				shownCatalogue = catalogue;
				symbologies.setChoices(
					catalogue.symbologies.map((entry) => ({ value: entry.id, label: t(entry.labelKey) })),
				);
			}
			symbologies.set(design.symbol.symbology);
			const entry = catalogue.symbologies.find((found) => found.id === design.symbol.symbology);
			const note = entry?.noteKey ?? null;
			phoneNote.hidden = note === null;
			if (note !== null) setText(phoneNote, t(note));
			const allowed = (entry?.ecLevels ?? []).join('');
			if (allowed !== shownLevels) {
				shownLevels = allowed;
				levels.setChoices(
					(entry?.ecLevels ?? []).map((level) => ({
						value: level,
						label: t(LEVEL_KEYS[level] ?? level),
					})),
				);
			}
			const symbol = snapshot.symbol;
			const view: SymbolView | null = symbol.status === 'empty' ? null : symbol.view;
			levels.set(view?.ecLevel ?? design.symbol.ecLevel ?? null);
			if (view === null) {
				fill.style.setProperty('--fill', '0');
				meter.setAttribute('aria-valuenow', '0');
				setText(reading, t('app.capacity.empty'));
				replace(facts, []);
				largest.hidden = true;
				return;
			}
			const percent = Math.round(view.capacity.fraction * 100);
			fill.style.setProperty('--fill', String(Math.min(1, view.capacity.fraction)));
			meter.setAttribute('aria-valuenow', String(percent));
			meter.setAttribute(
				'aria-valuetext',
				t('app.capacity.value', {
					used: whole(view.capacity.usedBits),
					total: whole(view.capacity.totalBits),
					percent,
				}),
			);
			meter.dataset.level = view.capacity.ofLargest > 0.85 ? 'high' : 'normal';
			setText(
				reading,
				t('app.capacity.value', {
					used: whole(view.capacity.usedBits),
					total: whole(view.capacity.totalBits),
					percent,
				}),
			);
			largest.hidden = false;
			setText(
				largest,
				t('app.capacity.largest', {
					percent: Math.max(1, Math.round(view.capacity.ofLargest * 100)),
				}),
			);
			const rows: [string, string][] = [
				[t('app.encoding.version'), view.version],
				[
					t('app.encoding.modules'),
					t('app.encoding.modules-value', { width: view.modules[0], height: view.modules[1] }),
				],
				[t('app.encoding.ec'), view.ecLevel],
				[t('app.encoding.mask'), String(view.mask)],
				[
					t('app.encoding.segments'),
					view.segments
						.map((segment) =>
							t('app.encoding.segment', {
								mode: t(MODE_KEYS[segment.mode] ?? segment.mode),
								chars: segment.chars,
							}),
						)
						.join('; '),
				],
			];
			replace(
				facts,
				rows.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]),
			);
		},
	};
}

export interface ContentView extends View {
	readonly root: HTMLElement;
	/** The words for the card's line: the kind of code. */
	meta(snapshot: StudioSnapshot): string;
}

export function createContent(ctx: AppContext): ContentView {
	const chips = choiceGroup(
		t('app.content.types'),
		[],
		(value) => ctx.dispatch({ type: 'payload/type', typeId: value }),
		'chips',
	);
	// The rest of the kinds, grouped by category, in one native select at the
	// end of the chips: a long list a phone shows in its own picker.
	const more = h('select', {
		className: 'input input--select more__select',
		attrs: { 'aria-label': t('app.content.more') },
		on: {
			change: () => {
				if (more.value !== '') ctx.dispatch({ type: 'payload/type', typeId: more.value });
			},
		},
	});
	const moreField = h('div', { className: 'more' }, [more]);
	const description = h('p', { className: 'content__description' });
	const action = h('p', { className: 'content__action' }, [
		h('span', { className: 'content__action-label', text: t('app.content.when-scanned') }),
		h('span', { className: 'content__action-text' }),
	]);
	const formHost = h('div', { className: 'form' });
	const formIssues = h('ul', { className: 'field__issues' });
	formIssues.hidden = true;
	const notes = h('div', { className: 'content__notes' });
	const encoding = createEncoding(ctx);
	const locked = h('p', { className: 'note note--info', text: t('studio.issue.design-locked') });
	locked.hidden = true;
	const root = h('div', { className: 'content' }, [
		chips.root,
		formHost,
		formIssues,
		action,
		description,
		locked,
		notes,
		encoding.root,
	]);

	let shownCatalogue: unknown = null;
	let shownForm: FormView | null = null;
	let formKey = '';
	let controls = new Map<string, FieldControl>();
	let touched = new Set<string>();

	const touch = (key: string): void => {
		if (touched.has(key)) return;
		touched.add(key);
		if (shownForm !== null) {
			const view = shownForm.fields.find((found) => found.key === key);
			if (view !== undefined) controls.get(key)?.update(view, true);
		}
	};

	function buildForm(form: FormView): void {
		controls = new Map();
		const byKey = new Map(form.fields.map((view) => [view.key, view]));
		const main: HTMLElement[] = [];
		const advanced: HTMLElement[] = [];
		for (const group of form.groups) {
			const plain: HTMLElement[] = [];
			const behind: HTMLElement[] = [];
			for (const key of group.fields) {
				const view = byKey.get(key);
				if (view === undefined) continue;
				const control = fieldControl(ctx, view, touch);
				controls.set(key, control);
				(view.advanced ? behind : plain).push(control.root);
			}
			const wrap = (children: HTMLElement[]): HTMLElement =>
				group.labelKey === null
					? h('div', { className: 'form__group' }, children)
					: h('fieldset', { className: 'form__group form__group--named' }, [
							h('legend', { className: 'legend', text: t(group.labelKey) }),
							...children,
						]);
			if (plain.length > 0) main.push(wrap(plain));
			if (behind.length > 0) advanced.push(wrap(behind));
		}
		const children: HTMLElement[] = [...main];
		if (advanced.length > 0) {
			children.push(
				h('details', { className: 'advanced' }, [
					h('summary', { className: 'advanced__head', text: t('app.content.advanced') }),
					h('div', { className: 'advanced__body' }, advanced),
				]),
			);
		}
		replace(formHost, children);
	}

	function drawNotes(form: FormView): void {
		const children: HTMLElement[] = [];
		if (form.safety.length > 0) {
			children.push(
				h('div', { className: 'notes' }, [
					h('h3', { className: 'notes__title', text: t('app.content.safety') }),
					h(
						'ul',
						{ className: 'notes__list' },
						form.safety.map((finding) =>
							h(
								'li',
								{
									className: `note note--${finding.severity === 'danger' ? 'error' : finding.severity === 'caution' ? 'warning' : 'info'}`,
								},
								[
									icon(finding.severity === 'danger' ? 'fail' : 'warn'),
									h('span', { text: t(safetyMessageKey(finding.code), finding.params ?? {}) }),
								],
							),
						),
					),
				]),
			);
		}
		if (form.compatibility.length > 0) {
			children.push(
				h('div', { className: 'notes' }, [
					h('h3', { className: 'notes__title', text: t('app.content.compatibility') }),
					h(
						'ul',
						{ className: 'notes__list' },
						form.compatibility.map((note) =>
							h('li', { className: 'note note--info' }, [
								icon('pending'),
								h('span', { text: t(note.noteKey) }),
							]),
						),
					),
				]),
			);
		}
		replace(notes, children);
	}

	function update(snapshot: StudioSnapshot): void {
		const catalogue = snapshot.catalogue;
		if (shownCatalogue !== catalogue) {
			shownCatalogue = catalogue;
			const all = catalogue.payloadTypes
				.flatMap((group) => group.types)
				.filter((type) => type.generate);
			chips.setChoices(
				COMMON.map((id) => all.find((type) => type.id === id))
					.filter((type) => type !== undefined)
					.map((type) => ({ value: type.id, label: t(type.labelKey) })),
			);
			// Rebuilding the chips empties their row; the select goes back at its end.
			chips.root.querySelector('.chips__grid')?.appendChild(moreField);
			replace(more, [
				h('option', { text: t('app.content.more'), attrs: { value: '' } }),
				...catalogue.payloadTypes
					.map((group) => ({
						group,
						types: group.types.filter((type) => type.generate && !COMMON.includes(type.id)),
					}))
					.filter(({ types }) => types.length > 0)
					.map(({ group, types }) =>
						h(
							'optgroup',
							{ attrs: { label: t(group.labelKey) } },
							types.map((type) =>
								h('option', { text: t(type.labelKey), attrs: { value: type.id } }),
							),
						),
					),
			]);
		}
		const form = snapshot.form;
		const typeId = snapshot.document.typeId;
		chips.set(COMMON.includes(typeId) ? typeId : null);
		more.value = COMMON.includes(typeId) ? '' : typeId;
		moreField.dataset.active = COMMON.includes(typeId) ? 'false' : 'true';

		if (form !== shownForm) {
			const key = `${form.typeId}:${form.fields.map((view) => view.key).join(',')}`;
			if (key !== formKey) {
				if (shownForm?.typeId !== form.typeId) touched = new Set();
				formKey = key;
				buildForm(form);
				drawNotes(form);
			} else if (
				shownForm === null ||
				shownForm.safety !== form.safety ||
				shownForm.compatibility !== form.compatibility
			) {
				drawNotes(form);
			}
			for (const view of form.fields) controls.get(view.key)?.update(view, touched.has(view.key));
			issueList(formIssues, form.issues);
			setText(description, t(form.descriptionKey));
			setText(action.lastElementChild as HTMLElement, t(form.actionKey));
			locked.hidden = !form.designLocked;
			shownForm = form;
		}
		encoding.update(snapshot);
	}

	return {
		root,
		update,
		meta: (snapshot) => t(snapshot.form.labelKey),
	};
}
