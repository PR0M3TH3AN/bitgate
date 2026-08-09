# ADR 0004 — The core is hex-only

**Status:** accepted

## Context

Administrative lists in the wild contain both hex pubkeys and `npub` strings,
and the reference implementation normalized them everywhere it touched them.
Doing the same in the core would mean bech32 decoding in a package that is
meant to have no dependencies and no encoding opinions.

## Decision

`@nostr-governance/core` accepts 64-character hex only. Decoding lives in
`@nostr-governance/nostr` (`normalizePubkeyInput`, `normalizeEventIdInput`),
and codecs normalize at ingest, so the core only ever sees hex.

## Consequences

The core stays dependency-free and runs unchanged in Node and the browser.

The trade-off is a real footgun: `normalizePubkey` returns `""` for a valid
`npub` rather than throwing. Callers that hand user input straight to the core
will silently get nothing. Anything accepting operator or user input must
normalize through the codec package first — this is called out in the
integration guide.
