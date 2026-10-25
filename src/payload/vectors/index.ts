/**
 * `./payload/vectors`: the evidence behind the built-in content types, for
 * test suites and audits. Nothing here is needed to make or read a code, and
 * nothing on the runtime path imports it, so a bundler leaves all of it out
 * of a page that only uses `./payload`.
 */

export { BUILT_IN_VECTORS } from './built-in.js';
export { REDIRECT_HOST_SOURCES } from './hosts.js';
export type { PayloadVector } from '../types.js';
