# ADR 0003 — The engine carries no thresholds

**Status:** accepted

## Context

The extraction started from one application's numbers: blur at 3 trusted
reports, hide at 20 trusted mutes, a 60-day mute window. Those were nearly
promoted into the core as defaults, which would have made every future consumer
inherit a video application's editorial judgement.

## Decision

The core defines the *vocabulary* — target types, capabilities, effect ladders,
reason identifiers, aggregation and precedence rules — and no thresholds.
Applications supply a `PolicyDefinition` of named profiles with category
thresholds. The characterized reference values live in
`@bitgate/bitvid-compat` as one application's profile.

`NEUTRAL_POLICY` is the fallback: it enforces administrative denial and applies
no trust thresholds, so the generic engine never hides content merely because
one trusted account acted against it.

## Consequences

A new consumer writes a policy instead of arguing with a default. The commerce
example needed no core change, which is the test this decision has to pass.

An application that supplies no policy gets very little enforcement. That is
deliberate: silently applying someone else's moderation thresholds is worse than
applying none, because the operator would not know it was happening.

Threshold `0` means "gate disabled" rather than "fires on everything", so
zeroing a value is a safe way to switch a gate off.
