# Changelog

Notable changes to this repository. The package version and the wire schema
version move independently: a breaking package release does not imply a new
event schema, and a new schema does not require a major package bump unless the
public API changes with it.

## [Unreleased]

### Added — `resolveNamedLists`: verify, then choose

- Reads every named list from whatever relays returned. Signatures are
  checked **before** choosing, then the newest passing copy per signer and `d`
  is kept.
- A tampered copy that keeps the genuine id and claims to be newer cannot
  push out the genuine list, and a replaced copy no longer counts. This came
  from a note by BitUnlock's session after building its shadow part.
- The named-list vectors gain a replaced `sellers` copy. The spec and
  `docs/shadow-comparison.md` state the rule.

### Changed — curation sets: copies dated in the future are left out

- `resolveCurationSet` now follows NSWP-08's rule (NSWP 7c71118):
  - a copy dated more than 600 s after the reader's `now` is left out before
    choosing, and named in `futureDated`;
  - a candidate needs exactly one `d` tag equal to the list's;
  - each id counts once.
- It takes `coordinate` as well as `{ pubkey, d }`, and results carry the
  chosen `id`.
- `vectors/nswp/lists.json` is re-copied at 7c71118, with its new `choosing`
  section, and re-pinned by hash. BitGate's own curation-set vectors gain a
  two-`d` case.

### Changed — the typecheck reads sources

- `npm run lint`, `check:types` and `typecheck` now use `tsconfig.check.json`
  and `packages/widget/tsconfig.check.json`. These map every `@bitgate/*`
  import to its source.
- Stale built types (`dist/types`) can no longer fail the typecheck before
  `npm run build:types` has run.
- `scripts/check-types-read-sources.mjs`, part of `check:types`, fails if
  either typecheck reads a built file. It plants decoys where none exist, so
  it is never vacuous.
- The declaration builds (`tsconfig.types.json`) are unchanged.

### Changed — named lists read listings by BitUnlock's rule

- Listing entries in `listings-allowed` and `listings-blocked` are read from
  their `a` tags with BitUnlock's own coordinate rule, exactly:
  `30078:<64 lowercase hex>:<name>`, the name 1 to 256 characters on one line,
  not starting with a colon.
- Names are not trimmed. The general coordinate reader trims, which would have
  made a name with a trailing space a different listing from BitUnlock's.
- Entries that don't fit are skipped and counted (`skipped`).
- New exports: `parseListingCoordinate`, `LISTING_COORDINATE`.
- The spec says that switching on `may-sell-listing-curated` is the owner's
  word.

### Added — a required signature check on the headless path

- **`readLabelContributions`, `readContributionLists`, `resolveVerifiedRoster`
  and `keepVerified`** (`@bitgate/nostr`). Each takes `verify` and throws
  without it; events that fail are dropped and counted.
- The application-wide headless path now fails closed, as the runtime and
  widget already did.
- The README's headless section and `examples/headless-quickstart.mjs` use
  them. The example now signs its labels with public test keys and shows a
  forged label being dropped.
- The structure-only codecs are unchanged.

### Added — the named-lists vocabulary

- **One curator, several lists:** `sellers`, `payees`, `listings-allowed`,
  `listings-blocked` and `people-blocked`, each under a namespace of its own,
  so they replace independently.
- **The decisions each list feeds:** `may-sell`, `may-be-paid`,
  `may-sell-listing` and `may-sell-listing-curated`, each answered on the
  transaction dimension, with blocked beating allowed.
- **The `list-curator` role** (`NAMED_LIST_ROLES`): list powers only.
- **API:** `readNamedList` (a signature check is required),
  `contributionsForDecision`, `namedListIdentifier` and `encodeNamedList`.
- **Vectors:** `vectors/governance-lists/named-lists.json` gives the events,
  their reading and every decision's answer.
- The names were given by the fleet's orchestrator on 2026-11-21.

### Added — curation sets (kind 30004, NSWP-08) as input

- **`parseCurationSet`, `readCurationSet`, `resolveCurationSet` and
  `curationSetToContribution`** (`@bitgate/nostr`). BitPortal's host allow
  list, its starter set and any NSWP-08 list of worlds become `address-allow`
  input as they are, without being re-published.
- The structure matches NSWP's own reader and is held to NSWP's vectors,
  copied unchanged (CC0) and pinned by hash in `vectors/nswp/`.
- Reading for governance requires a signature check. The current copy is
  chosen by the list's own key.
- BitGate's vectors: `vectors/governance-lists/curation-sets.json`.

### Changed — relicensed to MIT

BitGate is MIT from 2026-11-21; it was GPL-3.0-or-later. The change covers
`LICENSE`, a `license` field in every package, the built-file banners, the
README and the site footers. The owner decided it so that BitGate can be
vendored into the MIT projects it serves (BitLogin, BitPortal, the NSWP kit).
Provenance, and why the owner alone could relicense, is recorded in
[docs/license-and-provenance.md](docs/license-and-provenance.md).

### Changed — scoped lists, after the NSWP kit's review

- **Who may sign:** a reader may be given the subject's root (`root`), one
  key or a list of at most four. By default it is the subject's own key. A
  given root replaces the default, and the newest copy across the root's keys
  is the list. `scopedListAuthority(subject, root)` builds the matching
  authority, in which no root key can be blocked from its own subject.
- **Future-dated lists:** a copy dated more than 600 seconds ahead of the
  reader's clock (`now`) is dropped before choosing; it is not refused as the
  newest. So a fast clock can neither pin a list nor make it unreadable.
  `resolveScopedList` reports such copies in `futureDated`. Read on its own,
  such an event is refused (`from_the_future`).
- **Spec additions:** the subject's name is everything after the pubkey's
  colon; the `client` tag never matters; the NSWP conventions are written
  down (namespace `nswp`, writers stop at 500 entries, and an empty allow list
  means nobody but the owner).
- **Vectors:** 43 decode and 12 resolve cases, read at a fixed `now`.

### Added — scoped lists, and allow for worlds and listings

- **Scoped lists:** an allow or block list about one addressable thing, signed
  by that thing's own author.
  - The first use is a world's own guest list and block list, with no roster,
    curator or service.
  - Kind 30078, `d` = `<namespace>:governance:<user-allow|user-deny>:v1:<coordinate>`,
    with required `v`, `scope` and `subject` tags.
  - `decodeScopedList`, `resolveScopedList`, `encodeScopedList` and
    `scopedListToContribution` are in `@bitgate/nostr`. A signature check is
    required; there is no unverified mode.
  - Refusals carry stable reason codes, and an event with more than 2,000
    entries is refused whole.
  - Format: [docs/governance-lists.md](docs/governance-lists.md). Signed vectors
    are in `vectors/governance-lists/`, generated by
    `scripts/build-list-vectors.mjs` and checked by `npm test`.
- **`event-allow` and `address-allow`.**
  - An allowlist can now name worlds and listings, not only people. An event or
    address passes on its own entry or its author's, and a block still beats
    an allow.
  - The new capabilities are `contribute-event-allow` and
    `contribute-address-allow`, held by `super_admin`.
  - NIP-32 allow labels on `e` and `a` targets now map to them instead of
    being dropped.

### Changed — application-wide lists read more strictly

- A `scope` tag that disagrees with the `d` now refuses the document. It used
  to override the `d`, so two readers could disagree on allow versus deny.
- Entries are read only in lowercase hex. npub and uppercase forms inside an
  event are skipped; they remain accepted as typed input elsewhere.

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
