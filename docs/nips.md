# Nostr spec coverage

What BitGate implements, what it deliberately does not, and where the gaps are.
Verified against the NIPs repository; specs move, so re-check before relying on
this table for anything load-bearing.

## Implemented

| NIP | Kind | How BitGate uses it |
| --- | --- | --- |
| **NIP-01** | — | Event shape, replaceable selection with a deterministic same-timestamp tiebreak, and signature verification via `@bitgate/verify` (id recomputed, then schnorr-checked) |
| **NIP-02** | 3 | The viewer's follow list *is* the trust graph. Relay hints in the third tag position are captured as an outbox fallback. |
| **NIP-19** | — | bech32 `npub`/`note` decoding at the codec edge, so the core stays hex-only |
| **NIP-32** | 1985 | **Not yet** — see gaps below |
| **NIP-51** | 10000 | Mute lists. Public `p` entries always; the viewer's *own* private entries decrypted through their signer. |
| **NIP-44** | — | Decryption of the viewer's own private mute entries, delegated to the signer |
| **NIP-56** | 1984 | Reports. The report type is read from the 3rd tag position, with fallbacks for clients that place it elsewhere. |
| **NIP-65** | 10002 | Outbox model: each contact's mute list is fetched from *their* write relays |
| **NIP-78** | 30078 | Canonical governance documents — roles, policy, and contribution lists — under namespaced `d` identifiers |

## Deliberate choices

**The viewer's private mutes are decrypted; nobody else's are.** Another
account's private list is none of our business, and the check lives at the
codec boundary rather than relying on callers to behave. A user who mutes
privately should still have their mutes take effect — ignoring them reads as
the product being broken.

**Report categories follow NIP-56 exactly** in the social preset. Declaring a
threshold for a category no standard client emits is dead configuration.

**Commerce categories are non-standard on purpose.** `scam`, `counterfeit`, and
`not-as-described` have no NIP-56 equivalent. Reports from generic clients
arrive as `other` and fall through to a `default` threshold, so they are never
silently ignored — including at checkout, where an unclassified complaint earns
review rather than an automatic denial.

**Relays are transport, never authority.** Signatures are verified through an
injected verifier before anything authoritative is accepted.

## Known gaps

**NIP-32 labelling (kind 1985) — the interop gap.** BitGate's contribution
lists are a private vocabulary. NIP-32 is the standard way to publish
moderation labels (`L` namespace, `l` value, targeting `e`/`p`/`a`), and our
user/event/address denials map onto it almost exactly. Emitting NIP-32 would
let other clients honour these moderators; consuming it would let BitGate
subscribe to third-party label sets. This is the highest-value remaining work.

**Trust is binary.** `resolveTrustSet` is "in the viewer's follows, or not".
Most things called web-of-trust weight by hop distance — follows-of-follows at
reduced weight. Adding depth naively would be wrong: a two-hop reporter would
count the same as someone the viewer actually follows. It needs hop-weighted
counting, which is a change to aggregation, not just to the set.

**NIP-72 / NIP-29 communities.** The role roster is a parallel invention to
NIP-72's moderator `p` tags. Note NIP-72 is now marked *"unrecommended: try
NIP-29 instead"*, so a compat codec is only worth building against a specific
target application.

**NIP-86 relay management, NIP-70 protected events.** Relay-side moderation is
a different layer and out of scope; BitGate governs what a client shows, not
what a relay stores.
