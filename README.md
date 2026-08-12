# BitGate

Moderation and access control for Nostr apps. Decide what to show, what to
allow, and what to sell — without writing the policy code yourself.

Pairs with [BitLogin](https://github.com/PR0M3TH3AN/bitlogin): **BitLogin
answers "who are you." BitGate answers "what may you see, and what may you do."**

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
| `@bitgate/core` | Pure evaluation. No I/O, no browser globals, no dependencies. |
| `@bitgate/nostr` | Codecs: canonical v1, NIP-56, NIP-51, NIP-32, NIP-65, NIP-02, bech32. |
| `@bitgate/runtime` | Stores, transport orchestration, commands. |
| `@bitgate/verify` | Optional NIP-01 signature verification, so the core stays dependency-free. |
| `@bitgate/testing` | Conformance harness. |
| `@bitgate/widget` | Drop-in custom elements: viewer controls and a moderator console. |
| `@bitgate/bitvid-compat` | Reference application profile for the characterization corpus. |

## Quick start — a static page

No npm install, no bundler. Build the widget once, self-host it, and configure
everything in markup:

```bash
npm install && npm run build:widget   # produces packages/widget/dist/bitgate.js
```

```html
<script type="module" src="/vendor/bitgate/bitgate.js"></script>

<bitgate-provider relays="wss://relay.example" root="<root-pubkey>" policy="social">
  <bitgate-veil profile="feed" target-user="<author-pubkey>">
    <img src="thumbnail.jpg" alt="" />
  </bitgate-veil>
</bitgate-provider>
```

That is the whole integration. The provider builds a runtime, loads
administrative state, and descendants find it themselves — no wiring code.

Sign in with BitLogin and BitGate knows who the viewer is:

```js
const provider = document.querySelector("bitgate-provider");
await provider.ready;
await provider.useSigner(window.nostr);   // BitLogin's NIP-07 provider
```

Policy presets: `social`, `commerce`, `admin-only`, and `allowlist` (only
allowlisted publishers are shown — the symmetric twin of a denylist, for
invite-only or curated surfaces). Every number in them is a starting point —
see the [integration guide](docs/integration-guide.md) to write your own.

## Quick start — JavaScript

```js
import { createPolicyDefinition, evaluateTarget } from "@bitgate/core";
import { createBitGate, createMemoryTransport } from "@bitgate/runtime";

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

const runtime = createBitGate({
  applicationId: "my-app",
  namespace: "myapp",
  root: ROOT_PUBKEY,
  transport: createRelayTransport(["wss://relay.example"]),
  policy,
  now: () => Math.floor(Date.now() / 1000),
});

runtime.setViewer(viewerPubkey);
runtime.trust.setContacts(followList);
await runtime.loadAdministrativeState();

const decision = runtime.evaluate({ type: "user", pubkey: authorPubkey }, { profile: "feed" });
if (decision.visibility.effect === "hide") return null;
```

### Headless, straight from NIP-32 labels

If you don't want the runtime's transport orchestration either — you already
have relay events in hand and just want the engine — the whole path is four
pure functions. **NIP-32 label events (kind 1985) are the canonical, signed
decision format**; you don't invent one:

```js
import { createSnapshot, evaluateTarget, reduceAdminState, createAuthorityState } from "@bitgate/core";
import { decodeLabels, labelsToContributions } from "@bitgate/nostr";

const authority = createAuthorityState({ root: ROOT, actors: honoredModerators }); // moderator set as data
const contributions = labelsToContributions(
  labelEvents.flatMap(decodeLabels),                 // kind-1985 events off your relays
  { namespace: "org.bitblocks.plugins", denyValues: ["deny"], allowValues: ["allow"] },
);
const snapshot = createSnapshot({ authority, admin: reduceAdminState(contributions, authority) });
const decision = evaluateTarget(target, snapshot, { policy, surface: "registry" });

if (!decision.transaction || decision.transaction.effect === "allow") install();  // gate a non-visual action
```

A decision has four dimensions, so `transaction` can block an install or
checkout while `visibility` still shows the listing with a warning — something a
`hidden` boolean can't express. [`examples/headless-quickstart.mjs`](examples/headless-quickstart.mjs)
is a runnable end-to-end walkthrough (`node examples/headless-quickstart.mjs`);
[docs/labels.md](docs/labels.md) covers the NIP-32 wire format and interop.

## Extending to a new application

Write an adapter saying what your object is in governance terms, and a policy
saying what the evidence means to you. Nothing else.

```js
import { createApplicationAdapter, evaluateObject } from "@bitgate/core";

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

`@bitgate/widget` ships custom elements that render decisions and issue
commands — and compute no policy of their own:

```html
<bitgate-veil profile="feed"><img src="thumbnail.jpg" alt="" /></bitgate-veil>
```

```js
import { defineBitGateElements } from "@bitgate/widget";
defineBitGateElements();

const veil = document.querySelector("bitgate-veil");
veil.runtime = runtime;
veil.target = { type: "event", id, author };
```

Viewer elements (`bitgate-veil`, `bitgate-report`, `bitgate-status`)
and moderator elements (`bitgate-capabilities`, `bitgate-action`,
`bitgate-admin-panel`) are separate, so a site embeds only what it needs.
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
npm run build         # .d.ts for every package + the widget bundle
```

The widget bundle is **not** committed. Build it from source and self-host the
result — a moderation widget is exactly the kind of artifact where reading the
source matters.

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
