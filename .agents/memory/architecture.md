# Architecture

Durable architectural decisions and constraints for BitGate.

## Administrative state fails closed without signature verification

With no `verifySignature` configured, roles, policy, and contribution
documents are rejected outright (counted in `diagnostics.rejectedUnverified`)
— `event.pubkey` is an unauthenticated claim until a signature is checked, so
an authorship check alone proves nothing. Verification runs inside
`ingestEvent` itself, not only in the loaders, because `ingestEvent` is
public API; an asynchronous verifier on that synchronous path is treated as
unverified ("I could not check this" reads as failure), and `ingestVerified()`
or the loaders must be used to await one. `trustUnsignedEvents: true` and the
widget's `verify="off"` exist for local development only and are made visible
on purpose. Trust signals (reports, mutes) are deliberately not gated this
way because they are bounded by the viewer's own follow graph — a weaker
guarantee, which is why verification still matters for them.

Authoritative source:
- docs/security.md ("Signature verification is required")
- packages/verify/

## Relays are transport, not authority

Everything arriving from a relay is untrusted input: a relay can withhold
events, replay old ones, and — absent signature verification — fabricate them
wholesale, including `pubkey`. Two independent checks therefore gate
administrative state: authorship (a roles document is accepted only from the
deployment's `configuredRoot`, compared against the constructor value and
never against current authority state, so a bad ingest cannot move the
goalposts) and authenticity (the signature check above). The hostile-input
table in the security doc enumerates the attacks this design is meant to
survive; consult it before touching ingest, authorship, or verification
paths.

Authoritative source:
- docs/security.md ("The trust boundary", "Hostile input BitGate is designed to survive")
