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

### Changed

- The evaluator no longer carries application thresholds. The previous invented
  defaults (5/3/10/5) are gone; applications supply category thresholds through
  a policy definition. The characterized reference values live in
  `@nostr-governance/bitvid-compat` as one application's profile.
- `createAuthorityState` takes an options object and always grants the root
  every capability and protection.
- Evaluation takes a `GovernanceSnapshot` and a `ViewerState` rather than a
  flat state object, and reads an injected clock instead of wall time.
