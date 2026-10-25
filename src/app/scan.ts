/**
 * Scan: read a code from the camera, a picture, or a paste.
 *
 * The camera opens only when the person asks, and every track is stopped when
 * they stop it, leave the mode, or hide the tab (the dom layer's camera does
 * that). A browser can refuse the camera to a file opened from disk; when it
 * does, the drop target is the way in and the page says so plainly.
 *
 * What a code says comes from the studio's inspector. Until the inspect layer
 * is part of the build the studio reports it unavailable, and this view reads
 * the code with the decoder directly and shows its exact text, with the
 * inspector's card saying what is still to come. "Remake as a static code"
 * works either way: it is the studio's `payload/raw` action.
 */

import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { decodeImage } from '../decode/decoder.js';
import type { DecodedSymbol } from '../decode/types.js';
import { imageFromBlob, imageFromClipboard } from '../dom/image.js';
import { isCameraAvailable, startCameraScan } from '../dom/camera.js';
import type { CameraScanHandle } from '../dom/camera.js';
import { copyText } from '../dom/output.js';
import { safetyMessageKey } from '../payload/safety.js';
import { studioError } from '../studio/index.js';
import type { InspectReport, StudioError, StudioSnapshot } from '../studio/index.js';
import { button, setButtonLabel } from './controls.js';
import type { AppContext, View } from './context.js';
import { h, icon, replace, s, setText } from './dom.js';
import { errorText, t } from './text.js';

/** One code found, as this view shows it: from the inspector, or from the decoder alone. */
interface Found {
	readonly text: string;
	readonly symbology: string;
	readonly version: string;
	readonly ecLevel: string;
	readonly part: { readonly index: number; readonly total: number } | null;
}

export interface ScanView extends View {
	readonly root: HTMLElement;
	/** Read a picture the person dropped or pasted anywhere on the page. */
	readBlob(blob: Blob): Promise<void>;
	/** Stop the camera: the mode changed, or the page is going away. */
	stopCamera(): void;
}

function symbologyLabel(ctx: AppContext, id: string): string {
	const entry = ctx.snapshot().catalogue.symbologies.find((found) => found.id === id);
	return entry === undefined ? id : t(entry.labelKey);
}

export function createScan(ctx: AppContext): ScanView {
	// The viewfinder.
	const video = h('video', {
		className: 'viewfinder__video',
		attrs: { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' },
	});
	video.muted = true;
	const outline = s('svg', {
		class: 'viewfinder__outline',
		'aria-hidden': 'true',
		preserveAspectRatio: 'xMidYMid meet',
	});
	const cameraStatus = h('p', { className: 'viewfinder__status' });
	const viewfinder = h('div', { className: 'viewfinder' }, [
		video,
		outline,
		h('span', { className: 'viewfinder__frame', attrs: { 'aria-hidden': 'true' } }),
	]);
	viewfinder.dataset.live = 'false';
	let camera: CameraScanHandle | null = null;
	const cameraButton = button(t('app.scan.camera-start'), {
		icon: 'camera',
		primary: true,
		onClick: () => {
			if (camera !== null && !camera.stopped) stopCamera();
			else void startCamera();
		},
	});

	function stopCamera(): void {
		camera?.stop();
		camera = null;
		viewfinder.dataset.live = 'false';
		replace(outline, []);
		setButtonLabel(cameraButton, t('app.scan.camera-start'));
	}

	async function startCamera(): Promise<void> {
		if (!isCameraAvailable()) {
			setText(cameraStatus, t('app.scan.camera-unavailable'));
			viewfinder.dataset.live = 'refused';
			return;
		}
		setText(cameraStatus, t('app.scan.camera-requesting'));
		const started = await startCameraScan({
			video,
			symbologies: ctx.registries.symbologies,
			onStatus: (status) => {
				if (status.state === 'live') {
					viewfinder.dataset.live = 'true';
					setText(cameraStatus, t('app.scan.camera-live'));
					setButtonLabel(cameraButton, t('app.scan.camera-stop'));
				} else if (status.state === 'stopped') {
					viewfinder.dataset.live = 'false';
					setButtonLabel(cameraButton, t('app.scan.camera-start'));
				}
			},
			onResult: (symbols) => {
				drawOutline(symbols);
				// A scanner that read something stops, so the result holds still to be read.
				stopCamera();
				setText(cameraStatus, t('app.scan.camera-read'));
				void showDecoded(symbols);
			},
		});
		if (!started.ok) {
			viewfinder.dataset.live = 'refused';
			setText(
				cameraStatus,
				`${errorText(studioError(started.error))} ${t('app.scan.camera-fallback')}`,
			);
			return;
		}
		if (started.value.superseded) return;
		camera = started.value;
	}

	function drawOutline(symbols: readonly DecodedSymbol[]): void {
		if (video.videoWidth === 0) return;
		outline.setAttribute('viewBox', `0 0 ${video.videoWidth} ${video.videoHeight}`);
		replace(
			outline,
			symbols.map((symbol) =>
				s('polygon', {
					points: symbol.corners.map((corner) => `${corner.x},${corner.y}`).join(' '),
				}),
			),
		);
	}

	// The drop target.
	const chooser = h('input', { attrs: { type: 'file', accept: 'image/*' } });
	chooser.hidden = true;
	chooser.addEventListener('change', () => {
		const file = chooser.files?.[0];
		chooser.value = '';
		if (file !== undefined) void readBlob(file);
	});
	const chooseButton = button(t('app.scan.choose'), {
		icon: 'image',
		onClick: () => chooser.click(),
	});
	const drop = h(
		'div',
		{ className: 'dropzone', attrs: { role: 'group', 'aria-label': t('app.scan.drop') } },
		[
			icon('image', 'dropzone__icon'),
			h('p', { className: 'dropzone__text', text: t('app.scan.drop') }),
			chooseButton,
			h('p', { className: 'field__hint', text: t('app.scan.paste-hint') }),
			chooser,
		],
	);
	drop.addEventListener('dragover', (event) => {
		event.preventDefault();
		drop.dataset.over = 'true';
	});
	drop.addEventListener('dragleave', () => {
		drop.dataset.over = 'false';
	});
	drop.addEventListener('drop', (event) => {
		event.preventDefault();
		event.stopPropagation();
		drop.dataset.over = 'false';
		const file = event.dataTransfer?.files[0];
		if (file !== undefined) void readBlob(file);
	});

	// The results.
	const status = h('p', { className: 'results__status' });
	const list = h('ol', { className: 'results__list' });
	const clear = button(t('app.scan.clear'), {
		small: true,
		onClick: () => {
			replace(list, []);
			setText(status, t('app.scan.nothing-yet'));
			clear.hidden = true;
		},
	});
	clear.hidden = true;
	const results = h(
		'section',
		{ className: 'results', attrs: { 'aria-labelledby': 'results-title' } },
		[
			h('div', { className: 'results__head' }, [
				h('h2', { className: 'results__title', id: 'results-title', text: t('app.scan.results') }),
				clear,
			]),
			status,
			list,
		],
	);
	setText(status, t('app.scan.nothing-yet'));

	const root = h('div', { className: 'scan' }, [
		h('div', { className: 'scan__intro' }, [
			h('h2', { className: 'mode__title', text: t('app.scan.title') }),
			h('p', { className: 'mode__lede', text: t('app.scan.intro') }),
		]),
		h('div', { className: 'scan__grid' }, [
			h('div', { className: 'card card--static scan__inputs' }, [
				h('div', { className: 'card__body' }, [
					viewfinder,
					h('div', { className: 'viewfinder__controls' }, [cameraButton, cameraStatus]),
					drop,
				]),
			]),
			results,
		]),
	]);
	if (!isCameraAvailable()) {
		setText(cameraStatus, t('app.scan.camera-unavailable'));
		viewfinder.dataset.live = 'refused';
	}

	function remake(text: string): void {
		ctx.dispatch({ type: 'payload/raw', text });
		const after = ctx.snapshot();
		if (after.refusal?.action === 'payload/raw') {
			ctx.announce(
				after.refusal.issues.map((found) => t(found.code, found.params ?? {})).join(' '),
			);
			return;
		}
		ctx.dispatch({ type: 'mode', mode: 'create' });
		ctx.announce(t('app.scan.remade'));
	}

	function textBlock(text: string): HTMLElement {
		// Focusable, because a long text scrolls and a keyboard has to reach it.
		return h('pre', { className: 'results__text', attrs: { tabindex: 0 } }, [text]);
	}

	function card(found: Found, inspected: InspectReport | null, unavailable: boolean): HTMLElement {
		const children: HTMLElement[] = [
			h('p', {
				className: 'results__symbol',
				text: t('app.scan.symbol', {
					symbology: symbologyLabel(ctx, found.symbology),
					version: found.version,
					level: found.ecLevel,
				}),
			}),
		];
		if (found.part !== null) {
			children.push(
				h('p', {
					className: 'tag',
					text: t('app.scan.part', { index: found.part.index + 1, total: found.part.total }),
				}),
			);
		}
		if (inspected !== null && inspected.payload !== null) {
			const payload = inspected.payload;
			const type = ctx.registries.payloads.get(payload.typeId);
			children.push(h('h3', { className: 'notes__title', text: t('app.scan.type') }));
			children.push(
				h('p', {
					className: 'results__type',
					text: type === undefined ? payload.typeId : t(type.labelKey),
				}),
			);
			if (type !== undefined) {
				children.push(h('p', { className: 'field__hint', text: t(type.actionKey) }));
				const rows: HTMLElement[] = [];
				for (const schema of type.fields) {
					const value = payload.value[schema.key];
					const text = Array.isArray(value)
						? value.filter((item) => item !== '').join(', ')
						: value === null || value === undefined || value === false
							? ''
							: String(value);
					if (text === '') continue;
					rows.push(h('dt', { text: t(schema.labelKey) }));
					rows.push(
						schema.kind === 'secret'
							? h('dd', {}, [secret(text)])
							: h('dd', { className: 'results__value', text }),
					);
				}
				if (rows.length > 0) children.push(h('dl', { className: 'facts' }, rows));
			}
		}
		if (inspected?.safety !== null && inspected?.safety !== undefined) {
			const safety = inspected.safety;
			if (safety.displayHost !== null) {
				children.push(h('h3', { className: 'notes__title', text: t('app.scan.destination') }));
				children.push(
					h('p', { className: 'results__host', text: safety.unicodeHost ?? safety.displayHost }),
				);
				if (safety.unicodeHost !== null && safety.unicodeHost !== safety.displayHost) {
					children.push(
						h('p', {
							className: 'field__hint',
							text: t('app.scan.host-ascii', { host: safety.displayHost }),
						}),
					);
				}
			}
			children.push(h('h3', { className: 'notes__title', text: t('app.scan.safety') }));
			children.push(
				safety.findings.length === 0
					? h('p', { className: 'note note--info', text: t('app.scan.safety-none') })
					: h(
							'ul',
							{ className: 'notes__list' },
							safety.findings.map((finding) =>
								h(
									'li',
									{
										className: `note note--${finding.severity === 'danger' ? 'error' : finding.severity === 'caution' ? 'warning' : 'info'}`,
									},
									[
										icon(finding.severity === 'danger' ? 'fail' : 'warn'),
										h('span', { text: t(safetyMessageKey(finding.code), finding.params ?? {}) }),
									],
								),
							),
						),
			);
		}
		children.push(h('h3', { className: 'notes__title', text: t('app.scan.text') }));
		children.push(textBlock(found.text));
		if (unavailable)
			children.push(
				h('p', { className: 'note note--info', text: t('app.scan.inspect-unavailable') }),
			);
		children.push(
			h('div', { className: 'results__actions' }, [
				button(t('app.scan.remake'), {
					primary: true,
					small: true,
					onClick: () => remake(found.text),
				}),
				button(t('app.scan.copy-text'), {
					small: true,
					icon: 'copy',
					onClick: async () => {
						const copied = await copyText(found.text);
						ctx.announce(copied.ok ? t('app.scan.copied') : errorText(studioError(copied.error)));
					},
				}),
			]),
		);
		return h('li', { className: 'card card--static results__card' }, [
			h('div', { className: 'card__body' }, children),
		]);
	}

	function secret(text: string): HTMLElement {
		const value = h('span', {
			className: 'results__value results__value--secret',
			text: '●'.repeat(Math.min(12, text.length)),
		});
		let shown = false;
		const toggle = button(t('app.content.show-secret'), {
			small: true,
			icon: 'eye',
			attrs: { 'aria-pressed': 'false' },
			onClick: () => {
				shown = !shown;
				setText(value, shown ? text : '●'.repeat(Math.min(12, text.length)));
				toggle.setAttribute('aria-pressed', String(shown));
			},
		});
		return h('span', { className: 'results__secret' }, [value, toggle]);
	}

	function showError(error: StudioError): void {
		clear.hidden = false;
		replace(list, []);
		setText(status, errorText(error));
		ctx.announce(errorText(error));
	}

	function showFound(
		found: readonly Found[],
		inspected: InspectReport | null,
		unavailable: boolean,
	): void {
		clear.hidden = false;
		const message =
			found.length === 1
				? t('app.scan.found-one')
				: t('app.scan.found-many', { count: found.length });
		setText(status, message);
		replace(
			list,
			found.map((item) => card(item, inspected, unavailable)),
		);
		ctx.announce(message);
		(list.querySelector('h3, .results__symbol') as HTMLElement | null)?.scrollIntoView?.({
			block: 'nearest',
		});
	}

	function fromDecoded(symbols: readonly DecodedSymbol[]): Found[] {
		return symbols.map((symbol) => ({
			text: symbol.read.bitstream.text,
			symbology: symbol.symbology,
			version: symbol.read.version,
			ecLevel: symbol.read.ecLevel,
			part: symbol.read.bitstream.structuredAppend,
		}));
	}

	function fromReport(report: InspectReport): Found[] {
		return report.symbols.map((symbol) => ({
			text: symbol.text,
			symbology: symbol.symbology,
			version: symbol.version,
			ecLevel: symbol.ecLevel,
			part: symbol.structuredAppend,
		}));
	}

	/** Codes the camera read: explained by the inspector from their text when it is in the build. */
	async function showDecoded(symbols: readonly DecodedSymbol[]): Promise<void> {
		const text = symbols.map((symbol) => symbol.read.bitstream.text).join('');
		const result = await ctx.studio.run({ type: 'inspect/text', text });
		if (result.ok) showFound(fromDecoded(symbols), result.value, false);
		else showFound(fromDecoded(symbols), null, isUnavailable(studioError(result.error)));
	}

	function isUnavailable(error: StudioError): boolean {
		return error.code === 'platform/unavailable' && error.params.feature === 'inspect';
	}

	async function readImage(image: RgbaImage): Promise<void> {
		setText(status, t('app.scan.reading'));
		const result = await ctx.studio.run({ type: 'inspect/image', image });
		if (result.ok) {
			if (result.value.symbols.length === 0) showError(studioError(notFound()));
			else showFound(fromReport(result.value), result.value, false);
			return;
		}
		const error = studioError(result.error);
		if (!isUnavailable(error)) {
			showError(error);
			return;
		}
		// The inspector is not in this build: read the code with the decoder.
		const decoded = decodeImage(image, {}, ctx.registries.symbologies);
		if (!decoded.ok) {
			showError(studioError(decoded.error));
			return;
		}
		if (decoded.value.length === 0) {
			showError(studioError(notFound()));
			return;
		}
		showFound(fromDecoded(decoded.value), null, true);
	}

	async function readBlob(blob: Blob): Promise<void> {
		setText(status, t('app.scan.reading'));
		const image = await imageFromBlob(blob);
		if (!image.ok) {
			showError(studioError(image.error));
			return;
		}
		await readImage(image.value);
	}

	// A paste of a screenshot, while Scan is the mode.
	document.addEventListener('paste', (event) => {
		if (ctx.snapshot().document.mode !== 'scan') return;
		void imageFromClipboard(event).then((pasted) => {
			if (!pasted.ok) showError(studioError(pasted.error));
			else if (pasted.value !== null) void readImage(pasted.value);
		});
	});

	return {
		root,
		readBlob,
		stopCamera,
		update(snapshot: StudioSnapshot) {
			if (snapshot.document.mode !== 'scan' && camera !== null) stopCamera();
		},
	};
}

/** A picture that read and held no code says so the way a failed read does. */
function notFound(): QrStudioError {
	return new QrStudioError('decode/not-found', 'No code was found in this picture.');
}
