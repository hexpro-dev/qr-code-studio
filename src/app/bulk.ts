/**
 * Bulk: many codes from a spreadsheet, in the design from Create.
 *
 * The file is read here and goes nowhere. Its columns are mapped to the
 * chosen content type's fields (a column, or a template that mixes text and
 * columns), the plan is drawn as a preview with each row's problems beside
 * it, and the studio's `batch` command makes a ZIP of files or a PDF of label
 * sheets in time slices, with its progress in the snapshot.
 *
 * The mapping, the preview and the output choice are the command's arguments,
 * not the document, so they live here; the rows and what became of them are
 * the studio's.
 */

import { decodeCsvBytes } from '../batch/text-decoding.js';
import { parseCsv } from '../batch/csv.js';
import { planBatch } from '../batch/plan.js';
import { findColumn } from '../batch/template.js';
import type { BatchMapping, BatchOutput, BatchRow, CsvTable, FieldSource } from '../batch/types.js';
import { QrStudioError } from '../core/errors.js';
import { downloadBytes } from '../dom/output.js';
import { builtInSheets } from '../render/sheets.js';
import { studioError } from '../studio/index.js';
import type { StudioSnapshot } from '../studio/index.js';
import { button, choiceGroup, field, issueList, setButtonLabel } from './controls.js';
import type { AppContext, View } from './context.js';
import { fileBytes, h, icon, replace, setText, uid } from './dom.js';
import { keepNativeUndo } from './shortcuts.js';
import { errorText, issueText, t, whole } from './text.js';

/** Rows drawn in the preview. The run makes every row; the preview is for checking the mapping. */
const PREVIEW_ROWS = 12;

interface Source {
	readonly csv: string | Uint8Array;
	readonly table: CsvTable;
}

export interface BulkView extends View {
	readonly root: HTMLElement;
	/** A spreadsheet the person dropped anywhere on the page. */
	readFile(file: Blob): Promise<void>;
}

export function createBulk(ctx: AppContext): BulkView {
	let source: Source | null = null;
	let typeId = 'url';
	let fields: Record<string, FieldSource | null> = {};
	let filename = '';
	let output: 'zip' | 'sheet' = 'zip';
	let format: 'svg' | 'png' | 'pdf' | 'eps' = 'png';
	let sheet = builtInSheets()[0]?.id ?? '';
	let colourSpace: 'srgb' | 'cmyk' = 'srgb';
	let lastResult: { bytes: Uint8Array; filename: string; mime: string } | null = null;

	// The spreadsheet.
	const sourceIssues = h('ul', { className: 'field__issues' });
	sourceIssues.hidden = true;
	const sourceSummary = h('p', { className: 'bulk__summary' });
	const chooser = h('input', {
		attrs: { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain' },
	});
	chooser.hidden = true;
	chooser.addEventListener('change', () => {
		const file = chooser.files?.[0];
		chooser.value = '';
		if (file !== undefined) void readFile(file);
	});
	const pasteId = uid('paste');
	const paste = h('textarea', {
		className: 'input input--area input--mono',
		id: pasteId,
		attrs: {
			rows: 5,
			spellcheck: 'false',
			autocomplete: 'off',
			placeholder: t('app.bulk.paste-placeholder'),
		},
	});
	keepNativeUndo(paste);
	let pasteTimer: ReturnType<typeof setTimeout> | null = null;
	paste.addEventListener('input', () => {
		if (pasteTimer !== null) clearTimeout(pasteTimer);
		pasteTimer = setTimeout(() => {
			pasteTimer = null;
			if (paste.value.trim() === '') {
				source = null;
				redraw();
			} else load(paste.value);
		}, 250);
	});
	const drop = h(
		'div',
		{
			className: 'dropzone dropzone--compact',
			attrs: { role: 'group', 'aria-label': t('app.bulk.drop') },
		},
		[
			icon('file', 'dropzone__icon'),
			h('p', { className: 'dropzone__text', text: t('app.bulk.drop') }),
			button(t('app.bulk.choose'), { icon: 'open', onClick: () => chooser.click() }),
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
		if (file !== undefined) void readFile(file);
	});

	function load(csv: string | Uint8Array): void {
		try {
			const text = typeof csv === 'string' ? csv : decodeCsvBytes(csv).text;
			const table = parseCsv(text);
			source = { csv, table };
			guessMapping();
			issueList(sourceIssues, table.issues.slice(0, 6));
		} catch (thrown) {
			source = null;
			const error =
				thrown instanceof QrStudioError
					? thrown
					: new QrStudioError('batch/malformed-csv', 'This spreadsheet file could not be read.');
			issueList(sourceIssues, []);
			sourceIssues.hidden = false;
			replace(sourceIssues, [
				h('li', { className: 'note note--error', text: errorText(studioError(error)) }),
			]);
		}
		redraw();
	}

	async function readFile(file: Blob): Promise<void> {
		paste.value = '';
		load(await fileBytes(file));
	}

	/** A first mapping: each field from the column of the same name or label, if there is one. */
	function guessMapping(): void {
		if (source === null) return;
		const type = ctx.registries.payloads.get(typeId);
		const headers = source.table.headers;
		const next: Record<string, FieldSource | null> = {};
		for (const schema of type?.fields ?? []) {
			let index = findColumn(headers, schema.key);
			if (index === -1) index = findColumn(headers, t(schema.labelKey));
			next[schema.key] = index === -1 ? null : { column: headers[index] as string };
		}
		// A file with one column and a type with one required field: that is the mapping.
		const required = (type?.fields ?? []).filter((schema) => schema.required === true);
		if (
			headers.length === 1 &&
			required.length === 1 &&
			Object.values(next).every((value) => value === null)
		) {
			next[(required[0] as { key: string }).key] = { column: headers[0] as string };
		}
		fields = next;
		const first = headers[0];
		filename = first === undefined ? '' : `qr-{${first}}`;
		filenameInput.value = filename;
	}

	// The type and the mapping.
	const typeSelectId = uid('bulk-type');
	const typeSelect = h('select', {
		className: 'input input--select',
		id: typeSelectId,
		on: {
			change: () => {
				typeId = typeSelect.value;
				guessMapping();
				redraw();
			},
		},
	});
	const mappingHost = h('div', { className: 'mapping' });
	const filenameInput = h('input', {
		className: 'input input--mono',
		attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' },
		on: {
			input: () => {
				filename = filenameInput.value;
				drawPreview();
			},
		},
	});
	keepNativeUndo(filenameInput);
	const filenameField = field(t('app.bulk.filename'), filenameInput, t('app.bulk.filename-hint'));

	function drawMapping(): void {
		const type = ctx.registries.payloads.get(typeId);
		if (type === undefined || source === null) {
			replace(mappingHost, []);
			return;
		}
		const headers = source.table.headers;
		replace(
			mappingHost,
			type.fields.map((schema) => {
				const id = uid('map');
				const current = fields[schema.key] ?? null;
				const select = h('select', { className: 'input input--select', id });
				replace(select, [
					h('option', { text: t('app.bulk.no-column'), attrs: { value: '' } }),
					h(
						'optgroup',
						{ attrs: { label: t('app.bulk.from-column') } },
						headers.map((header, index) =>
							h('option', {
								text: header === '' ? t('app.bulk.column-n', { n: index + 1 }) : header,
								attrs: { value: `c:${header}` },
							}),
						),
					),
					h('option', { text: t('app.bulk.from-template'), attrs: { value: 'template' } }),
				]);
				select.value =
					current === null ? '' : 'column' in current ? `c:${current.column}` : 'template';
				const template = h('input', {
					className: 'input input--mono',
					attrs: {
						type: 'text',
						autocomplete: 'off',
						spellcheck: 'false',
						'aria-label': t('app.bulk.template-for', { field: t(schema.labelKey) }),
					},
				});
				keepNativeUndo(template);
				template.value = current !== null && 'template' in current ? current.template : '';
				template.hidden = !(current !== null && 'template' in current);
				select.addEventListener('change', () => {
					if (select.value === '') fields[schema.key] = null;
					else if (select.value === 'template') {
						fields[schema.key] = { template: template.value };
						template.hidden = false;
						template.focus();
					} else fields[schema.key] = { column: select.value.slice(2) };
					if (select.value !== 'template') template.hidden = true;
					drawPreview();
				});
				template.addEventListener('input', () => {
					fields[schema.key] = { template: template.value };
					drawPreview();
				});
				return h('div', { className: 'mapping__row' }, [
					h(
						'label',
						{ className: 'field__label', text: t(schema.labelKey), attrs: { for: id } },
						schema.required === true
							? [h('span', { className: 'tag', text: t('app.content.required') })]
							: [],
					),
					select,
					template,
				]);
			}),
		);
	}

	// The preview.
	const previewStatus = h('p', { className: 'bulk__summary' });
	const preview = h('ol', { className: 'preview' });
	let plan: readonly BatchRow[] = [];

	function mapping(): BatchMapping {
		const out: Record<string, FieldSource> = {};
		for (const [key, value] of Object.entries(fields)) if (value !== null) out[key] = value;
		return { typeId, fields: out, filename };
	}

	function drawPreview(): void {
		if (source === null) {
			plan = [];
			replace(preview, []);
			setText(previewStatus, t('app.bulk.empty'));
			makeButton.disabled = true;
			return;
		}
		try {
			plan = planBatch(source.table, mapping(), ctx.registries);
		} catch (thrown) {
			plan = [];
			replace(preview, []);
			const error =
				thrown instanceof QrStudioError
					? thrown
					: new QrStudioError('batch/unknown-column', 'A column this needs is not in the file.');
			setText(previewStatus, errorText(studioError(error)));
			makeButton.disabled = true;
			return;
		}
		const ready = plan.filter((row) => row.content !== null).length;
		setText(previewStatus, t('app.bulk.plan', { ready, skipped: plan.length - ready }));
		setButtonLabel(makeButton, t('app.bulk.make', { count: ready }));
		makeButton.disabled = ready === 0 || ctx.snapshot().batch.status === 'running';
		const shown = plan.slice(0, PREVIEW_ROWS);
		replace(preview, [
			...shown.map((row) => {
				const item = h('li', { className: 'preview__row' }, [
					h('span', {
						className: 'preview__number',
						text: t('app.bulk.row', { row: row.rowNumber }),
					}),
					h('span', { className: 'preview__name', text: row.filename }),
					h('span', { className: 'preview__state' }, [
						icon(row.content === null ? 'fail' : 'pass'),
						h('span', {
							text: row.content === null ? t('app.bulk.row-skipped') : t('app.bulk.row-ok'),
						}),
					]),
					row.issues.length === 0
						? null
						: h(
								'ul',
								{ className: 'preview__issues' },
								row.issues.slice(0, 3).map((found) => h('li', { text: issueText(found) })),
							),
				]);
				item.dataset.result = row.content === null ? 'fail' : 'pass';
				return item;
			}),
			plan.length > PREVIEW_ROWS
				? h('li', {
						className: 'preview__more',
						text: t('app.bulk.preview-more', { count: plan.length - PREVIEW_ROWS }),
					})
				: null,
		]);
	}

	// The output.
	const outputGroup = choiceGroup(
		t('app.bulk.output'),
		[
			{ value: 'zip', label: t('app.bulk.output-zip') },
			{ value: 'sheet', label: t('app.bulk.output-sheet') },
		],
		(value) => {
			output = value as typeof output;
			drawOutput();
		},
	);
	outputGroup.set(output);
	const outputHost = h('div', { className: 'bulk__output' });

	function drawOutput(): void {
		if (output === 'zip') {
			const formats = choiceGroup(
				t('app.bulk.format'),
				(['png', 'svg', 'pdf', 'eps'] as const).map((value) => ({
					value,
					label: t(
						value === 'png'
							? 'app.export.format-png'
							: value === 'svg'
								? 'app.export.format-svg'
								: value === 'pdf'
									? 'app.export.format-pdf'
									: 'app.export.format-eps',
					),
				})),
				(value) => {
					format = value as typeof format;
				},
			);
			formats.set(format);
			replace(outputHost, [formats.root]);
			return;
		}
		const sheetId = uid('sheet');
		const select = h(
			'select',
			{
				className: 'input input--select',
				id: sheetId,
				on: {
					change: () => {
						sheet = select.value;
					},
				},
			},
			builtInSheets().map((template) =>
				h('option', { text: t(template.labelKey), attrs: { value: template.id } }),
			),
		);
		select.value = sheet;
		const colour = choiceGroup(
			t('app.export.colour-space'),
			[
				{ value: 'srgb', label: t('app.export.colour-srgb') },
				{ value: 'cmyk', label: t('app.export.colour-cmyk') },
			],
			(value) => {
				colourSpace = value as typeof colourSpace;
			},
		);
		colour.set(colourSpace);
		replace(outputHost, [
			field(t('app.bulk.sheet'), select, t('app.bulk.sheet-hint')).root,
			colour.root,
		]);
	}
	drawOutput();

	const progress = h('span', { className: 'check__progress', attrs: { 'aria-hidden': 'true' } }, [
		h('span', { className: 'check__progress-fill' }),
	]);
	const runStatus = h('p', { className: 'bulk__summary' });
	const makeButton = button(t('app.bulk.make', { count: 0 }), {
		icon: 'download',
		primary: true,
		onClick: () => void make(),
	});
	makeButton.disabled = true;
	const againButton = button(t('app.bulk.download-again'), {
		icon: 'download',
		small: true,
		onClick: () => {
			if (lastResult !== null)
				downloadBytes(lastResult.bytes, lastResult.filename, lastResult.mime);
		},
	});
	againButton.hidden = true;
	const skippedList = h('ul', { className: 'field__issues' });
	skippedList.hidden = true;

	async function make(): Promise<void> {
		if (source === null) return;
		const out: BatchOutput =
			output === 'zip' ? { kind: 'zip', format } : { kind: 'sheet', template: sheet, colourSpace };
		const result = await ctx.studio.run({
			type: 'batch',
			csv: source.csv,
			mapping: mapping(),
			output: out,
		});
		if (!result.ok) {
			if (result.error.code !== 'cancelled') ctx.announce(errorText(studioError(result.error)));
			return;
		}
		const name = output === 'zip' ? 'qr-codes.zip' : 'qr-labels.pdf';
		const mime = output === 'zip' ? 'application/zip' : 'application/pdf';
		lastResult = { bytes: result.value, filename: name, mime };
		const saved = downloadBytes(result.value, name, mime);
		if (saved.ok) ctx.announce(t('app.export.saved', { filename: name }));
		againButton.hidden = false;
	}

	const root = h('div', { className: 'bulk' }, [
		h('div', { className: 'scan__intro' }, [
			h('h2', { className: 'mode__title', text: t('app.bulk.title') }),
			h('p', { className: 'mode__lede', text: t('app.bulk.intro') }),
		]),
		h('ol', { className: 'steps' }, [
			step(1, t('app.bulk.source'), [
				drop,
				h('div', { className: 'field' }, [
					h('label', {
						className: 'field__label',
						text: t('app.bulk.paste'),
						attrs: { for: pasteId },
					}),
					paste,
				]),
				sourceSummary,
				sourceIssues,
			]),
			step(2, t('app.bulk.mapping'), [
				field(t('app.bulk.type'), typeSelect).root,
				h('p', { className: 'field__hint', text: t('app.bulk.template-hint') }),
				mappingHost,
				filenameField.root,
			]),
			step(3, t('app.bulk.preview'), [previewStatus, preview]),
			step(4, t('app.bulk.output'), [
				outputGroup.root,
				outputHost,
				h('p', { className: 'field__hint', text: t('app.bulk.design-note') }),
				h('div', { className: 'bulk__run' }, [makeButton, againButton]),
				progress,
				runStatus,
				skippedList,
			]),
		]),
	]);

	function step(number: number, title: string, children: (HTMLElement | null)[]): HTMLElement {
		return h('li', { className: 'card card--static step' }, [
			h('div', { className: 'card__head card__head--static' }, [
				h('span', { className: 'card__num', text: String(number).padStart(2, '0') }),
				h('h3', { className: 'card__title', text: title }),
			]),
			h('div', { className: 'card__body' }, children),
		]);
	}

	function redraw(): void {
		if (source === null) {
			setText(sourceSummary, '');
		} else {
			setText(
				sourceSummary,
				t('app.bulk.rows', {
					count: whole(source.table.rows.length),
					columns: source.table.headers.length,
				}),
			);
		}
		drawMapping();
		drawPreview();
	}

	let shownCatalogue: unknown = null;
	let shownBatch: unknown = null;
	redraw();

	return {
		root,
		readFile,
		update(snapshot: StudioSnapshot) {
			if (shownCatalogue !== snapshot.catalogue) {
				shownCatalogue = snapshot.catalogue;
				replace(
					typeSelect,
					snapshot.catalogue.payloadTypes.map((group) =>
						h(
							'optgroup',
							{ attrs: { label: t(group.labelKey) } },
							group.types
								.filter((type) => type.generate)
								.map((type) => h('option', { text: t(type.labelKey), attrs: { value: type.id } })),
						),
					),
				);
				typeSelect.value = typeId;
			}
			const batch = snapshot.batch;
			if (batch === shownBatch) return;
			shownBatch = batch;
			root.dataset.status = batch.status;
			switch (batch.status) {
				case 'idle':
					setText(runStatus, '');
					break;
				case 'running':
					progress.style.setProperty(
						'--fill',
						String(batch.total === 0 ? 0 : batch.done / batch.total),
					);
					setText(runStatus, t('app.bulk.making', { done: batch.done, total: batch.total }));
					makeButton.disabled = true;
					break;
				case 'done': {
					progress.style.setProperty('--fill', '1');
					setText(
						runStatus,
						t('app.bulk.done', { written: batch.written, skipped: batch.skipped }),
					);
					const skipped = batch.outcomes
						.filter((outcome) => outcome.status === 'skipped')
						.slice(0, 8);
					skippedList.hidden = skipped.length === 0;
					replace(
						skippedList,
						skipped.map((outcome) =>
							h('li', {
								className: 'note note--warning',
								text: `${t('app.bulk.row', { row: outcome.rowNumber })}: ${outcome.issues.map(issueText).join(' ')}`,
							}),
						),
					);
					drawPreview();
					break;
				}
				case 'failed':
					setText(runStatus, errorText(batch.error));
					drawPreview();
					break;
			}
		},
	};
}
