/**
 * The specification vectors for the email content type, ../content/email.ts.
 * Test data: see ./built-in.ts for why it lives here rather than on the type.
 */

import type { EmailValue } from '../content/email.js';
import type { PayloadVector } from '../types.js';

export const emailVectors: readonly PayloadVector<EmailValue>[] = [
	{
		text: 'mailto:chris@example.com',
		value: { to: ['chris@example.com'], cc: [], bcc: [], subject: '', body: '' },
		source: 'RFC 6068 section 6.1, first example.',
	},
	{
		text: 'mailto:infobot@example.com?subject=current-issue',
		value: { to: ['infobot@example.com'], cc: [], bcc: [], subject: 'current-issue', body: '' },
		source: 'RFC 6068 section 6.1.',
	},
	{
		text: 'mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index',
		value: {
			to: ['infobot@example.com'],
			cc: [],
			bcc: [],
			subject: '',
			body: 'send current-issue\nsend index',
		},
		source: 'RFC 6068 section 6.1: a line break in the body is %0D%0A.',
	},
	{
		text: 'mailto:gorby%25kremvax@example.com',
		value: { to: ['gorby%kremvax@example.com'], cc: [], bcc: [], subject: '', body: '' },
		source: 'RFC 6068 section 6.1: a percent sign in an address is itself percent-encoded.',
	},
	{
		text: 'mailto:Mike%26family@example.org',
		value: { to: ['Mike&family@example.org'], cc: [], bcc: [], subject: '', body: '' },
		source: 'RFC 6068 section 6.1: an ampersand in an address is percent-encoded.',
	},
	{
		text: 'mailto:joe@example.com?cc=bob@example.com&body=hello',
		value: {
			to: ['joe@example.com'],
			cc: ['bob@example.com'],
			bcc: [],
			subject: '',
			body: 'hello',
		},
		source: 'RFC 6068 section 6.1.',
	},
	{
		text: 'mailto:addr1@an.example,addr2@an.example',
		value: {
			to: ['addr1@an.example', 'addr2@an.example'],
			cc: [],
			bcc: [],
			subject: '',
			body: '',
		},
		source: 'RFC 6068 section 6.1.',
	},
];
