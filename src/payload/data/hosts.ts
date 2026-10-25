/**
 * Hosts whose job is to forward a visitor somewhere else.
 *
 * A link through one of these does not say where it ends up: whoever runs the
 * service decides that, at the moment of the scan, and can change it later.
 * That is a fact about how the link works and nothing more. The finding these
 * produce says exactly that, names the host, and makes no claim about any
 * operator's intentions or terms.
 *
 * Every entry cites the operator's own documentation for the host being
 * theirs and being used for redirects. An entry without one does not belong
 * here: this list is shown to people as a reason to look twice, so it has to
 * be checkable. Matching is on the host and its subdomains, because Short.io
 * and Google both serve redirects from subdomains of theirs (Short.io's
 * customer subdomains of s.gy, Google Maps' maps.app.goo.gl).
 *
 * Left out for want of an operator source naming the host, at the time of
 * writing (October 2026): lnkd.in, amzn.to, bl.ink, flowcode.com, flow.page,
 * me-qr.com, uqr.me, qrd.by and q-r.to. bitly.com is documented as still
 * forwarding its old short links, and is left out because it is also Bitly's
 * own website, so a match would mostly be wrong.
 *
 * The five Dub domains that resemble other companies' names (git.new,
 * chatg.pt, spti.fi, ggl.link, amzn.id) are Dub's, by Dub's own page. The
 * operator field says so, and nothing here says otherwise.
 */

export interface RedirectHost {
	readonly host: string;
	readonly operator: string;
	/** The operator's own page that shows the host is theirs. */
	readonly source: string;
}

/** General short-link services. */
export const SHORTENER_HOSTS: readonly RedirectHost[] = Object.freeze([
	{
		host: 'bit.ly',
		operator: 'Bitly',
		source:
			'https://support.bitly.com/hc/en-us/articles/4408507361165-How-do-I-change-my-default-domain-for-creating-links',
	},
	{
		host: 'j.mp',
		operator: 'Bitly',
		source:
			'https://support.bitly.com/hc/en-us/articles/4423884643725-What-happened-to-j-mp-and-bitly-com-short-links',
	},
	{ host: 'tinyurl.com', operator: 'TinyURL', source: 'https://tinyurl.com/app/faq' },
	{ host: 't.co', operator: 'X', source: 'https://help.x.com/en/using-x/url-shortener' },
	{
		host: 'goo.gl',
		operator: 'Google',
		source:
			'https://developers.googleblog.com/en/google-url-shortener-links-will-no-longer-be-available/',
	},
	{ host: 'ow.ly', operator: 'Hootsuite', source: 'https://hootsuite.com/pages/owly' },
	{
		host: 'buff.ly',
		operator: 'Buffer',
		source: 'https://support.buffer.com/articles/shortening-and-unshortening-links-dgev2p41yY',
	},
	{ host: 'is.gd', operator: 'is.gd', source: 'https://is.gd/terms.php' },
	{ host: 'v.gd', operator: 'v.gd', source: 'https://v.gd/' },
	{
		host: 'rebrand.ly',
		operator: 'Rebrandly',
		source:
			'https://support.rebrandly.com/en/articles/758665-why-can-t-i-use-rebrand-ly-in-more-than-one-workspace',
	},
	{ host: 'rb.gy', operator: 'Rebrandly', source: 'https://free-url-shortener.rb.gy/' },
	{ host: 'cutt.ly', operator: 'Cuttly', source: 'https://cutt.ly/' },
	{ host: 't.ly', operator: 'T.LY', source: 'https://t.ly/' },
	{ host: 'shorturl.at', operator: 'ShortURL', source: 'https://www.shorturl.at/' },
	{ host: 'tiny.cc', operator: 'Tinycc', source: 'https://tinycc.com/tiny/about' },
	{ host: 's.id', operator: 'S.id', source: 'https://home.s.id/' },
	{
		host: 'short.gy',
		operator: 'Short.io',
		source: 'https://blog.short.io/free-shortgy-shortener/',
	},
	{ host: 's.gy', operator: 'Short.io', source: 'https://blog.short.io/meet-sgy/' },
	{ host: 'dub.sh', operator: 'Dub', source: 'https://dub.co/help/article/default-dub-domains' },
	{ host: 'git.new', operator: 'Dub', source: 'https://dub.co/help/article/default-dub-domains' },
	{ host: 'chatg.pt', operator: 'Dub', source: 'https://dub.co/help/article/default-dub-domains' },
	{ host: 'spti.fi', operator: 'Dub', source: 'https://dub.co/help/article/default-dub-domains' },
	{ host: 'ggl.link', operator: 'Dub', source: 'https://dub.co/help/article/default-dub-domains' },
	{ host: 'amzn.id', operator: 'Dub', source: 'https://dub.co/help/article/default-dub-domains' },
]);

/** Domains QR code vendors put into "dynamic" codes so the destination can be changed after printing. */
export const DYNAMIC_QR_HOSTS: readonly RedirectHost[] = Object.freeze([
	{
		host: 'qrco.de',
		operator: 'QR Code Generator PRO',
		source:
			'https://support.qr-code-generator.com/hc/en-us/articles/7664232533133-Why-did-a-QR-Code-or-link-bring-me-to-the-Help-Center',
	},
	{
		host: 'l.ead.me',
		operator: 'QR Code Generator PRO',
		source:
			'https://support.qr-code-generator.com/hc/en-us/articles/7665667969677-How-do-I-edit-the-short-URL-on-Dynamic-Codes',
	},
	{ host: 'qrfy.io', operator: 'QRFY', source: 'https://qrfy.io/' },
	{
		host: 'qr1.be',
		operator: 'QR TIGER',
		source: 'https://www.qrcode-tiger.com/short-url-generator',
	},
	{
		host: 'scnv.io',
		operator: 'Scanova',
		source: 'https://support.scanova.io/hc/en-us/articles/38649069650201-Custom-Short-URL',
	},
	{
		host: 'qrcodes.pro',
		operator: 'Uniqode',
		source:
			'https://docs.uniqode.com/en/articles/6967207-why-does-uniqode-recommend-its-customers-use-custom-domains',
	},
	{
		host: 'qr.tapnscan.me',
		operator: 'Uniqode',
		source:
			'https://docs.uniqode.com/en/articles/6967207-why-does-uniqode-recommend-its-customers-use-custom-domains',
	},
	{
		host: 'linkpages.pro',
		operator: 'Uniqode',
		source:
			'https://docs.uniqode.com/en/articles/6967207-why-does-uniqode-recommend-its-customers-use-custom-domains',
	},
	{
		host: 'hov.to',
		operator: 'Hovercode',
		source: 'https://hovercode.com/tools/bulk-short-link-generator/',
	},
	{
		host: 'linko.page',
		operator: 'QRCodeChimp',
		source: 'https://www.qrcodechimp.com/guide-to-qr-code-white-labeling/',
	},
	{
		host: 'qrcc.me',
		operator: 'QRCodeChimp',
		source: 'https://www.qrcodechimp.com/guide-to-qr-code-white-labeling/',
	},
	{
		host: 'qrs.ly',
		operator: 'QRStuff',
		source: 'https://www.qrstuff.com/blog/qr-code-basics/dynamic-qr-codes/',
	},
	{
		host: 'qr.vc',
		operator: 'QR Planet',
		source: 'https://qrplanet.com/help/article/what-is-a-shortened-vanity-url-in-a-qr-code',
	},
]);
