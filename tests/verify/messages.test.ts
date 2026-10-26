/**
 * Every message key the scan check uses has an English sentence, every
 * sentence is used, every placeholder a sentence has is filled by the params
 * its check or fix carries, and every sentence keeps the house register.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DesignPaint, QrDesignV1 } from '../../src/design/types.js';
import { VERIFY_MESSAGES } from '../../src/messages/en/verify.js';
import { suggestFixes } from '../../src/verify/fixes.js';
import { VERIFY_MESSAGE_KEYS, checkNameKey } from '../../src/verify/keys.js';
import type { VerifyJob, VerifyReport } from '../../src/verify/types.js';
import { alwaysReads, design, run } from './helpers.js';
import { checkHouseStyle } from './style.js';
import { messageArguments } from '../../src/messages/format.js';

const root = resolve(import.meta.dirname, '../..');

function keyLiterals(dir: string): string[] {
	const keys = new Set<string>();
	for (const name of readdirSync(join(root, dir))) {
		const text = readFileSync(join(root, dir, name), 'utf8');
		for (const match of text.matchAll(/'(verify\.[a-z0-9.-]+)'/g)) keys.add(match[1] as string);
	}
	return [...keys];
}

function flatten(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(flatten);
	return [];
}

const used = new Set([...keyLiterals('src/verify'), ...flatten(VERIFY_MESSAGE_KEYS)]);

const solid = (ink: string): DesignPaint => ({ kind: 'solid', ink });

/** Reports that between them reach every check sentence with a placeholder, and every fix. */
function scenarios(): { report: VerifyReport; design: QrDesignV1 }[] {
	const statics = (overrides: Partial<VerifyJob>) => ({
		report: run(overrides, { reader: alwaysReads, axes: [] }),
		design: overrides.design ?? design({}),
	});
	const base = design({});
	const gradient = (to: string): DesignPaint => ({
		kind: 'linear',
		angle: 0,
		space: 'symbol',
		stops: [
			{ offset: 0, ink: '#000000' },
			{ offset: 1, ink: to },
		],
	});
	const logo = (size: number, ecLevel: 'M' | 'H') =>
		design({
			symbol: { symbology: 'qr', ecLevel },
			logo: {
				source: { kind: 'icon', id: 'link' },
				size,
				clear: 'box',
				padding: 1,
				plate: { paint: solid('#ffffff'), shape: 'square' },
			},
		});
	return [
		statics({ design: design({ modules: { ...base.modules, paint: gradient('#6e6e6e') } }) }),
		statics({ design: logo(0.1, 'M') }),
		statics({}),
		statics({ design: design({ quietZone: 2 }) }),
		statics({ design: design({ modules: { ...base.modules, paint: solid('#a0a0a0') } }) }),
		statics({ design: design({ modules: { ...base.modules, paint: solid('#d0d0d0') } }) }),
		statics({ design: design({ modules: { ...base.modules, paint: solid('#ff0000') } }) }),
		statics({ design: design({ modules: { ...base.modules, paint: gradient('#606060') } }) }),
		statics({
			design: design({
				symbol: { symbology: 'qr', ecLevel: 'M' },
				logo: {
					source: { kind: 'icon', id: 'link' },
					size: 0.3,
					clear: 'box',
					padding: 1,
					plate: null,
				},
			}),
		}),
		statics({ design: logo(0.2, 'H') }),
		statics({
			design: design({
				background: solid('#000000'),
				modules: { ...base.modules, paint: solid('#ffffff') },
			}),
		}),
		statics({ conditions: { sizeMm: 8, dpi: null, distanceMm: null } }),
		statics({ conditions: { sizeMm: 13, dpi: null, distanceMm: null } }),
		statics({ conditions: { sizeMm: 30, dpi: null, distanceMm: 600 } }),
		statics({ conditions: { sizeMm: null, dpi: null, distanceMm: null } }),
		{
			report: run({}, { reader: () => ({ read: false, margin: null }), axes: ['distance'] }),
			design: base,
		},
	];
}

describe('the verify message catalogue', () => {
	it('has a sentence for every key the layer uses', () => {
		expect([...used].filter((key) => !(key in VERIFY_MESSAGES))).toEqual([]);
	});

	it('has no sentence nothing uses', () => {
		expect(Object.keys(VERIFY_MESSAGES).filter((key) => !used.has(key))).toEqual([]);
	});

	it('fills every placeholder from the params its check or fix carries', () => {
		const reached = new Set<string>();
		for (const { report, design: used } of scenarios()) {
			const said: { key: string; params: Readonly<Record<string, number | string>> }[] = [
				...report.checks.map((check) => ({ key: check.messageKey, params: check.params ?? {} })),
				...suggestFixes(report, used).map((fix) => ({
					key: fix.labelKey,
					params: fix.params ?? {},
				})),
			];
			for (const { key, params } of said) {
				const sentence = VERIFY_MESSAGES[key] as string;
				expect(sentence, key).toBeDefined();
				for (const name of messageArguments(sentence)) {
					expect(params, `${key} uses {${name}}`).toHaveProperty(name);
					reached.add(key);
				}
			}
		}
		const withPlaceholders = Object.entries(VERIFY_MESSAGES)
			.filter(([, sentence]) => messageArguments(sentence).length > 0)
			.map(([key]) => key);
		expect(withPlaceholders.filter((key) => !reached.has(key))).toEqual([]);
	});

	it('names each check apart, the two contrast checks included', () => {
		const report = run({ design: design({}) }, { reader: alwaysReads, axes: [] });
		const names = report.checks.map((check) => VERIFY_MESSAGES[checkNameKey(check)]);
		expect(names.every((name) => typeof name === 'string')).toBe(true);
		expect(new Set(names).size).toBe(names.length);
		const contrast = report.checks.filter((check) => check.id === 'contrast');
		expect(contrast.map(checkNameKey)).toEqual([
			'verify.check-name.contrast',
			'verify.check-name.modulation',
		]);
	});

	it('keeps the house register', () => {
		checkHouseStyle(VERIFY_MESSAGES, 'verify', (key) =>
			/\.(check-name|status|fix)\./.test(key) || /^verify\.axis\.[a-z]+$/.test(key)
				? 'label'
				: 'sentence',
		);
	});
});
