# @bitgate/widget

Drop-in custom elements. Framework-agnostic, no bundler required by consumers,
and built strictly on the published API.

## Install

```bash
npm install && npm run build:widget
```

Copy `packages/widget/dist/bitgate.js` (and its `.map`) onto your own origin.
The bundle is deliberately not committed: build it from reviewed source rather
than trusting a prebuilt minified blob for a moderation widget.

## The one-element version

```html
<script type="module" src="/vendor/bitgate/bitgate.js"></script>

<bitgate-provider relays="wss://relay.example" root="<root-pubkey>" policy="social">
  <bitgate-veil profile="feed" target-user="<author-pubkey>">
    <img src="thumbnail.jpg" alt="" />
  </bitgate-veil>
</bitgate-provider>
```

`<bitgate-provider>` builds the runtime, loads administrative state, and shares
both with every descendant. Nothing else to wire.

### Provider attributes

| Attribute | Meaning |
| --- | --- |
| `relays` | Comma-separated relay URLs (required) |
| `root` | Root administrator pubkey, from your deployment config |
| `policy` | `social`, `commerce`, or `admin-only` (default) |
| `viewer` | Viewer pubkey, if known at render time |
| `application` / `namespace` | Storage and event namespacing |

### Target attributes

Any target-bearing element reads its target from markup:

```html
<bitgate-veil target-user="<pubkey>">…</bitgate-veil>
<bitgate-veil target-event="<id>" target-author="<pubkey>">…</bitgate-veil>
<bitgate-veil target-address="30078:<pubkey>:sku-001">…</bitgate-veil>
```

Assigning `.target` in JavaScript still works and takes precedence.

### With BitLogin

```js
const provider = document.querySelector("bitgate-provider");
await provider.ready;
await provider.useSigner(window.nostr);
```

Await `ready` rather than listening for `bitgate:ready` — the event fires during
element upgrade, which is before a script that runs after parsing could attach a
listener.

## The rule these elements follow

**They render decisions and issue commands. They compute no policy.**

If an element here ever needed to compare a count to a threshold, that would
mean the policy definition is missing a profile — not that the widget needs a
number. Keeping that line is the whole reason the engine was extracted.

## Elements

### Viewer-facing

| Element | Purpose |
| --- | --- |
| `<bitgate-veil>` | Wraps content and applies the decision: blur on `restrict`, disclosure on `hide`, warning on `warn` |
| `<bitgate-report>` | Report dialog. Requires no capability — anyone may report |
| `<bitgate-status>` | Readout of effect, reasons, and evidence |

### Moderator-facing

| Element | Purpose |
| --- | --- |
| `<bitgate-capabilities>` | What the signed-in account may actually do |
| `<bitgate-action>` | A capability-gated button that explains refusals |
| `<bitgate-admin-panel>` | Effective state, contributor attribution, and controls |

## Usage

```html
<script type="module">
  import { createBitGate, createCommands } from "@bitgate/runtime";
  import { defineBitGateElements } from "@bitgate/widget";

  defineBitGateElements();

  const runtime = createBitGate({
    applicationId: "my-app",
    namespace: "myapp",
    root: ROOT_PUBKEY,
    transport: myRelayAdapter,
    policy: myPolicy,
    now: () => Math.floor(Date.now() / 1000),
  });

  await runtime.loadAdministrativeState();

  const veil = document.querySelector("bitgate-veil");
  veil.runtime = runtime;
  veil.target = { type: "event", id: eventId, author: authorPubkey };
</script>

<bitgate-veil profile="feed">
  <img src="thumbnail.jpg" alt="" />
</bitgate-veil>
```

Elements receive a runtime; they never construct one. A widget that owned relay
connections would make it impossible to share one governance runtime across a
page.

## Events

All events are `composed` so they cross shadow boundaries.

| Event | Fired when |
| --- | --- |
| `bitgate:revealed` | The viewer chose to show hidden content |
| `bitgate:reported` / `bitgate:report-failed` | A report was published or refused |
| `bitgate:action-completed` / `:action-refused` / `:action-failed` | An action resolved |
| `bitgate:account-restricted` | The admin panel restricted an account |

## Wording

The engine emits stable reason identifiers, never prose, so applications phrase
them for their own audience:

```js
veil.reasonText = {
  "admin-user-deny": "This seller is suspended",
  "trusted-report-threshold": "Flagged by several buyers you follow",
};
```

## Design decisions worth knowing

**Hidden content is removed from the accessibility tree**, not merely covered.
A screen reader must not read out something the viewer was not meant to see.

**A hidden decision renders a disclosure, not nothing.** Content that silently
vanishes is indistinguishable from a bug and leaves no route to appeal. Where
the profile permits an override, a "Show anyway" control appears; where it does
not, the reason still does.

**Refused actions stay visible and explain themselves.** A moderator who cannot
see that they lack a capability will assume the tool is broken, and a hidden
button teaches nothing about the authority model. The command layer enforces
the same check independently — the UI is an explanation, never the gate.

**Styling is yours.** Elements expose `part` attributes and inherit `color` and
`font` from the host. Override the CSS custom properties (`--gov-fg`,
`--gov-surface`, `--gov-warn`, `--gov-danger`, `--gov-radius`) or target parts:

```css
bitgate-veil::part(veil) { border: 1px solid red; }
```

## Environment

`defineBitGateElements()` is safe to call repeatedly and safe to import in
Node — registration is a no-op without a DOM, so a server-rendering host can
import the helpers without guarding.
