/**
 * The specification vectors for the UPI payment content type,
 * ../content/upi.ts. Test data: see ./built-in.ts for why it lives here rather
 * than on the type.
 */

import type { UpiValue } from '../content/upi.js';
import type { PayloadVector } from '../types.js';

const NPCI = 'NPCI, UPI Linking Specifications version 1.6, section 3 (URL specification)';

export const upiVectors: readonly PayloadVector<UpiValue>[] = [
	{
		text: 'upi://pay?pa=example@upi&pn=Example%20Shop&am=10.00&cu=INR&tn=Order%201',
		value: { address: 'example@upi', name: 'Example Shop', amount: 10, note: 'Order 1' },
		source: `${NPCI}: pa, pn, am, cu and tn, spaces as %20; synthetic payee.`,
	},
];
