# @bitgate/verify

NIP-01 event signature verification for BitGate. Optional package, so the rest
of BitGate carries no crypto dependency and can be audited without one.

```bash
npm install @bitgate/verify
```

```js
import { createBitGate } from "@bitgate/runtime";
import { createVerifier } from "@bitgate/verify";

const runtime = createBitGate({
  root: ROOT_PUBKEY,
  verifySignature: createVerifier(),
  …
});
```

`<bitgate-provider>` uses this automatically — the widget bundle includes it, so
the drop-in path is verified without any extra step.

## What verification means here

Two checks, and both matter:

1. **The event id is the hash of the event's own contents.** Without this, an
   attacker could take a genuine signature over one id and attach it to
   different content.
2. **The signature is valid for that id under the claimed pubkey.**

Checking only the signature would let a forged event pass by reusing a real
signature over an unrelated id. `verifyEvent` recomputes the id and refuses on
mismatch before touching the curve.

## Clock skew

`createVerifier({ maxFutureSeconds })` (default 900) rejects events dated
further ahead than the allowance. A far-future `created_at` wins
replaceable-event selection indefinitely and pins stale state in place — the
signature is perfectly valid, so only a clock check catches it. Pass `0` to
disable.

## It never throws

Malformed input, bad hex, and curve errors are all "not verified". A verifier
that threw would be a denial-of-service vector: one hostile event would break
the whole ingestion batch.

## Conformance

Validated against **120 live events** from a public relay across kinds 0, 1, 3,
and 10002 — including 59 with non-ASCII content and 71 containing quotes,
newlines, or tabs, which is where serialization mismatches would surface. All
120 verified with zero id mismatches.

## API

| Export | Purpose |
| --- | --- |
| `createVerifier(options)` | Build a verifier for `verifySignature` |
| `verifyEvent(event)` | Verify one event; never throws |
| `computeEventId(event)` | NIP-01 event id |
| `isVerifiable(event)` | Structural check, before any crypto |
