// @bitgate/standalone — the headless engine and the Nostr codecs it consumes,
// as one bundleable entry.
//
// Bare specifiers (`@bitgate/core`) don't resolve in a browser, and the headless
// path needs two packages (the evaluator in core, the kind-1985 label codec in
// nostr). build.mjs esbuilds this entry into a single self-contained ESM file a
// no-build static site can vendor the way it would vendor any one dependency —
// the requirement the widget bundle already meets for the DOM path, met here for
// the headless path.
//
// Both re-exported packages are dependency-free (@bitgate/verify, the only
// package with third-party deps, is intentionally not pulled in), so the bundle
// carries no external code.
export * from "@bitgate/core";
export * from "@bitgate/nostr";
