/**
 * Bundle a test module for a page, the way the offline build bundles the app.
 *
 * The module is built from source on every run and handed to the page as an
 * inline script, so there is no server, no file on disk, and no chance of a
 * stale copy being what a browser checks.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function bundleForPage(entry: string, globalName: string): Promise<string> {
	const result = await esbuild.build({
		entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
		bundle: true,
		format: 'iife',
		globalName,
		write: false,
		target: ['es2022'],
	});
	const text = result.outputFiles[0]?.text;
	if (!text) throw new Error('esbuild produced no output');
	return text;
}
