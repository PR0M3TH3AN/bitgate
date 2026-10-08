/**
 * BitGate library version.
 *
 * Keep this string in lockstep with the root and `@bitgate/core` `package.json`
 * versions. `packages/core/test/version.test.js` asserts they match. Browser
 * bundles replace this module at build time with the same value read from
 * `package.json`, so the shipped file cannot drift.
 */
export const VERSION = "0.1.0";
