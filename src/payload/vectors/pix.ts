/**
 * The specification vectors for the Pix payment content type,
 * ../content/pix.ts. Test data: see ./built-in.ts for why it lives here rather
 * than on the type.
 */

import type { PixValue } from '../content/pix.js';
import type { PayloadVector } from '../types.js';

const MANUAL =
	'https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf';

export const pixVectors: readonly PayloadVector<PixValue>[] = [
	{
		text: '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
		value: {
			key: '123e4567-e12b-12d1-a456-426655440000',
			name: 'Fulano de Tal',
			city: 'BRASILIA',
			amount: null,
			description: '',
			txid: '',
		},
		source: `BCB, Manual de Padroes para Iniciacao do Pix v2.10.0, the static BR Code example. ${MANUAL}`,
	},
];
