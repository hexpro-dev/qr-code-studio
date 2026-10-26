/**
 * The scan check, run on a batch's rows.
 *
 * `scanCheckVerifier(registries)` is the `verifyRow` to pass for it: each
 * row's content in the design it was drawn with, given to verify's
 * `runVerifyJob` and driven one capture at a time inside the batch's own
 * slices, so a check never holds the page for longer than one capture does. The report comes back as the row's verdict and its
 * issues: a failing check as a warning in the check's own message key and
 * params (verify's catalogue has the sentence), a check with a warning as an
 * info issue, and a clean capture that did not read as a warning of its own,
 * because that fails the verdict with no check to point at.
 *
 * A full check takes eight seeded captures at every level of every axis,
 * which measured 5 to 16 seconds a code in Node on a laptop, depending on
 * what else it was doing. A batch cannot afford that on every row, so the
 * number of seeds follows the mode: 'all' checks every row with 2 seeds
 * (4 to 5 seconds a row), enough to catch a design that fails outright, and
 * 'sampled' checks a few rows with all 8, as the studio checks a single code,
 * because those few stand in for the rest (`SEEDS_ALL`, `SEEDS_SAMPLED` in
 * run.ts). `verifySeeds` on the output overrides both.
 *
 * It is not runBatch's default, because run.ts must not import verify: the
 * studio's batch command reaches run.ts from the offline file, which leaves
 * the scan check out until it is given one.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { runVerifyJob } from '../verify/job.js';
import { VERIFY_MESSAGE_KEYS } from '../verify/keys.js';
import { designRequirements } from '../verify/prepare.js';
import type { VerifyJob, VerifyRegistries, VerifyReport } from '../verify/types.js';
import type { BatchVerifier, BatchVerifyRequest, BatchVerifyResult } from './types.js';

/** The scan check's job for one row. */
export function scanCheckJob(request: BatchVerifyRequest): VerifyJob {
	const { assets } = request;
	return {
		content: request.content,
		design: request.design,
		// The size is the symbol with its quiet zone, worked out from the scene
		// as drawn, which is what verify measures modules against whatever the
		// design's own size measures.
		conditions: { sizeMm: request.sizeMm, dpi: request.dpi, distanceMm: null },
		seed: request.seed,
		requires: designRequirements(request.design),
		...(Object.keys(assets).length === 0 ? {} : { assets }),
		captureSeeds: request.captureSeeds,
		overlay: request.overlay,
	};
}

/** A report as a row's verdict and issues. */
export function reportResult(report: VerifyReport): BatchVerifyResult {
	const issues: Issue[] = [];
	if (!report.baseline.passed) {
		issues.push(issue(VERIFY_MESSAGE_KEYS.baselineFailed, ['check', 'baseline'], 'warning'));
	}
	for (const check of report.checks) {
		if (check.status === 'pass') continue;
		issues.push(
			issue(
				check.messageKey,
				['check', check.id],
				check.status === 'fail' ? 'warning' : 'info',
				check.params,
			),
		);
	}
	return { verdict: report.verdict, issues };
}

/** The scan check as a batch's `verifyRow`, over these registries. */
export function scanCheckVerifier(registries: VerifyRegistries): BatchVerifier {
	return function* check(request) {
		const report = yield* runVerifyJob(scanCheckJob(request), registries);
		return reportResult(report);
	};
}
