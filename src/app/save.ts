/**
 * Saving the code: the format and its settings, the download, the copies and
 * printing.
 *
 * Every file is the studio's `export` command, which draws from the same
 * scene the proof shows, so what is saved is what was seen. The settings here
 * are the command's arguments, not part of the document: a design says how
 * large it prints, and this says what to hand over this time.
 *
 * Printing goes through the browser's own print dialog with a print
 * stylesheet that shows the code alone at its physical width. The document's
 * policy refuses frames, so the print helper that builds one is not used here.
 */

import type { QrStudioError } from '../core/errors.js';
import { copyImageToClipboard, copyText, downloadBytes } from '../dom/output.js';
import { studioError } from '../studio/index.js';
import type { ExportFormat, ExportOptions, StudioSnapshot } from '../studio/index.js';
import { button, choiceGroup, field, setButtonLabel, slider } from './controls.js';
import type { AppContext } from './context.js';
import type { Panel } from './design-panels.js';
import { h, replace, setText } from './dom.js';
import { showSvg } from './images.js';
import type { ProofView } from './proof.js';
import { errorText, issueText, num, percent, t } from './text.js';

const FORMATS: readonly ExportFormat[] = ['svg', 'png', 'pdf', 'eps', 'jpeg', 'webp'];

const FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
	svg: 'app.export.format-svg',
	png: 'app.export.format-png',
	pdf: 'app.export.format-pdf',
	eps: 'app.export.format-eps',
	jpeg: 'app.export.format-jpeg',
	webp: 'app.export.format-webp',
};

const FORMAT_HINTS: Readonly<Record<ExportFormat, string>> = {
	svg: 'app.export.hint-svg',
	png: 'app.export.hint-png',
	pdf: 'app.export.hint-pdf',
	eps: 'app.export.hint-eps',
	jpeg: 'app.export.hint-jpeg',
	webp: 'app.export.hint-webp',
};

interface Settings {
	format: ExportFormat;
	sizing: 'pixels' | 'print';
	widthPx: number | null;
	sizeMm: number | null;
	dpi: number | null;
	colourSpace: 'srgb' | 'cmyk' | null;
	bleedMm: number;
	cropMarks: boolean;
	quality: number;
}

export interface Saver {
	readonly panel: Panel;
	/** The buttons under the proof. */
	readonly actions: HTMLElement;
	/** The bar along the bottom of a phone's screen. */
	readonly dock: HTMLElement;
	download(): Promise<void>;
	print(): void;
}

export function createSaver(
	ctx: AppContext,
	proofRef: () => ProofView | null,
	printImg: HTMLImageElement,
): Saver {
	const settings: Settings = {
		format: 'png',
		sizing: 'pixels',
		widthPx: null,
		sizeMm: null,
		dpi: null,
		colourSpace: null,
		bleedMm: 0,
		cropMarks: false,
		quality: 0.92,
	};

	function options(): ExportOptions {
		const out: { -readonly [K in keyof ExportOptions]: ExportOptions[K] } = {};
		const raster =
			settings.format === 'png' || settings.format === 'jpeg' || settings.format === 'webp';
		if (raster) {
			if (settings.sizing === 'pixels' && settings.widthPx !== null) out.widthPx = settings.widthPx;
			if (settings.sizing === 'print') {
				if (settings.sizeMm !== null) out.sizeMm = settings.sizeMm;
				if (settings.dpi !== null) out.dpi = settings.dpi;
			}
			if (settings.format !== 'png') out.quality = settings.quality;
		}
		if (settings.format === 'pdf' || settings.format === 'eps') {
			if (settings.sizeMm !== null) out.sizeMm = settings.sizeMm;
			if (settings.colourSpace !== null) out.colourSpace = settings.colourSpace;
		}
		if (settings.format === 'pdf') {
			if (settings.bleedMm > 0) out.bleedMm = settings.bleedMm;
			if (settings.cropMarks) out.cropMarks = true;
		}
		return out;
	}

	function fail(error: QrStudioError): void {
		ctx.announce(errorText(studioError(error)));
	}

	async function download(): Promise<void> {
		const result = await ctx.studio.run({
			type: 'export',
			format: settings.format,
			options: options(),
		});
		if (!result.ok) {
			fail(result.error);
			return;
		}
		const saved = downloadBytes(result.value.bytes, result.value.filename, result.value.mime);
		if (!saved.ok) {
			fail(saved.error);
			return;
		}
		const notes = result.value.issues.map(issueText);
		ctx.announce([t('app.export.saved', { filename: result.value.filename }), ...notes].join(' '));
	}

	async function copyImage(): Promise<void> {
		const result = await ctx.studio.run({
			type: 'export',
			format: 'png',
			options: { widthPx: 1024 },
		});
		if (!result.ok) {
			fail(result.error);
			return;
		}
		const copied = await copyImageToClipboard(result.value.bytes);
		if (copied.ok) ctx.announce(t('app.export.copied-image'));
		else fail(copied.error);
	}

	async function copySvg(): Promise<void> {
		const result = await ctx.studio.run({ type: 'export', format: 'svg', options: {} });
		if (!result.ok) {
			fail(result.error);
			return;
		}
		const copied = await copyText(new TextDecoder().decode(result.value.bytes));
		if (copied.ok) ctx.announce(t('app.export.copied-svg'));
		else fail(copied.error);
	}

	/** Put the code on the print sheet at its printed width. */
	function preparePrint(): void {
		const drawn = proofRef()?.current() ?? null;
		if (drawn === null || drawn.sample) return;
		showSvg(printImg, drawn.svg);
		printImg.style.setProperty('width', `${drawn.widthMm}mm`);
		printImg.alt = t('app.export.print-alt', { size: num(drawn.widthMm) });
	}

	function print(): void {
		preparePrint();
		window.print();
	}
	window.addEventListener('beforeprint', preparePrint);

	// The buttons under the proof.
	const downloadButton = button(t('app.export.download-format', { format: t(FORMAT_LABELS.png) }), {
		icon: 'download',
		primary: true,
		onClick: () => void download(),
	});
	const copyImageButton = button(t('app.export.copy-image'), {
		icon: 'copy',
		onClick: () => void copyImage(),
	});
	const copySvgButton = button(t('app.export.copy-svg'), {
		icon: 'copy',
		onClick: () => void copySvg(),
	});
	const printButton = button(t('app.export.print'), { icon: 'print', onClick: print });
	const actions = h('div', { className: 'proof__actions' }, [
		downloadButton,
		copyImageButton,
		copySvgButton,
		printButton,
	]);

	const dockButton = button(t('app.export.download-format', { format: t(FORMAT_LABELS.png) }), {
		icon: 'download',
		primary: true,
		onClick: () => void download(),
	});
	const dockNote = h('span', { className: 'dock__note' });
	const dock = h(
		'div',
		{ className: 'dock', attrs: { role: 'region', 'aria-label': t('app.dock.label') } },
		[dockNote, dockButton],
	);

	// The panel.
	const epsNote = h('p', { className: 'note note--info' });
	epsNote.hidden = true;
	const hint = h('p', { className: 'field__hint' });
	const formatGroup = choiceGroup(
		t('app.export.format'),
		FORMATS.map((format) => ({ value: format, label: t(FORMAT_LABELS[format]) })),
		(value) => {
			settings.format = value as ExportFormat;
			drawOptions();
			refresh();
		},
		'segments',
	);
	formatGroup.set(settings.format);
	const optionsHost = h('div', { className: 'export__options' });
	const panelDownload = button(t('app.export.download'), {
		icon: 'download',
		primary: true,
		onClick: () => void download(),
	});
	const root = h('div', { className: 'panel export' }, [
		formatGroup.root,
		epsNote,
		hint,
		optionsHost,
		panelDownload,
	]);

	function numberField(
		label: string,
		read: () => number | null,
		write: (value: number | null) => void,
		attrs: Readonly<Record<string, string | number>>,
		hintText?: string,
	): HTMLElement {
		const input = h('input', {
			className: 'input input--number',
			attrs: { type: 'number', inputmode: 'decimal', ...attrs },
		});
		const value = read();
		input.value = value === null ? '' : String(value);
		input.addEventListener('change', () => {
			const text = input.value.trim();
			const parsed = text === '' ? null : Number(text);
			write(parsed !== null && Number.isFinite(parsed) ? parsed : null);
		});
		input.setAttribute('placeholder', t('app.export.automatic'));
		return field(label, input, hintText).root;
	}

	function drawOptions(): void {
		const format = settings.format;
		const children: HTMLElement[] = [];
		const raster = format === 'png' || format === 'jpeg' || format === 'webp';
		if (raster) {
			const sizing = choiceGroup(
				t('app.export.size'),
				[
					{ value: 'pixels', label: t('app.export.size-pixels') },
					{ value: 'print', label: t('app.export.size-print') },
				],
				(value) => {
					settings.sizing = value as Settings['sizing'];
					drawOptions();
				},
			);
			sizing.set(settings.sizing);
			children.push(sizing.root);
			if (settings.sizing === 'pixels') {
				children.push(
					numberField(
						t('app.export.width-px'),
						() => settings.widthPx,
						(value) => {
							settings.widthPx = value === null ? null : Math.round(value);
						},
						{ min: 16, max: 16384, step: 1 },
						t('app.export.width-px-hint'),
					),
				);
			} else {
				children.push(
					numberField(
						t('app.export.width-mm'),
						() => settings.sizeMm,
						(value) => {
							settings.sizeMm = value;
						},
						{ min: 5, max: 2000, step: 0.5 },
					),
					numberField(
						t('app.export.dpi'),
						() => settings.dpi,
						(value) => {
							settings.dpi = value;
						},
						{ min: 72, max: 2400, step: 1 },
					),
				);
			}
			if (format !== 'png') {
				const quality = slider(
					t('app.export.quality'),
					{ min: 0.5, max: 1, step: 0.01 },
					(value) => percent(value),
					(value) => {
						settings.quality = value;
					},
				);
				quality.set(settings.quality);
				children.push(quality.root);
			}
		} else if (format === 'pdf' || format === 'eps') {
			children.push(
				numberField(
					t('app.export.width-mm'),
					() => settings.sizeMm,
					(value) => {
						settings.sizeMm = value;
					},
					{ min: 5, max: 2000, step: 0.5 },
					t('app.export.width-mm-hint'),
				),
			);
			const colour = choiceGroup(
				t('app.export.colour-space'),
				[
					{ value: 'srgb', label: t('app.export.colour-srgb') },
					{ value: 'cmyk', label: t('app.export.colour-cmyk') },
				],
				(value) => {
					settings.colourSpace = value as 'srgb' | 'cmyk';
				},
			);
			colour.set(settings.colourSpace ?? ctx.snapshot().design.effective.output.colourSpace);
			children.push(colour.root);
			if (format === 'pdf') {
				children.push(
					numberField(
						t('app.export.bleed'),
						() => (settings.bleedMm === 0 ? null : settings.bleedMm),
						(value) => {
							settings.bleedMm = value ?? 0;
						},
						{ min: 0, max: 50, step: 0.5 },
					),
				);
				const marks = h('input', {
					attrs: { type: 'checkbox' },
					on: {
						change: () => {
							settings.cropMarks = marks.checked;
						},
					},
				});
				marks.checked = settings.cropMarks;
				children.push(
					h('label', { className: 'tick' }, [
						marks,
						h('span', { text: t('app.export.crop-marks') }),
					]),
				);
			}
		}
		replace(optionsHost, children);
		optionsHost.hidden = children.length === 0;
	}
	drawOptions();

	let lastSnapshot: StudioSnapshot | null = null;

	function refresh(): void {
		const label = t('app.export.download-format', { format: t(FORMAT_LABELS[settings.format]) });
		setButtonLabel(downloadButton, label);
		setButtonLabel(dockButton, label);
		setText(hint, t(FORMAT_HINTS[settings.format]));
		if (lastSnapshot !== null) update(lastSnapshot);
	}
	refresh();

	function update(snapshot: StudioSnapshot): void {
		lastSnapshot = snapshot;
		const ready = snapshot.symbol.status === 'ok';
		for (const node of [
			downloadButton,
			copyImageButton,
			copySvgButton,
			printButton,
			dockButton,
			panelDownload,
		]) {
			node.disabled = !ready;
		}
		const epsIssues = snapshot.preview?.epsIssues ?? [];
		const eps = formatGroup.inputs().find((input) => input.value === 'eps');
		if (eps !== undefined) eps.disabled = epsIssues.length > 0;
		epsNote.hidden = epsIssues.length === 0;
		if (epsIssues.length > 0) {
			setText(epsNote, epsIssues.map(issueText).join(' '));
			if (settings.format === 'eps') {
				settings.format = 'pdf';
				formatGroup.set('pdf');
				drawOptions();
				refresh();
			}
		}
		setText(
			dockNote,
			ready
				? t(snapshot.form.labelKey)
				: snapshot.symbol.status === 'stale'
					? t('app.proof.not-updated')
					: t('app.proof.sample'),
		);
	}

	return {
		panel: {
			root,
			update,
			meta: () => t(FORMAT_LABELS[settings.format]),
		},
		actions,
		dock,
		download,
		print,
	};
}
