/**
 * The specification vectors for the calendar event content type,
 * ../content/event.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 */

import type { EventValue } from '../content/event.js';
import type { PayloadVector } from '../types.js';

export const eventVectors: readonly PayloadVector<EventValue>[] = [
	{
		text: [
			'BEGIN:VEVENT',
			'UID:19970901T130000Z-123401@example.com',
			'DTSTAMP:19970901T130000Z',
			'DTSTART:19970903T163000Z',
			'DTEND:19970903T190000Z',
			'SUMMARY:Annual Employee Review',
			'CLASS:PRIVATE',
			'CATEGORIES:BUSINESS,HUMAN RESOURCES',
			'END:VEVENT',
		].join('\r\n'),
		value: {
			summary: 'Annual Employee Review',
			timing: 'utc',
			start: '1997-09-03T16:30',
			end: '1997-09-03T19:00',
			startDate: '',
			endDate: '',
			location: '',
			description: '',
			url: '',
		},
		source: 'RFC 5545 section 3.6.1, the first VEVENT example.',
	},
	{
		text: [
			'BEGIN:VEVENT',
			'UID:20070423T123432Z-541111@example.com',
			'DTSTAMP:20070423T123432Z',
			'DTSTART;VALUE=DATE:20070628',
			'DTEND;VALUE=DATE:20070709',
			'SUMMARY:Festival International de Jazz de Montreal',
			'TRANSP:TRANSPARENT',
			'END:VEVENT',
		].join('\r\n'),
		value: {
			summary: 'Festival International de Jazz de Montreal',
			timing: 'all-day',
			start: '',
			end: '',
			startDate: '2007-06-28',
			endDate: '2007-07-08',
			location: '',
			description: '',
			url: '',
		},
		source: 'RFC 5545 section 3.6.1, the multi-day all-day example: DTEND is exclusive.',
	},
];
