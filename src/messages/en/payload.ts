/**
 * English for every message key the payload layer emits: type names and
 * descriptions, what a phone does with each type, field labels and hints,
 * option labels, issues and safety findings.
 *
 * Placeholders in braces are filled from an issue's or a finding's `params`,
 * and `tests/payload/messages.test.ts` checks every placeholder a sentence
 * uses is one its key is given. Action sentences say what happens without
 * saying anything about the content: "Joins a Wi-Fi network", never the
 * network's name.
 */

export const PAYLOAD_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	// Issues any field can have.
	'payload.issue.wrong-kind': 'This value is the wrong kind of thing for this field.',
	'payload.issue.required': 'This is required.',
	'payload.issue.too-long': 'This is {length} characters and the limit is {max}.',
	'payload.issue.too-many': 'There are {count} of these and the limit is {max}.',
	'payload.issue.line-break': 'This has to fit on one line.',
	'payload.issue.control-character':
		'This contains a control character at position {position}, which a reader would not show.',
	'payload.issue.unpaired-surrogate': 'This contains a broken character at position {position}.',
	'payload.issue.not-a-number': 'Enter a number.',
	'payload.issue.not-an-integer': 'Enter a whole number.',
	'payload.issue.below-min': 'This is below the minimum of {min}.',
	'payload.issue.above-max': 'This is above the maximum of {max}.',
	'payload.issue.invalid-option': 'Choose one of the options.',
	'payload.issue.invalid-url': 'This is not a complete web address. It should start with https://.',
	'payload.issue.url-scheme': 'Only web addresses starting with https:// or http:// work here.',
	'payload.issue.invalid-email': 'This is not an email address.',
	'payload.issue.invalid-tel':
		'Enter a phone number using digits, with + and the country code if it is international.',
	'payload.issue.invalid-date': 'Enter a real date.',
	'payload.issue.invalid-datetime': 'Enter a real date and time.',
	'payload.issue.invalid-iban': 'This is not an IBAN. It starts with two letters and two digits.',
	'payload.issue.iban-country': 'This IBAN starts with a country code that has no IBANs.',
	'payload.issue.iban-length':
		'This IBAN has {length} characters, and IBANs from this country have {expected}.',
	'payload.issue.iban-checksum':
		'This IBAN fails its check digits. A character is probably mistyped.',
	'payload.issue.invalid-bic': 'This is not a BIC. It is 8 or 11 letters and digits.',
	'payload.issue.amount-decimals': 'Use at most {max} decimal places.',
	'payload.issue.invalid-currency': 'Use a three-letter currency code.',
	'payload.issue.invalid-country': 'Use a two-letter country code.',
	'payload.issue.invalid-latitude': 'Latitude is between -90 and 90.',
	'payload.issue.invalid-longitude': 'Longitude is between -180 and 180.',
	'payload.issue.creditor-reference':
		'This creditor reference fails its check digits. It starts with RF and two digits.',

	// Safety findings, one per safety code.
	'payload.safety.scheme.dangerous':
		'This code runs a script or opens something on the device ({scheme}) instead of going to a website. Do not open it.',
	'payload.safety.scheme.unusual':
		'This link opens an app rather than a web page ({scheme}). Check that is what you expected.',
	'payload.safety.host.ip-literal':
		'This link goes to a numeric address, {host}, rather than to a named website.',
	'payload.safety.host.mixed-script':
		'The address {host} mixes letters from different alphabets, which is how look-alike addresses are made.',
	'payload.safety.host.punycode':
		'The address {host} is shown in its own letters as {unicodeHost}. Check it is the site you expect.',
	'payload.safety.host.lookalike':
		'The address {host} is written in letters that look like ordinary ones but come from another alphabet.',
	'payload.safety.url.userinfo':
		'This link is written to look like another address. It goes to {host}.',
	'payload.safety.host.shortener':
		'This link goes through a redirect service, {host}, and whoever runs it decides where it ends up.',
	'payload.safety.host.dynamic-qr':
		'This code goes through a QR code redirect service, {host}, and whoever runs it decides where it ends up.',
	'payload.safety.url.tracking-params':
		'This link carries tracking parameters ({count}) that record where you came from. The page is the same without them.',
	'payload.safety.url.insecure':
		'This link does not use a secure connection, so what you see or send could be read or changed on the way.',
	'payload.safety.url.very-long':
		'This link is {length} characters long, so the part you can see may not be the part that matters.',
	'payload.safety.payload.open-wifi':
		'This network has no password, so anyone nearby can join it and may see what you send over it.',
	'payload.safety.payload.payment':
		'This code starts a payment. Check who is being paid and how much before you confirm.',
	'payload.safety.payload.sends-message':
		'This code prepares a message. Nothing is sent until you choose to send it.',

	// Plain text.
	'payload.text.label': 'Text',
	'payload.text.description': 'Any text, shown as it is.',
	'payload.text.action': 'Shows some text.',
	'payload.text.field.text': 'Text',

	// Web link.
	'payload.url.label': 'Web link',
	'payload.url.description': 'A web address that opens in the browser.',
	'payload.url.action': 'Opens a web page.',
	'payload.url.field.url': 'Web address',
	'payload.url.hint.url': 'The full address, starting with https://.',
	'payload.url.field.utm-source': 'Campaign source',
	'payload.url.field.utm-medium': 'Campaign medium',
	'payload.url.field.utm-campaign': 'Campaign name',
	'payload.url.field.utm-term': 'Campaign term',
	'payload.url.field.utm-content': 'Campaign content',
	'payload.url.issue.utm-incomplete':
		'Analytics groups visits by source, medium and campaign together, so fill in all three.',

	// Email.
	'payload.email.label': 'Email',
	'payload.email.description': 'An email with the address, subject and message filled in.',
	'payload.email.action': 'Opens an email ready to send.',
	'payload.email.field.to': 'To',
	'payload.email.field.cc': 'Cc',
	'payload.email.field.bcc': 'Bcc',
	'payload.email.field.subject': 'Subject',
	'payload.email.field.body': 'Message',
	'payload.email.issue.no-recipient': 'Add at least one address to send to.',

	// Phone call.
	'payload.phone.label': 'Phone call',
	'payload.phone.description': 'A phone number to call.',
	'payload.phone.action': 'Offers to call a phone number.',
	'payload.phone.field.number': 'Phone number',
	'payload.phone.hint.number': 'Include + and the country code so it works from anywhere.',

	// Text message.
	'payload.sms.label': 'Text message',
	'payload.sms.description': 'A text message with the number and message filled in.',
	'payload.sms.action': 'Opens a text message ready to send.',
	'payload.sms.field.number': 'Phone number',
	'payload.sms.hint.number': 'Include + and the country code so it works from anywhere.',
	'payload.sms.field.message': 'Message',

	// WhatsApp.
	'payload.whatsapp.label': 'WhatsApp chat',
	'payload.whatsapp.description':
		'A WhatsApp chat with a number, with a message typed in if you like.',
	'payload.whatsapp.action': 'Opens a WhatsApp chat.',
	'payload.whatsapp.field.number': 'WhatsApp number',
	'payload.whatsapp.hint.number':
		'The full international number, starting with + and the country code.',
	'payload.whatsapp.field.message': 'Message',
	'payload.whatsapp.issue.international':
		'Start the number with + and the country code. WhatsApp links only work with the full number.',
	'payload.whatsapp.compat.app':
		'Opens in WhatsApp if it is installed, otherwise on the WhatsApp website.',

	// Telegram.
	'payload.telegram.label': 'Telegram chat',
	'payload.telegram.description': 'A Telegram chat with a username or a phone number.',
	'payload.telegram.action': 'Opens a Telegram chat.',
	'payload.telegram.field.target': 'Chat with',
	'payload.telegram.option.target.username': 'A username',
	'payload.telegram.option.target.phone': 'A phone number',
	'payload.telegram.field.username': 'Username',
	'payload.telegram.hint.username': 'Without the @.',
	'payload.telegram.field.phone': 'Phone number',
	'payload.telegram.hint.phone':
		'The full international number, starting with + and the country code.',
	'payload.telegram.field.message': 'Message',
	'payload.telegram.issue.international': 'Start the number with + and the country code.',
	'payload.telegram.issue.username':
		'A Telegram username is 5 to 32 letters, digits and underscores.',
	'payload.telegram.compat.app':
		'Opens in Telegram if it is installed, otherwise on the Telegram website.',

	// Signal.
	'payload.signal.label': 'Signal chat',
	'payload.signal.description': 'A Signal chat with a phone number.',
	'payload.signal.action': 'Opens a Signal chat.',
	'payload.signal.field.number': 'Signal number',
	'payload.signal.hint.number':
		'The full international number, starting with + and the country code.',
	'payload.signal.issue.international': 'Start the number with + and the country code.',
	'payload.signal.compat.app': 'Needs the Signal app to open the chat.',

	// FaceTime.
	'payload.facetime.label': 'FaceTime call',
	'payload.facetime.description': 'A FaceTime call to a phone number or an email address.',
	'payload.facetime.action': 'Offers to start a FaceTime call.',
	'payload.facetime.field.contact': 'Phone number or email',
	'payload.facetime.hint.contact': 'The number or email address the person uses for FaceTime.',
	'payload.facetime.field.audio-only': 'Audio only',
	'payload.facetime.issue.contact': 'Enter a phone number or an email address.',
	'payload.facetime.compat.apple-only': 'Only iPhone, iPad and Mac open FaceTime calls.',

	// Wi-Fi.
	'payload.wifi.label': 'Wi-Fi network',
	'payload.wifi.description':
		'The name and password of a Wi-Fi network, so a phone can join without typing them.',
	'payload.wifi.action': 'Joins a Wi-Fi network.',
	'payload.wifi.field.ssid': 'Network name',
	'payload.wifi.hint.ssid': 'Exactly as it appears in the list of networks, including capitals.',
	'payload.wifi.field.security': 'Security',
	'payload.wifi.hint.security':
		'Most home and office networks use WPA. Choose WPA3 only if the network accepts nothing else.',
	'payload.wifi.option.security.wpa': 'WPA2 or WPA3',
	'payload.wifi.option.security.sae': 'WPA3 only',
	'payload.wifi.option.security.wep': 'WEP (old)',
	'payload.wifi.option.security.nopass': 'No password',
	'payload.wifi.option.security.wpa2-eap': 'Enterprise (WPA2-EAP)',
	'payload.wifi.field.password': 'Password',
	'payload.wifi.field.hidden': 'Hidden network',
	'payload.wifi.hint.hidden': 'Tick this if the network does not appear in the list of networks.',
	'payload.wifi.field.eap-method': 'EAP method',
	'payload.wifi.option.eap-method.peap': 'PEAP',
	'payload.wifi.option.eap-method.tls': 'TLS',
	'payload.wifi.option.eap-method.ttls': 'TTLS',
	'payload.wifi.option.eap-method.pwd': 'PWD',
	'payload.wifi.option.eap-method.sim': 'SIM',
	'payload.wifi.option.eap-method.aka': 'AKA',
	'payload.wifi.option.eap-method.aka-prime': "AKA'",
	'payload.wifi.field.phase2': 'Phase 2 method',
	'payload.wifi.option.phase2.pap': 'PAP',
	'payload.wifi.option.phase2.mschap': 'MSCHAP',
	'payload.wifi.option.phase2.mschapv2': 'MSCHAPv2',
	'payload.wifi.option.phase2.gtc': 'GTC',
	'payload.wifi.option.phase2.sim': 'SIM',
	'payload.wifi.option.phase2.aka': 'AKA',
	'payload.wifi.option.phase2.aka-prime': "AKA'",
	'payload.wifi.field.identity': 'Identity',
	'payload.wifi.field.anonymous-identity': 'Anonymous identity',
	'payload.wifi.issue.ssid-too-long': 'This network name is {length} bytes and Wi-Fi allows {max}.',
	'payload.wifi.issue.password-required': 'Enter the password, or choose No password.',
	'payload.wifi.issue.wep-key': 'A WEP key is 5 or 13 characters, or 10 or 26 hexadecimal digits.',
	'payload.wifi.issue.wpa-ascii':
		'A WPA password uses only the letters, digits and symbols on an English keyboard.',
	'payload.wifi.issue.wpa-length':
		'This password is {length} characters. A WPA password is {min} to {max}.',
	'payload.wifi.issue.eap-ignored':
		'The enterprise settings are only used when Security is Enterprise.',
	'payload.wifi.issue.password-ignored': 'A network with no password ignores the password.',

	// vCard.
	'payload.vcard.label': 'Contact card',
	'payload.vcard.description':
		'A contact with name, numbers, email and address, saved to the address book in one step.',
	'payload.vcard.action': 'Offers to save a contact.',
	'payload.vcard.field.prefix': 'Title before the name',
	'payload.vcard.field.given-name': 'First name',
	'payload.vcard.field.additional-names': 'Middle names',
	'payload.vcard.field.family-name': 'Last name',
	'payload.vcard.field.suffix': 'Title after the name',
	'payload.vcard.field.formatted-name': 'Name as shown',
	'payload.vcard.hint.formatted-name': 'Leave this empty to use the name parts above.',
	'payload.vcard.field.organisation': 'Organisation',
	'payload.vcard.field.department': 'Department',
	'payload.vcard.field.title': 'Job title',
	'payload.vcard.field.mobile': 'Mobile',
	'payload.vcard.field.work-phone': 'Work phone',
	'payload.vcard.field.home-phone': 'Home phone',
	'payload.vcard.field.fax': 'Fax',
	'payload.vcard.field.other-phone': 'Other phone',
	'payload.vcard.field.email': 'Email',
	'payload.vcard.field.website': 'Website',
	'payload.vcard.field.street': 'Street address',
	'payload.vcard.field.locality': 'Suburb or city',
	'payload.vcard.field.region': 'State or region',
	'payload.vcard.field.postcode': 'Postcode',
	'payload.vcard.field.country': 'Country',
	'payload.vcard.field.address-type': 'Address type',
	'payload.vcard.option.address-type.work': 'Work',
	'payload.vcard.option.address-type.home': 'Home',
	'payload.vcard.field.note': 'Note',
	'payload.vcard.field.birthday': 'Birthday',
	'payload.vcard.issue.no-name': 'Add a name or an organisation.',

	// MECARD.
	'payload.mecard.label': 'Contact card (compact)',
	'payload.mecard.description':
		'A shorter contact card that makes a smaller code, with fewer details than a full one.',
	'payload.mecard.action': 'Offers to save a contact.',
	'payload.mecard.field.family-name': 'Last name',
	'payload.mecard.field.given-name': 'First name',
	'payload.mecard.field.nickname': 'Nickname',
	'payload.mecard.field.phones': 'Phone',
	'payload.mecard.field.email': 'Email',
	'payload.mecard.field.url': 'Website',
	'payload.mecard.field.address': 'Address',
	'payload.mecard.field.organisation': 'Organisation',
	'payload.mecard.hint.organisation': 'Some older readers ignore this.',
	'payload.mecard.field.note': 'Note',
	'payload.mecard.field.birthday': 'Birthday',
	'payload.mecard.issue.no-name': 'Add a first or last name.',
	'payload.mecard.compat.org':
		'The organisation is a later addition to this format and some older readers ignore it.',

	// Calendar event.
	'payload.event.label': 'Calendar event',
	'payload.event.description':
		'An event with its time and place, added to the calendar in one step.',
	'payload.event.action': 'Offers to add an event to the calendar.',
	'payload.event.field.summary': 'Event name',
	'payload.event.field.timing': 'Time',
	'payload.event.hint.timing':
		'A set time is the same moment everywhere. Local time is that time wherever the reader is.',
	'payload.event.option.timing.utc': 'At a set time',
	'payload.event.option.timing.floating': 'At a local time',
	'payload.event.option.timing.all-day': 'All day',
	'payload.event.field.start': 'Starts',
	'payload.event.field.end': 'Ends',
	'payload.event.field.start-date': 'First day',
	'payload.event.field.end-date': 'Last day',
	'payload.event.hint.end-date': 'Leave this empty for a one-day event.',
	'payload.event.field.location': 'Location',
	'payload.event.field.description': 'Description',
	'payload.event.field.url': 'Web address',
	'payload.event.issue.end-before-start': 'The end is before the start.',

	// Place.
	'payload.geo.label': 'Map location',
	'payload.geo.description': 'A point on the map, opened in the map app.',
	'payload.geo.action': 'Shows a place on a map.',
	'payload.geo.field.latitude': 'Latitude',
	'payload.geo.field.longitude': 'Longitude',
	'payload.geo.field.altitude': 'Altitude',
	'payload.geo.hint.altitude': 'In metres above sea level. Most map apps ignore it.',
	'payload.geo.field.uncertainty': 'Accuracy',
	'payload.geo.hint.uncertainty': 'How far off the point may be, in metres.',

	// Bitcoin.
	'payload.bitcoin.label': 'Bitcoin payment',
	'payload.bitcoin.description':
		'A request to pay a Bitcoin address, with the amount filled in if you like.',
	'payload.bitcoin.action': 'Opens a Bitcoin payment in a wallet.',
	'payload.bitcoin.field.address': 'Bitcoin address',
	'payload.bitcoin.hint.address':
		'Paste it from the wallet that will receive the payment rather than typing it.',
	'payload.bitcoin.field.amount': 'Amount (BTC)',
	'payload.bitcoin.field.label': 'Paid to',
	'payload.bitcoin.field.message': 'Message',
	'payload.bitcoin.issue.address': 'This is not a Bitcoin address.',
	'payload.bitcoin.issue.address-checksum':
		'This address fails its own check. A character is mistyped, and a payment to it would fail.',
	'payload.bitcoin.issue.testnet':
		'This is a test network address. Real bitcoin sent to it is lost.',

	// Lightning.
	'payload.lightning.label': 'Lightning invoice',
	'payload.lightning.description':
		'A Lightning invoice from a wallet, as a code that can be scanned to pay it.',
	'payload.lightning.action': 'Opens a Lightning payment in a wallet.',
	'payload.lightning.field.invoice': 'Invoice',
	'payload.lightning.hint.invoice':
		'Paste the invoice from the wallet that will be paid. It starts with lnbc.',
	'payload.lightning.issue.format': 'This is not a Lightning invoice.',
	'payload.lightning.issue.checksum':
		'This invoice fails its own check. It was copied incompletely or changed.',
	'payload.lightning.issue.prefix':
		'This invoice does not say which network it is for in a way wallets accept.',
	'payload.lightning.issue.amount':
		'The amount in this invoice is written in a way wallets refuse.',
	'payload.lightning.issue.testnet':
		'This invoice is for a test network. A real wallet cannot pay it.',

	// SEPA credit transfer.
	'payload.epc.label': 'SEPA transfer',
	'payload.epc.description':
		'A euro bank transfer with the account, amount and reference filled in, for banking apps in Europe.',
	'payload.epc.action': 'Opens a bank transfer in a banking app.',
	'payload.epc.field.name': 'Pay to',
	'payload.epc.field.iban': 'IBAN',
	'payload.epc.field.bic': 'BIC',
	'payload.epc.hint.bic': 'Needed only for banks outside the European Economic Area.',
	'payload.epc.field.amount': 'Amount (EUR)',
	'payload.epc.field.reference': 'Creditor reference',
	'payload.epc.hint.reference':
		'A structured reference, usually starting with RF. Use either this or a message.',
	'payload.epc.field.message': 'Message',
	'payload.epc.field.purpose': 'Purpose code',
	'payload.epc.hint.purpose': 'A four-letter ISO 20022 code, such as CHAR for a donation.',
	'payload.epc.field.information': 'Note for the payer',
	'payload.epc.hint.information': 'Shown to the person paying. It is not sent with the payment.',
	'payload.epc.field.version': 'Format version',
	'payload.epc.option.version.002': 'Version 2',
	'payload.epc.option.version.001': 'Version 1 (needs a BIC)',
	'payload.epc.issue.bic-required': 'Version 1 needs a BIC.',
	'payload.epc.issue.purpose': 'A purpose code is four capital letters or digits.',
	'payload.epc.issue.reference-and-message':
		'Use either a creditor reference or a message, not both.',
	'payload.epc.issue.reference-unchecked':
		'This reference does not start with RF, so its check digits cannot be checked here.',
	'payload.epc.issue.too-long':
		'This transfer is {length} bytes and the format allows {max}. Shorten the name or the message.',

	// Swiss QR-bill.
	'payload.swiss-qr-bill.label': 'Swiss QR-bill',
	'payload.swiss-qr-bill.description': 'The payment part of a Swiss QR-bill, in francs or euros.',
	'payload.swiss-qr-bill.action': 'Opens a bill payment in a Swiss banking app.',
	'payload.swiss-qr-bill.field.iban': 'Account (IBAN or QR-IBAN)',
	'payload.swiss-qr-bill.hint.iban':
		'A Swiss or Liechtenstein IBAN. A QR-IBAN needs a QR reference.',
	'payload.swiss-qr-bill.field.creditor-name': 'Payable to',
	'payload.swiss-qr-bill.field.creditor-street': 'Street',
	'payload.swiss-qr-bill.field.creditor-building': 'Building number',
	'payload.swiss-qr-bill.field.creditor-postcode': 'Postcode',
	'payload.swiss-qr-bill.field.creditor-town': 'Town',
	'payload.swiss-qr-bill.field.creditor-country': 'Country',
	'payload.swiss-qr-bill.field.creditor-address-type': 'Address format',
	'payload.swiss-qr-bill.hint.creditor-address-type':
		'Bills are made with separate address lines. Combined lines are only read from older bills.',
	'payload.swiss-qr-bill.option.creditor-address-type.s': 'Separate lines',
	'payload.swiss-qr-bill.option.creditor-address-type.k': 'Combined lines (old)',
	'payload.swiss-qr-bill.field.amount': 'Amount',
	'payload.swiss-qr-bill.field.currency': 'Currency',
	'payload.swiss-qr-bill.option.currency.chf': 'Swiss francs (CHF)',
	'payload.swiss-qr-bill.option.currency.eur': 'Euros (EUR)',
	'payload.swiss-qr-bill.field.debtor-name': 'Payable by',
	'payload.swiss-qr-bill.field.debtor-street': 'Street',
	'payload.swiss-qr-bill.field.debtor-building': 'Building number',
	'payload.swiss-qr-bill.field.debtor-postcode': 'Postcode',
	'payload.swiss-qr-bill.field.debtor-town': 'Town',
	'payload.swiss-qr-bill.field.debtor-country': 'Country',
	'payload.swiss-qr-bill.field.debtor-address-type': 'Address format',
	'payload.swiss-qr-bill.hint.debtor-address-type':
		'Bills are made with separate address lines. Combined lines are only read from older bills.',
	'payload.swiss-qr-bill.option.debtor-address-type.s': 'Separate lines',
	'payload.swiss-qr-bill.option.debtor-address-type.k': 'Combined lines (old)',
	'payload.swiss-qr-bill.field.reference-type': 'Reference',
	'payload.swiss-qr-bill.hint.reference-type':
		'A QR-IBAN takes a QR reference. Any other IBAN takes a creditor reference or none.',
	'payload.swiss-qr-bill.option.reference-type.qrr': 'QR reference',
	'payload.swiss-qr-bill.option.reference-type.scor': 'Creditor reference (RF)',
	'payload.swiss-qr-bill.option.reference-type.non': 'No reference',
	'payload.swiss-qr-bill.field.reference': 'Reference number',
	'payload.swiss-qr-bill.field.message': 'Additional information',
	'payload.swiss-qr-bill.field.billing-information': 'Billing information',
	'payload.swiss-qr-bill.field.alternative1': 'Alternative procedure 1',
	'payload.swiss-qr-bill.field.alternative2': 'Alternative procedure 2',
	'payload.swiss-qr-bill.issue.iban-country':
		'A QR-bill account is a Swiss (CH) or Liechtenstein (LI) IBAN.',
	'payload.swiss-qr-bill.issue.combined-address':
		'This bill uses combined address lines, which QR-bills stopped accepting in November 2025. Split the address into its lines before making the bill again.',
	'payload.swiss-qr-bill.issue.qrr-needs-qr-iban': 'A QR reference needs a QR-IBAN.',
	'payload.swiss-qr-bill.issue.qr-iban-needs-qrr': 'A QR-IBAN needs a QR reference.',
	'payload.swiss-qr-bill.issue.qrr-chf-only': 'A QR reference is only for bills in Swiss francs.',
	'payload.swiss-qr-bill.issue.qr-reference':
		'A QR reference is 27 digits and this one fails its check digit.',
	'payload.swiss-qr-bill.issue.reference-not-allowed':
		'Choose a reference type before entering a reference.',
	'payload.swiss-qr-bill.issue.message-too-long':
		'The additional and billing information together are {length} characters, and a bill allows {max}.',
	'payload.swiss-qr-bill.issue.character':
		'This contains a character QR-bills do not allow, at position {position}.',
	'payload.swiss-qr-bill.issue.too-long':
		'This bill is {length} characters and a QR-bill allows {max}.',

	// Pix.
	'payload.pix.label': 'Pix payment',
	'payload.pix.description': 'A Pix payment to a Pix key, for banking apps in Brazil.',
	'payload.pix.action': 'Opens a Pix payment in a banking app.',
	'payload.pix.field.key': 'Pix key',
	'payload.pix.hint.key': 'A CPF, CNPJ, email address, phone number with +55, or random key.',
	'payload.pix.field.name': 'Receiver name',
	'payload.pix.field.city': 'City',
	'payload.pix.field.amount': 'Amount (BRL)',
	'payload.pix.field.description': 'Message',
	'payload.pix.field.txid': 'Transaction ID',
	'payload.pix.hint.txid': 'Letters and digits only. Leave it empty if you do not use one.',
	'payload.pix.issue.key': 'This is not a Pix key.',
	'payload.pix.issue.account-too-long':
		'The key and the message together take {length} characters and Pix allows {max}.',
	'payload.pix.issue.txid': 'A transaction ID is up to 25 letters and digits.',
	'payload.pix.issue.non-ascii':
		'Some banking apps show accented letters incorrectly. Consider writing this without them.',
	'payload.pix.compat.banking-apps': 'Opens in the banking apps of Brazilian banks that offer Pix.',

	// UPI.
	'payload.upi.label': 'UPI payment',
	'payload.upi.description': 'A UPI payment to a payment address, for payment apps in India.',
	'payload.upi.action': 'Opens a UPI payment in a payment app.',
	'payload.upi.field.address': 'UPI ID',
	'payload.upi.hint.address': 'The payment address, such as name@bank.',
	'payload.upi.field.name': 'Payee name',
	'payload.upi.field.amount': 'Amount (INR)',
	'payload.upi.field.note': 'Note',
	'payload.upi.issue.address': 'This is not a UPI ID. It looks like name@bank.',

	// GS1 Digital Link.
	'payload.gs1-digital-link.label': 'Product link (GS1)',
	'payload.gs1-digital-link.description':
		'A product code that tills read as the barcode and phones open as a web page.',
	'payload.gs1-digital-link.action': 'Opens a product page.',
	'payload.gs1-digital-link.field.domain': 'Web domain',
	'payload.gs1-digital-link.hint.domain': 'Your own domain, or id.gs1.org if you do not have one.',
	'payload.gs1-digital-link.field.gtin': 'GTIN',
	'payload.gs1-digital-link.hint.gtin':
		'The number under the product barcode: 8, 12, 13 or 14 digits.',
	'payload.gs1-digital-link.field.batch': 'Batch or lot',
	'payload.gs1-digital-link.field.serial': 'Serial number',
	'payload.gs1-digital-link.field.expiry': 'Expiry date',
	'payload.gs1-digital-link.hint.expiry': 'As YYMMDD. A day of 00 means the end of the month.',
	'payload.gs1-digital-link.field.best-before': 'Best before',
	'payload.gs1-digital-link.hint.best-before': 'As YYMMDD. A day of 00 means the end of the month.',
	'payload.gs1-digital-link.issue.domain': 'This is not a web domain.',
	'payload.gs1-digital-link.issue.gtin': 'A GTIN is 8, 12, 13 or 14 digits.',
	'payload.gs1-digital-link.issue.gtin-check-digit':
		'This GTIN fails its check digit. A digit is probably mistyped.',
	'payload.gs1-digital-link.issue.character': 'This contains a character GS1 codes do not allow.',
	'payload.gs1-digital-link.issue.date': 'Enter the date as YYMMDD.',

	// Saudi e-invoice.
	'payload.zatca.label': 'Saudi e-invoice',
	'payload.zatca.description': 'The code on a Saudi tax invoice. It can be read here but not made.',
	'payload.zatca.action': 'Shows the details of a tax invoice.',
	'payload.zatca.field.seller-name': 'Seller',
	'payload.zatca.field.vat-number': 'VAT number',
	'payload.zatca.field.timestamp': 'Issued',
	'payload.zatca.field.total': 'Total with VAT',
	'payload.zatca.field.vat-total': 'VAT',
	'payload.zatca.field.has-invoice-hash': 'Invoice hash',
	'payload.zatca.field.has-signature': 'Signature',
	'payload.zatca.field.has-public-key': 'Public key',
	'payload.zatca.field.has-stamp-signature': 'Stamp signature',
	'payload.zatca.issue.vat-number': 'A Saudi VAT number is 15 digits that start and end with 3.',
	'payload.zatca.issue.timestamp': 'The issue time is not written as a date and time.',
	'payload.zatca.issue.amount': 'This amount is not written as a number.',
	'payload.zatca.issue.phase-one':
		'This code has no signature parts. Invoices have needed them since 1 January 2023, so it may be old or incomplete.',
});
