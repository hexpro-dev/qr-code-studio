/**
 * Validation problems, as data.
 *
 * A design file with two bad colours, or a Wi-Fi form with no network name and
 * a password that is too long, is not exceptional. It is the normal state of a
 * form while somebody is typing into it. So validators return every problem
 * they find as an `Issue` rather than throwing the first, and a view shows them
 * beside the fields they belong to.
 *
 * An issue never carries a sentence. `code` is a `MessageKey`: the offline app
 * looks it up in `src/messages/en.ts`, the website in its own locale files,
 * and the two are kept in step by a test on each side. `params` carries the
 * numbers a sentence needs, and never the value that was wrong: "this is 70
 * characters and the limit is 63" is useful, and the 70 characters might be a
 * password.
 */

/**
 * A key into a message catalogue.
 *
 * Dotted and lowercase, `area.thing.detail`. Kept as a plain string type so
 * that adding a registry entry does not mean editing a central union; the
 * completeness of the catalogue is checked by test instead, which is the check
 * that matters (a key with no sentence behind it shows up as raw text).
 */
export type MessageKey = string;

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
	/** What is wrong, as a message key. */
	readonly code: MessageKey;
	/** Where, from the root of whatever was validated: `['fields', 'ssid']`. */
	readonly path: readonly (string | number)[];
	readonly severity: IssueSeverity;
	/** Numbers and identifiers a sentence may use. Never the offending value. */
	readonly params?: Readonly<Record<string, number | string>>;
}

export function issue(
	code: MessageKey,
	path: readonly (string | number)[],
	severity: IssueSeverity = 'error',
	params?: Readonly<Record<string, number | string>>,
): Issue {
	return params === undefined ? { code, path, severity } : { code, path, severity, params };
}

/** True when any issue would stop the thing being used. Warnings and notes do not. */
export function hasErrors(issues: readonly Issue[]): boolean {
	return issues.some((found) => found.severity === 'error');
}
