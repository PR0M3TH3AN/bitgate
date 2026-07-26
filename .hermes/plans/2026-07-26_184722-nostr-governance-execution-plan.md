# Nostr Governance Execution Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a headless `nostr-governance` SDK that reproduces BitVid governance behavior from fixtures first, then proves it can model BitRoad targets, without modifying the BitVid or BitRoad repositories during extraction.

**Architecture:** Keep BitVid and BitRoad as read-only reference repos. Build a new repo that owns four layers: pure core, Nostr codecs, runtime stores, and thin consumer adapters. The first meaningful milestone is **not** a full runtime or UI; it is a fixture-driven vertical slice that turns existing BitVid moderation inputs into stable `GovernanceDecision` outputs.

**Tech Stack:** Node 22, npm workspaces, ESM JavaScript, strict JSDoc, TypeScript compiler for type-checking and `.d.ts` emit, Vitest, GitHub Actions.

---

## 1. What is strong vs weak in the current master plan

### Strong
- Correctly separates headless governance from consumer UI.
- Correctly treats **user**, **event**, and **address** as first-class targets.
- Correctly insists on one canonical evaluator.
- Correctly identifies BitVid as the parity source and BitRoad as the address-target validation consumer.
- Correctly preserves batched subscriptions and cached fallback behavior.

### Weak
- It is too wide for a first build.
- It mixes **must-have parity work** with **later platform work**.
- It risks starting with runtime plumbing before the pure evaluator is proven.
- It leaves open a common failure mode: porting BitVid UI-shaped logic into the SDK.

### Recommendation
Start narrower.

**Do not begin with runtime stores, live relay integration, admin write commands, or consumer-repo integration.**

Start with this vertical slice:

```text
BitVid fixture events/state
        ↓
BitVid legacy codec
        ↓
normalized governance snapshot
        ↓
pure evaluator
        ↓
GovernanceDecision
        ↓
BitVid decision adapter
```

If this slice does not achieve parity, the rest of the repository will just harden the wrong behavior.

---

## 2. Hard guardrails for this project

1. **No changes in `bitvid` during extraction.**
2. **No changes in `bitroad` during extraction.**
3. **No shared source imports from either repo.**
4. **Reference repos are read-only inputs for behavior, fixtures, and provenance only.**
5. **No UI code in the SDK.**
6. **No browser globals in `packages/core`.**
7. **No second evaluator in adapters, HTTP wrappers, or example apps.**
8. **No consumer integration PR until internal conformance passes in this repo.**

### Licensing pushback
This part matters.

BitVid is GPL-3.0-or-later. If this repo directly ports logic or structure from BitVid, the safe assumption is that `nostr-governance` must remain GPL-compatible unless you do a true clean-room rewrite.

**Do not ignore this now.** Decide the license model in the first repo-bootstrap PR.

---

## 3. Read-only reference map

### BitVid source files to treat as behavioral references
- `js/services/moderationService.js`
- `js/services/moderationUtils.js`
- `js/accessControl.js`
- `js/adminListStore.js`
- `js/adminListBatch.js`
- `js/adminEventBlacklistHelpers.js`
- `js/services/trustBootstrap.js`
- `js/services/moderationDecorator.js`
- `js/app/moderationCoordinator.js`

### BitRoad source files to treat as target-model references
- `src/commerce/address.mjs`
- `src/commerce/storefronts.mjs`
- `src/commerce/product.mjs`

### Key extracted behaviors already visible in references
- BitVid batches report subscriptions in chunks of 200.
- BitVid distinguishes ranking-only trusted mutes below threshold from hide behavior at threshold.
- BitVid hydrates cached admin state synchronously before live refresh.
- BitVid protects admins from community blacklist inclusion.
- BitRoad treats `kind:30078` coordinates as durable object identifiers for storefronts and products.

---

## 4. Recommended repository shape

Create this structure in `nostr-governance`:

```text
nostr-governance/
├── package.json
├── tsconfig.json
├── tsconfig.types.json
├── vitest.config.js
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.md
│   ├── reference-map.md
│   ├── license-and-provenance.md
│   ├── consumer-adapter-contract.md
│   └── checkpoints.md
├── fixtures/
│   ├── bitvid/
│   │   ├── admin-state/
│   │   ├── reports/
│   │   ├── trusted-mutes/
│   │   ├── overrides/
│   │   └── expectations/
│   └── bitroad/
│       ├── storefronts/
│       ├── products/
│       └── expectations/
├── scripts/
│   ├── import-bitvid-fixtures.mjs
│   ├── import-bitroad-reference-shapes.mjs
│   └── verify-no-reference-imports.mjs
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── identifiers.js
│   │   │   ├── targets.js
│   │   │   ├── authority.js
│   │   │   ├── policy.js
│   │   │   ├── decisions.js
│   │   │   ├── evaluator.js
│   │   │   ├── snapshots.js
│   │   │   └── index.js
│   │   └── test/
│   ├── nostr/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── codecs/canonical-v1.js
│   │   │   ├── codecs/bitvid-legacy.js
│   │   │   ├── codecs/nip51.js
│   │   │   ├── codecs/nip56.js
│   │   │   ├── event-selection.js
│   │   │   ├── verification.js
│   │   │   └── index.js
│   │   └── test/
│   ├── runtime/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── GovernanceRuntime.js
│   │   │   ├── GovernanceAdminStore.js
│   │   │   ├── TrustGraphStore.js
│   │   │   ├── ReportStore.js
│   │   │   ├── TrustedMuteStore.js
│   │   │   ├── PolicyStore.js
│   │   │   ├── OverrideStore.js
│   │   │   └── index.js
│   │   └── test/
│   ├── bitvid-compat/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── accessControlFacade.js
│   │   │   ├── moderationServiceFacade.js
│   │   │   ├── videoDecisionAdapter.js
│   │   │   └── index.js
│   │   └── test/
│   └── testing/
│       ├── package.json
│       ├── src/
│       │   ├── FakeTransport.js
│       │   ├── FakeSigner.js
│       │   ├── FakeStorage.js
│       │   ├── FakeClock.js
│       │   └── index.js
│       └── test/
└── examples/
    ├── bitvid-parity/
    └── bitroad-address-targets/
```

---

## 5. Package boundaries

### `@nostr-governance/core`
Owns:
- target normalization
- identifiers
- authority resolution
- policy normalization
- evaluator
- decision composition
- explanations
- snapshot fingerprinting

Must not own:
- relay I/O
- localStorage
- `window`
- UI terms like video card, product card, modal, toast

### `@nostr-governance/nostr`
Owns:
- legacy BitVid codec
- canonical v1 codec
- NIP-51 parse helpers
- NIP-56 parse helpers
- replaceable event selection
- signature verification hooks

### `@nostr-governance/runtime`
Owns:
- store lifecycle
- transport wiring
- cache hydration
- subscriptions
- recomputation
- invalidation

### `@nostr-governance/bitvid-compat`
Owns:
- mapping `GovernanceDecision` to BitVid-shaped moderation fields
- access-control facade compatibility
- temporary method names BitVid expects

Must not own:
- feed orchestration
- playback recovery
- DOM events
- UI refresh behavior

### `@nostr-governance/testing`
Owns:
- fake transport
- fake signer
- fake storage
- fake clock
- reusable conformance helpers

---

## 6. What not to port

Do **not** extract these into the SDK:
- `moderationCoordinator` application flow
- `ModerationActionController`
- video-card rendering
- profile modal logic
- playback coordination
- BitRoad storefront rendering
- BitRoad checkout UI
- toasts, DOM dispatch, CSS, or app copy

This is the line:

```text
SDK decides policy.
Consumer decides presentation and UX.
```

---

## 7. Execution phases with stop points

## Phase 0 — Freeze references and provenance

**Objective:** Make the repo safe before writing extracted code.

**Files:**
- Create: `docs/reference-map.md`
- Create: `docs/license-and-provenance.md`
- Create: `docs/checkpoints.md`
- Create: `scripts/verify-no-reference-imports.mjs`

**Work:**
1. Record pinned reference commits for BitVid and BitRoad.
2. Map each planned module to source reference files.
3. Record which behaviors are parity requirements vs future changes.
4. Add a repo check that fails if any package imports from paths outside this repo.

**Validation:**
- `node scripts/verify-no-reference-imports.mjs`
- Expected: passes with zero external repo imports.

**Checkpoint gate:**
Do not create runtime stores before this provenance map exists.

---

## Phase 1 — Bootstrap the workspace

**Objective:** Create the empty repo skeleton and CI.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.types.json`
- Create: `vitest.config.js`
- Create: `.github/workflows/ci.yml`
- Create: package `package.json` files under `packages/*`

**Scripts to add at root:**
- `test`
- `test:unit`
- `test:conformance`
- `typecheck`
- `build:types`
- `lint`
- `check:references`

**Validation:**
- `npm install`
- `npm run test`
- `npm run typecheck`
- `npm run build:types`

**Acceptance:**
- Empty packages import cleanly.
- CI runs with no browser globals required.

**Checkpoint gate:**
Stop here and confirm the workspace shape before porting any behavior.

---

## Phase 2 — Build the conformance corpus first

**Objective:** Turn BitVid behavior into committed fixtures and expectations.

**Files:**
- Create: `scripts/import-bitvid-fixtures.mjs`
- Create: `fixtures/bitvid/...`
- Create: `packages/testing/src/fixtureLoader.js`
- Create: `tests/conformance/bitvid-fixtures.test.js`

**Reference inputs:**
- `bitvid/js/services/moderationService.js`
- `bitvid/js/services/moderationUtils.js`
- `bitvid/js/accessControl.js`
- `bitvid/js/adminListStore.js`
- `bitvid/js/adminListBatch.js`
- `bitvid/js/adminEventBlacklistHelpers.js`
- `bitvid/js/services/trustBootstrap.js`
- `bitvid/js/services/moderationDecorator.js`

**Required fixture scenarios:**
- trusted report threshold reached
- duplicate reporter dedupe
- blocked reporter ignored
- trusted mute below threshold
- trusted mute at threshold
- expired trusted mute
- personal block precedence
- admin blacklist
- event blacklist
- community blacklist
- moderator trust seed
- viewer override
- author override
- cache fallback

**Validation:**
- `npm run test:conformance -- bitvid-fixtures`

**Acceptance:**
- The repo can replay BitVid behavior from committed fixtures without importing BitVid code.

**Checkpoint gate:**
If fixture expectations are fuzzy, pause and fix the corpus before writing evaluator logic.

---

## Phase 3 — Implement the pure core

**Objective:** Create the deterministic evaluator with zero I/O.

**Files:**
- Create: `packages/core/src/identifiers.js`
- Create: `packages/core/src/targets.js`
- Create: `packages/core/src/authority.js`
- Create: `packages/core/src/policy.js`
- Create: `packages/core/src/decisions.js`
- Create: `packages/core/src/evaluator.js`
- Create: `packages/core/src/snapshots.js`
- Create: `packages/core/test/*.test.js`

**First tests to write:**
- `packages/core/test/targets.test.js`
- `packages/core/test/authority.test.js`
- `packages/core/test/evaluator-precedence.test.js`
- `packages/core/test/evaluator-thresholds.test.js`
- `packages/core/test/evaluator-overrides.test.js`

**Rules:**
- all inputs immutable
- all outputs deterministic
- no `Date.now()` without injected clock context
- no hidden consumer-specific defaults in core

**Validation:**
- `npm run test:unit -- packages/core`
- `npm run typecheck`

**Acceptance:**
- Same snapshot + same policy = same decision.
- Core contains no `bitvid` or `bitroad` terminology.

**Checkpoint gate:**
Do not build codecs until the evaluator can pass core policy tests in isolation.

---

## Phase 4 — Implement Nostr codecs

**Objective:** Convert legacy and canonical events into normalized snapshots.

**Files:**
- Create: `packages/nostr/src/codecs/bitvid-legacy.js`
- Create: `packages/nostr/src/codecs/canonical-v1.js`
- Create: `packages/nostr/src/codecs/nip51.js`
- Create: `packages/nostr/src/codecs/nip56.js`
- Create: `packages/nostr/src/event-selection.js`
- Create: `packages/nostr/src/verification.js`
- Create: `packages/nostr/test/*.test.js`

**Specific reference behaviors to preserve:**
- BitVid admin-state cache shape and guardrails.
- Event blacklist normalization from `adminEventBlacklistHelpers.js`.
- Community source batching logic from `adminListBatch.js`.
- NIP-56 report dedupe by reporter and category.
- Replaceable-event newest selection with deterministic tie-breaking.

**Validation:**
- `npm run test:unit -- packages/nostr`
- `npm run test:conformance -- bitvid-fixtures`

**Acceptance:**
- Legacy BitVid events produce normalized snapshots that the core evaluator understands.

**Checkpoint gate:**
If codecs need consumer-specific hacks, the snapshot model is wrong. Fix the model, not the adapter.

---

## Phase 5 — Deliver the first vertical slice

**Objective:** Prove BitVid parity entirely inside this repo.

**Files:**
- Create: `packages/bitvid-compat/src/videoDecisionAdapter.js`
- Create: `packages/bitvid-compat/test/videoDecisionAdapter.test.js`
- Create: `examples/bitvid-parity/README.md`
- Create: `tests/conformance/bitvid-parity.test.js`

**Work:**
1. Feed committed BitVid fixtures through legacy codec.
2. Evaluate them through the pure core.
3. Map the result back into BitVid-shaped moderation fields.
4. Compare expected hide/blur/restrict/ranking outcomes.

**Validation:**
- `npm run test:conformance -- bitvid-parity`

**Acceptance:**
- The new repo can reproduce current BitVid policy outcomes without importing BitVid application code.

**Checkpoint gate:**
This is the first milestone that matters. Do not move to runtime or live relays until this passes.

---

## Phase 6 — Add BitRoad proof-of-fit without touching BitRoad

**Objective:** Prove the target model works for addressable commerce objects before any BitRoad integration PR.

**Files:**
- Create: `fixtures/bitroad/storefronts/*.json`
- Create: `fixtures/bitroad/products/*.json`
- Create: `examples/bitroad-address-targets/README.md`
- Create: `tests/conformance/bitroad-address-targets.test.js`
- Create: `docs/consumer-adapter-contract.md`

**Reference behaviors to model:**
- `src/commerce/address.mjs` coordinate parsing
- `src/commerce/storefronts.mjs` storefront address structure
- `src/commerce/product.mjs` product address and replaceable semantics

**Proof cases:**
- seller denied by user target
- storefront denied by address target
- product denied by exact event only
- product address denial survives replacement revision
- checkout policy can deny transaction without requiring hidden listing UI

**Validation:**
- `npm run test:conformance -- bitroad-address-targets`

**Acceptance:**
- The SDK can express BitRoad governance semantics without BitRoad-specific core logic.

**Checkpoint gate:**
Only after this passes should you consider a BitRoad integration branch.

---

## Phase 7 — Runtime stores

**Objective:** Add live transport, cache, invalidation, and recomputation.

**Files:**
- Create: `packages/runtime/src/GovernanceRuntime.js`
- Create: `packages/runtime/src/GovernanceAdminStore.js`
- Create: `packages/runtime/src/TrustGraphStore.js`
- Create: `packages/runtime/src/ReportStore.js`
- Create: `packages/runtime/src/TrustedMuteStore.js`
- Create: `packages/runtime/src/PolicyStore.js`
- Create: `packages/runtime/src/OverrideStore.js`
- Create: `packages/runtime/test/*.test.js`

**Must preserve from BitVid:**
- synchronous cached fallback hydration
- emit-on-change only
- batched report subscriptions
- bounded filter chunking
- trust-seed recomputation on admin changes
- trusted-mute expiry with injected clock

**Validation:**
- `npm run test:unit -- packages/runtime`
- `npm run test:conformance`

**Acceptance:**
- No per-card subscription behavior.
- No network I/O during `evaluateMany()`.

**Checkpoint gate:**
If runtime changes evaluator output relative to fixture mode, stop and resolve before adding commands.

---

## Phase 8 — Admin write commands

**Objective:** Add mutation flows only after read-path parity is stable.

**Files:**
- Create: `packages/runtime/src/commands/*.js`
- Create: `packages/runtime/test/commands/*.test.js`
- Create: `docs/authority-model.md`

**Pushback:**
This phase should come later than the original wide plan suggests. Read parity is the product. Write commands are riskier and easier to get wrong.

**Validation:**
- `npm run test:unit -- packages/runtime`
- `npm run test:conformance`

**Acceptance:**
- unauthorized writes are rejected
- revoked actors no longer influence effective state
- protected actors cannot be denied

---

## 8. First four PRs I recommend

### PR 1 — Repo bootstrap only
Deliver:
- workspace
- CI
- typecheck
- test runner
- package skeleton
- license/provenance docs

### PR 2 — Fixture corpus only
Deliver:
- import scripts
- committed BitVid fixtures
- conformance harness
- no evaluator yet

### PR 3 — Pure core only
Deliver:
- identifiers
- targets
- policy
- evaluator
- core tests

### PR 4 — BitVid vertical slice only
Deliver:
- legacy codec
- parity tests
- BitVid decision adapter
- passing conformance

Stop after PR 4 and reassess before live runtime work.

---

## 9. Concrete test matrix

### Core
- personal block precedence
- user deny
- event deny
- address deny
- allowlist miss
- protected target
- viewer override
- transaction deny
- deterministic explanation trace

### Trust/reporting
- F1 report counts
- duplicate report dedupe
- blocked reporter ignored
- muted reporter ignored
- trust seed fallback
- trust graph recompute

### Trusted mutes
- below threshold = downrank only
- at threshold = hide/restrict
- expiry window
- category counts

### Runtime
- batched `#e` filters
- latest replaceable event selection
- cached fallback survives relay failure
- viewer switch clears viewer-local state
- destroy closes subscriptions

### BitRoad proof
- address denial survives product replacement
- exact event denial does not automatically deny newer replacement event
- checkout profile can deny transaction independently of visibility profile

---

## 10. Risks and answers

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| GPL inheritance | Direct extraction likely carries GPL obligations | Decide license in PR 1; document provenance |
| Authority ambiguity from BitVid | Current moderator vs super-admin loading semantics are not fully clean | Normalize around root-authorized contributor model before commands |
| Hidden policy duplication | BitVid currently computes overlapping policy in more than one layer | Keep one evaluator; adapters only map decisions |
| Address-target mistakes | BitRoad uses replaceable `kind:30078` coordinates | Treat address denial as first-class in core tests |
| Premature runtime complexity | Live relay code can hide policy bugs | Prove fixture parity before runtime |
| Consumer leakage into core | Video/product/storefront concepts can pollute the SDK | Enforce neutral naming and adapter contracts |

---

## 11. Open questions to answer before implementation starts

1. **License:** Are you comfortable making `nostr-governance` GPL-compatible from day one?
2. **Release scope:** Should `0.1` be read-only evaluation only, with no admin write commands yet?
3. **Canonical schema:** Do you want one canonical governance schema now, or legacy BitVid-only read support first?
4. **Package manager:** npm workspaces are fine; do you want to keep it that simple rather than introducing pnpm?

My recommendation:
- **yes** to GPL-compatible now
- **yes** to read-only `0.1`
- **yes** to supporting a canonical v1 schema, but only after BitVid legacy parity exists
- **yes** to plain npm workspaces

---

## 12. Immediate next action

The correct next move is:

**Create the repo skeleton plus provenance/conformance harness, then stop.**

Do **not** start by moving `moderationService.js` wholesale. That is the easiest way to transplant BitVid application assumptions into a package that is supposed to be generic.

---

## 13. Definition of success for the first milestone

Success is **not** “the runtime exists.”

Success is:

```text
Given pinned BitVid fixtures,
nostr-governance produces the same hide/blur/restrict/downrank outcomes
through a legacy codec + pure evaluator + BitVid adapter,
with no imports from BitVid.
```

Once that is true, the rest of the plan becomes safer and much more mechanical.
