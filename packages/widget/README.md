# @nostr-governance/widget

Drop-in custom elements for governance UI. Framework-agnostic, no build step
required for consumers, and built strictly on the published API.

## The rule these elements follow

**They render decisions and issue commands. They compute no policy.**

If an element here ever needed to compare a count to a threshold, that would
mean the policy definition is missing a profile — not that the widget needs a
number. Keeping that line is the whole reason the engine was extracted.

## Elements

### Viewer-facing

| Element | Purpose |
| --- | --- |
| `<governance-veil>` | Wraps content and applies the decision: blur on `restrict`, disclosure on `hide`, warning on `warn` |
| `<governance-report>` | Report dialog. Requires no capability — anyone may report |
| `<governance-status>` | Readout of effect, reasons, and evidence |

### Moderator-facing

| Element | Purpose |
| --- | --- |
| `<governance-capabilities>` | What the signed-in account may actually do |
| `<governance-action>` | A capability-gated button that explains refusals |
| `<governance-admin-panel>` | Effective state, contributor attribution, and controls |

## Usage

```html
<script type="module">
  import { createGovernanceRuntime, createCommands } from "@nostr-governance/runtime";
  import { defineGovernanceElements } from "@nostr-governance/widget";

  defineGovernanceElements();

  const runtime = createGovernanceRuntime({
    applicationId: "my-app",
    namespace: "myapp",
    root: ROOT_PUBKEY,
    transport: myRelayAdapter,
    policy: myPolicy,
    now: () => Math.floor(Date.now() / 1000),
  });

  await runtime.loadAdministrativeState();

  const veil = document.querySelector("governance-veil");
  veil.runtime = runtime;
  veil.target = { type: "event", id: eventId, author: authorPubkey };
</script>

<governance-veil profile="feed">
  <img src="thumbnail.jpg" alt="" />
</governance-veil>
```

Elements receive a runtime; they never construct one. A widget that owned relay
connections would make it impossible to share one governance runtime across a
page.

## Events

All events are `composed` so they cross shadow boundaries.

| Event | Fired when |
| --- | --- |
| `governance:revealed` | The viewer chose to show hidden content |
| `governance:reported` / `governance:report-failed` | A report was published or refused |
| `governance:action-completed` / `:action-refused` / `:action-failed` | An action resolved |
| `governance:account-restricted` | The admin panel restricted an account |

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
governance-veil::part(veil) { border: 1px solid red; }
```

## Environment

`defineGovernanceElements()` is safe to call repeatedly and safe to import in
Node — registration is a no-op without a DOM, so a server-rendering host can
import the helpers without guarding.
