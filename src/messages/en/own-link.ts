/**
 * English for every message key the own-link layer emits: the issues with a
 * redirect or a campaign link, and the note that goes with each platform's
 * rule, saying where it goes.
 */

export const OWN_LINK_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'own-link.issue.from':
		'Enter the full address on your own site that the code will hold, starting with https://.',
	'own-link.issue.from-query':
		'The address the code holds cannot have a ? or # part, because redirect rules match the path alone.',
	'own-link.issue.from-path':
		'Use only letters, digits, hyphens, dots, underscores and slashes in the path, so every platform matches it the same way.',
	'own-link.issue.to': 'Enter the full destination address, starting with https://.',
	'own-link.issue.to-insecure':
		'The destination does not use a secure connection. Use https:// if the site supports it.',
	'own-link.issue.status':
		'Choose 302 or 307 for a destination you may change, or 301 or 308 for one you will not.',
	'own-link.issue.permanent':
		'Browsers remember a permanent redirect, so if you change the destination later, people who scanned before may still go to the old one.',
	'own-link.issue.loop':
		'The destination is the same address as the code, so it would redirect to itself.',
	'own-link.issue.target': 'Choose from the listed hosting setups.',
	'own-link.issue.url': 'Enter the full address, starting with https://.',
	'own-link.issue.utm-required':
		'Fill in the source, medium and campaign. Analytics groups visits by all three.',
	'own-link.issue.utm-value': 'This contains a character that cannot go in a link.',
	'own-link.note.cloudflare-bulk':
		'Upload this to a Bulk Redirect List in the Cloudflare dashboard, then turn the list on with a Bulk Redirect Rule.',
	'own-link.note.cloudflare-rule':
		'Create a Redirect Rule with this expression and target in the Cloudflare dashboard, or send it to the Rulesets API.',
	'own-link.note.netlify':
		'Put this line in the _redirects file in the folder your site is published from.',
	'own-link.note.netlify-status':
		'Put this line in the _redirects file in the folder your site is published from. Netlify does not support 307 or 308, so the nearest status it does support is used.',
	'own-link.note.vercel':
		'Add this to the redirects in vercel.json at the root of your project, keeping any that are already there.',
	'own-link.note.apache':
		'Add this line to the .htaccess file in your site folder. The server has to allow FileInfo overrides.',
	'own-link.note.nginx': 'Add this block inside the server block for your site, then reload nginx.',
	'own-link.note.html':
		'Upload this page to your site at the path the code holds. Use it only where the host has no redirect settings, because search engines treat it as a page rather than a redirect.',
});
