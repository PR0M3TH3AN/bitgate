# BitGate — open items

Updated: 2026-08-10

BitGate is the standalone governance and policy engine in this repository. The
existing `@bitgate/core`, `@bitgate/nostr`, `@bitgate/runtime`, `@bitgate/verify`,
`@bitgate/testing`, `@bitgate/widget`, and compatibility packages are existing
surfaces. The distribution and API work below must be additive and must not
break current BitGate consumers or the behavior characterized from BitVid and
BitRoad.

## Priority 1 — Distribution

- [ ] Guarantee one browser-ready standalone build: `bitgate.js`.
    - [ ] Require no npm at runtime.
    - [ ] Require no runtime dependencies.
    - [ ] Work directly from vanilla HTML.
- [ ] Publish predictable downloadable release artifacts.
- [ ] Provide both an ES module and an npm package.
- [ ] Verify the standalone build works from ordinary static HTTPS hosts and
      localhost development without requiring a framework or bundler.
- [ ] Document `file://` limitations and the recommended local development
      server path.

## Priority 2 — Canonical API

- [ ] Establish one obvious entry point, for example:

      const decision = await gate.evaluate({
        viewer,
        item,
        action: "view"
      });

- [ ] Standardize decision output:

      {
        visibility,
        ranking,
        interaction,
        transaction,
        reasons,
        evidence
      }

- [ ] Keep the four decision axes independent:
    - [ ] visibility
    - [ ] ranking
    - [ ] interaction
    - [ ] transaction
- [ ] Do not collapse all policy outcomes into `allowed`/`blocked`.
- [ ] Define stable machine-readable reason codes, for example:
    - [ ] `USER_MUTED`
    - [ ] `FOLLOWED_USER_REPORTED`
    - [ ] `MALWARE_SIGNAL`
    - [ ] `SPAM_SIGNAL`
    - [ ] `POLICY_BLOCK`
- [ ] Define how any legacy adapter verdicts map onto the canonical four-axis
      decision without losing information.
- [ ] Define deterministic behavior when an axis is not applicable to an
      action, such as transaction policy for a read-only view.

## Priority 3 — Shared Context

- [ ] Accept a standardized viewer context:

      {
        pubkey,
        follows,
        mutes,
        relays,
        trustGraph,
        interests
      }

- [ ] Avoid requiring BitGate-specific conversions when data already comes
      from BitLogin or Nostr.
- [ ] Define optional versus required context fields and safe defaults for
      missing, stale, or unavailable context.
- [ ] Keep context normalization separate from policy evaluation so applications
      can pass through native BitLogin/Nostr structures without needless copying.
- [ ] Define privacy boundaries for context: do not require raw viewer identity,
      cross-site tracking data, or unnecessary behavioral history.

## Priority 4 — Policies

- [ ] Formalize the `bitgate/1` policy schema.
- [ ] Make policies serializable, hashable, signable, publishable, and forkable.
- [ ] Allow policies to be loaded from signed Nostr events.
- [ ] Verify policy signatures, schema versions, hashes, and issuer metadata
      before using a policy; fail safely when verification is ambiguous.
- [ ] Support named policy profiles, for example:
    - [ ] `social`
    - [ ] `comments`
    - [ ] `marketplace-browse`
    - [ ] `marketplace-checkout`
    - [ ] `messaging`
- [ ] Keep app-specific policy configuration outside the core engine.
- [ ] Define policy precedence, composition, conflict resolution, and explicit
      override rules when multiple policies apply.
- [ ] Make policy evaluation deterministic and testable for the same input,
      policy set, and evaluation time.
- [ ] Document policy expiry, revocation, cache behavior, and offline behavior.

## Priority 5 — Explainability

- [ ] Make every decision explainable.
- [ ] Return machine-readable reasons.
- [ ] Return optional human-readable explanations without making UI copy part
      of the stable machine contract.
- [ ] Support `gate.explain(decision)`.
- [ ] Make it straightforward for applications to answer:
    - [ ] “Why was this hidden?”
    - [ ] “Why can't I reply?”
    - [ ] “Why is checkout disabled?”
- [ ] Include enough evidence references to audit a decision without exposing
      unnecessary private viewer data.
- [ ] Distinguish the policy reason, the evidence source, and the resulting
      action; do not imply that a signal is proof when it is only a heuristic.
- [ ] Define stable explanation behavior for conflicting signals, unavailable
      evidence, expired policies, and fail-open/fail-closed choices.

## Priority 6 — Documentation

- [ ] Add a vanilla HTML example.
- [ ] Add a BitLogin + BitGate example.
- [ ] Add a social feed example.
- [ ] Add a commerce example.
- [ ] Document the difference between:
    - [ ] hide
    - [ ] downrank
    - [ ] warn
    - [ ] interaction deny
    - [ ] transaction deny
- [ ] Document the canonical API in relation to the existing package APIs and
      how current consumers migrate without a forced rewrite.
- [ ] Document the security and privacy boundaries of local policy evaluation,
      signed Nostr policies, and remotely supplied evidence.

## Compatibility and testing gates

- [ ] Preserve existing package APIs while introducing the canonical BitGate
      API.
- [ ] Preserve the behavior characterized from BitVid and BitRoad during
      extraction and future policy-engine changes.
- [ ] Add unit tests for canonical decision-axis independence, stable reason
      codes, legacy verdict mapping, policy precedence, and explainability.
- [ ] Add tests for signed policy verification, malformed policies, unknown
      schema versions, expired policies, and ambiguous evidence.
- [ ] Add browser integration tests for the standalone `bitgate.js` artifact
      from vanilla HTML.
- [ ] Test the npm package and ES-module import paths from a clean consumer
      project.
- [ ] Test the definition-of-done examples against the published artifact.
- [ ] Run the existing build, typecheck, and test suite before and after
      changes; standalone work must not replace or mutate current package
      output.

## Definition of done

A developer can drop `bitgate.js` into a page, pass it a viewer, item, and
action, and receive a consistent, explainable policy decision without needing
to understand BitGate internals. The same canonical engine is available as an
ES module and npm package, while existing BitGate consumers continue to work
unchanged.

## Open design decisions

- [ ] Choose the exact `bitgate/1` event kind and signed-policy event format.
- [ ] Choose the canonical TypeScript types and runtime validation strategy.
- [ ] Decide whether `gate.explain(decision)` is pure/local only or may resolve
      additional evidence asynchronously.
- [ ] Decide default fail-open/fail-closed behavior per axis and per action.
- [ ] Decide how policy profile discovery works without creating a centralized
      authority or leaking private application context.
- [ ] Decide whether standalone output is generated from the canonical engine
      directly or from a separately maintained browser entry point.
- [ ] Decide how browser builds expose version and integrity metadata.

## BitBlocks App Kit compatibility layer

Do this only after BitLogin, BitGate, and BitFeed each have clean standalone
APIs. BitBlocks is an optional integration layer, not a replacement for any of
the three libraries. It must not merge their implementations or make an app
depend on the kit when it only needs BitGate.

- [ ] Create a tiny optional BitBlocks integration layer.
- [ ] Keep BitLogin, BitGate, and BitFeed as separate replaceable libraries;
      the App Kit must compose them rather than absorb them.
- [ ] Provide shared initialization, for example:

      const app = await BitBlocks.create({
        login: {},
        gate: {},
        feed: {},
        relays: [...]
      });

- [ ] Standardize the viewer context exchanged between the components without
      changing BitGate's policy engine, signed-policy format, or four-axis
      decision contract.
- [ ] Centralize optional common Nostr plumbing in the kit: relay connections,
      subscriptions, EOSE handling, reconnects, deduplication, timeouts,
      publishing, OK responses, profile lookup, follow-list lookup, and
      mute-list lookup.
- [ ] Expose `app.viewer`, `app.signer`, `app.relays`, `app.gate`, and
      `app.feed` through documented interfaces.
- [ ] Keep each underlying library independently usable and independently
      versioned.
- [ ] Do not make applications depend on BitBlocks when they use only
      BitGate's policy and governance capabilities.
- [ ] Add integration tests proving the kit is an adapter over the standalone
      APIs, not a second implementation of identity, policy, or feed logic.

### BitBlocks definition of done

A developer or AI agent can take `bitlogin.js`, `bitgate.js`, `bitfeed.js`, and
`bitblocks.js` and build a functional static Nostr application with almost no
infrastructure or integration boilerplate, while each individual library
remains usable without BitBlocks.

## Feedback from Tessera building a moderation layer (2026-08-11)

Tessera needed exactly what BitGate provides (moderation as policy over public
Nostr events) but ended up building a **client-side stand-in** — a kind-33604
"moderation decision" event carrying the four dimensions, ladder-max
composition, a signed root-controlled moderator set, and a browser console —
rather than integrating `@bitgate/*`. Notes on why, and what would have made
adoption the obvious choice.

### Why we didn't reach for BitGate first

- **[ADDRESSED 2026-08-11] No obvious "just the engine + events over Nostr" path
  for a static site.** The headless path existed but was buried under the widget
  on-ramp. Added a "Headless, straight from NIP-32 labels" subsection to the
  README (four pure functions: decode → contributions → reduce → evaluate, no
  runtime transport, no DOM) and a runnable `examples/headless-quickstart.mjs`.
  Pinned by `tests/headless-quickstart.test.js`.
- **[ADDRESSED 2026-08-11] The decision event format is ours, not yours.** There
  was no need to invent 33604: **NIP-32 label events (kind 1985) are the
  canonical signed decision format** — `@bitgate/nostr` already has the codec
  (`encodeLabel`/`decodeLabels`/`labelsToContributions`) and `docs/labels.md`
  documents interop. The README and the headless example now say so explicitly
  and round-trip real 1985 events into a four-dimension decision, so other
  clients interoperate instead of each inventing a shape.

### High-value asks

- **[DONE 2026-08-11] Headless quickstart**: shipped `examples/headless-quickstart.mjs`
  and a README subsection — `@bitgate/core` composing a decision from an array
  of kind-1985 label events + an honored moderator set + a policy, zero DOM. It
  shows exactly the `transaction`-dimension case the ask names: a malware plugin
  stays **visible (warn)** but **not installable (transaction deny)** — where a
  `hidden` boolean can't reach. Pinned by `tests/headless-quickstart.test.js`
  (incl. that an out-of-set labeller's deny is ignored).
- **[PARTIAL 2026-08-11] Moderator-set as data.** The primitive exists
  (`createAuthorityState({ root, actors })` + capability-gated
  `reduceAdminState`), and the headless example demonstrates resolving the
  honored set as data and ignoring an unauthorized labeller. Still open as a
  first-class helper: resolving that actor map from a *signed, root-controlled
  kind-30000 set* at runtime (with delegation) rather than the app assembling
  the `actors` object itself. Left as a focused follow-up.
- **[DONE 2026-08-11] Allowlist / whitelist mode.** The engine already honored
  `requireAllowlist` + `allowlistMiss` (evaluator.js), and the commerce example
  configured a seller allowlist by hand — but there was no reusable named
  preset. **Shipped** `ALLOWLIST_POLICY` (registry name `allowlist`): only
  publishers with a `user-allow` contribution are shown, every unlisted one is
  hidden across all four dimensions, administrative denials still apply on top,
  and protected actors (root/mods) are never gated. Symmetric to the denylist —
  populate `userAllow` the same way (signed contributions / NIP-32 allow
  labels). Covered by presets.test.js (unlisted hidden, allowlisted shown,
  protected bypasses); surfaced in the README preset list.

### Medium

- **[DONE 2026-08-11]** Ship a standalone ESM single-file. **Shipped**
  `@bitgate/standalone` (`packages/standalone/`, `npm run build:standalone` →
  `dist/bitgate.js`, ~44 KB): the headless engine (core) + the Nostr codecs
  (nostr, incl. the kind-1985 label round-trip) esbuilt into one self-contained,
  dependency-free ESM file — `@bitgate/verify`'s @noble deps are deliberately
  not pulled in. A no-build static site vendors the single file and gets the
  whole headless path. Verified dependency-free (no bare imports in the output)
  and end-to-end (a smoke test composes a decision from the entry). Documented
  in the README Packages table and the headless section; wired into `npm run build`.
- **[DONE 2026-08-11]** A worked example of BitGate feeding a feed ranking.
  **Shipped** `examples/feed-ranking.mjs` (runnable): it reads `decision.ranking`
  (`{ effect: "normal" | "downrank", weight }`) and turns it into a score
  multiplier (`base ** weight` for a downrank), so trusted spam reports push two
  high-base authors below a clean lower-base one **without hiding them** —
  visibility stays a separate dimension, capped at `restrict` on a feed. The
  multiplier lives in the example, not the engine (core ships no such numbers).
  Pinned by `tests/feed-ranking.test.js`; the README headless section points to
  it.
