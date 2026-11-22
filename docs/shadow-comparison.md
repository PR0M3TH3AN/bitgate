# Shadow comparison: BitGate beside each project's own list

- **Written:** 2026-11-22, by the BitGate session, for the BitPortal
  orchestrator to brief BitUnlock, BitPortal and BitLogin from.
- **State:** a plan. Nothing in it is built, and nothing goes live by it.
- **What it is for:** the owner asked for one place that answers "may this be
  shown, used or sold", with allow and block lists a curator signs, instead of
  a separate list in each project. Before any project trusts BitGate's answer,
  it computes that answer beside its own and records where the two disagree.
  That is the shadow.

Code locations are as read at: BitUnlock `main` 90be0f2, BitPortal `main`
a389395, BitLogin `beta` 48e8a67, BitGate `main` 2476ad2. Each project's
session checks them against its own code before building.

## What stays true while the shadow runs

- **Each project's own list decides.** That means BitUnlock's D1
  `seller_allowlist` with `SUPER_ADMIN_PUBKEY`, BitPortal's `d=bitportal` list
  with its adult filter, and BitLogin's switches. BitGate's answer is recorded,
  never used.
- **No list is published, and no key is made,** by any session. The curator's
  lists exist only once the owner has decided who holds the root and curator
  keys, and has said yes to publishing them (rule 5). Until then the shadow
  runs only in trials, with public test keys and the stand-in relay.

## Rules for every shadow

1. **Compute beside; never enforce.** The response, the screen and the timing
   are exactly what they would be without the shadow. If computing BitGate's
   answer throws, the error is caught and logged as `bitgate: "unavailable"`,
   and the request goes on untouched.
2. **Never call a service or a relay in a request.** Lists are fetched in the
   background, read with a signature check (`readNamedList`,
   `readCurationSet`; BitGate's readers refuse to run without one), and kept
   locally. A request reads only that local copy. No local copy, or one older
   than its freshness limit, means `bitgate: "unavailable"`, never a guess.
3. **Log the answer, never the subject.** No key (hex or npub), listing
   coordinate or name, world coordinate or name, tenant id, quote or order id,
   amount, IP address, user agent or session id. Identity is reconciled
   offline instead (below), by the operator, from data they already hold.
4. **One log line per decision,** in the shape below, so that the three
   projects' lines read the same way.
5. **The shadow is removable.** It lives behind one switch per project
   (`BITGATE_SHADOW`, off by default). Turning it off changes nothing else.

### The log line

One JSON object per decision:

```json
{
  "event": "bitgate_shadow",
  "v": 1,
  "project": "bitunlock",
  "decision": "may-sell",
  "existing": "allow",
  "bitgate": "deny",
  "agree": false,
  "reasons": ["allowlist-miss"],
  "lists": ["<event id of each list copy read>"],
  "listsAge": 5400,
  "at": 1763800000
}
```

| Field | Meaning |
| --- | --- |
| `decision` | A name from the named-lists vocabulary (`may-sell`, `may-be-paid`, `may-sell-listing`, `may-sell-listing-curated`), or `world-shown` for BitPortal |
| `existing` | The project's own answer: `allow` or `deny` |
| `bitgate` | `allow`, `deny` or `unavailable` (the transaction dimension, or visibility for `world-shown`) |
| `agree` | `existing === bitgate`; `false` whenever `bitgate` is `unavailable` |
| `reasons` | BitGate's reason ids for its answer (stable codes, e.g. `admin-user-deny`, `allowlist-miss`) |
| `lists` | The event ids of the list copies the answer was read from. These are public, and say which version decided |
| `listsAge` | Seconds since the newest of those copies was fetched |
| `at` | Unix seconds |

Nothing else goes in the line.

## Offline reconciliation

The log says *that* the two answers disagree. Who is on which list is a
comparison of two sets the operator already holds. So it is made by an
operator script, on the operator's own machine, and its output stays there:

- **BitUnlock:** the keys in `seller_allowlist` (plus `SUPER_ADMIN_PUBKEY`)
  against the entries of `sellers`, and again against `payees`; the suspended
  tenants' keys against `people-blocked`.
- **BitPortal:** the `a` entries of the `d=bitportal` list as BitPortal reads
  it (`catalog.ts`) against the same event read by `readCurationSet`.

An empty difference, together with logs that show no unexplained
disagreement, is the evidence for switching.

## BitUnlock

The Worker computes three decisions from the named lists, read from a local
copy.

| Decision | Where (the existing answer) | BitGate reads | The existing answer is |
| --- | --- | --- | --- |
| `may-sell` | `handleUpsertTenant`, `src/api/tenant.ts:98`, beside `isSellerOnboardingAllowed` | `sellers`, `people-blocked` | `isSellerOnboardingAllowed(env, db, pubkey)` |
| `may-be-paid` | `handleRegisterPayee`, `src/api/payees.ts:123`, beside the same gate | `payees`, `people-blocked` | the same gate, unless `PAYEE_REGISTRATION=open` (then `allow`) |
| `may-sell-listing` | `handleCreateQuote`, `src/api/quote.ts`, beside the suspended-tenant check (`:297`); and `handleRegisterProduct`, `src/api/product.ts:447` | `listings-blocked`, `people-blocked` (through the listing's seller) | the tenant is not `suspended`, and the product is active |

- **`may-sell-listing-curated`** may be logged too. It is expected to disagree
  wherever an allowed seller has a listing nobody curated, because BitUnlock
  has no counterpart today. Enforcing it would stop existing listings, so
  switching it on is the owner's word at the time.
- **The root.** BitGate's root is never gated, which matches
  `SUPER_ADMIN_PUBKEY` always being allowed. The authority is built from the
  root's role document with `NAMED_LIST_ROLES`.
- **Listings** are matched by coordinate only, with BitUnlock's own rule
  (`parseListingCoordinate`), never by event id.
- **How the lists reach the Worker:**
  - The daily cron (or a more frequent scheduled refresh) reads the
    curator's named lists and the root's role document from
    `SERVICE_RELAYS` with the existing `SimplePool`.
  - Each event is checked with the existing `verifyEvent` from
    nostr-tools, passed to BitGate's readers as `verify`.
  - The verified events are stored as they are in a D1 table of BitUnlock's
    choosing.
  - A request reads only D1. Freshness limit: 48 hours since the last good
    refresh; older means `unavailable`.
- **Carried code:** `@bitgate/core` and `@bitgate/nostr`, about 45 KB
  minified, with no new crypto. BitUnlock passes its own verifier.
- **The log** goes to Workers Logs: `observability` is already on in
  `wrangler.jsonc:10`, so it's one `console.log` of the line. No new D1 table
  holds log lines.
- **The rule that stays:** a block stops new sales only. A shadow never
  touches unlock, refresh, retry, recovery or fulfilment, and logs nothing
  there.
- **Expected disagreements** (each must be explained, not only counted):
  - **`may-sell-listing` denied by BitGate but allowed today:** a seller on
    `people-blocked` whose tenant is not suspended. This is the known gap in
    item 2 of report 1, and it is the shadow's main finding to expect.
  - **`may-be-paid` while `PAYEE_REGISTRATION=open`:** BitGate still reads
    `payees`, so it disagrees by design. Record it; don't count it against
    switching.

## BitPortal

| Decision | Where (the existing answer) | BitGate reads | The existing answer is |
| --- | --- | --- | --- |
| `world-shown` | `catalog.permits`, `src/shared/catalog.ts:167`, used for the doors at `src/walk/main.ts:821` | the host's `d=bitportal` curation set (`readCurationSet` / `resolveCurationSet`) as `address-allow`, under the `allowlist` preset | `!adult(world) && (!allowListOnly \|\| allowed.has(id))` |

- **The adult filter stays BitPortal's own.** Only the allowlist half is
  compared, so the BitGate answer is taken as "on the host's list".
- **Not in visitors' pages.** What a visitor looks at is not logged anywhere,
  in any form. BitPortal's shadow is a script instead (in NSWP `trials/`, or a
  BitPortal operator script):
  - it reads the host's list and the world announcements;
  - it computes both answers for every world;
  - it writes a report to the operator's machine.

  It runs first against the stand-in relay with test keys. A read-only run
  against public relays reads public events and publishes nothing; whether to
  run it is the orchestrator's call.
- **Expected:** full agreement, since both read the same signed list. A
  disagreement is a reader difference, which is exactly what the shadow is for:
  the `d` rule, future-dated copies, a world's name with a colon.
- **The starter set** can be compared the same way once it is read through
  BitGate, under the curator's key.

## BitLogin

| Decision | Where | BitGate reads | The existing answer is |
| --- | --- | --- | --- |
| `may-sell-listing` (is this purchase offered) | `packages/demo/public/assets/shop-ui.js:217–223`, after `readListing` | `listings-blocked`, `people-blocked` | offered when the listing reads, its service is known, and BitUnlock quotes |

**Recommendation: BitLogin does not shadow in the first round.**

- BitUnlock's quote is the authority on whether a listing may be sold, and its
  shadow already computes this decision at the moment that matters.
- In BitLogin the same comparison would add a fetch to the buy screen and a
  new place where a visitor's purchase could be observed, for no evidence
  that BitUnlock's shadow doesn't give.

**If it is wanted later:**
- lists fetched in the background, not on the buy screen;
- the line written to the browser console only, behind `BITGATE_SHADOW`;
- never sent anywhere;
- off by default on bitlogin.network, where a merge to `main` is a release.

## Never

- **Enforce,** or change a response, a screen, a status code or its timing.
- **Call a service or a relay during a request,** a quote above all.
- **Log a key, a listing, a world, or anything that identifies a person or a
  purchase.**
- **Publish a list, make a key, or sign anything with a real key.** Trials use
  public test keys only.
- **Run a shadow in a fulfilment, unlock, refresh or recovery path.**

## How long, and who switches

The shadow runs until **all** of these hold, per decision:

- at least **14 days** with the curator's real lists in place;
- **no unexplained disagreement** in that time. Each explained one is fixed
  in a list or in code, or recorded as expected (above);
- **the offline reconciliation shows an empty difference;**
- for BitUnlock, **at least 20 logged decisions** of each kind it switches.
  Sign-ups are rare, so this, not the days, may be what takes longest.

**Switching is the owner's word,** because it changes live behaviour. It is
asked through the orchestrator, one project and one decision at a time:

1. BitPortal first. It is display only.
2. BitUnlock's `may-sell` and `may-be-paid`.
3. BitUnlock's `may-sell-listing`.
4. `may-sell-listing-curated` only if the owner wants curated listings.

Each switch keeps the old list's code for one release, so it can be switched
back.

## What waits on whom

1. **The owner:** who holds the root and the curator key, and where (on the
   owner's page under "later"). Nothing real can be shadowed without lists.
2. **The owner:** publishing the curator's lists to public relays (rule 5).
   They are filled first from `seller_allowlist` and `d=bitportal`, so the two
   should agree from the start.
3. **Before either:** each project wires its shadow and tries it in `trials/`
   on the stand-in relay with test keys. BitGate supplies the readers and
   vectors already on `main`. The vectors are in `vectors/governance-lists/`,
   and the spec is `docs/governance-lists.md`.
