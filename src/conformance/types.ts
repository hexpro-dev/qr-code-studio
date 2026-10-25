/**
 * What the conformance checks return: one entry per rule broken, with enough
 * detail for whoever wrote the entry to find the case and draw it again.
 *
 * `detail` is for a developer reading a test failure, in plain English with
 * the numbers in it. It never reaches a person using the studio, so it is
 * not a message key.
 */

export interface Violation {
	/** The entry's id. */
	readonly entry: string;
	/** Which rule, as a short kebab-case name. */
	readonly rule: string;
	readonly detail: string;
}
