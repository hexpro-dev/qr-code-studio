/**
 * The scan check: its verdict, the checks with their sentences, the limits it
 * found, the fixes it suggests, and the strip of simulated captures under the
 * proof, laid out like the colour bar along the edge of a press sheet.
 *
 * The check runs in time slices on this thread, a full one when the person
 * asks and a quicker one by itself after each change, and the card says which
 * it is showing. A copy whose host left the check out has the studio report it
 * unavailable (a 'failed' state whose error names the feature), and every part
 * of this view says so in words rather than showing an empty box. Each tile in
 * the strip is the proof itself, put through a stylesheet filter that stands
 * for its condition; the verdict beside it is the check's, never the filter's.
 */

import type { CaptureAxis, StudioSnapshot, VerifyReport } from '../studio/index.js';
import { axisKey, checkKey } from '../studio/index.js';
import { button } from './controls.js';
import type { AppContext } from './context.js';
import { h, icon, replace, setText } from './dom.js';
import type { IconName } from './dom.js';
import { showSvg } from './images.js';
import type { Panel } from './design-panels.js';
import type { ProofView } from './proof.js';
import { errorText, fine, num, t, whole } from './text.js';

type Outcome = 'pass' | 'partial' | 'fail' | 'unknown' | 'running' | 'unavailable';

const OUTCOME_ICON: Readonly<Record<Outcome, IconName>> = {
	pass: 'pass',
	partial: 'warn',
	fail: 'fail',
	unknown: 'pending',
	running: 'pending',
	unavailable: 'pending',
};

const OUTCOME_KEY: Readonly<Record<Outcome, string>> = {
	pass: 'app.strip.pass',
	partial: 'app.strip.partial',
	fail: 'app.strip.fail',
	unknown: 'app.strip.unknown',
	running: 'app.strip.running',
	unavailable: 'app.strip.unknown',
};

interface Tile {
	readonly id: string;
	readonly labelKey: string;
	readonly axis: CaptureAxis | 'static';
}

/** The captures a phone meets most, in the order a press sheet's bar would run. */
const TILES: readonly Tile[] = [
	{ id: 'sharp', labelKey: 'app.strip.sharp', axis: 'static' },
	{ id: 'far', labelKey: 'app.strip.far', axis: 'distance' },
	{ id: 'soft', labelKey: 'app.strip.soft', axis: 'focus' },
	{ id: 'angle', labelKey: 'app.strip.angle', axis: 'angle' },
	{ id: 'dim', labelKey: 'app.strip.dim', axis: 'light' },
	{ id: 'glare', labelKey: 'app.strip.glare', axis: 'glare' },
	{ id: 'ink', labelKey: 'app.strip.ink', axis: 'ink' },
];

/** Every axis the check runs, for the full list in the panel. */
const AXIS_LABELS: Readonly<Record<CaptureAxis, string>> = {
	distance: 'app.axis.distance',
	focus: 'app.axis.focus',
	motion: 'app.axis.motion',
	noise: 'app.axis.noise',
	angle: 'app.axis.angle',
	light: 'app.axis.light',
	glare: 'app.axis.glare',
	ink: 'app.axis.ink',
	contrast: 'app.axis.contrast',
};

function captureOutcome(capture: VerifyReport['captures'][number] | undefined): Outcome {
	if (capture === undefined) return 'unknown';
	if (capture.firstFailed === null) return 'pass';
	if (capture.worstPassed === null) return 'fail';
	return 'partial';
}

function staticOutcome(report: VerifyReport): Outcome {
	if (report.checks.some((check) => check.status === 'fail')) return 'fail';
	if (report.checks.some((check) => check.status === 'warn')) return 'partial';
	return 'pass';
}

function unavailable(snapshot: StudioSnapshot): boolean {
	const verify = snapshot.verify;
	return verify.status === 'failed' && verify.error.params.feature === 'verify';
}

function outcomeFor(snapshot: StudioSnapshot, axis: CaptureAxis | 'static'): Outcome {
	const verify = snapshot.verify;
	if (unavailable(snapshot)) return 'unavailable';
	if (verify.status === 'running') return 'running';
	if (verify.status !== 'done') return 'unknown';
	const report = verify.report;
	return axis === 'static'
		? staticOutcome(report)
		: captureOutcome(report.captures.find((capture) => capture.axis === axis));
}

export function createStrip(
	_ctx: AppContext,
	proof: ProofView,
): { root: HTMLElement; update(snapshot: StudioSnapshot): void } {
	const tiles = TILES.map((tile) => {
		const img = h('img', { className: 'capture__img', attrs: { alt: '', decoding: 'async' } });
		const result = h('span', { className: 'capture__result' });
		const root = h('li', { className: `capture capture--${tile.id}` }, [
			h('span', { className: 'capture__view', attrs: { 'aria-hidden': 'true' } }, [img]),
			h('span', { className: 'capture__name', text: t(tile.labelKey) }),
			result,
		]);
		return { tile, img, result, root };
	});
	const caption = h('p', { className: 'strip__caption' });
	const root = h('div', { className: 'strip' }, [
		h('h3', { className: 'strip__title', text: t('app.strip.label') }),
		h(
			'ol',
			{ className: 'strip__row' },
			tiles.map((tile) => tile.root),
		),
		caption,
	]);
	proof.onDrawn((drawn) => {
		for (const tile of tiles) if (drawn !== null) showSvg(tile.img, drawn.svg);
	});
	return {
		root,
		update(snapshot) {
			const stale = snapshot.verify.status === 'done' && snapshot.verify.stale;
			root.dataset.stale = String(stale);
			for (const { tile, result, root: node } of tiles) {
				const outcome = outcomeFor(snapshot, tile.axis);
				node.dataset.result = outcome;
				replace(result, [
					icon(OUTCOME_ICON[outcome]),
					h('span', { text: t(OUTCOME_KEY[outcome]) }),
				]);
			}
			setText(
				caption,
				unavailable(snapshot)
					? t('app.check.unavailable')
					: stale
						? t('app.check.stale')
						: t('app.strip.caption'),
			);
		},
	};
}

export function createCheck(ctx: AppContext): Panel {
	const status = h('p', { className: 'check__status', attrs: { 'aria-live': 'off' } });
	const progress = h('span', { className: 'check__progress', attrs: { 'aria-hidden': 'true' } }, [
		h('span', { className: 'check__progress-fill' }),
	]);
	const run = button(t('app.check.run'), {
		icon: 'pass',
		onClick: () => ctx.dispatch({ type: 'verify/request' }),
	});
	const stop = button(t('app.check.cancel'), {
		icon: 'stop',
		small: true,
		onClick: () => ctx.dispatch({ type: 'verify/cancel' }),
	});
	const detail = h('div', { className: 'check__detail' });
	const root = h('div', { className: 'panel check' }, [
		h('div', { className: 'check__head' }, [status, run, stop]),
		progress,
		detail,
	]);
	let shownVerify: unknown = null;

	function verdictText(report: VerifyReport): string {
		return report.verdict === 'pass'
			? t('app.check.verdict-pass')
			: report.verdict === 'warn'
				? t('app.check.verdict-warn')
				: t('app.check.verdict-fail');
	}

	function drawReport(
		report: VerifyReport,
		fixes: readonly { id: string; labelKey: string }[],
	): void {
		const checks = h(
			'ul',
			{ className: 'checks' },
			report.checks.map((check) => {
				const word =
					check.status === 'pass'
						? t('app.check.status-pass')
						: check.status === 'warn'
							? t('app.check.status-warn')
							: t('app.check.status-fail');
				const row = h('li', { className: 'checks__row' }, [
					icon(check.status === 'pass' ? 'pass' : check.status === 'warn' ? 'warn' : 'fail'),
					h('span', { className: 'checks__name', text: t(checkKey(check.id)) }),
					h('span', { className: 'checks__word', text: word }),
					h('span', {
						className: 'checks__sentence',
						text: t(check.messageKey, {
							measured: fine(check.measured),
							threshold: fine(check.threshold),
						}),
					}),
					h('span', {
						className: 'checks__numbers',
						text: t('app.check.measured', {
							measured: fine(check.measured),
							threshold: fine(check.threshold),
						}),
					}),
				]);
				row.dataset.result = check.status;
				return row;
			}),
		);
		const captures = h(
			'ul',
			{ className: 'checks checks--captures' },
			report.captures.map((capture) => {
				const outcome = captureOutcome(capture);
				const row = h('li', { className: 'checks__row' }, [
					icon(OUTCOME_ICON[outcome]),
					h('span', { className: 'checks__name', text: t(AXIS_LABELS[capture.axis]) }),
					h('span', { className: 'checks__word', text: t(OUTCOME_KEY[outcome]) }),
				]);
				row.dataset.result = outcome === 'partial' ? 'warn' : outcome;
				return row;
			}),
		);
		const limits: HTMLElement[] = [];
		const size = report.conditions.sizeMm;
		if (report.limits.maxDistanceMm !== null && size !== null) {
			limits.push(
				h('p', {
					className: 'check__limit',
					text: t('app.check.limits', {
						distance: whole(report.limits.maxDistanceMm / 10),
						size: num(size),
					}),
				}),
			);
		}
		if (report.limits.minModuleMm !== null) {
			limits.push(
				h('p', {
					className: 'check__limit',
					text: t('app.check.limits-module', { size: fine(report.limits.minModuleMm) }),
				}),
			);
		}
		const fixList =
			fixes.length === 0
				? null
				: h('div', { className: 'fixes' }, [
						h('h3', { className: 'notes__title', text: t('app.check.fixes') }),
						h(
							'div',
							{ className: 'fixes__list' },
							fixes.map((fix) =>
								button(t(fix.labelKey), {
									small: true,
									onClick: () => {
										ctx.dispatch({ type: 'fix/apply', fixId: fix.id });
										ctx.announce(t('app.check.fixed'));
									},
								}),
							),
						),
					]);
		replace(detail, [
			...limits,
			checks,
			h('details', { className: 'advanced' }, [
				h('summary', { className: 'advanced__head', text: t('app.check.captures') }),
				h('div', { className: 'advanced__body' }, [captures]),
			]),
			fixList,
		]);
	}

	return {
		root,
		update(snapshot) {
			const verify = snapshot.verify;
			stop.hidden = verify.status !== 'running';
			run.hidden = verify.status === 'running' || unavailable(snapshot);
			root.dataset.status = unavailable(snapshot) ? 'unavailable' : verify.status;
			if (verify.status === 'running') {
				progress.style.setProperty('--fill', String(verify.progress));
				setText(
					status,
					`${t('app.check.running', { percent: Math.round(verify.progress * 100) })} ${verify.axis === null ? '' : t(axisKey(verify.axis))}`.trim(),
				);
			}
			if (shownVerify === verify) return;
			shownVerify = verify;
			if (unavailable(snapshot)) {
				setText(status, t('app.check.unavailable'));
				replace(detail, [
					h('p', { className: 'field__hint', text: t('app.check.unavailable-detail') }),
				]);
				return;
			}
			switch (verify.status) {
				case 'idle':
					setText(status, t('app.check.idle'));
					replace(detail, [h('p', { className: 'field__hint', text: t('app.check.idle-detail') })]);
					return;
				case 'running':
					return;
				case 'failed':
					setText(status, errorText(verify.error));
					replace(detail, []);
					return;
				case 'done':
					setText(
						status,
						verify.stale
							? `${verdictText(verify.report)}. ${t('app.check.stale')}`
							: verify.full
								? verdictText(verify.report)
								: `${verdictText(verify.report)}. ${t('app.check.quick')}`,
					);
					root.dataset.depth = verify.full ? 'full' : 'quick';
					root.dataset.verdict = verify.report.verdict;
					drawReport(verify.report, verify.fixes);
					return;
			}
		},
		meta(snapshot) {
			if (unavailable(snapshot)) return t('app.check.meta-unavailable');
			const verify = snapshot.verify;
			if (verify.status === 'done') {
				return verify.report.verdict === 'pass'
					? t('app.check.verdict-pass')
					: verify.report.verdict === 'warn'
						? t('app.check.verdict-warn')
						: t('app.check.verdict-fail');
			}
			return verify.status === 'running' ? t('app.strip.running') : t('app.check.idle');
		},
	};
}
