/**
 * Build the single file offline application.
 *
 * Everything ends up inside one HTML document: the script bundled and
 * minified, the stylesheet minified, and a Content-Security-Policy naming the
 * sha256 of each so the browser refuses to run anything added afterwards.
 *
 * Exported as a function rather than only run as a script, so the tests can
 * build it in memory and assert its properties without a build step having run
 * first, and so that `pnpm test` cannot pass against a stale artefact.
 *
 * The esbuild metafile comes back too. `tests/build/budget.test.ts` reads it to
 * hold each area of the package to its own share of the download, and
 * `tests/build/no-network.test.ts` reads it to prove the opt-in library never
 * reached the offline file.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export const OUTPUT_NAME = 'qr-code-studio.html';

export interface StandaloneBuildResult {
	readonly html: string;
	readonly scriptSha256: string;
	readonly styleSha256: string;
	readonly bytes: number;
	/** Bytes each source file contributed to the minified script, keyed by path from the root. */
	readonly inputs: Readonly<Record<string, number>>;
}

function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('base64');
}

/** The exact text between a tag's open and close, as the browser will hash it. */
function elementContent(html: string, tag: 'script' | 'style'): string {
	const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html);
	if (!match?.[1]) throw new Error(`the built document has no ${tag} element`);
	return match[1];
}

export async function buildStandaloneHtml(): Promise<StandaloneBuildResult> {
	const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
		version: string;
	};

	const bundle = await esbuild.build({
		entryPoints: [resolve(root, 'src/app/main.ts')],
		bundle: true,
		minify: true,
		format: 'iife',
		write: false,
		metafile: true,
		legalComments: 'none',
		target: ['es2022', 'safari16', 'firefox115', 'chrome110'],
		define: { __VERSION__: JSON.stringify(manifest.version) },
		absWorkingDir: root,
	});
	const output = bundle.outputFiles[0];
	if (!output) throw new Error('esbuild produced no output');
	const script = output.text;

	const inputs: Record<string, number> = {};
	for (const meta of Object.values(bundle.metafile.outputs)) {
		for (const [path, contribution] of Object.entries(meta.inputs)) {
			inputs[path] = (inputs[path] ?? 0) + contribution.bytesInOutput;
		}
	}

	const css = await readFile(resolve(root, 'src/app/styles.css'), 'utf8');
	const style = (await esbuild.transform(css, { loader: 'css', minify: true })).code;

	const template = await readFile(resolve(root, 'src/app/index.html'), 'utf8');

	// Replacements are functions, not strings. `String.replace` expands `$&`
	// and friends inside a string replacement, and a minifier reliably emits
	// `$&&` somewhere in a bundle this size. The sibling package shipped a file
	// that parsed as HTML and not as a program the one time this was a string.
	let html = template.replace('<!--STYLE-->', () => style).replace('<!--SCRIPT-->', () => script);

	// Hashed from what actually landed in the document, not from the bundle. A
	// formatter once moved a placeholder onto its own indented line in the
	// sibling package, the script gained a leading newline, and the browser
	// refused to run a file every other test passed.
	const scriptSha256 = sha256(elementContent(html, 'script'));
	const styleSha256 = sha256(elementContent(html, 'style'));

	const csp = [
		"default-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		`script-src 'sha256-${scriptSha256}'`,
		`style-src 'sha256-${styleSha256}'`,
		// blob: is what a saved file, a dropped logo and the preview of an
		// export all use. data: is the inline SVG swatches. There is no remote
		// scheme here at all.
		"img-src 'self' data: blob:",
		// The camera. mediastream: is the scheme a camera stream is given when it
		// is attached to a video element in some engines; blob: in others.
		"media-src 'self' blob: mediastream:",
		"connect-src 'none'",
		"frame-src 'none'",
		"object-src 'none'",
	].join('; ');

	html = html.replace(
		'<!--CSP-->',
		() => `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
	);

	return {
		html,
		scriptSha256,
		styleSha256,
		bytes: Buffer.byteLength(html, 'utf8'),
		inputs,
	};
}

async function main(): Promise<void> {
	const result = await buildStandaloneHtml();
	await mkdir(resolve(root, 'dist'), { recursive: true });
	const out = resolve(root, 'dist', OUTPUT_NAME);
	await writeFile(out, result.html, 'utf8');
	const digest = createHash('sha256').update(result.html, 'utf8').digest('hex');
	process.stdout.write(`${out}\n${result.bytes} bytes\nsha256 ${digest}\n`);
}

// Only writes a file when run as a script. Importing it from a test builds in
// memory and touches nothing.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
