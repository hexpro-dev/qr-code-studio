/**
 * A Telegram chat, by username or by phone number, with an optional draft
 * message: Telegram's own deep links (core.telegram.org/api/links), written
 * as t.me/<username> or t.me/+<phone_number>, each with ?text=.
 *
 * A username is 5 to 32 characters of Latin letters, digits and underscores
 * (core.telegram.org/method/account.updateUsername). Telegram's invite links
 * also start t.me/+ but carry letters after it, so only digits are read as a
 * phone number.
 */

import { issue } from '../../core/issue.js';
import type { Issue } from '../../core/issue.js';
import { definePayload, field, unparseable } from '../define.js';
import { parseQuery } from '../escape.js';
import { telDigits, textOf } from '../fields.js';

const ID = 'telegram';

export type TelegramValue = {
	readonly target: string;
	readonly username: string;
	readonly phone: string;
	readonly message: string;
};

const USERNAME = /^[A-Za-z0-9_]{5,32}$/;

function write(value: TelegramValue): string {
	const target = textOf(value, 'target');
	const path =
		target === 'phone' ? `+${telDigits(textOf(value, 'phone'))}` : textOf(value, 'username');
	const message = textOf(value, 'message');
	return `https://t.me/${path}${message === '' ? '' : `?text=${encodeURIComponent(message)}`}`;
}

function rules(value: TelegramValue, flagged: (key: string) => boolean): Issue[] {
	if (textOf(value, 'target') === 'phone') {
		const phone = textOf(value, 'phone');
		if (phone === '') return [issue('payload.issue.required', ['fields', 'phone'])];
		if (!flagged('phone') && !phone.startsWith('+')) {
			return [issue('payload.telegram.issue.international', ['fields', 'phone'])];
		}
		return [];
	}
	const username = textOf(value, 'username');
	if (username === '') return [issue('payload.issue.required', ['fields', 'username'])];
	return USERNAME.test(username)
		? []
		: [issue('payload.telegram.issue.username', ['fields', 'username'])];
}

function locate(text: string): { readonly path: string; readonly query: string } | undefined {
	const web = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([^/?#]+)\/?(?:\?([^#]*))?$/i.exec(text);
	if (web) return { path: web[1] as string, query: web[2] ?? '' };
	const app = /^tg:\/\/resolve\?(.*)$/i.exec(text);
	if (!app) return undefined;
	const pairs = parseQuery(app[1] as string) ?? [];
	const domain = pairs.find(([name]) => name === 'domain')?.[1];
	const phone = pairs.find(([name]) => name === 'phone')?.[1];
	const rest = pairs
		.filter(([name]) => name === 'text')
		.map(([, v]) => `text=${encodeURIComponent(v)}`)
		.join('&');
	if (domain !== undefined) return { path: domain, query: rest };
	if (phone !== undefined) return { path: `+${phone.replace(/^\+/, '')}`, query: rest };
	return undefined;
}

function parse(text: string): TelegramValue {
	const found = locate(text);
	if (found === undefined) throw unparseable(ID, 'not-telegram');
	const pairs = parseQuery(found.query);
	if (pairs === undefined) throw unparseable(ID, 'malformed-escape');
	const message = pairs.find(([name]) => name === 'text')?.[1] ?? '';
	const phone = /^\+(\d{3,15})$/.exec(found.path);
	if (phone) return { target: 'phone', username: '', phone: `+${phone[1]}`, message };
	if (!USERNAME.test(found.path)) throw unparseable(ID, 'not-a-username');
	return { target: 'username', username: found.path, phone: '', message };
}

export const telegramType = definePayload<TelegramValue>({
	id: ID,
	category: 'message',
	fields: [
		field(ID, 'target', 'select', {
			required: true,
			options: ['username', 'phone'],
			default: 'username',
		}),
		field(ID, 'username', 'text', { maxLength: 32, hint: true }),
		field(ID, 'phone', 'tel', { hint: true }),
		field(ID, 'message', 'multiline', { maxLength: 4096 }),
	],
	compatibility: [
		// Telegram, "Deep links": https://core.telegram.org/api/links
		{ reader: 'telegram', noteKey: 'payload.telegram.compat.app' },
	],
	rules,
	write,
	detect: (text) => {
		try {
			parse(text);
			return 0.9;
		} catch {
			return 0;
		}
	},
	parse,
});
