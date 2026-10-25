/**
 * The offline application.
 *
 * A placeholder until the studio controller exists (milestone M8). It proves
 * the build: one document, one script, a hash policy, the version stamped in.
 */

declare const __VERSION__: string;

function byId<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`the page has no #${id}`);
	return found as T;
}

byId('version').textContent = __VERSION__;
