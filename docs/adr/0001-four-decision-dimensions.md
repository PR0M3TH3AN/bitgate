# ADR 0001 — Four independent decision dimensions

**Status:** accepted

## Context

The reference application collapsed moderation into a small number of booleans
(`blurThumbnail`, `hideReason`, `blockAutoplay`), computed in two places that
overlapped. A commerce consumer needs a state those booleans cannot express: a
product that is visible, inspectable, downranked, and unbuyable at once.

## Decision

A decision carries four independent dimensions, each an ordered ladder:

- `ranking`: `normal` → `downrank` (with accumulated weight)
- `visibility`: `allow` → `warn` → `restrict` → `hide` → `deny`
- `interaction`: `allow` → `require-explicit-action` → `deny`
- `transaction`: `allow` → `require-review` → `deny` (present only when a
  profile can affect it)

Composition takes the ladder maximum per dimension.

## Consequences

Composition is commutative and associative, so the order decisions arrive in
cannot change the result — which is what lets an object be evaluated against
several targets and merged without an ordering rule.

Consumers must map dimensions to their own UI rather than reading a boolean.
That is more work at the call site and is the point: the mapping is application
policy, and putting it in the engine is how the duplication started.

`transaction` is absent rather than `allow` when no profile gate can reach it,
so a consumer can distinguish "explicitly permitted" from "not governed here".
