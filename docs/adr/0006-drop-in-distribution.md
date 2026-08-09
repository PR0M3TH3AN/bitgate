# ADR 0006 — Ship a built, self-contained widget

**Status:** accepted

## Context

BitGate was a well-factored SDK that was not droppable into a page. Adopting it
required supplying a transport adapter, authoring a policy definition, and
wiring every element in JavaScript. BitLogin sets a much higher bar: copy two
files, add one script tag and one element.

Testing the widget in a real browser exposed a failure no unit test could
catch. `packages/widget/src/index.js` imports `@bitgate/core` and
`@bitgate/runtime` as bare specifiers. Node and the test runner resolve those
through `node_modules`; a browser cannot resolve them at all. The source worked
everywhere except the one place the widget exists to serve.

## Decision

Three pieces close the gap.

1. **`createRelayTransport(urls)`** — a small WebSocket transport, so nobody
   writes an adapter to get started. It speaks enough of the protocol to load
   state, subscribe, and publish; it is not a general-purpose relay client.

2. **Policy presets** — `social`, `commerce`, `admin-only`, addressable by name.
   The engine still carries no thresholds: these are application policies that
   happen to ship in the box, and every number in them is documented as a
   starting point.

3. **`<bitgate-provider>`** — configuration in markup. Descendants find the
   runtime by firing a bubbling context-request event rather than walking up
   the DOM, which would break across shadow boundaries.

Plus a build step (`npm run build:widget`) producing a single self-contained
`dist/bitgate.js` via esbuild.

## Consequences

A static page needs one script tag and one element, matching BitLogin.

The build output is deliberately **not** committed. Consumers build from
reviewed source and self-host the result, as BitLogin instructs, because a
moderation widget is exactly the kind of artifact where reading the source
matters and trusting a prebuilt minified blob does not.

The provider exposes `ready` as a promise as well as an event. The event fires
during element upgrade — before a page that calls `defineBitGateElements()`
after parsing could attach a listener — so an event alone was a race that
silently lost. This was found by running the demo, not by a test.
