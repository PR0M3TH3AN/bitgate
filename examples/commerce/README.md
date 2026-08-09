# Commerce proof-of-fit

A marketplace built on `nostr-governance`, using only the published API.

The point is not to ship marketplace moderation. It is to prove the engine did
not accidentally stay video-specific during extraction: if a commerce consumer
needs a change to `@bitgate/core`, the abstraction is wrong.

## What it demonstrates

The migration plan lists ten behaviors a commerce consumer should show before
`1.0.0`. Each is a numbered block in
[`test/proof-of-fit.test.js`](test/proof-of-fit.test.js):

1. **Seller allowlist mode** — unlisted sellers are hidden from discovery, but
   the allowlist is not enforced at checkout
2. **Administrative seller denial** — takes the seller's whole catalogue down
   while leaving them their own dashboard view
3. **Product-address denial** — survives the seller republishing under a new
   event id, and does not touch their other listings
4. **Exact-event denial** — affects only the named revision
5. **Trusted scam-report downranking** — one report reorders, three block
   checkout; nothing is hidden on a single signal
6. **Malware checkout denial** — one trusted malware report blocks the sale,
   while three "misleading" reports do not
7. **Moderator capability checks** — a listing moderator cannot deny a seller;
   a seller moderator cannot deny a listing address
8. **Community curator ingestion** — curated denials are honored, curator
   contributions beyond their capability are dropped, and the root cannot be
   denied through a curated list
9. **Seller-dashboard explanation** — the seller sees who reported and why;
   public surfaces see only counts
10. **No core changes required** — four different verdicts for one product from
    one snapshot, using only exported functions

## Files

| File | Contents |
| --- | --- |
| `src/policy.js` | Marketplace thresholds and roles. None of these numbers exist in the core. |
| `src/adapters.js` | Products, storefronts, reviews, and sellers as governance targets. |
| `src/marketplace.js` | Feed pipeline, grid ordering, checkout, seller explanation. |

## The shape worth copying

A product answers to three targets — its seller, its exact event, and its
address coordinate — and the composed decision is the strictest verdict reaching
it. That is what makes "deny the seller" remove every listing without a line of
cascade logic in the application.

One product, one snapshot, four surfaces:

| Surface | Visibility | Transaction |
| --- | --- | --- |
| `public-marketplace` | `restrict` | `deny` |
| `product-detail` | `restrict`, overridable | `deny` |
| `checkout` | `allow` | `deny` |
| `seller-dashboard` | `restrict`, with evidence | `deny` |

Reviews deliberately answer to their reviewer and their own event — never to the
product they review. Otherwise denying a bad product would silence the reviews
warning people about it.

## Run it

```bash
npm test -- examples/commerce
```
