# ADR 0005 — Rename to BitGate

**Status:** accepted (supersedes the repository-name decision in §5.1 of the
migration plan)

## Context

The project shipped as `nostr-governance`, a name chosen while it was still a
specification exercise. Three problems emerged once it became a product.

"Governance" means something specific and different to this audience. In Nostr
and crypto circles it reads as DAO voting and token-weighted proposals. The
project is a moderation and access-control policy engine; the word misdirects.

It named a category rather than a product. It could not be verbed, and it gave
no signal that BitVid and BitRoad compose with it.

It named the mechanism rather than the benefit. The sibling project BitLogin is
not called "Nostr Portable Auth" — it is called BitLogin, because *login* is
what people want.

## Decision

Rename to **BitGate**, joining the existing `bit-` family (BitVid, BitRoad,
BitLogin, BitUnlock). Gates open and close, which maps onto the allow/deny
ladder, and "gate your app" is a natural verb.

- npm scope: `@nostr-governance/*` → `@bitgate/*`
- custom elements: `governance-*` → `bitgate-*`
- custom events: `governance:*` → `bitgate:*`
- storage key prefix: `nostr-governance:` → `bitgate:`
- consumer entry points: `createGovernanceRuntime` → `createBitGate`,
  `defineGovernanceElements` → `defineBitGateElements`

Domain vocabulary is unchanged. `GovernanceDecision`, `GovernanceTarget`, and
`GovernanceRuntime` keep their names: the product is BitGate, the subject
matter is still governance.

The migration plan and the `.hermes` execution plan are left as written. They
record decisions as they were made; this ADR records the change rather than
rewriting history.

## Consequences

Done at 0.1.0, unpublished, with no external consumers — the cheapest this
could ever be. The storage key prefix changed, which would have invalidated
caches had anything been deployed.

The `bit-` prefix signals membership in one author's suite, which is a mild
cost for infrastructure intended for wider adoption. BitLogin carries the same
cost and it has not hurt it; the composability signal is worth more, especially
since BitLogin and BitGate are designed to be used together.
