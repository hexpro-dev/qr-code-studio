/**
 * GS1 element strings, against examples from the GS1 General
 * Specifications (section 3.2 and the worked examples of section 7.8), and
 * the ways a string stops being element strings.
 */

import { describe, expect, it } from 'vitest';
import { GS1_AIS, parseGs1 } from '../../src/inspect/gs1.js';
import { INSPECT_MESSAGE_KEYS, gs1MessageKey } from '../../src/inspect/keys.js';

const GS = '\u001d';

describe('parseGs1', () => {
	it('reads fixed lengths without separators and variable ones up to a separator or the end', () => {
		expect(parseGs1(`0109520123456788${'17'}260101${'10'}ABC1${GS}21XYZ`)).toEqual([
			{ ai: '01', value: '09520123456788' },
			{ ai: '17', value: '260101' },
			{ ai: '10', value: 'ABC1' },
			{ ai: '21', value: 'XYZ' },
		]);
		// A leading separator (FNC1 as the reader gives it) is skipped.
		expect(parseGs1(`${GS}00123456789012345675`)).toEqual([
			{ ai: '00', value: '123456789012345675' },
		]);
	});

	it('reads three and four digit identifiers, measures and amounts', () => {
		expect(parseGs1(`2401234${GS}3103000500${'3922'}1250${GS}7003260101123${'0'}`)).toEqual([
			{ ai: '240', value: '1234' },
			{ ai: '3103', value: '000500' },
			{ ai: '3922', value: '1250' },
			{ ai: '7003', value: '2601011230' },
		]);
		expect(parseGs1('4220364151234567890123')).toEqual([
			{ ai: '422', value: '036' },
			{ ai: '415', value: '1234567890123' },
		]);
	});

	it('splits out an identifier it has no name for, by the length rule for its first two digits', () => {
		expect(parseGs1(`7240ABC${GS}91INTERNAL`)).toEqual([
			{ ai: '7240', value: 'ABC' },
			{ ai: '91', value: 'INTERNAL' },
		]);
		expect(parseGs1('23512')).toEqual([{ ai: '235', value: '12' }]);
	});

	it('stops where the text stops being element strings, keeping what came before', () => {
		// Too short for a fixed length.
		expect(parseGs1('0101234')).toEqual([]);
		// A separator inside a fixed length.
		expect(parseGs1(`01012345${GS}678901234`)).toEqual([]);
		// Longer than the identifier allows.
		expect(parseGs1(`10${'A'.repeat(21)}`)).toEqual([]);
		// Not digits.
		expect(parseGs1('0109520123456788ZZ12')).toEqual([{ ai: '01', value: '09520123456788' }]);
		expect(parseGs1('9')).toEqual([]);
		// An identifier cut short, or with letters where its later digits belong.
		expect(parseGs1('72AB')).toEqual([]);
		expect(parseGs1('724')).toEqual([]);
		expect(parseGs1('')).toEqual([]);
	});
});

describe('the names of identifiers', () => {
	it('names every identifier in the table, the families, and the rest', () => {
		for (const ai of Object.keys(GS1_AIS)) expect(gs1MessageKey(ai)).toBe(`inspect.gs1.${ai}`);
		expect(gs1MessageKey('3103')).toBe(INSPECT_MESSAGE_KEYS.gs1Measure);
		expect(gs1MessageKey('3922')).toBe(INSPECT_MESSAGE_KEYS.gs1Amount);
		expect(gs1MessageKey('7240')).toBe(INSPECT_MESSAGE_KEYS.gs1Unknown);
	});
});
