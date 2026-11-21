# BitGate report 1: what is true of the code, what each project would ask, what is missing

- **Written:** 2026-11-21, by the BitGate session for the BitPortal orchestrator (NSWP `docs/backlog/bitgate.md`).
- **State:** sent and read. The decisions in item 5 and the licence are on the owner's list. The corrections and additions at the end were made after it was sent.
- **Kept here:** this is the record of what was said. The code and tests outrank it; where they disagree, the code is right and this file is stale.

From the BitGate session. I read and changed nothing in another session's checkout. Each claim is marked as seen here, reported by a read-only survey I ran of the other repositories (I spot-checked several lines myself), or not tried by anybody.

## 0. Where BitGate stands

- **Live:** https://bitgate.vercel.app answers HTTP 200 (I fetched headers only). It is a landing page, docs and a demo; the demo has placeholder relays only. I don't know which commit it is on. No npm package has been published (`npm view @bitgate/core` gives 404), and there are no GitHub releases.
- **Repository:** `PR0M3TH3AN/bitgate`, public, licence **GPL-3.0-or-later**.
  - `main` is at 53bd7b8 and was clean when this session started.
  - Draft PR #1 (CSS theme tokens and a VERSION injected at build time) is open and unmerged.
- **Checks, run here at 53bd7b8 on Node 22.23.1:**
  - `npm run lint` exited 0.
  - `npm run build:types` exited 0.
  - `npm test` exited 0: 914 tests in 42 files, plus 39 conformance tests in 1 file.
- **One fault:** `npm ci` exits non-zero. `package-lock.json` has no entry for the `@bitgate/standalone` workspace, so a clean install fails here too, not only on GitHub's checks. `npm install` repaired the lockfile (16 added lines). That change is uncommitted in my main folder. I have asked the owner in this session whether to put it up as a PR; the owner has not answered, and I'm holding it until they do.
- **Own rules (AGENTS.md, in short):**
  - `@bitgate/core` stays dependency-free, with no I/O. The crypto lives only in `@bitgate/verify`.
  - An import-boundary check is part of `lint`.
  - Everything from a relay is untrusted, and administrative state fails closed without signature verification.
  - Behaviour changes update their tests; tests are never weakened.
  - The backlog is `docs/TODO.md`.
  - Memory changes only through reviewed proposals in `.agents/`.

## 1. What BitGate does today

**Built and tested (seen):**
- **Targets:** three kinds only.
  - `user`: a hex pubkey.
  - `event`: an id.
  - `address`: `kind:pubkey:d`.
- **Contributions a curator can make:**
  - `user-allow`
  - `user-deny`
  - `event-deny`
  - `address-deny`
  - `trust-seed`

  **Allow exists for people only.** An allow label pointing at an event or address is dropped on purpose (`packages/nostr/src/labels.js:163-171`).
- **Evaluation:** one call, `evaluateTarget`, is pure and synchronous. It returns four answers:
  - ranking: normal or downrank, with a weight;
  - visibility: allow / warn / restrict / hide / deny;
  - interaction: allow / require-explicit-action / deny;
  - transaction: allow / require-review / deny.

  Composition takes the most severe answer on each dimension, so order doesn't matter. Stable reason IDs and redacted evidence come with each decision.
- **Authority:** a root key, roles and capabilities, resolved when lists are merged (revoking a moderator drops their lists at once). `resolveAuthorityRoster` reads root-signed kind 30000 role sets, so moderators are data, not config.
- **Codecs:**
  - BitGate's own lists on kind 30078 (`d = <namespace>:governance:<scope>:v1`);
  - NIP-32 labels (kind 1985);
  - NIP-56 reports, NIP-51 mutes, NIP-65, NIP-02, NIP-19.
- **Presets:** `social`, `commerce` (browse / detail / checkout / seller-dashboard, where transaction is gated separately from visibility), `admin-only`, and `allowlist` (anyone not allowed is denied on all four dimensions).
- **Other packages:**
  - `@bitgate/verify`: NIP-01 signature checks with @noble.
  - `@bitgate/runtime`: stores, a WebSocket relay transport with reconnects and deduplication, and signed commands.
  - `@bitgate/widget`: custom elements.
  - `@bitgate/standalone`: one ESM file of core plus codecs, without verify.

**Designed only (in `docs/TODO.md`, no code):**
- a single `gate.evaluate({viewer, item, action})` entry point and `gate.explain()`;
- a `bitgate/1` policy schema and policies loaded from signed events;
- the shared BitViewer context and `setViewer`;
- origin and URL targets;
- a published `bitgate.js` with an integrity manifest;
- the MIT relicense.

**Run against real relays: nobody has tried.** Every test uses an in-memory or mocked transport. The characterization fixtures were written from BitVid's source, not captured from relays (`docs/checkpoints.md:40`). The runtime has never run in a Cloudflare Worker.

**Signatures are the caller's job in the headless path (seen).** `decodeLabels` and `resolveAuthorityRoster` read events they assume are already verified (`roster.js:14`). The standalone file leaves verify out. Only the runtime and widget enforce fail-closed. Each consumer below already has its own signature check, so it can be passed in. But nothing in BitGate makes it fail closed on that path today.

## 2. What each project would ask, where, and which dimension answers

Paths below are in the other repositories, per the surveys.

**BitUnlock:**

| Question | Where it is asked today | Target | Answer |
|---|---|---|---|
| May this key sell? | `POST /v1/tenants` → `isSellerOnboardingAllowed` (`src/onboarding-gate.ts:19`, which I checked) | user (seller hex) | **transaction**, sellers list |
| May this key be paid a share? | `POST /v1/payees` → the same gate (`src/api/payees.ts:122-131`). Its TODO already says to split this list "the day the owner wants to invite someone who must be payable but must not sell" | user (payee hex) | **transaction**, a separate payees list |
| May this listing be sold? | **Nothing checks it today.** It would go in `handleRegisterProduct` (`src/api/product.ts:447`) and `handleCreateQuote` (`src/api/quote.ts:236`), next to the suspended-tenant check | address `30078:<seller>:<d>`, plus the seller as user | **transaction** (allow / require-review / deny) |

- **Inferred:** asking at quote time also closes a gap. Today, removing a key from the allowlist does not stop that seller's existing listings; only a separate suspension does.
- That fits BitUnlock's own rule that only new quotes stop and paid buyers are never affected.

**BitPortal and the kit:**

| Question | Where | Target | Answer |
|---|---|---|---|
| Is this world on a door or a list? | `catalog.permits` (`src/shared/catalog.ts:131-167`), used for doors at `src/walk/main.ts:793` | address `37300:<pk>:<d>`, plus the publisher | **visibility** (shelf or door); **ranking** (order, through BitFeed) |
| May I go through? | the Airlock (`src/go/airlock.ts`) | the same | **interaction** (a second confirmation, or no Continue) |
| May I pay to enter? | before a BitUnlock quote | the same | **transaction** |
| Is this person shown, and can they be heard? | kit `presence.ts:834-840` (`blockedKeys`) | user | **visibility** for avatar and voice; **interaction: deny** means don't connect |
| Is anything from this website shown? | the origin of `r` / `/.well-known/nswp.json` | **origin: no such target** | NSWP Q6 |

spec.md §15 already maps the dimensions this way. Its "the host decides the floor; a visitor can only tighten it" matches how BitGate combines answers (the most severe wins).

**BitLogin:**
- **Is this purchase offered?** On BitLogin's own page, `shop-ui.js` around :217-226, after `readListing`. At that point the seller, coordinate, world origin, price and receipt service are all known. Target: listing address plus seller. Answer: **transaction**. The signer only checks `buyingOpenAt` and should stay that way; the page is where the CSP allows fetching.
- **Is this tip offered?** `ecash-ui.js:136-160`. A tip to a person is a user target. A tip to a website has no key, only the origin and the manifest's `tip`, so it hits the origin gap as well. Answer: **transaction**.
- BitLogin's switches (`BUYING_OPEN_AT`, `SHARES_OPEN_AT` in `embedded/permissions.ts:123-132`, which I checked) are on/off per host. They are not lists of people, so they are not what BitGate replaces.

## 3. What BitGate lacks, in order of what blocks an integration first

1. **The licence.** GPL-3.0 here, MIT in BitLogin, BitPortal and NSWP (seen in their `package.json`/`LICENSE`). I found no licence field in BitUnlock. MIT is the accepted target but has not shipped. It blocks every vendoring into an MIT repository. It is a licence, so it is the owner's word under rule 5.
2. **Allow for worlds and listings, not only people.** "Curated until the kinks are worked out" is an allow list of worlds (BitPortal's `d=bitportal` set and the starter set) and of listings. BitGate can only allow users. This needs `address-allow` and `event-allow`, with the allowlist preset gating them. It is small, inside the existing model, and needs tests.
3. **Reading the lists that already exist.** BitPortal's allow list and starter set are NSWP-08 kind 30004 sets, which BitGate cannot read. A codec for 30004 makes the existing signed lists BitGate input as they are. Without it, a curator re-publishes the same worlds in a second format, which is the "second list" the backlog entry forbids.
4. **Several named lists under one curator.** One evaluation has one allow set. Sellers, payees and starter worlds are three lists. This works today by running one reduction per label namespace or value. It wants an agreed vocabulary (for example, one namespace with values `seller`, `payee`, `world`, `deny`), written as vectors under rule 1, and a helper so nobody invents their own.
5. **Fail-closed signature checks on the headless path.** A required `verify` function passed in, so an unverified label or roster cannot count, as the runtime already does. Each consumer passes its own: BitUnlock `nostr-tools verifyEvent`, the kit `core/src/event.ts`, BitLogin its noble code.
6. **A trial end to end.** Against the stand-in relay (`trials/`) first, then the Worker runtime. Nobody has tried either.
7. **Origin targets (Q6).** Needed for "block this website" and tips to a website. They need a design decision first: origin, URL or registrable domain, and how an origin decision combines with the worlds served from it. It doesn't block the first three questions above.
8. **Not blocking:**
   - `gate.evaluate` / `gate.explain`, BitViewer, and a published release. `evaluateTarget` is enough to start.
   - The kit already vendors from a clean sibling checkout with sha256 values, so BitGate can be vendored the same way before a release exists.

## 4. How it would be carried

Sizes are measured here with esbuild minified ESM and `gzip -9`:

| Bundle | Minified | gzip |
|---|---|---|
| core | 29.1 KB | 8.2 KB |
| standalone (core + codecs) | 44.5 KB | 13.0 KB |
| verify (with @noble) | 39.1 KB | 15.3 KB |
| core + codecs + verify | 83.7 KB | 27.9 KB |
| runtime (with core and codecs) | 62.9 KB | 17.8 KB |
| widget | 126.5 KB | 39.9 KB |

- **BitUnlock (Worker, no browser):**
  - **What it takes:** core plus codecs, about 45 KB, with its own `verifyEvent` passed in. It already reads relays with `SimplePool`, so it needs no BitGate runtime.
  - **How it would run:** keep D1 as the store it answers from, and refresh it from the curator's signed lists.
  - **Not yet:** the Worker build hasn't been tried.
- **BitLogin (pages):** core plus codecs, about 45 KB, on the `/connect/` page only, with its own noble check. No widget: the screens are BitLogin's.
- **The kit (vendored, small):** core plus codecs, 44.5 KB (13 KB gzip). That is about 9% of `nswp-core.js` (492 KB). Verify comes from the kit's own `event.ts`; vendoring `@bitgate/verify` would carry a second copy of @noble.
- **None of the three** would take the runtime or the widget to start.

## 5. The curator, and the keys (this needs the owner)

Keys in use today, per the surveys:
- `a4a6b584…b95b` is BitUnlock's `SUPER_ADMIN_PUBKEY` and BitPortal's only operator (checked in `src/shared/instance.ts:58`).
- A separate starter-set curator key `4bf82a93…37a0` signs `d=bitportal-starter-test`. Its secret is in a key file on the owner's machine, outside any repository. NSWP's own Q5 (who holds the curator key) is still open.

**My recommendation:**
- **Root:** the owner's key `a4a6b584…`, as it already is in both places. It signs one thing, rarely: the kind 30000 role set naming the curator keys. It signs through the owner's own signer (BitLogin or a NIP-07 extension), never a file, and no session ever sees it.
- **Curator:** a key of its own, named in that role set. Changing or revoking it is a new signed role set, with no app config or redeploy. To start, one curator for all three lists.
  - Whether its secret may sit in a file for scripts, like today's starter-set key, or only in a signer, is the owner's choice.
  - My recommendation is a signer. A curator key in a file can quietly allow a seller to be paid.

**What I need from the owner:**
- (a) confirm `a4a6b584…` is the root;
- (b) who holds the curator key, and where;
- (c) to sign the role set themself when it is time.

That event is published to public relays, so it is their word under rule 5.

## 6. What stays true until an integration is agreed and tried

- BitUnlock's D1 `seller_allowlist` plus `SUPER_ADMIN_PUBKEY` stays the only list of who may sell or be paid. BitUnlock keeps its admin routes and `/apply`.
- BitPortal's `d=bitportal` allow list, its starter set and visitors' local blocks stay as they are. So do BitLogin's switches.
- Nothing is published to public relays, and no list is copied into BitGate's format.
- **The way in I'd propose:**
  - **Shadow first:** each project computes the BitGate answer beside its existing list, logs where they disagree, and enforces nothing.
  - **Then:** the curator's signed lists are filled from the D1 allowlist and the `d=bitportal` set. That is a publish, so it is the owner's word.
  - **Only after no disagreements:** each project switches, one at a time, BitUnlock last because money moves there.

## What I'd do next in BitGate, if briefed

All of it in my own repository, one PR each, with the gate run here:
1. The lockfile fix.
2. `address-allow` / `event-allow`.
3. A 30004 list codec.
4. A required `verify` on the headless path.
5. A named-lists vocabulary written as vectors.

None of it needs the licence decision to be built. Vendoring it into MIT projects does.

## Corrections and additions after sending

- **The `curator` role can only block people** (`packages/core/src/authority.js:69`). A curator key that keeps the sellers, payees or starter lists needs `contribute-user-allow` granted explicitly in the root's role set, with a `cap` tag (`packages/nostr/src/canonical.js:221-231`). Granting allow is a real power, which is one more reason the curator key belongs in a signer, not a file.
- **The lockfile fault in item 0 is fixed.** It was merged as PR #3 (717db75): `npm ci` installs cleanly again.
- **Two rules from BitUnlock's own session** (NSWP `docs/backlog/bitgate.md`, main at 713c4d6). Any design keeps both:
  1. A block stops new sales only. It never touches a paid buyer's unlock, refresh or recovery.
  2. Every decision is answered from BitUnlock's own database, never by asking another service during a quote. BitGate's lists are copied into a table it reads.

  The shadow-first way in (item 6) fits both.
- **Per-world lists** were asked for next. The answer and its design are in `2026-11-21-lists-answer.md` beside this file, and the wire format will be in `docs/governance-lists.md` (it lands with the per-world lists change).
