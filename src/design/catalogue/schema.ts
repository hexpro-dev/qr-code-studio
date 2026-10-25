/**
 * Parameter schemas for the built-in entries, written once.
 *
 * Labels are shared where the meaning is: every "Size" slider is the same
 * message key, so a translation is done once and two entries never call the
 * same thing by different names.
 */

import type { ParamSchema } from '../types.js';

export function numberParam(
	key: string,
	defaultValue: number,
	min: number,
	max: number,
	step: number,
	label = key,
): ParamSchema {
	return Object.freeze({
		key,
		kind: 'number',
		labelKey: `design.param.${label}`,
		default: defaultValue,
		min,
		max,
		step,
	});
}

export function integerParam(
	key: string,
	defaultValue: number,
	min: number,
	max: number,
	label = key,
): ParamSchema {
	return Object.freeze({
		key,
		kind: 'integer',
		labelKey: `design.param.${label}`,
		default: defaultValue,
		min,
		max,
		step: 1,
	});
}

export function angleParam(key: string, defaultValue: number, label = key): ParamSchema {
	return Object.freeze({
		key,
		kind: 'angle',
		labelKey: `design.param.${label}`,
		default: defaultValue,
		min: 0,
		max: 360,
		step: 1,
	});
}

export function colourParam(key: string, defaultValue: string, label = key): ParamSchema {
	return Object.freeze({
		key,
		kind: 'colour',
		labelKey: `design.param.${label}`,
		default: defaultValue,
	});
}

export function selectParam(
	key: string,
	defaultValue: string,
	values: readonly string[],
	label = key,
): ParamSchema {
	return Object.freeze({
		key,
		kind: 'select',
		labelKey: `design.param.${label}`,
		default: defaultValue,
		options: Object.freeze(
			values.map((value) => Object.freeze({ value, labelKey: `design.option.${value}` })),
		),
	});
}
