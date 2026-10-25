/**
 * The operator's own page for each redirect host in ../data/hosts.ts, showing
 * the host is theirs and is used to forward visitors.
 *
 * The host table is shown to people as a reason to look twice at a link, so
 * every entry in it has to be checkable, and the url-safety suite fails on a
 * host with no page here or a page here for a host that has gone. Matching
 * needs only the host, so the pages are kept here, off the runtime path,
 * rather than in the table every bundle that analyses a link carries.
 */

export const REDIRECT_HOST_SOURCES: Readonly<Record<string, string>> = Object.freeze({
	'bit.ly':
		'https://support.bitly.com/hc/en-us/articles/4408507361165-How-do-I-change-my-default-domain-for-creating-links',
	'j.mp':
		'https://support.bitly.com/hc/en-us/articles/4423884643725-What-happened-to-j-mp-and-bitly-com-short-links',
	'tinyurl.com': 'https://tinyurl.com/app/faq',
	't.co': 'https://help.x.com/en/using-x/url-shortener',
	'goo.gl':
		'https://developers.googleblog.com/en/google-url-shortener-links-will-no-longer-be-available/',
	'ow.ly': 'https://hootsuite.com/pages/owly',
	'buff.ly': 'https://support.buffer.com/articles/shortening-and-unshortening-links-dgev2p41yY',
	'is.gd': 'https://is.gd/terms.php',
	'v.gd': 'https://v.gd/',
	'rebrand.ly':
		'https://support.rebrandly.com/en/articles/758665-why-can-t-i-use-rebrand-ly-in-more-than-one-workspace',
	'rb.gy': 'https://free-url-shortener.rb.gy/',
	'cutt.ly': 'https://cutt.ly/',
	't.ly': 'https://t.ly/',
	'shorturl.at': 'https://www.shorturl.at/',
	'tiny.cc': 'https://tinycc.com/tiny/about',
	's.id': 'https://home.s.id/',
	'short.gy': 'https://blog.short.io/free-shortgy-shortener/',
	's.gy': 'https://blog.short.io/meet-sgy/',
	'dub.sh': 'https://dub.co/help/article/default-dub-domains',
	'git.new': 'https://dub.co/help/article/default-dub-domains',
	'chatg.pt': 'https://dub.co/help/article/default-dub-domains',
	'spti.fi': 'https://dub.co/help/article/default-dub-domains',
	'ggl.link': 'https://dub.co/help/article/default-dub-domains',
	'amzn.id': 'https://dub.co/help/article/default-dub-domains',
	'qrco.de':
		'https://support.qr-code-generator.com/hc/en-us/articles/7664232533133-Why-did-a-QR-Code-or-link-bring-me-to-the-Help-Center',
	'l.ead.me':
		'https://support.qr-code-generator.com/hc/en-us/articles/7665667969677-How-do-I-edit-the-short-URL-on-Dynamic-Codes',
	'qrfy.io': 'https://qrfy.io/',
	'qr1.be': 'https://www.qrcode-tiger.com/short-url-generator',
	'scnv.io': 'https://support.scanova.io/hc/en-us/articles/38649069650201-Custom-Short-URL',
	'qrcodes.pro':
		'https://docs.uniqode.com/en/articles/6967207-why-does-uniqode-recommend-its-customers-use-custom-domains',
	'qr.tapnscan.me':
		'https://docs.uniqode.com/en/articles/6967207-why-does-uniqode-recommend-its-customers-use-custom-domains',
	'linkpages.pro':
		'https://docs.uniqode.com/en/articles/6967207-why-does-uniqode-recommend-its-customers-use-custom-domains',
	'hov.to': 'https://hovercode.com/tools/bulk-short-link-generator/',
	'linko.page': 'https://www.qrcodechimp.com/guide-to-qr-code-white-labeling/',
	'qrcc.me': 'https://www.qrcodechimp.com/guide-to-qr-code-white-labeling/',
	'qrs.ly': 'https://www.qrstuff.com/blog/qr-code-basics/dynamic-qr-codes/',
	'qr.vc': 'https://qrplanet.com/help/article/what-is-a-shortened-vanity-url-in-a-qr-code',
});
