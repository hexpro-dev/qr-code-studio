/**
 * The form a view draws for a content type: its schema with the values, the
 * issues sorted onto the fields they belong to, and the fields gathered into
 * the groups and the disclosure the schema asks for.
 *
 * A view renders this and nothing else, so a content type added to the
 * registry gets a working form in both interfaces without a line of view
 * code. Field order is the schema's; a group is a run of consecutive fields
 * sharing a `group`, which is how every built-in type lays its groups out.
 */

import type { Issue } from '../core/issue.js';
import type { FieldValue, PayloadType, SafetyFinding } from '../payload/types.js';
import { emptyValue } from './document.js';
import { groupKey } from './keys.js';
import type { FieldGroupView, FieldView, FormView } from './types.js';

function belongsTo(found: Issue, key: string): boolean {
	return found.path[0] === 'fields' && found.path[1] === key;
}

function safetyOf(
	type: PayloadType,
	value: Readonly<Record<string, FieldValue>>,
): readonly SafetyFinding[] {
	if (type.safety === undefined) return [];
	try {
		return type.safety(value);
	} catch {
		// A safety analyser is advice. One that cannot cope with a value has
		// nothing to say about it, and the form still has to draw.
		return [];
	}
}

export function formView(
	type: PayloadType,
	fields: Readonly<Record<string, FieldValue>>,
	issues: readonly Issue[],
): FormView {
	const views: FieldView[] = type.fields.map((field) => {
		const value = Object.prototype.hasOwnProperty.call(fields, field.key)
			? (fields[field.key] as FieldValue)
			: emptyValue(field);
		return Object.freeze({
			key: field.key,
			kind: field.kind,
			labelKey: field.labelKey,
			hintKey: field.hintKey ?? null,
			required: field.required === true,
			multiple: field.multiple === true,
			maxItems: field.maxItems ?? null,
			maxLength: field.maxLength ?? null,
			min: field.min ?? null,
			max: field.max ?? null,
			options: field.options ?? [],
			group: field.group ?? null,
			advanced: field.advanced === true,
			secret: field.kind === 'secret',
			value,
			issues: Object.freeze(issues.filter((found) => belongsTo(found, field.key))),
		});
	});

	const groups: FieldGroupView[] = [];
	let open: { id: string | null; fields: FieldView[] } | null = null;
	const close = (): void => {
		if (open === null) return;
		groups.push(
			Object.freeze({
				id: open.id,
				labelKey: open.id === null ? null : groupKey(open.id),
				advanced: open.fields.every((field) => field.advanced),
				fields: Object.freeze(open.fields.map((field) => field.key)),
			}),
		);
		open = null;
	};
	for (const view of views) {
		// Ungrouped fields gather too, so a group's heading never splits a run of plain fields in two.
		if (open === null || open.id !== view.group) {
			close();
			open = { id: view.group, fields: [] };
		}
		open.fields.push(view);
	}
	close();

	const keys = new Set(type.fields.map((field) => field.key));
	const errors = issues.some((found) => found.severity === 'error');
	return Object.freeze({
		typeId: type.id,
		labelKey: type.labelKey,
		descriptionKey: type.descriptionKey,
		actionKey: type.actionKey,
		category: type.category,
		fields: Object.freeze(views),
		groups: Object.freeze(groups),
		hasAdvanced: views.some((view) => view.advanced),
		issues: Object.freeze(
			issues.filter((found) => !(found.path[0] === 'fields' && keys.has(found.path[1] as string))),
		),
		compatibility: type.compatibility ?? [],
		safety: errors ? [] : safetyOf(type, fields),
		designLocked: type.constraints?.designLocked === true,
	});
}
