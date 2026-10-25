/**
 * Redirect rules for a person's own website, so a printed code can point at
 * an address they control and its destination can change later without
 * reprinting anything, and without a third party in the middle.
 *
 * One input, a rule for each hosting setup: Cloudflare (a Bulk Redirects
 * list row and a single Redirect Rule), Netlify, Vercel, Apache, nginx, and a
 * plain HTML page for hosts that offer no redirect settings at all. Each
 * follows its platform's documented syntax, cited beside it.
 *
 * A temporary status, 302 or 307, is the right one here and the default.
 * Browsers remember a permanent redirect (301 or 308) and may never ask the
 * server again, so a destination changed later would not reach anybody who
 * had scanned the code before. A permanent status is allowed, with a warning.
 *
 * The source path is limited to letters, digits, "-", ".", "_", "~" and "/".
 * That is every path a QR code needs. Percent-escapes are refused because
 * nginx and Apache match the decoded path and Cloudflare and Netlify the
 * encoded one, so the same rule would match different requests. And no
 * platform's pattern syntax (Vercel's ":name", Netlify's "*", a regular
 * expression's ".") can change what the rule matches, beyond the one escape
 * Apache needs for the dot. The destination is normalised by the WHATWG URL
 * parser, which percent-encodes spaces and quotes, and "$" and "\" are
 * percent-encoded on top because nginx and Apache read "$" as a variable or a
 * back-reference and nginx has no way to escape one.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { hasErrors } from '../core/issue.js';

export type RedirectStatus = 301 | 302 | 307 | 308;

export type RedirectTarget = 'cloudflare' | 'netlify' | 'vercel' | 'apache' | 'nginx' | 'html';

export const REDIRECT_TARGETS: readonly RedirectTarget[] = Object.freeze([
	'cloudflare',
	'netlify',
	'vercel',
	'apache',
	'nginx',
	'html',
] satisfies RedirectTarget[]);

export interface RedirectInput {
	/** The address on the person's own site that the code holds, such as https://example.com/qr/menu. */
	readonly from: string;
	/** Where it goes today. */
	readonly to: string;
	/** Default 302. */
	readonly status?: RedirectStatus;
	/** Which setups to write rules for; all of them when absent. */
	readonly targets?: readonly RedirectTarget[];
}

export interface RedirectRule {
	readonly target: RedirectTarget;
	readonly filename: string;
	readonly contents: string;
	/** Where the file goes and anything the platform needs, as a message key. */
	readonly noteKey: string;
}

export interface RedirectRulesResult {
	/** Empty when there is an error issue. */
	readonly rules: readonly RedirectRule[];
	readonly issues: readonly Issue[];
}

interface Parsed {
	readonly host: string;
	readonly path: string;
	readonly to: string;
	readonly status: RedirectStatus;
}

const STATUSES: readonly number[] = [301, 302, 307, 308];
const SAFE_PATH = /^\/[A-Za-z0-9._~/-]*$/;

function parseWebUrl(text: unknown): URL | undefined {
	if (typeof text !== 'string' || /\s/.test(text)) return undefined;
	try {
		const url = new URL(text);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
	} catch {
		return undefined;
	}
}

function validate(input: RedirectInput): { readonly parsed?: Parsed; readonly issues: Issue[] } {
	const issues: Issue[] = [];
	const from = parseWebUrl(input.from);
	if (from === undefined || from.username !== '' || from.password !== '' || from.port !== '') {
		issues.push(issue('own-link.issue.from', ['from']));
	} else if (from.search !== '' || from.hash !== '' || /[?#]/.test(input.from)) {
		issues.push(issue('own-link.issue.from-query', ['from']));
	} else if (!SAFE_PATH.test(from.pathname)) {
		issues.push(issue('own-link.issue.from-path', ['from']));
	}
	const to = parseWebUrl(input.to);
	if (to === undefined) issues.push(issue('own-link.issue.to', ['to']));
	else if (to.protocol === 'http:')
		issues.push(issue('own-link.issue.to-insecure', ['to'], 'warning'));
	const status = input.status ?? 302;
	if (!STATUSES.includes(status)) issues.push(issue('own-link.issue.status', ['status']));
	else if (status === 301 || status === 308)
		issues.push(issue('own-link.issue.permanent', ['status'], 'warning'));
	if (
		from !== undefined &&
		to !== undefined &&
		from.host === to.host &&
		from.pathname === to.pathname
	) {
		issues.push(issue('own-link.issue.loop', ['to']));
	}
	for (const target of input.targets ?? []) {
		if (!REDIRECT_TARGETS.includes(target))
			issues.push(issue('own-link.issue.target', ['targets']));
	}
	if (hasErrors(issues) || from === undefined || to === undefined) return { issues };
	return {
		parsed: { host: from.hostname, path: from.pathname, to: safeUrl(to.href), status },
		issues,
	};
}

/** "$" and "\" as percent-escapes: nginx and Apache would read them as syntax, and a URL means the same either way. */
function safeUrl(href: string): string {
	return href.replace(/\$/g, '%24').replace(/\\/g, '%5C');
}

/** A CSV field per RFC 4180: quoted when it holds a comma or a quote, with quotes doubled. */
function csvField(text: string): string {
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlAttribute(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Cloudflare Bulk Redirects, CSV upload format
 * (developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/csv-file-format/):
 * source, target, status, then preserve query string, include subdomains,
 * subpath matching and preserve path suffix, with no header row. The source
 * has no scheme, so it matches both http and https. Every flag is written out
 * as FALSE because Cloudflare's own pages disagree about one default.
 */
function cloudflareBulk({ host, path, to, status }: Parsed): RedirectRule {
	return {
		target: 'cloudflare',
		filename: 'cloudflare-bulk-redirects.csv',
		contents: `${csvField(`${host}${path}`)},${csvField(to)},${status},FALSE,FALSE,FALSE,FALSE\n`,
		noteKey: 'own-link.note.cloudflare-bulk',
	};
}

/**
 * A single Cloudflare Redirect Rule, as the Rulesets API takes it
 * (developers.cloudflare.com/rules/url-forwarding/single-redirects/create-api/):
 * an expression matching the exact host and path
 * (developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/)
 * and a static target. The expression can be pasted into the dashboard's
 * expression editor as it is.
 */
function cloudflareRule({ host, path, to, status }: Parsed): RedirectRule {
	const rule = {
		expression: `(http.host eq ${JSON.stringify(host)} and http.request.uri.path eq ${JSON.stringify(path)})`,
		action: 'redirect',
		action_parameters: {
			from_value: { target_url: { value: to }, status_code: status, preserve_query_string: false },
		},
	};
	return {
		target: 'cloudflare',
		filename: 'cloudflare-redirect-rule.json',
		contents: `${JSON.stringify(rule, null, '\t')}\n`,
		noteKey: 'own-link.note.cloudflare-rule',
	};
}

/**
 * Netlify `_redirects` (docs.netlify.com/manage/routing/redirects/overview/):
 * path, destination, status. The "!" forces the rule even when a file exists
 * at the path, which Netlify otherwise lets win (redirect-options). Netlify
 * does not support 307, and its documentation says to use 302 instead, so a
 * 307 is written as 302 and a 308 as 301, and the note says so.
 */
function netlify({ path, to, status }: Parsed): RedirectRule {
	const written = status === 307 ? 302 : status === 308 ? 301 : status;
	return {
		target: 'netlify',
		filename: '_redirects',
		contents: `${path}  ${to}  ${written}!\n`,
		noteKey: written === status ? 'own-link.note.netlify' : 'own-link.note.netlify-status',
	};
}

/**
 * Vercel `vercel.json` redirects (vercel.com/docs/project-configuration/vercel-json#redirects):
 * source, destination and statusCode, which is used rather than `permanent`
 * so that 302 and 301 can be written as well as 307 and 308.
 */
function vercel({ path, to, status }: Parsed): RedirectRule {
	const config = { redirects: [{ source: path, destination: to, statusCode: status }] };
	return {
		target: 'vercel',
		filename: 'vercel.json',
		contents: `${JSON.stringify(config, null, '\t')}\n`,
		noteKey: 'own-link.note.vercel',
	};
}

/**
 * Apache httpd 2.4 mod_alias (httpd.apache.org/docs/2.4/mod/mod_alias.html#redirectmatch):
 * RedirectMatch with an anchored expression, because plain Redirect matches
 * the path as a prefix and appends whatever follows it. Allowed in .htaccess
 * where AllowOverride includes FileInfo.
 */
function apache({ path, to, status }: Parsed): RedirectRule {
	const pattern = `^${path.replace(/\./g, '\\.')}$`;
	return {
		target: 'apache',
		filename: '.htaccess',
		contents: `RedirectMatch ${status} "${pattern}" "${to}"\n`,
		noteKey: 'own-link.note.apache',
	};
}

/**
 * nginx (nginx.org/en/docs/http/ngx_http_core_module.html#location and
 * ngx_http_rewrite_module.html#return): an exact-match location returning
 * the status and the URL. A "$" in the URL would start a variable and nginx
 * has no escape for one, which is why it arrives here percent-encoded.
 */
function nginx({ path, to, status }: Parsed): RedirectRule {
	return {
		target: 'nginx',
		filename: 'nginx-redirect.conf',
		contents: `location = ${path} {\n\treturn ${status} "${to}";\n}\n`,
		noteKey: 'own-link.note.nginx',
	};
}

/**
 * A page that forwards, for a host with no redirect settings: a meta refresh
 * (HTML Living Standard, "Shared declarative refresh steps") and a link for
 * anything that ignores it. It carries no words of its own, so it reads the
 * same in any language: the title is the destination's host and the link text
 * is the destination. It is not an HTTP redirect, so there is no status.
 */
function html({ path, to }: Parsed): RedirectRule {
	const trimmed = path.replace(/^\/+|\/+$/g, '');
	const filename =
		trimmed === '' ? 'index.html' : /\.html?$/.test(trimmed) ? trimmed : `${trimmed}/index.html`;
	const href = htmlAttribute(to);
	const title = htmlAttribute(new URL(to).hostname);
	const contents = [
		'<!doctype html>',
		'<meta charset="utf-8">',
		'<meta name="robots" content="noindex">',
		`<meta http-equiv="refresh" content="0; url='${href}'">`,
		`<title>${title}</title>`,
		`<a href="${href}">${href}</a>`,
		'',
	].join('\n');
	return { target: 'html', filename, contents, noteKey: 'own-link.note.html' };
}

const WRITERS: Readonly<Record<RedirectTarget, readonly ((parsed: Parsed) => RedirectRule)[]>> = {
	cloudflare: [cloudflareBulk, cloudflareRule],
	netlify: [netlify],
	vercel: [vercel],
	apache: [apache],
	nginx: [nginx],
	html: [html],
};

export function redirectRules(input: RedirectInput): RedirectRulesResult {
	if (typeof input !== 'object' || input === null)
		throw new TypeError('redirectRules takes an object with from and to.');
	const { parsed, issues } = validate(input);
	if (parsed === undefined) return { rules: [], issues };
	const targets = input.targets ?? REDIRECT_TARGETS;
	const rules = REDIRECT_TARGETS.filter((target) => targets.includes(target)).flatMap((target) =>
		WRITERS[target].map((writer) => writer(parsed)),
	);
	return { rules, issues };
}
