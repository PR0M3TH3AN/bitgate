# Security model

What BitGate assumes, what it enforces, and what it cannot do for you.

## The trust boundary

Everything arriving from a relay is untrusted input. Relays are transport, not
authority: a relay can withhold events, replay old ones, and — absent signature
verification — fabricate them wholesale, including the `pubkey` field.

Two independent checks gate administrative state:

1. **Authorship.** A roles document is accepted only from the deployment's
   configured `root`. Comparison is against `configuredRoot` — the value passed
   to the constructor — never against the current authority state, so a bad
   ingest cannot move the goalposts for the next one.
2. **Authenticity.** `event.pubkey` is an unauthenticated claim until a
   signature is checked, so an authorship check alone proves nothing.

## Signature verification is required

Administrative state **fails closed** without it. With no `verifySignature`
configured, roles, policy, and contribution documents are rejected and counted
in `diagnostics.rejectedUnverified`.

```js
createBitGate({
  root: ROOT_PUBKEY,
  verifySignature: (event) => verifyEventSignature(event),   // your crypto library
  …
});
```

`trustUnsignedEvents: true` exists for local development and tests, where
events are constructed in-process and there is no relay to lie. Never set it in
production; `describe().signatureVerification` reports the posture.

Trust signals — reports and mutes — are **not** gated this way, because they are
bounded by the viewer's own follow graph rather than by authority. A forged
report only counts if it appears to come from someone the viewer already
follows. That is a weaker guarantee than the administrative path and is the
reason verification still matters for them.

## Hostile input BitGate is designed to survive

| Attack | Defence |
| --- | --- |
| Publishing a roles document to become root | Authorship check against configured root |
| A relay forging an event from the root's key | Signature verification; fails closed without it |
| Report category crafted to dodge thresholds (`constructor`, `__proto__`) | Own-property lookups and null-prototype tables throughout |
| Denied account manufacturing reports | Denied and blocked accounts are excluded before aggregation |
| One account reporting repeatedly | Deduplicated per (reporter, category) |
| Curator exceeding their remit | Capabilities resolved at merge time, per contribution kind |
| Denying the root or a protected actor | Protected actors stripped from every denial set, and refused at the command boundary |
| Same-origin script tampering with cached state | A cached roster naming a different root is rejected outright |
| Stale relay data holding a target down forever | Configurable mute validity window |
| Unbounded relay responses | Administrative queries filter on governance `d` identifiers and carry a limit |

## What BitGate does not do

**It never handles secret material.** Signing and decryption are delegated to an
injected signer. There is no code path that reads a private key.

**It cannot decrypt another account's private mutes**, and does not try. Only
the viewer's own list is decrypted, and the check lives at the codec boundary
rather than depending on callers to behave.

**It does not moderate relays.** BitGate governs what a client shows; what a
relay stores is a different layer (see NIP-86).

**It is not a rate limiter.** Report and mute stores carry ceilings to bound
memory, not to resist flooding. A relay that floods you will evict your own
cache first.

## Operational guidance

- Configure `root` explicitly. Without it, every roster is refused.
- Configure `verifySignature`. Without it, all administrative state is refused.
- Treat `describe()` as a health check: `signatureVerification`, `stale`,
  `rejectedUnauthorized`, and `rejectedUnverified` all indicate posture.
- Rotating the root invalidates cached state by design — the storage key is
  namespaced by root identity.
- Serve the widget from your own origin, built from source you have read.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.
