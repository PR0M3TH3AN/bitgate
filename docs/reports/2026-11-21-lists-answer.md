# BitGate's allow and block lists as Nostr events, and what a per-world list needs

- **Written:** 2026-11-21, by the BitGate session, answering the BitPortal orchestrator for NSWP `docs/backlog/private-worlds-by-invitation.md`.
- **State:**
  - Sent and read.
  - Points (a) to (e) were agreed by the orchestrator as design, keeping two events. The kit's builder is checking the shape against the kit.
  - The wire format will be written in `docs/governance-lists.md`, with vectors.
- **Paths:** they refer to `main` at 717db75, which is the state before that change. The code and tests outrank this file.

All of this is seen in the source; none of it has been tried against a relay.

**In short:**
- The shape exists, and a world's owner can be the only signer.
- A reader needs no BitGate code: the event and a signature check are enough.
- BitGate has no list scoped to one world yet. The smallest addition is a change to the codec only (the part that reads and writes events), with no engine change (point 6).

## 1. The event, as it is today

- **Kind:** 30078, the NIP-78 application-data kind. It is addressable and replaceable (`packages/nostr/src/canonical.js:19`).
- **Two separate events, told apart by the `d` tag:**
  - `d` is `<namespace>:governance:<scope>:v1`. It is built at `canonical.js:45-47` and parsed with `^([^:]+):governance:([^:]+):v(\d+)$` at `canonical.js:54-64`.
  - The scope `user-allow` is the allow list and `user-deny` is the block list. The scope table is at `canonical.js:25-31`.
- **Tags written** (`canonical.js:291-314`):
  - `["d", …]`, `["v","1"]`, `["client","bitgate"]`, `["scope", <scope>]`;
  - optionally `["source", …]`;
  - one `["p", <hex pubkey>]` per person.
  - The content is always empty.
- **An entry names a person by key only.** The decoder reads `tag[1]` of each `p` tag (`canonical.js:126-131`) and ignores any relay hint or petname. It also accepts an npub there (`packages/nostr/src/nip19.js:178-187`), but the encoder writes hex.
- **Which copy counts:** the newest `created_at` wins. A tie goes to the lexicographically smallest id (`packages/nostr/src/replaceable.js:54-85`).

## 2. Who may sign one

- The decoder accepts any signer (`canonical.js:103`).
- Authority is applied later, when lists are combined. A list counts only if its signer holds the matching capability (`packages/core/src/adminState.js:97-105`; the capability table is at `:39-46`).
  - `contribute-user-allow` is held only by `super_admin`.
  - `contribute-user-deny` is held by super_admin, moderator and curator (`packages/core/src/authority.js:50-70`).
- The root always holds every capability, and it can never be blocked (`authority.js:93-95`, `adminState.js:173-181`).
- So for a world, the authority has root = the world's owner. The owner's own two lists are the whole authority, with no role set and no curator.

## 3. Scoped to one thing, or only a whole application?

- Today a list covers only a whole namespace, meaning one application, per signer.
- The namespace cannot contain `:` (`canonical.js:58`), so a world's coordinate `37300:<pk>:<d>` cannot be put in it.
- One owner with two worlds would therefore have one guest list for both. No per-world list exists.

## 4. Hidden entries

- The list event has none: the content is always empty (`canonical.js:313`) and nothing decrypts it.
- The only hidden entries in BitGate are NIP-51 private mutes. They are NIP-44 encrypted to the signer themself (`packages/nostr/src/mutes.js:70-120`), so only the owner can read them. That is no use for a gate, because the visitor's kit cannot read them.
- Encrypting to a group needs a group key, and BitGate has none.
- **What a non-member could tell from a hidden list:**
  - that it exists, who signed it, and when;
  - any public tags;
  - roughly how many entries it has, from the ciphertext's length.
- **Hashing the keys instead hides no one.** Pubkeys are public, so anyone can hash every key they know and compare.
- **So start with lists anyone can read, and say so in the menus.** Bring hidden lists with the sealed kind. A public block list also tells the world whom the owner blocked.

## 5. Checking a list without BitGate

The event and a signature check are enough. A reader:
1. checks kind 30078, the signature, and that the signer is the world's owner;
2. checks the `d` grammar and the scope;
3. reads the `p` tags.

No service is asked. What was missing is a written spec (`docs/nips.md:19` has one line). That is now `docs/governance-lists.md`, with vectors.

**Blocked beats allowed: yes.**
- Blocks are applied at step 6 (`packages/core/src/evaluator.js:341-361`).
- The allow list, at step 7, only adds "not on the list" when someone is missing (`evaluator.js:371-380`). Being allowed never removes a block.
- Results combine by taking the most severe answer on each dimension.
- The one exception: the root (the owner) cannot be blocked by anyone, the owner included.

## 6. What to change now, in order (agreed as design)

a. **Per-world lists.**
   - The same kind and scopes, with an optional subject on the end of `d`: `<namespace>:governance:<scope>:v1:<coordinate>`.
   - A required tag `["subject", <coordinate>]` must equal that suffix.
   - Readers that haven't been updated reject these events outright. So an old reader ignores a per-world list rather than applying it to the whole application.
   - A per-world list counts only for that world, and only when signed by the subject's own pubkey.
   - The engine is unchanged: the reader builds one snapshot per world with root = the owner.
b. **Refuse disagreement between `scope` and `d`.** Today a `scope` tag overrides `d` (`canonical.js:97`), so a `d` saying `user-allow` with a scope of `user-deny` reads as a block.
c. **Hex only on the wire.** npub stays accepted as input in screens only, not in events.
d. **A cap on entries:** 2,000 per event. An event over the cap is refused, not truncated.
e. **Allow for addresses and events**, alongside allow for users.

**Keep two events (allow and block) rather than one with both.**
- That is the existing shape.
- Each half replaces independently.
- Because blocked beats allowed, publishing the block first is always safe.
