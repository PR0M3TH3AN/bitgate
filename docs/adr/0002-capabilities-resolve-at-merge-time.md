# ADR 0002 — Capabilities resolve at merge time

**Status:** accepted

## Context

The reference application treated moderator status as a UI permission: an
editor list gated which buttons appeared, but the resulting events carried no
cryptographic authority. Anyone could publish the same event.

Revocation is the hard part. If a contribution's validity is decided when it is
ingested, revoking a role later requires finding and undoing everything that
actor ever contributed.

## Decision

Contributions are stored as-published, keyed by (actor, kind). Effective state
is derived by `reduceAdminState`, which resolves each actor's capabilities
against the *current* authority state every time it runs.

## Consequences

Revocation is immediate and requires no rewriting: drop the role, recompute,
and that actor's entries are gone. A revoked moderator's stored contributions
become inert rather than needing deletion.

Reduction cost is proportional to total contributions rather than to the change.
For realistic list sizes this is far cheaper than maintaining incremental
invalidation, and the store only recomputes when something actually changed.

An actor's contributions can also come *back* if their role is restored, which
is the correct behavior for a mistaken revocation but must be understood when
reasoning about "permanent" removal — permanence lives in the contribution
being retracted, not in the role.
