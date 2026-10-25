/**
 * The specification vectors for the Bitcoin payment request content type,
 * ../content/bitcoin.ts. Test data: see ./built-in.ts for why it lives here
 * rather than on the type.
 *
 * BIP 21's example address and BIP 321's examples fail their own checksums,
 * so those vectors are held to reading only, and the conformance suite
 * expects validation to report the checksum (see ../content/bitcoin.ts).
 */

import type { BitcoinValue } from '../content/bitcoin.js';
import type { PayloadVector } from '../types.js';

const BIP21 = 'https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki';

export const bitcoinVectors: readonly PayloadVector<BitcoinValue>[] = [
	{
		text: 'bitcoin:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4?amount=0.001',
		value: {
			address: 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
			amount: 0.001,
			label: '',
			message: '',
		},
		source:
			'BIP 173 test vectors, the first valid segwit address, in a BIP 21 link with an amount. https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki',
	},
	{
		text: 'BITCOIN:BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ?BC=BC1P5SWKUGEZN97763TL0YTY6556856UUG0Q6JFLLJVEP9M4P7339X5QZYRH4Q',
		value: {
			address: 'BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ',
			amount: null,
			label: '',
			message: '',
		},
		source:
			'BIP 321, the upper-case example; its bc= parameter is not one this type reads. https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki',
	},
	{
		text: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
		value: {
			address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
			amount: null,
			label: '',
			message: '',
		},
		source: `BIP 21, Examples, "Just the address". ${BIP21}`,
	},
	{
		text: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?label=Luke-Jr',
		value: {
			address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
			amount: null,
			label: 'Luke-Jr',
			message: '',
		},
		source: `BIP 21, Examples, "Address with name". ${BIP21}`,
	},
	{
		text: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=20.3&label=Luke-Jr',
		value: {
			address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
			amount: 20.3,
			label: 'Luke-Jr',
			message: '',
		},
		source: `BIP 21, Examples, "Request 20.30 BTC to Luke-Jr". ${BIP21}`,
	},
	{
		text: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz',
		value: {
			address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
			amount: 50,
			label: 'Luke-Jr',
			message: 'Donation for project xyz',
		},
		source: `BIP 21, Examples, "Request 50 BTC with message". ${BIP21}`,
	},
	{
		text: 'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?somethingyoudontunderstand=50&somethingelseyoudontget=999',
		value: {
			address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
			amount: null,
			label: '',
			message: '',
		},
		source: `BIP 21, Examples: parameters not understood and not required are ignored. ${BIP21}`,
	},
];
