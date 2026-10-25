/**
 * The controls every panel is built from, so there is one button, one card
 * and one way of picking from a set of pictures across the whole page.
 *
 * Native controls first: a choice among pictures is a group of radio inputs
 * with a text label each, a slider is an input of type range with its value
 * written beside it, a section is a details element. The browser then gives
 * keyboard handling, focus order and the accessibility tree for free, and a
 * screen reader hears the same words a sighted person reads.
 */

import type { Issue } from '../core/issue.js';
import type { ParamSchema, ParamValue } from '../design/types.js';
import { h, icon, replace, setText, uid } from './dom.js';
import type { Child, IconName } from './dom.js';
import { degrees, fine, issueText, t } from './text.js';

export interface ButtonOptions {
	readonly icon?: IconName;
	readonly primary?: boolean;
	readonly small?: boolean;
	/** For a button whose only text is hidden on narrow screens. */
	readonly compact?: boolean;
	readonly onClick: (event: MouseEvent) => void;
	readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

/** The one button. */
export function button(label: string, options: ButtonOptions): HTMLButtonElement {
	const classes = ['btn'];
	if (options.primary === true) classes.push('btn--primary');
	if (options.small === true) classes.push('btn--small');
	if (options.compact === true) classes.push('btn--compact');
	return h(
		'button',
		{
			className: classes.join(' '),
			attrs: { type: 'button', ...options.attrs },
			on: { click: options.onClick },
		},
		[
			options.icon === undefined ? null : icon(options.icon),
			h('span', { className: 'btn__label', text: label }),
		],
	);
}

export function setButtonLabel(node: HTMLButtonElement, label: string): void {
	const span = node.querySelector('.btn__label');
	if (span !== null) setText(span, label);
}

export interface Card {
	readonly root: HTMLDetailsElement;
	readonly body: HTMLDivElement;
	/** The line beside the title that says what is chosen. */
	readonly meta: HTMLSpanElement;
}

/** The one card: a numbered section that opens and closes. */
export function card(number: number, title: string, open: boolean, id?: string): Card {
	const meta = h('span', { className: 'card__meta' });
	const body = h('div', { className: 'card__body' });
	const root = h('details', { className: 'card', ...(id === undefined ? {} : { id }) }, [
		h('summary', { className: 'card__head' }, [
			h('span', { className: 'card__num', text: String(number).padStart(2, '0') }),
			h('h2', { className: 'card__title', text: title }),
			meta,
			icon('plus', 'card__chevron'),
		]),
		body,
	]);
	root.open = open;
	return { root, body, meta };
}

/** A list of issues, worded, with the severity said in words as well as in colour. */
export function issueList(node: HTMLElement, issues: readonly Issue[]): void {
	if (issues.length === 0) {
		replace(node, []);
		node.hidden = true;
		return;
	}
	node.hidden = false;
	replace(
		node,
		issues.map((found) =>
			h('li', { className: `note note--${found.severity}` }, [
				icon(
					found.severity === 'error' ? 'fail' : found.severity === 'warning' ? 'warn' : 'pending',
				),
				h('span', { text: issueText(found) }),
			]),
		),
	);
}

export interface Choice {
	readonly value: string;
	readonly label: string;
	/** A picture beside the words, as an image URL. */
	readonly picture?: string;
	readonly disabled?: boolean;
	readonly hint?: string;
}

export interface ChoiceGroup {
	readonly root: HTMLFieldSetElement;
	set(value: string | null): void;
	/** Swap the choices, keeping the group and its legend. */
	setChoices(choices: readonly Choice[]): void;
	readonly inputs: () => readonly HTMLInputElement[];
}

/**
 * A choice of one from a set: radio inputs in a fieldset. `look` picks how it
 * is drawn (pictures in a grid, chips in a row, or a segmented strip), never
 * how it behaves.
 */
export function choiceGroup(
	legend: string,
	choices: readonly Choice[],
	onPick: (value: string) => void,
	look: 'swatches' | 'chips' | 'segments' = 'segments',
	options: { readonly legendHidden?: boolean; readonly name?: string } = {},
): ChoiceGroup {
	const name = options.name ?? uid('choice');
	const grid = h('div', { className: `${look}__grid` });
	const root = h('fieldset', { className: look }, [
		h('legend', {
			className: options.legendHidden === true ? 'sr-only' : 'legend',
			text: legend,
		}),
		grid,
	]);
	let current: string | null = null;
	const build = (list: readonly Choice[]): void => {
		replace(
			grid,
			list.map((choice) => {
				const input = h('input', {
					className: 'choice__input',
					attrs: {
						type: 'radio',
						name,
						value: choice.value,
						disabled: choice.disabled === true,
					},
					on: {
						change: () => {
							if (input.checked) onPick(choice.value);
						},
					},
				});
				input.checked = choice.value === current;
				const children: Child[] = [input];
				const box = h('span', { className: 'choice__box' }, [
					choice.picture === undefined
						? null
						: h('img', {
								className: 'choice__img',
								attrs: { src: choice.picture, alt: '', width: 48, height: 48, decoding: 'async' },
							}),
					h('span', { className: 'choice__label', text: choice.label }),
					choice.hint === undefined
						? null
						: h('span', { className: 'choice__hint', text: choice.hint }),
				]);
				children.push(box);
				return h('label', { className: 'choice' }, children);
			}),
		);
	};
	build(choices);
	const inputs = (): HTMLInputElement[] => [...grid.querySelectorAll<HTMLInputElement>('input')];
	return {
		root,
		inputs,
		set(value) {
			current = value;
			for (const input of inputs()) {
				const checked = input.value === value;
				if (input.checked !== checked) input.checked = checked;
			}
		},
		setChoices(list) {
			// Keep focus where it was when the list is rebuilt under the person.
			const focused = document.activeElement;
			const hadFocus = focused instanceof HTMLInputElement && grid.contains(focused);
			build(list);
			if (hadFocus) {
				const again = inputs().find((input) => input.checked) ?? inputs()[0];
				again?.focus();
			}
		},
	};
}

/** A label above a control, a hint below it, and the issues under that. */
export interface Field {
	readonly root: HTMLDivElement;
	readonly label: HTMLLabelElement;
	readonly hint: HTMLParagraphElement;
	readonly issues: HTMLUListElement;
	readonly describedBy: string;
}

export function field(labelText: string, control: HTMLElement, hintText?: string): Field {
	const id = control.id === '' ? uid('field') : control.id;
	control.id = id;
	const hintId = `${id}-hint`;
	const issuesId = `${id}-issues`;
	const label = h('label', { className: 'field__label', text: labelText, attrs: { for: id } });
	const hint = h('p', { className: 'field__hint', id: hintId, text: hintText ?? '' });
	hint.hidden = hintText === undefined;
	const issues = h('ul', { className: 'field__issues', id: issuesId });
	issues.hidden = true;
	const describedBy = `${hintId} ${issuesId}`;
	control.setAttribute('aria-describedby', describedBy);
	const root = h('div', { className: 'field' }, [label, control, hint, issues]);
	return { root, label, hint, issues, describedBy };
}

/**
 * A slider for a number, with its value written beside it. `onValue` is told
 * the phase: 'move' while a drag goes on, 'end' when it lets go, so a drag
 * can be one undo step.
 */
export interface Slider {
	readonly root: HTMLDivElement;
	readonly input: HTMLInputElement;
	set(value: number): void;
}

export function slider(
	labelText: string,
	range: { readonly min: number; readonly max: number; readonly step: number },
	format: (value: number) => string,
	onValue: (value: number, phase: 'move' | 'end') => void,
): Slider {
	const id = uid('slider');
	const output = h('output', { className: 'slider__value', attrs: { for: id } });
	const input = h('input', {
		className: 'slider__input',
		id,
		attrs: { type: 'range', min: range.min, max: range.max, step: range.step },
		on: {
			input: () => {
				const value = Number(input.value);
				setText(output, format(value));
				onValue(value, 'move');
			},
			change: () => onValue(Number(input.value), 'end'),
		},
	});
	const root = h('div', { className: 'slider' }, [
		h('label', { className: 'slider__label', text: labelText, attrs: { for: id } }),
		output,
		input,
	]);
	return {
		root,
		input,
		set(value) {
			// Only when it differs, so a drag in progress is never pulled back by its own echo.
			if (Number(input.value) !== value) input.value = String(value);
			setText(output, format(value));
		},
	};
}

/**
 * Wraps a dispatcher so a run of 'move' calls is one undo step: the first
 * opens a history group, each applies, and 'end' closes it.
 */
export function grouped(
	key: string,
	begin: (key: string) => void,
	apply: (value: number) => void,
	commit: (key: string) => void,
): (value: number, phase: 'move' | 'end') => void {
	let open = false;
	return (value, phase) => {
		if (!open) {
			begin(key);
			open = true;
		}
		apply(value);
		if (phase === 'end') {
			commit(key);
			open = false;
		}
	};
}

/** A control for one of a registry entry's params, by the kind its schema gives. */
export interface ParamControl {
	readonly root: HTMLElement;
	set(value: ParamValue): void;
}

export function paramControl(
	schema: ParamSchema,
	onValue: (value: ParamValue, phase: 'move' | 'end') => void,
): ParamControl {
	const label = t(schema.labelKey);
	switch (schema.kind) {
		case 'boolean': {
			const input = h('input', {
				attrs: { type: 'checkbox' },
				on: { change: () => onValue(input.checked, 'end') },
			});
			const root = h('label', { className: 'tick' }, [input, h('span', { text: label })]);
			return {
				root,
				set(value) {
					input.checked = value === true;
				},
			};
		}
		case 'select': {
			const select = h(
				'select',
				{ on: { change: () => onValue(select.value, 'end') } },
				(schema.options ?? []).map((option) =>
					h('option', { text: t(option.labelKey), attrs: { value: option.value } }),
				),
			);
			const wrapped = field(label, select);
			return {
				root: wrapped.root,
				set(value) {
					select.value = String(value);
				},
			};
		}
		case 'colour': {
			const input = h('input', {
				className: 'colour-well',
				attrs: { type: 'color' },
				on: {
					input: () => onValue(input.value, 'move'),
					change: () => onValue(input.value, 'end'),
				},
			});
			const wrapped = field(label, input);
			return {
				root: wrapped.root,
				set(value) {
					if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
				},
			};
		}
		default: {
			const isAngle = schema.kind === 'angle';
			const min = schema.min ?? 0;
			const max = schema.max ?? (isAngle ? 360 : 1);
			const step = schema.step ?? (schema.kind === 'integer' || isAngle ? 1 : (max - min) / 100);
			// Small ranges (a corner radius from 0 to 0.5) need the second decimal place.
			const format = isAngle
				? degrees
				: schema.kind === 'integer'
					? (value: number) => String(value)
					: fine;
			const control = slider(label, { min, max, step }, format, (value, phase) =>
				onValue(value, phase),
			);
			return {
				root: control.root,
				set(value) {
					if (typeof value === 'number') control.set(value);
				},
			};
		}
	}
}
