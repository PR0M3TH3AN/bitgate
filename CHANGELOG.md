# Changelog

Notable changes to this repository. The package version and the wire schema
version move independently: a breaking package release does not imply a new
event schema, and a new schema does not require a major package bump unless the
public API changes with it.

## [Unreleased]

### Added

- **Core decision model.** Four independent dimensions (`ranking`, `visibility`,
  `interaction`, `transaction`) with severity ladders and commutative
  max-merge composition.
- **Stable reason identifiers** (`REASON_IDS`) as part of the public contract.
  Renaming or removing one is a breaking change.
- **Structured evidence**, redacted by default and merged across an object's
  targets, so a multi-target object explains itself with everything that
  contributed.
- **Administrative-state reduction** with capability filtering at merge time,
  community-source marking, and protected-actor stripping.
- **Snapshot fingerprints** for cache invalidation and mismatch records.
- **Application adapter contract** (`createApplicationAdapter`,
  `evaluateObject`, `collectTargets`).
- **Codecs**: canonical v1 on `kind:30078`, NIP-56 reports, NIP-51 mute lists,
  legacy administrative lists, bech32/NIP-19, replaceable selection with a
  deterministic same-timestamp tiebreak, injected signature verification.
- **Runtime**: six stores, transport orchestration, chunked report
  subscriptions, viewer lifecycle, diagnostics, idempotent teardown.
- **Commands** with local capability checks, protected-target refusal, partial
  relay acceptance, and stable error codes.
- **Characterization corpus**: 34 generated fixtures covering the behaviors the
  migration plan's Phase 0 requires, plus a conformance suite that evaluates
  them.
- **Commerce proof-of-fit** (`examples/commerce`) demonstrating the engine
  outside a video application using only the public API.
- **Decision caching** keyed by (profile, target) with targeted invalidation:
  report and mute changes invalidate only the targets they touch, while
  administrative, trust, policy, and viewer changes drop the whole cache.
  Cached decisions are deeply frozen so a consumer cannot corrupt later reads.
- **Performance fixture** (`tests/performance/`) over 5,000 targets, 500
  authors, and 100 trusted muters per author, asserting no network access,
  bounded subscription counts, and targeted invalidation.
- **Security requirements suite** (`tests/security/`) covering the enumerated
  requirements testable at this layer.
- **`@nostr-governance/widget`**: framework-agnostic custom elements. Viewer
  surfaces (`governance-veil`, `governance-report`, `governance-status`) and
  moderator surfaces (`governance-capabilities`, `governance-action`,
  `governance-admin-panel`), plus a runnable demo page. Elements render
  decisions and issue commands; they compute no policy.
- **Runtime wiring**: storage persistence and hydration, signature verification
  in the load path, trusted mute-list subscriptions, community source
  resolution, root-policy application, import/export, and capability queries.
- GPL-3.0-or-later `LICENSE`, `README`, and an integration guide.

### Fixed

- Per-package `types` fields pointed at paths the build never produced, so
  consumers received no type declarations at all. Declarations now emit per
  package and resolve.
- `reduceAdminState` accepted malformed target identifiers, because
  `getTargetKey` formats anything it is given.
- `community-user-deny` fired for any contributor rather than only for
  community-curated sources, making a direct moderator action indistinguishable
  from a federated one.
- `composeDecisions` kept only the first decision's evidence, so an object
  governed by several targets lost the evidence that drove its verdict.
- `OverrideStore.clear()` shadowed the inherited listener `clear()`, leaking
  subscribers on teardown. Now `clearOverrides()`.
- `GovernanceAdminStore` emitted only when reduced denial state changed, so
  revoking a role that happened to deny nobody announced nothing — leaving
  capability-gated UI and the decision cache stale. It now also emits on
  authority changes.
- `ReportStore.ingest` required a `target` field it never read, since the
  target is identified by the key argument.
- Evaluation was quadratic in state size: both the snapshot and its fingerprint
  were rebuilt for every target, so each call walked every report and mute
  list. A 5,000-target pass took ~47s. The runtime now memoizes the snapshot
  and its fingerprint until a store changes, and `evaluateMany` computes the
  fingerprint once for the batch. The same pass now takes ~85ms cold and ~6ms
  warm.

- `npm audit` reported 5 vulnerabilities (1 critical, 2 high, 2 moderate), all
  from `vitest@1.6.1`'s dependency tree (`vite` → `esbuild`, `postcss` →
  `nanoid`). Dev-only and never shipped, since packages publish `src` and
  `dist` alone. Upgrading to `vitest@3` clears all five with no test changes.

### Changed

- The evaluator no longer carries application thresholds. The previous invented
  defaults (5/3/10/5) are gone; applications supply category thresholds through
  a policy definition. The characterized reference values live in
  `@nostr-governance/bitvid-compat` as one application's profile.
- `createAuthorityState` takes an options object and always grants the root
  every capability and protection.
- Evaluation takes a `GovernanceSnapshot` and a `ViewerState` rather than a
  flat state object, and reads an injected clock instead of wall time.
