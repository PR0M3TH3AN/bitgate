# ADR 0007 — NIP-32 labelling as the interop surface

**Status:** accepted

## Context

BitGate read two standard event kinds (NIP-56 reports, NIP-51 mutes) but
published its moderation output as a private vocabulary — contribution lists
under a `bitgate`-namespaced `d` identifier. Other clients could not act on a
BitGate deployment's moderator decisions, and BitGate could not act on anyone
else's. For a project whose stated goal is being a reusable building block,
that made it an island.

NIP-32 (kind 1985) is the shared vocabulary for moderation labels: an `L`
namespace, an `l` value, and `e`/`p`/`a` targets.

## Decision

Treat a label as **just another wire format for a contribution**, subject to
the identical capability gate.

A NIP-32 label is `(namespace, value, target)`. A BitGate contribution is
`(kind, target)` that only takes effect if its author holds the matching
capability. The bridge is `labelsToContributions(labels, mapping)`, where the
application supplies the namespace it trusts and the label values that mean
deny or allow. A matching label becomes a contribution authored by the
labeller, with a `source` marker, and reduces exactly like a community source:
it denies someone only if the labeller holds the capability in the roster.

The codec itself carries no vocabulary. "MIT", "nsfw", and "spam" are all
labels; whether any of them means denial is a policy decision that lives in the
caller's `labelMapping`, not in the codec. This is what keeps it a building
block: an application brings its own namespace and its own words.

- **Consume:** `ingestEvent` maps kind 1985 through the configured
  `labelMapping`; `loadLabels(labellers)` fetches them.
- **Emit:** `commands.publishLabel(target, value)`, gated by the same
  capability as denying the target, so the shared form is no weaker than the
  private one.

## Consequences

A BitGate deployment can honour a third-party labeller by adding them to the
roster with a contribution capability — no new trust mechanism, because labels
reuse the one that already exists. Other clients can read a deployment's
`deny` labels. The two directions round-trip.

Because labels are administrative state, they fail closed without signature
verification, like every other administrative document.

`r` (relay) and `t` (topic) label targets are dropped rather than mapped: they
have no place in an allow/deny model, and representing them as something else
would be worse than ignoring them. An application that cares about topic labels
can consume the codec's generic `decodeLabels` output directly.
