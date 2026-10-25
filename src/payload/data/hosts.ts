/**
 * Hosts whose job is to forward a visitor somewhere else.
 *
 * A link through one of these does not say where it ends up: whoever runs the
 * service decides that, at the moment of the scan, and can change it later.
 * That is a fact about how the link works and nothing more. The finding these
 * produce says exactly that, names the host, and makes no claim about any
 * operator's intentions or terms.
 *
 * Every entry is cited by the operator's own documentation for the host being
 * theirs and being used for redirects. An entry without one does not belong
 * here: this list is shown to people as a reason to look twice, so it has to
 * be checkable. The citations are `REDIRECT_HOST_SOURCES` in
 * ../vectors/hosts.ts, and the url-safety suite fails on a host without one.
 * They are kept there rather than beside each host because matching needs
 * only the host, and carried here they put three dozen addresses into every
 * bundle that analyses a link. Matching is on the host and its subdomains,
 * because Short.io and Google both serve redirects from subdomains of theirs
 * (Short.io's customer subdomains of s.gy, Google Maps' maps.app.goo.gl).
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
}

/** General short-link services. */
export const SHORTENER_HOSTS: readonly RedirectHost[] = Object.freeze([
	{ host: 'bit.ly', operator: 'Bitly' },
	{ host: 'j.mp', operator: 'Bitly' },
	{ host: 'tinyurl.com', operator: 'TinyURL' },
	{ host: 't.co', operator: 'X' },
	{ host: 'goo.gl', operator: 'Google' },
	{ host: 'ow.ly', operator: 'Hootsuite' },
	{ host: 'buff.ly', operator: 'Buffer' },
	{ host: 'is.gd', operator: 'is.gd' },
	{ host: 'v.gd', operator: 'v.gd' },
	{ host: 'rebrand.ly', operator: 'Rebrandly' },
	{ host: 'rb.gy', operator: 'Rebrandly' },
	{ host: 'cutt.ly', operator: 'Cuttly' },
	{ host: 't.ly', operator: 'T.LY' },
	{ host: 'shorturl.at', operator: 'ShortURL' },
	{ host: 'tiny.cc', operator: 'Tinycc' },
	{ host: 's.id', operator: 'S.id' },
	{ host: 'short.gy', operator: 'Short.io' },
	{ host: 's.gy', operator: 'Short.io' },
	{ host: 'dub.sh', operator: 'Dub' },
	{ host: 'git.new', operator: 'Dub' },
	{ host: 'chatg.pt', operator: 'Dub' },
	{ host: 'spti.fi', operator: 'Dub' },
	{ host: 'ggl.link', operator: 'Dub' },
	{ host: 'amzn.id', operator: 'Dub' },
]);

/** Domains QR code vendors put into "dynamic" codes so the destination can be changed after printing. */
export const DYNAMIC_QR_HOSTS: readonly RedirectHost[] = Object.freeze([
	{ host: 'qrco.de', operator: 'QR Code Generator PRO' },
	{ host: 'l.ead.me', operator: 'QR Code Generator PRO' },
	{ host: 'qrfy.io', operator: 'QRFY' },
	{ host: 'qr1.be', operator: 'QR TIGER' },
	{ host: 'scnv.io', operator: 'Scanova' },
	{ host: 'qrcodes.pro', operator: 'Uniqode' },
	{ host: 'qr.tapnscan.me', operator: 'Uniqode' },
	{ host: 'linkpages.pro', operator: 'Uniqode' },
	{ host: 'hov.to', operator: 'Hovercode' },
	{ host: 'linko.page', operator: 'QRCodeChimp' },
	{ host: 'qrcc.me', operator: 'QRCodeChimp' },
	{ host: 'qrs.ly', operator: 'QRStuff' },
	{ host: 'qr.vc', operator: 'QR Planet' },
]);
