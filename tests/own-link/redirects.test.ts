import { describe, expect, it } from 'vitest';
import { redirectRules, REDIRECT_TARGETS } from '../../src/own-link/redirects.js';
import type { RedirectInput, RedirectRule } from '../../src/own-link/redirects.js';
import { utmLink } from '../../src/own-link/utm.js';

const INPUT: RedirectInput = {
	from: 'https://example.com/qr/menu',
	to: 'https://example.org/menu/autumn',
};

function rule(rules: readonly RedirectRule[], filename: string): RedirectRule {
	const found = rules.find((candidate) => candidate.filename === filename);
	if (found === undefined) throw new Error(`no ${filename}`);
	return found;
}

describe('redirectRules', () => {
	it('writes a rule for every setup, temporary by default', () => {
		const { rules, issues } = redirectRules(INPUT);
		expect(issues).toEqual([]);
		expect(rules.map((r) => [r.target, r.filename, r.noteKey])).toEqual([
			['cloudflare', 'cloudflare-bulk-redirects.csv', 'own-link.note.cloudflare-bulk'],
			['cloudflare', 'cloudflare-redirect-rule.json', 'own-link.note.cloudflare-rule'],
			['netlify', '_redirects', 'own-link.note.netlify'],
			['vercel', 'vercel.json', 'own-link.note.vercel'],
			['apache', '.htaccess', 'own-link.note.apache'],
			['nginx', 'nginx-redirect.conf', 'own-link.note.nginx'],
			['html', 'qr/menu/index.html', 'own-link.note.html'],
		]);
	});

	it("follows each platform's documented syntax", () => {
		const { rules } = redirectRules(INPUT);
		// Cloudflare Bulk Redirects CSV: no header, no scheme on the source.
		expect(rule(rules, 'cloudflare-bulk-redirects.csv').contents).toBe(
			'example.com/qr/menu,https://example.org/menu/autumn,302,FALSE,FALSE,FALSE,FALSE\n',
		);
		expect(JSON.parse(rule(rules, 'cloudflare-redirect-rule.json').contents)).toEqual({
			expression: '(http.host eq "example.com" and http.request.uri.path eq "/qr/menu")',
			action: 'redirect',
			action_parameters: {
				from_value: {
					target_url: { value: 'https://example.org/menu/autumn' },
					status_code: 302,
					preserve_query_string: false,
				},
			},
		});
		expect(rule(rules, '_redirects').contents).toBe(
			'/qr/menu  https://example.org/menu/autumn  302!\n',
		);
		expect(JSON.parse(rule(rules, 'vercel.json').contents)).toEqual({
			redirects: [
				{ source: '/qr/menu', destination: 'https://example.org/menu/autumn', statusCode: 302 },
			],
		});
		expect(rule(rules, '.htaccess').contents).toBe(
			'RedirectMatch 302 "^/qr/menu$" "https://example.org/menu/autumn"\n',
		);
		expect(rule(rules, 'nginx-redirect.conf').contents).toBe(
			'location = /qr/menu {\n\treturn 302 "https://example.org/menu/autumn";\n}\n',
		);
		expect(rule(rules, 'qr/menu/index.html').contents).toBe(
			[
				'<!doctype html>',
				'<meta charset="utf-8">',
				'<meta name="robots" content="noindex">',
				`<meta http-equiv="refresh" content="0; url='https://example.org/menu/autumn'">`,
				'<title>example.org</title>',
				'<a href="https://example.org/menu/autumn">https://example.org/menu/autumn</a>',
				'',
			].join('\n'),
		);
	});

	it('escapes what each format treats as syntax', () => {
		const { rules } = redirectRules({
			from: 'https://example.com/qr/menu.v2',
			to: 'https://example.org/a?x=1,2&price=$5&q="hi"&n=<i>\'',
		});
		// WHATWG percent-encodes the quotes and angle brackets; "$" is ours.
		const to = 'https://example.org/a?x=1,2&price=%245&q=%22hi%22&n=%3Ci%3E%27';
		expect(rule(rules, 'cloudflare-bulk-redirects.csv').contents).toBe(
			`example.com/qr/menu.v2,"${to}",302,FALSE,FALSE,FALSE,FALSE\n`,
		);
		expect(rule(rules, '.htaccess').contents).toBe(`RedirectMatch 302 "^/qr/menu\\.v2$" "${to}"\n`);
		expect(rule(rules, 'nginx-redirect.conf').contents).toContain(`return 302 "${to}";`);
		expect(rule(rules, 'qr/menu.v2/index.html').contents).toContain(
			`href="${to.replace(/&/g, '&amp;')}"`,
		);
		expect(
			redirectRules({ ...INPUT, to: 'https://example.org/a\\b?c=d\\e' }).rules[0]?.contents,
		).toContain('https://example.org/a/b?c=d%5Ce');
	});

	it('keeps an apostrophe from ending the refresh URL', () => {
		// The HTML standard cuts a quoted refresh URL at its first matching quote.
		const page = rule(
			redirectRules({ ...INPUT, to: "https://example.org/it's/here", targets: ['html'] }).rules,
			'qr/menu/index.html',
		);
		expect(page.contents).toContain(`content="0; url='https://example.org/it%27s/here'"`);
	});

	it('keeps Netlify and Vercel from reading the destination as a pattern', () => {
		const { rules } = redirectRules({
			...INPUT,
			to: 'https://en.wikipedia.org:443/wiki/Mercury_(planet)/Help:Contents/*/a+b{c}?q=a:b(c)+d#x:y',
		});
		const inert =
			'https://en.wikipedia.org/wiki/Mercury_%28planet%29/Help%3AContents/%2A/a%2Bb%7Bc%7D?q=a%3Ab%28c%29+d#x%3Ay';
		expect(rule(rules, '_redirects').contents).toBe(`/qr/menu  ${inert}  302!\n`);
		expect(JSON.parse(rule(rules, 'vercel.json').contents).redirects[0].destination).toBe(inert);
		const port = redirectRules({
			...INPUT,
			to: 'https://example.org:8443/a:b',
			targets: ['vercel'],
		});
		expect(JSON.parse(port.rules[0]?.contents ?? '').redirects[0].destination).toBe(
			'https://example.org:8443/a%3Ab',
		);
	});

	it('names the page after the path', () => {
		const html = (from: string) =>
			redirectRules({ ...INPUT, from, targets: ['html'] }).rules[0]?.filename;
		expect(html('https://example.com/')).toBe('index.html');
		expect(html('https://example.com/menu.html')).toBe('menu.html');
		expect(html('https://example.com/qr/menu/')).toBe('qr/menu/index.html');
	});

	it('writes only the setups asked for', () => {
		expect(
			redirectRules({ ...INPUT, targets: ['nginx', 'vercel'] }).rules.map((r) => r.target),
		).toEqual(['vercel', 'nginx']);
		expect(REDIRECT_TARGETS).toHaveLength(6);
	});

	it('warns that a permanent redirect is remembered, and writes it', () => {
		const { rules, issues } = redirectRules({ ...INPUT, status: 301 });
		expect(issues).toEqual([
			{ code: 'own-link.issue.permanent', path: ['status'], severity: 'warning' },
		]);
		expect(rule(rules, 'nginx-redirect.conf').contents).toContain('return 301');
		expect(redirectRules({ ...INPUT, status: 308 }).issues).toHaveLength(1);
	});

	it('maps 307 and 308 to the statuses Netlify supports, and says so', () => {
		const temporary = rule(redirectRules({ ...INPUT, status: 307 }).rules, '_redirects');
		expect(temporary.contents).toBe('/qr/menu  https://example.org/menu/autumn  302!\n');
		expect(temporary.noteKey).toBe('own-link.note.netlify-status');
		expect(rule(redirectRules({ ...INPUT, status: 308 }).rules, '_redirects').contents).toContain(
			'301!',
		);
		expect(rule(redirectRules({ ...INPUT, status: 301 }).rules, '_redirects').noteKey).toBe(
			'own-link.note.netlify',
		);
	});

	it('reports every problem with the input at once, and writes nothing', () => {
		const codes = (input: Partial<RedirectInput>) =>
			redirectRules({ ...INPUT, ...input } as RedirectInput).issues.map((found) => found.code);
		expect(codes({ from: 'example.com/qr' })).toEqual(['own-link.issue.from']);
		expect(codes({ from: 'https://user@example.com/qr' })).toEqual(['own-link.issue.from']);
		expect(codes({ from: 'https://example.com:8443/qr' })).toEqual(['own-link.issue.from']);
		expect(codes({ from: 'ftp://example.com/qr' })).toEqual(['own-link.issue.from']);
		expect(codes({ from: 'https://example.com/qr?table=1' })).toEqual([
			'own-link.issue.from-query',
		]);
		expect(codes({ from: 'https://example.com/qr?' })).toEqual(['own-link.issue.from-query']);
		expect(codes({ from: 'https://example.com/qr#x' })).toEqual(['own-link.issue.from-query']);
		expect(codes({ from: 'https://example.com/q:r' })).toEqual(['own-link.issue.from-path']);
		expect(codes({ from: 'https://example.com/caf%C3%A9' })).toEqual(['own-link.issue.from-path']);
		expect(codes({ to: '/relative' })).toEqual(['own-link.issue.to']);
		expect(codes({ to: 'https://example.org/a b c' })).toEqual(['own-link.issue.to']);
		expect(codes({ to: 'http://example.org/' })).toEqual(['own-link.issue.to-insecure']);
		expect(codes({ status: 303 as never })).toEqual(['own-link.issue.status']);
		expect(codes({ to: 'https://example.com/qr/menu' })).toEqual(['own-link.issue.loop']);
		// Netlify matches with or without a trailing slash, so this loops too.
		expect(codes({ to: 'https://example.com/qr/menu/' })).toEqual(['own-link.issue.loop']);
		expect(codes({ from: 'https://example.com/qr//menu' })).toEqual(['own-link.issue.from-path']);
		expect(codes({ to: 'https://user:pass@example.org/' })).toEqual(['own-link.issue.to-userinfo']);
		expect(codes({ targets: ['iis' as never] })).toEqual(['own-link.issue.target']);
		const both = redirectRules({ from: 'nope', to: 'nope' });
		expect(both.rules).toEqual([]);
		expect(both.issues).toHaveLength(2);
		expect(() => redirectRules(null as never)).toThrow(TypeError);
		expect(codes({ from: 3 as never })).toEqual(['own-link.issue.from']);
	});
});

describe('utmLink', () => {
	it('adds the campaign tags to the link as written', () => {
		expect(
			utmLink('https://example.com/menu?table=4#drinks', {
				source: 'poster',
				medium: 'qr',
				campaign: 'spring sale',
				content: 'v2',
			}),
		).toEqual({
			url: 'https://example.com/menu?table=4&utm_source=poster&utm_medium=qr&utm_campaign=spring%20sale&utm_content=v2#drinks',
			issues: [],
		});
		expect(
			utmLink('https://example.com/?utm_source=old&&x=%ZZ', {
				source: 'new',
				medium: 'm',
				campaign: 'c',
				term: 't',
			}).url,
		).toBe('https://example.com/?x=%ZZ&utm_source=new&utm_medium=m&utm_campaign=c&utm_term=t');
		// A parameter whose name cannot be decoded is kept as written, and
		// one spelt with + for a space is matched as the form encoding means.
		expect(
			utmLink('https://example.com/?%ZZ=1&utm+source=x&flag', {
				source: 's',
				medium: 'm',
				campaign: 'c',
			}).url,
		).toBe('https://example.com/?%ZZ=1&utm+source=x&flag&utm_source=s&utm_medium=m&utm_campaign=c');
	});

	it('needs source, medium and campaign, and a link they can go on', () => {
		const { url, issues } = utmLink('example.com', { source: '', medium: ' ', campaign: 'c' });
		expect(url).toBeNull();
		expect(issues.map((found) => [found.code, found.path])).toEqual([
			['own-link.issue.url', ['url']],
			['own-link.issue.utm-required', ['source']],
			['own-link.issue.utm-required', ['medium']],
		]);
		expect(
			utmLink('https://example.com/ a', { source: 'a', medium: 'b', campaign: 'c' }).url,
		).toBeNull();
		expect(
			utmLink('mailto:a@example.com', { source: 'a', medium: 'b', campaign: 'c' }).url,
		).toBeNull();
	});

	it('refuses a value that cannot go in a link', () => {
		for (const bad of ['line\nbreak', 'del\u007f', 'half \ud800', 'half \udc00 too', 3]) {
			const result = utmLink('https://example.com/', {
				source: bad as string,
				medium: 'b',
				campaign: 'c',
			});
			expect(
				result.issues.map((found) => found.code),
				String(bad),
			).toEqual(['own-link.issue.utm-value']);
		}
		expect(utmLink('https://example.com/', { source: '😀', medium: 'b', campaign: 'c' }).url).toBe(
			'https://example.com/?utm_source=%F0%9F%98%80&utm_medium=b&utm_campaign=c',
		);
		expect(() => utmLink(3 as never, {} as never)).toThrow(TypeError);
		expect(() => utmLink('https://example.com/', null as never)).toThrow(TypeError);
	});
});
