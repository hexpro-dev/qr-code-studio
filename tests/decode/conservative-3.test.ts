/**
 * Conservativeness, shard 3 of 4: see conservative.ts. Split so the four run
 * in parallel, and each into chunks so no one test holds its worker for long.
 */

import { describe } from 'vitest';
import { describeShard } from './conservative.js';

describe('strict-v1 against zxing-cpp and jsQR, shard 3', () => {
	describeShard(3);
});
