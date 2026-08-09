# Integration guide

How to put this engine into an application that is not a video app.

Everything application-specific lives in two places you write: an **adapter**
(what is my object, in governance terms) and a **policy** (what does the
evidence mean to me). Nothing else needs to change, and nothing in the core
needs to know your application exists.

## 1. Decide what your objects are

Three target types cover the model:

| Target | Use for |
| --- | --- |
| `user` | Accounts: authors, sellers, reviewers, reporters, curators |
| `event` | One exact, immutable event that should stay denied on its own |
| `address` | A replaceable coordinate: a product across revisions, a storefront, an article |

The distinction between `event` and `address` matters more than it looks.
Denying an **address** survives the author republishing under a new event id.
Denying an **event** does not — which is exactly what you want when only one
revision was bad. Most objects want both.

## 2. Write an adapter

```js
import { createApplicationAdapter } from "@nostr-governance/core";

export const productAdapter = createApplicationAdapter({
  applicationId: "my-shop",

  // Every target whose status should reach this object.
  toTargets: (product) => [
    { type: "user", pubkey: product.sellerPubkey },
    { type: "event", id: product.id, author: product.sellerPubkey, kind: 30078 },
    { type: "address", kind: "30078", pubkey: product.sellerPubkey, identifier: product.sku },
  ],

  // The object's own identity, used to key its decision.
  getPrimaryTargetKey: (product) => `address:30078:${product.sellerPubkey}:${product.sku}`,

  // Optional: map the decision back into your shape.
  applyDecision: (product, decision) => ({
    ...product,
    hidden: decision.visibility.effect === "hide",
    rankPenalty: decision.ranking.weight,
    checkoutAllowed: (decision.transaction?.effect ?? "allow") === "allow",
  }),
});
```

Composition across an object's targets is ladder-maximum per dimension: the
strictest verdict reaching the object wins. That is what makes "deny the seller"
take their whole catalogue down without you writing any cascade logic.

Be deliberate about what you *don't* include. A review should answer to its
reviewer and its own event — not to the product it reviews, or a bad product
would silence honest reviews of it.

## 3. Write a policy

A policy is a set of named **profiles**, one per surface. Profiles read the same
evidence and are free to reach different conclusions.

```js
import { createPolicyDefinition } from "@nostr-governance/core";

export const policy = createPolicyDefinition({
  id: "my-shop",
  version: "1.0.0",
  defaultProfile: "browse",
  profiles: {
    browse: {
      name: "browse",
      administrativeDeny: { visibility: "hide", interaction: "deny", transaction: "deny" },
      requireAllowlist: true,
      allowlistMiss: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: false,
      reports: {
        malware: { hide: 1, transactionDeny: 1 },
        scam: { downrank: 1, restrict: 3, transactionDeny: 3 },
        default: { downrank: 2, warn: 4 },
      },
      mutes: { default: { downrank: 1 } },
      muteWindowSeconds: 60 * 24 * 60 * 60,
    },

    checkout: {
      name: "checkout",
      administrativeDeny: { visibility: "allow", transaction: "deny" },
      allowViewerOverride: false,
      reports: { malware: { transactionDeny: 1 }, scam: { transactionDeny: 3 } },
      mutes: {},
    },
  },
});
```

### Profile options

| Option | Effect |
| --- | --- |
| `administrativeDeny` | Effects applied when the target is administratively denied |
| `viewerBlock` | Effects applied when the viewer personally blocks |
| `requireAllowlist` / `allowlistMiss` | Enforce an allowlist on this surface |
| `allowViewerOverride` | Whether a viewer may soften a decision |
| `exposeEvidence` | Whether contributor pubkeys reach the consumer |
| `bypassHide` / `bypassHideCeiling` | Cap a hide on discovery surfaces |
| `disabled` | Turn governance off for this surface, with a reason |
| `reports` / `mutes` | Category thresholds |
| `muteWindowSeconds` | Ignore mutes older than this |

### Threshold gates

A gate fires when `count >= threshold`. A threshold of `0` means **disabled**,
not "always on" — so you can zero a gate out without it triggering on every
target.

```
downrank → ranking      warn, restrict, hide, deny → visibility
requireExplicitAction, interactionDeny → interaction
transactionReview, transactionDeny → transaction
```

## 4. Supply a transport

The runtime depends on no relay pool. Implement three methods:

```js
const transport = {
  async list(filters, options) { /* → NostrEvent[] */ },
  subscribe(filters, handlers, options) { /* → { close() } */ },
  async publish(event, options) {
    return { ok: true, accepted: ["wss://..."], failed: [] };
  },
};
```

`publish` should report **partial** acceptance honestly: `ok: true` with a
non-empty `failed` list is a normal, successful outcome. The first acceptance
means the event exists on the network; the remaining results are diagnostics.

A signer (`getPublicKey`, `signEvent`) and storage (`read`, `write`, `remove`)
follow the same injection pattern. In-memory versions ship for testing:

```js
import { createMemoryTransport, createMemoryStorage } from "@nostr-governance/runtime";
```

## 5. Wire the pipeline

```js
import { collectTargets, evaluateObject } from "@nostr-governance/core";

runtime.setViewer(viewerPubkey);        // do this FIRST — it clears viewer state
runtime.trust.setContacts(followList);  // then seed trust
await runtime.loadAdministrativeState();

runtime.setActiveTargets(collectTargets(products, productAdapter));
runtime.subscribeToActiveTargetReports();

const governed = products.map((product) =>
  productAdapter.applyDecision(
    product,
    evaluateObject(product, productAdapter, (target) =>
      runtime.evaluate(target, { profile: "browse" }),
    ),
  ),
);
```

Order matters in one place: `setViewer` clears viewer-scoped state by design, so
seed contacts, blocks, and overrides *after* it, never before.

## 6. Define your roles

Roles are application-defined bundles over a fixed capability vocabulary:

```js
import { createRoleDefinition } from "@nostr-governance/core";

const roles = {
  listing_moderator: createRoleDefinition("listing_moderator", [
    "contribute-event-deny",
    "contribute-address-deny",
    "review-evidence",
  ]),
  seller_moderator: createRoleDefinition("seller_moderator", [
    "contribute-user-deny",
    "review-evidence",
  ]),
};
```

If you pass a custom `roles` map to `setRoles`, it **replaces** the defaults —
include `super_admin` yourself if you still want it. The root administrator
always holds every capability regardless, so a misconfigured roster cannot lock
you out of your own instance.

Every command checks capability locally before the signer is invoked. An
unauthorized actor cannot produce a signed mutation at all, rather than
publishing one that quietly fails to take effect.

## Common mistakes

**Recomputing policy in your view layer.** If your renderer is comparing report
counts to thresholds, the extraction has failed. Consume `decision`.

**Treating `downrank` as a filter.** Downranking is a sort input. A downranked
item still appears and can still be acted on; conflating the two is what makes
moderation feel like censorship to the people affected.

**Skipping the checkout re-check.** Evaluate transaction-critical actions
against their own profile at the moment of action. State moves between page
render and button press.

**Exposing evidence everywhere.** `exposeEvidence` is off by default for a
reason: public surfaces get counts, appeal surfaces get identities.

**Assuming an allowlist implies trust.** Being allowed to publish grants no
trust, no moderator authority, and no immunity from personal blocks. The two
systems are deliberately separate.

## Testing your integration

The conformance harness takes JSON fixtures and asserts decisions:

```js
import { runConformanceCase } from "@nostr-governance/testing/conformance";

const { passed, mismatches } = runConformanceCase(fixture, policy);
```

Expectations are partial — assert the dimensions your case is about and stay
silent about the rest. See `fixtures/bitvid/cases/` for the shape and
`examples/commerce/test/proof-of-fit.test.js` for a full application suite.
