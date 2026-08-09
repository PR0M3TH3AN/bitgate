# nostr-governance

A headless, application-agnostic governance engine for Nostr: moderation,
access control, and trust-graph policy, with no opinion about what your
application is.

The engine carries **no thresholds of its own**. Applications supply a policy
definition; the engine supplies precedence, aggregation, composition, and
explanation. That separation is what lets one engine serve a video app and a
marketplace without either leaking into the other.

## Why it looks like this

**Four independent decision dimensions.** A governance decision is not a
`hidden` boolean. It is four answers:

| Dimension | Values |
| --- | --- |
| `ranking` | `normal` → `downrank` (with weight) |
| `visibility` | `allow` → `warn` → `restrict` → `hide` → `deny` |
| `interaction` | `allow` → `require-explicit-action` → `deny` |
| `transaction` | `allow` → `require-review` → `deny` |

A marketplace listing can be visible to its seller, downranked in discovery,
inspectable behind a warning on its detail page, and blocked at checkout — all
from one evaluation. Collapsing that into one boolean is what forces
applications to reimplement policy.

**Composition is ladder-maximum per dimension**, which makes it commutative and
associative: the order decisions arrive in cannot change the result.

**Capabilities resolve at merge time, not ingest time.** Revoking a moderator's
role drops their contributions from effective state immediately, without
replaying or rewriting anything.

**Trust seeds are a fallback, not an addition.** Once a viewer has real
contacts, configured seeds stop contributing — following nobody must not be
equivalent to following the operator's seed list.

## Packages

| Package | Purpose |
| --- | --- |
| `@nostr-governance/core` | Pure evaluation. No I/O, no browser globals, no dependencies. |
| `@nostr-governance/nostr` | Codecs: canonical v1, NIP-56, NIP-51, legacy lists, bech32. |
| `@nostr-governance/runtime` | Stores, transport orchestration, commands. |
| `@nostr-governance/testing` | Conformance harness. |
| `@nostr-governance/widget` | Drop-in custom elements: viewer controls and a moderator console. |
| `@nostr-governance/bitvid-compat` | Reference application profile for the characterization corpus. |

## Quick start

```js
import { createPolicyDefinition, evaluateTarget } from "@nostr-governance/core";
import { createGovernanceRuntime, createMemoryTransport } from "@nostr-governance/runtime";

const policy = createPolicyDefinition({
  id: "my-app",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: {
        spam: { downrank: 1, restrict: 3, hide: 8 },
        malware: { hide: 1, interactionDeny: 1 },
      },
      mutes: { default: { downrank: 1, hide: 20 } },
      muteWindowSeconds: 60 * 24 * 60 * 60,
    },
  },
});

const runtime = createGovernanceRuntime({
  applicationId: "my-app",
  namespace: "myapp",
  transport: myRelayAdapter,
  policy,
  now: () => Math.floor(Date.now() / 1000),
});

runtime.setViewer(viewerPubkey);
runtime.trust.setContacts(followList);
await runtime.loadAdministrativeState();

const decision = runtime.evaluate({ type: "user", pubkey: authorPubkey }, { profile: "feed" });
if (decision.visibility.effect === "hide") return null;
```

## Extending to a new application

Write an adapter saying what your object is in governance terms, and a policy
saying what the evidence means to you. Nothing else.

```js
import { createApplicationAdapter, evaluateObject } from "@nostr-governance/core";

const productAdapter = createApplicationAdapter({
  applicationId: "my-shop",
  toTargets: (product) => [
    { type: "user", pubkey: product.sellerPubkey },
    { type: "event", id: product.id, author: product.sellerPubkey },
    { type: "address", kind: "30078", pubkey: product.sellerPubkey, identifier: product.sku },
  ],
  getPrimaryTargetKey: (product) => `address:30078:${product.sellerPubkey}:${product.sku}`,
});

const decision = evaluateObject(product, productAdapter, (target) =>
  runtime.evaluate(target, { profile: "checkout" }),
);
```

A worked example lives in [`examples/commerce`](examples/commerce) — a
marketplace built entirely on the public API, demonstrating seller allowlists,
address denial that survives republication, malware-driven checkout blocking,
capability-scoped moderator roles, community curator ingestion, and
seller-facing explanations. See [`docs/integration-guide.md`](docs/integration-guide.md).

## Plug-and-play UI

`@nostr-governance/widget` ships custom elements that render decisions and issue
commands — and compute no policy of their own:

```html
<governance-veil profile="feed"><img src="thumbnail.jpg" alt="" /></governance-veil>
```

```js
import { defineGovernanceElements } from "@nostr-governance/widget";
defineGovernanceElements();

const veil = document.querySelector("governance-veil");
veil.runtime = runtime;
veil.target = { type: "event", id, author };
```

Viewer elements (`governance-veil`, `governance-report`, `governance-status`)
and moderator elements (`governance-capabilities`, `governance-action`,
`governance-admin-panel`) are separate, so a site embeds only what it needs.
See [`packages/widget/README.md`](packages/widget/README.md) and the runnable
[`examples/commerce/demo.html`](examples/commerce/demo.html).

## Authority model

Root-authorized contributors: the root publishes the role roster, each actor
publishes contributions under their own key, and a contribution is accepted only
if the signing actor holds the matching capability.

```
manage-roles            manage-policy         manage-community-sources
contribute-user-allow   contribute-user-deny  contribute-event-deny
contribute-address-deny contribute-trust-seed review-evidence
```

Roles are convenience bundles over these; applications define their own
(`listing_moderator`, `seller_moderator`, …). No moderator ever needs the root
key. Protected actors cannot be denied by any contributor list, however many
curators list them.

## Development

```bash
npm install
npm run lint          # reference guard + typecheck
npm test              # unit + conformance
npm run build:types   # per-package .d.ts
```

BitVid and BitRoad are **read-only reference repositories**, pinned by commit in
[`docs/reference-map.md`](docs/reference-map.md). Behavior is copied via fixtures
and characterization tests, never by importing their source;
`npm run check:references` fails the build if anything does.

Regenerate the characterization corpus with:

```bash
node scripts/build-characterization-corpus.mjs
```

## License

GPL-3.0-or-later. See [`docs/license-and-provenance.md`](docs/license-and-provenance.md).
