# Changelog

Notable changes to this repository. The package version and the wire schema
version move independently: a breaking package release does not imply a new
event schema, and a new schema does not require a major package bump unless the
public API changes with it.

## [Unreleased]

### Changed — renamed to BitGate

`@nostr-governance/*` is now `@bitgate/*`, `governance-*` elements are
`bitgate-*`, and `createGovernanceRuntime` / `defineGovernanceElements` are
`createBitGate` / `defineBitGateElements`. Domain types keep their names: the
product is BitGate, the subject matter is still governance. See
[ADR 0005](docs/adr/0005-rename-to-bitgate.md).

The storage key prefix changed from `nostr-governance:` to `bitgate:`.

### Added — drop-in distribution

Adopting BitGate previously meant supplying a transport, authoring a policy,
and wiring every element in JavaScript. Three pieces close that gap, plus a
build step. See [ADR 0006](docs/adr/0006-drop-in-distribution.md).

- **`createRelayTransport(urls)`** — a small WebSocket transport with
  reconnection, backoff, subscription replay, and cross-relay deduplication.
- **Policy presets** — `social`, `commerce`, `admin-only`, addressable by name.
  The engine still carries no thresholds of its own.
- **`<bitgate-provider>`** — configuration in markup; descendants find the
  runtime through a bubbling context-request event rather than DOM walking,
  which would break across shadow boundaries. Targets can be read from
  attributes (`target-user`, `target-event`, `target-address`).
- **`npm run build:widget`** — a self-contained `dist/bitgate.js` via esbuild.
  Bare specifiers do not resolve in browsers, so the unbundled source worked
  everywhere except a plain static page. Not committed: build from source.

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
- **`@bitgate/widget`**: framework-agnostic custom elements. Viewer
  surfaces (`bitgate-veil`, `bitgate-report`, `bitgate-status`) and
  moderator surfaces (`bitgate-capabilities`, `bitgate-action`,
  `bitgate-admin-panel`), plus a runnable demo page. Elements render
  decisions and issue commands; they compute no policy.
- **Runtime wiring**: storage persistence and hydration, signature verification
  in the load path, trusted mute-list subscriptions, community source
  resolution, root-policy application, import/export, and capability queries.
- GPL-3.0-or-later `LICENSE`, `README`, and an integration guide.

### Fixed

- `GovernanceAdminStore` announced nothing when a roster change altered
  capabilities without changing any denial, leaving capability-gated UI and the
  decision cache stale.
- The relay transport sent every subscription twice on connect: queued REQ
  frames were flushed *and* subscriptions were replayed from the map.
- The commerce preset computed a visibility verdict at checkout, a surface that
  renders nothing, and could hide a listing from its own seller — leaving no
  route to appeal. Checkout now declares only transaction gates, and the seller
  dashboard caps visibility at a warning.
- `<bitgate-status>` threw if a runtime returned an unusable decision.
- `ReportStore.ingest` required a `target` field it never read.
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
- The performance fixture was intermittently failing. Its setup repeated the
  same 100 mute-list writes 50 times with identical data, making construction
  50x more expensive than the fixture it describes and pushing individual tests
  past their timeout under load. The fixture's shape is now asserted so it
  cannot silently degrade again.
- The performance suite's wall-clock assertion was replaced with structural
  ones. A timing budget measured the machine as much as the code — it varied
  roughly 20x between idle and loaded runs here — so it now asserts that state
  is materialized once per batch, which is the actual regression that made a
  5,000-target pass take ~47 seconds.
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
  `@bitgate/bitvid-compat` as one application's profile.
- `createAuthorityState` takes an options object and always grants the root
  every capability and protection.
- Evaluation takes a `GovernanceSnapshot` and a `ViewerState` rather than a
  flat state object, and reads an injected clock instead of wall time.
