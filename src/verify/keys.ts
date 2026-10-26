/**
 * The message keys a view needs to show a report, beyond the sentence each
 * check and fix already names: what each check and axis is called, the
 * statuses and verdicts, and one sentence per axis for whether it held up
 * under everyday conditions. The English is src/messages/en/verify.ts.
 */

import type { CaptureAxis, CheckId, CheckStatus } from './types.js';

export const VERIFY_MESSAGE_KEYS = Object.freeze({
	checkNames: Object.freeze({
		'quiet-zone': 'verify.check-name.quiet-zone',
		contrast: 'verify.check-name.contrast',
		polarity: 'verify.check-name.polarity',
		'function-patterns': 'verify.check-name.function-patterns',
		'logo-budget': 'verify.check-name.logo-budget',
		'module-size': 'verify.check-name.module-size',
		'finder-shape': 'verify.check-name.finder-shape',
		'colour-red-channel': 'verify.check-name.colour-red-channel',
		'reader-support': 'verify.check-name.reader-support',
	} satisfies Record<CheckId, string>),
	statuses: Object.freeze({
		pass: 'verify.status.pass',
		warn: 'verify.status.warn',
		fail: 'verify.status.fail',
	} satisfies Record<CheckStatus, string>),
	verdicts: Object.freeze({
		pass: 'verify.verdict.pass',
		warn: 'verify.verdict.warn',
		fail: 'verify.verdict.fail',
	} satisfies Record<CheckStatus, string>),
	/** When the clean capture itself did not read. */
	baselineFailed: 'verify.baseline.fail',
	/** For the QrStudioError 'verify/missing-entry'. */
	missingEntry: 'verify.error.missing-entry',
	axes: Object.freeze({
		distance: Object.freeze({
			name: 'verify.axis.distance',
			ok: 'verify.axis.distance.ok',
			short: 'verify.axis.distance.short',
		}),
		focus: Object.freeze({
			name: 'verify.axis.focus',
			ok: 'verify.axis.focus.ok',
			short: 'verify.axis.focus.short',
		}),
		motion: Object.freeze({
			name: 'verify.axis.motion',
			ok: 'verify.axis.motion.ok',
			short: 'verify.axis.motion.short',
		}),
		noise: Object.freeze({
			name: 'verify.axis.noise',
			ok: 'verify.axis.noise.ok',
			short: 'verify.axis.noise.short',
		}),
		angle: Object.freeze({
			name: 'verify.axis.angle',
			ok: 'verify.axis.angle.ok',
			short: 'verify.axis.angle.short',
		}),
		light: Object.freeze({
			name: 'verify.axis.light',
			ok: 'verify.axis.light.ok',
			short: 'verify.axis.light.short',
		}),
		glare: Object.freeze({
			name: 'verify.axis.glare',
			ok: 'verify.axis.glare.ok',
			short: 'verify.axis.glare.short',
		}),
		ink: Object.freeze({
			name: 'verify.axis.ink',
			ok: 'verify.axis.ink.ok',
			short: 'verify.axis.ink.short',
		}),
		contrast: Object.freeze({
			name: 'verify.axis.contrast',
			ok: 'verify.axis.contrast.ok',
			short: 'verify.axis.contrast.short',
		}),
	} satisfies Record<CaptureAxis, { name: string; ok: string; short: string }>),
});
