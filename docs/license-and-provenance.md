# License and Provenance

## Reality check

BitVid is GPL-3.0-or-later. Direct ports of BitVid logic or structure into this
repository create a derivative-work obligation. Do not pretend extracted
behavior is clean-room MIT unless it truly is independent work.

BitRoad is MIT and is used here only as a target/model reference.

## Working stance for this repo

Until a lawyer-ready SPDX audit is done, treat the repository as:

1. **Tooling / scaffolding** — original workspace layout, CI, docs structure.
2. **Likely GPL-encumbered governance behavior** — anything characterized from
   BitVid moderation thresholds, trust seeds, admin lists, report dedupe, mute
   expiry, and related evaluator precedence.
3. **MIT-compatible address concepts** — BitRoad coordinate shapes, used as
   consumer validation cases rather than copied UI/runtime code.

## Package boundary intention

| Package | Intention |
| --- | --- |
| `@bitgate/core` | Clean API surface + pure evaluator. Avoid BitVid names. |
| `@bitgate/nostr` | Codecs. Legacy BitVid codec is provenance-sensitive. |
| `@bitgate/runtime` | Transport/storage orchestration. |
| `@bitgate/bitvid-compat` | Explicit BitVid-facing adapter. Most provenance-exposed. |
| `@bitgate/testing` | Fakes and fixture loaders. |

## Rules

- No direct imports from BitVid or BitRoad source trees.
- Fixtures copied into this repo must record the source commit in README or metadata.
- If a module is ported from BitVid rather than rewritten cleanly, document it in
  the PR and keep SPDX compatible with GPL-3.0-or-later.
- Do not dual-license the whole monorepo casually. Prefer one root LICENSE once
  chosen, and call out adapter exceptions only if they are scoped carefully.

## Open decision (checkpoint 0)

Root license has not been finalized in this bootstrap.
Recommended default for continued extraction work: **GPL-3.0-or-later**.

Decision needed from owner before publishing packages.
