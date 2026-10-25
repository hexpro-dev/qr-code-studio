/**
 * The proof: the code as a printer hands it over, on a paper-white sheet with
 * crop marks, a millimetre ruler along two edges and the quiet zone marked.
 *
 * It is the only bright object on the page, in either theme. It never goes
 * blank: before anything has been typed it shows a sample drawn with the
 * person's design and says so, and while the content cannot be made it keeps
 * the last code that worked with a "not updated" mark (the studio's 'stale'
 * symbol). Its alternative text is built from the content type, what a phone
 * does with it and the scan check's verdict, and never from a secret field.
 */

import type { StudioSnapshot, SymbolView } from '../studio/index.js';
import type { Scene } from '../render/types.js';
import { button, choiceGroup } from './controls.js';
import type { AppContext, View } from './context.js';
import { h, replace, s, setText } from './dom.js';
import { clearImage, showSvg } from './images.js';
import { CSS_PX_PER_MM, drawSample, printedWidthMm } from './measure.js';
import { num, t } from './text.js';

/** The width of a bank card, ISO/IEC 7810 ID-1: what the calibration is matched against. */
const CARD_MM = 85.6;
const CARD_RATIO = 53.98 / 85.6;

/**
 * CSS pixels to the millimetre on this screen, once the person has matched
 * a card. In memory only: there is nowhere in this file to keep it, by design.
 */
let screenPxPerMm = CSS_PX_PER_MM;

export interface Drawn {
	readonly svg: string;
	readonly scene: Scene;
	readonly widthMm: number;
	readonly sample: boolean;
}

export interface ProofView extends View {
	readonly root: HTMLElement;
	/** The surround, true size and calibration controls, which a phone shows in a card instead. */
	readonly toolbar: HTMLElement;
	/** What the sheet is showing now, for printing and the strip. */
	current(): Drawn | null;
	/** Called whenever the drawing changes, with the new one. */
	onDrawn(listener: (drawn: Drawn | null) => void): void;
}

function verdictWord(snapshot: StudioSnapshot): string | null {
	const verify = snapshot.verify;
	if (verify.status !== 'done' || verify.stale) return null;
	return verify.report.verdict === 'pass'
		? t('app.check.verdict-pass')
		: verify.report.verdict === 'warn'
			? t('app.check.verdict-warn')
			: t('app.check.verdict-fail');
}

/** A few words of the content for the alternative text, from a field that is not secret. */
function contentSummary(snapshot: StudioSnapshot): string | null {
	for (const field of snapshot.form.fields) {
		if (field.secret || field.advanced) continue;
		const value = Array.isArray(field.value)
			? field.value.find((item) => item !== '')
			: field.value;
		if (typeof value !== 'string' || value.trim() === '') continue;
		const text = value.trim().replace(/\s+/g, ' ');
		return text.length > 60 ? `${text.slice(0, 57)}...` : text;
	}
	return null;
}

function altText(snapshot: StudioSnapshot, view: SymbolView, stale: boolean): string {
	const parts = [`${t(view.symbologyLabelKey)}. ${t(snapshot.form.labelKey)}.`];
	if (stale) parts.push(t('app.proof.alt-stale'));
	else {
		const summary = contentSummary(snapshot);
		if (summary !== null) parts.push(t('app.proof.alt-summary', { summary }));
	}
	parts.push(t(snapshot.form.actionKey));
	const verdict = verdictWord(snapshot);
	if (verdict !== null) parts.push(t('app.proof.alt-check', { verdict }));
	return parts.join(' ');
}

/** Tick marks every millimetre, numbered every ten, thinned out when the proof is small. */
function drawRuler(svg: SVGSVGElement, lengthPx: number, mm: number, across: boolean): void {
	const thickness = 18;
	svg.setAttribute(
		'viewBox',
		across ? `0 0 ${lengthPx} ${thickness}` : `0 0 ${thickness} ${lengthPx}`,
	);
	svg.setAttribute('width', String(across ? lengthPx : thickness));
	svg.setAttribute('height', String(across ? thickness : lengthPx));
	const children: SVGElement[] = [];
	if (lengthPx > 0 && mm > 0) {
		const perMm = lengthPx / mm;
		// The finest step whose ticks sit at least 5 px apart.
		const step =
			[1, 2, 5, 10, 20, 50, 100, 200, 500].find((candidate) => candidate * perMm >= 5) ?? 1000;
		const labelEvery = step * (step === 2 ? 5 : step === 1 ? 10 : 10);
		let path = '';
		for (let at = 0; at <= mm + 1e-9; at += step) {
			const p = Math.round(at * perMm) + 0.5;
			const major = Math.abs(at % labelEvery) < 1e-9;
			const mid = !major && Math.abs(at % (labelEvery / 2)) < 1e-9;
			const length = major ? 9 : mid ? 6 : 3.5;
			path += across ? `M${p} ${thickness}v-${length}` : `M${thickness} ${p}h-${length}`;
			if (major && at > 0 && at < mm - step * 0.5) {
				const text = s('text', across ? { x: p + 2, y: 8 } : { x: 7, y: p - 2 }, [
					String(Math.round(at)),
				]);
				if (!across) text.setAttribute('transform', `rotate(-90 7 ${p - 2})`);
				children.push(text);
			}
		}
		children.unshift(s('path', { d: path }));
	}
	replace(svg, children);
}

export function createProof(ctx: AppContext, actions: HTMLElement, strip: HTMLElement): ProofView {
	const listeners: ((drawn: Drawn | null) => void)[] = [];
	let drawn: Drawn | null = null;
	let shownState: 'none' | 'sample' | 'ok' | 'stale' = 'none';
	let trueSize = false;

	const img = h('img', { className: 'proof__img', attrs: { alt: '', decoding: 'sync' } });
	const quiet = s('svg', {
		class: 'proof__quiet',
		'aria-hidden': 'true',
		preserveAspectRatio: 'none',
	});
	const badge = h('span', { className: 'proof__badge' });
	const stage = h('div', { className: 'proof__stage' }, [img, quiet, badge]);
	const rulerTop = s('svg', { class: 'ruler ruler--top', 'aria-hidden': 'true' });
	const rulerLeft = s('svg', { class: 'ruler ruler--left', 'aria-hidden': 'true' });
	const crops = ['tl', 'tr', 'bl', 'br'].map((corner) =>
		h('span', { className: `crop crop--${corner}`, attrs: { 'aria-hidden': 'true' } }),
	);
	const frame = h('div', { className: 'proof__frame' }, [
		h('span', { className: 'proof__corner', attrs: { 'aria-hidden': 'true' }, text: 'mm' }),
		rulerTop,
		rulerLeft,
		stage,
		...crops,
	]);
	const registration = s(
		'svg',
		{ class: 'proof__registration', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
		[s('circle', { cx: 12, cy: 12, r: 6.5 }), s('path', { d: 'M12 1v22M1 12h22' })],
	);
	const slug = h('p', { className: 'proof__slug' });
	const sheet = h('div', { className: 'proof__sheet' }, [registration, frame, slug]);
	sheet.dataset.surround = 'light';
	const note = h('p', { className: 'proof__note', attrs: { role: 'note' } });
	note.hidden = true;

	const surround = choiceGroup(
		t('app.proof.surround'),
		[
			{ value: 'light', label: t('app.proof.surround-light') },
			{ value: 'dark', label: t('app.proof.surround-dark') },
		],
		(value) => {
			sheet.dataset.surround = value;
		},
		'segments',
		{ legendHidden: true },
	);
	surround.set('light');

	const trueButton = button(t('app.proof.true-size'), {
		icon: 'ruler',
		small: true,
		attrs: { 'aria-pressed': 'false' },
		onClick: () => {
			trueSize = !trueSize;
			trueButton.setAttribute('aria-pressed', String(trueSize));
			applySize();
		},
	});

	// The calibration: a card outline the person drags to the width of a real
	// card held against the glass.
	const cardBox = h('div', { className: 'calibrate__card', attrs: { 'aria-hidden': 'true' } });
	const scaleInput = h('input', {
		className: 'slider__input',
		id: 'calibrate-scale',
		attrs: { type: 'range', min: 2, max: 8, step: 0.01 },
		on: {
			input: () => {
				screenPxPerMm = Number(scaleInput.value);
				drawCard();
				applySize();
			},
		},
	});
	const drawCard = (): void => {
		cardBox.style.setProperty('width', `${CARD_MM * screenPxPerMm}px`);
		cardBox.style.setProperty('height', `${CARD_MM * CARD_RATIO * screenPxPerMm}px`);
	};
	const dialog = h(
		'dialog',
		{ className: 'calibrate', attrs: { 'aria-labelledby': 'calibrate-title' } },
		[
			h('h2', {
				id: 'calibrate-title',
				className: 'calibrate__title',
				text: t('app.proof.calibrate-title'),
			}),
			h('p', { className: 'calibrate__help', text: t('app.proof.calibrate-help') }),
			h('div', { className: 'calibrate__bench' }, [cardBox]),
			h('div', { className: 'slider' }, [
				h('label', {
					className: 'slider__label',
					text: t('app.proof.calibrate-scale'),
					attrs: { for: 'calibrate-scale' },
				}),
				scaleInput,
			]),
			h('div', { className: 'calibrate__actions' }, [
				button(t('app.proof.calibrate-reset'), {
					small: true,
					onClick: () => {
						screenPxPerMm = CSS_PX_PER_MM;
						scaleInput.value = String(screenPxPerMm);
						drawCard();
						applySize();
					},
				}),
				button(t('app.proof.calibrate-done'), {
					primary: true,
					small: true,
					onClick: () => dialog.close(),
				}),
			]),
		],
	);
	const calibrateButton = button(t('app.proof.calibrate'), {
		small: true,
		onClick: () => {
			scaleInput.value = String(screenPxPerMm);
			drawCard();
			dialog.showModal();
		},
	});

	const toolbar = h('div', { className: 'proof__bar' }, [
		surround.root,
		trueButton,
		calibrateButton,
	]);
	const heading = h('h2', { className: 'sr-only', id: 'proof-title', text: t('app.proof.label') });
	const toolbarHost = h('div', { className: 'proof__bar-host' }, [toolbar]);
	const root = h('section', { className: 'proof', attrs: { 'aria-labelledby': 'proof-title' } }, [
		heading,
		toolbarHost,
		h('div', { className: 'proof__desk' }, [sheet]),
		note,
		strip,
		actions,
		dialog,
	]);

	function applySize(): void {
		if (drawn === null) return;
		const ratio = drawn.scene.height / drawn.scene.width;
		stage.style.setProperty('--ratio', String(ratio));
		if (trueSize) {
			stage.style.setProperty('--true-width', `${drawn.widthMm * screenPxPerMm}px`);
			sheet.dataset.size = 'true';
		} else {
			sheet.dataset.size = 'fit';
		}
		drawRulers();
	}

	function drawRulers(): void {
		if (drawn === null) return;
		const width = stage.clientWidth;
		const height = stage.clientHeight;
		const mmTall = (drawn.widthMm * drawn.scene.height) / drawn.scene.width;
		drawRuler(rulerTop, width, drawn.widthMm, true);
		drawRuler(rulerLeft, height, mmTall, false);
	}

	if (typeof ResizeObserver === 'function') new ResizeObserver(() => drawRulers()).observe(stage);

	function drawQuiet(scene: Scene, view: SymbolView | null, framed: boolean): void {
		// Only where the scene is the symbol and its quiet zone and nothing else:
		// a frame moves the symbol by an amount the scene does not record.
		if (view === null || framed) {
			replace(quiet, []);
			return;
		}
		const zone = view.quietZone;
		quiet.setAttribute('viewBox', `0 0 ${scene.width} ${scene.height}`);
		replace(quiet, [
			s('rect', {
				x: zone,
				y: zone,
				width: scene.width - 2 * zone,
				height: scene.height - 2 * zone,
				'vector-effect': 'non-scaling-stroke',
			}),
		]);
	}

	function slugLine(view: SymbolView | null, widthMm: number, sample: boolean): void {
		const parts: string[] = [];
		if (view !== null) {
			parts.push(t('app.proof.slug-version', { version: view.version }));
			parts.push(t('app.proof.slug-level', { level: view.ecLevel }));
			parts.push(t('app.proof.slug-modules', { width: view.modules[0], height: view.modules[1] }));
			parts.push(t('app.proof.slug-mask', { mask: view.mask }));
		}
		parts.push(t('app.proof.slug-width', { size: num(widthMm) }));
		replace(slug, [
			h('span', {
				className: 'proof__slug-label',
				text: sample ? t('app.proof.sample') : t('app.proof.label'),
			}),
			...parts.map((part) => h('span', { text: part })),
		]);
	}

	function setDrawn(next: Drawn | null): void {
		drawn = next;
		for (const listener of listeners) listener(next);
	}

	let lastSampleDesign: unknown = null;
	let lastSample: ReturnType<typeof drawSample> = null;

	function update(snapshot: StudioSnapshot): void {
		const symbol = snapshot.symbol;
		const design = snapshot.design.effective;
		let next: Drawn | null = null;
		let view: SymbolView | null = null;
		let state: typeof shownState;
		if (symbol.status === 'empty') {
			state = 'sample';
			if (lastSampleDesign !== design) {
				lastSampleDesign = design;
				lastSample = drawSample(ctx.registries, design);
			}
			if (lastSample !== null) {
				next = {
					svg: lastSample.svg,
					scene: lastSample.scene,
					widthMm: printedWidthMm(lastSample.scene, null, snapshot),
					sample: true,
				};
			}
		} else {
			state = symbol.status;
			view = symbol.view;
			const preview = snapshot.preview;
			if (preview !== null) {
				next = {
					svg: preview.svg,
					scene: preview.scene,
					widthMm: printedWidthMm(preview.scene, view, snapshot),
					sample: false,
				};
			}
		}

		if (next === null) clearImage(img);
		else showSvg(img, next.svg);

		// The one moment of motion: the code printing onto the sheet the first
		// time the content makes one. Off under reduced motion, in the stylesheet.
		if (state === 'ok' && (shownState === 'sample' || shownState === 'none')) {
			stage.classList.remove('proof__stage--printing');
			// Read layout so the animation starts again from its first frame.
			void stage.offsetWidth;
			stage.classList.add('proof__stage--printing');
		}
		shownState = state;
		stage.dataset.state = state;
		stage.dataset.ground = design.background === null ? 'transparent' : 'solid';

		setText(
			badge,
			state === 'stale'
				? t('app.proof.not-updated')
				: state === 'sample'
					? t('app.proof.sample')
					: '',
		);
		badge.hidden = state === 'ok';

		if (state === 'sample') {
			img.alt = t('app.proof.alt-sample');
			setText(note, t('app.proof.sample-note'));
			note.hidden = false;
		} else if (view !== null) {
			img.alt = altText(snapshot, view, state === 'stale');
			if (symbol.status === 'stale') {
				setText(
					note,
					`${t('app.proof.not-updated')}. ${t(symbol.issue.code, symbol.issue.params ?? {})}`,
				);
				note.hidden = false;
			} else note.hidden = true;
		}

		if (next !== null) {
			drawQuiet(next.scene, view, design.frame !== null);
			slugLine(view, next.widthMm, next.sample);
		}
		const changed =
			drawn?.svg !== next?.svg ||
			drawn?.widthMm !== next?.widthMm ||
			drawn?.sample !== next?.sample;
		if (changed) setDrawn(next);
		applySize();
	}

	stage.addEventListener('animationend', () => stage.classList.remove('proof__stage--printing'));

	return {
		root,
		toolbar,
		update,
		current: () => drawn,
		onDrawn(listener) {
			listeners.push(listener);
		},
	};
}
