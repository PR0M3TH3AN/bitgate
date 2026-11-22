// Named lists: one curator, several lists, one vocabulary.
//
// An application-wide list is one replaceable event per signer, namespace and
// scope, so one namespace gives a curator exactly one allow list. "Who may
// sell" and "who may be paid a share" are two different lists (BitUnlock's
// own notes say to split them "the day the owner wants to invite someone who
// must be payable but must not sell"), so each named list gets a namespace of
// its own. This file is the vocabulary: the names, what each list answers,
// and which lists each decision reads. Readers in other projects are held to
// vectors/governance-lists/named-lists.json, not to this code.
//
// The names were given by the fleet's orchestrator on 2026-11-21 (NSWP
// docs/fleet.md, "Names given"). They are now an agreement between projects:
// change one only after asking there, then regenerate the vectors.
//
// Worlds are not here: a host's list of worlds and a curator's starter set
// are NSWP-08 curation sets (curationSets.js), read as they are.

import { DEFAULT_ROLE_CAPABILITIES } from "@bitgate/core";

import { canonicalIdentifier, decodeContribution, encodeContribution, CANONICAL_KIND } from "./canonical.js";
import { getTags, selectReplaceable } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').Contribution} Contribution
 * @typedef {import('@bitgate/core').GovernanceTarget} GovernanceTarget
 */

/**
 * @typedef {Object} NamedListDefinition
 * @property {string} namespace
 * @property {"user-allow"|"user-deny"|"address-allow"|"address-deny"} scope
 * @property {string} answers - The question an entry on the list answers yes (allow) or no (deny) to
 */

/** @type {Readonly<Record<string, Readonly<NamedListDefinition>>>} */
export const NAMED_LISTS = Object.freeze({
  sellers: Object.freeze({
    namespace: "bitunlock.sellers",
    scope: "user-allow",
    answers: "May this key sell?",
  }),
  payees: Object.freeze({
    namespace: "bitunlock.payees",
    scope: "user-allow",
    answers: "May this key be paid a share of a sale?",
  }),
  "listings-allowed": Object.freeze({
    namespace: "bitunlock.listings",
    scope: "address-allow",
    answers: "Is this listing on the curated list? (Read only while listings are curated.)",
  }),
  "listings-blocked": Object.freeze({
    namespace: "bitunlock.listings",
    scope: "address-deny",
    answers: "Is this listing blocked from sale?",
  }),
  "people-blocked": Object.freeze({
    namespace: "bitunlock.people",
    scope: "user-deny",
    answers: "Is this person blocked from selling and from being paid?",
  }),
});

/**
 * Which named lists each decision reads. A block on a person reaches every
 * decision about them, and blocks a listing through its seller.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const NAMED_DECISIONS = Object.freeze({
  "may-sell": Object.freeze(["sellers", "people-blocked"]),
  "may-be-paid": Object.freeze(["payees", "people-blocked"]),
  "may-sell-listing": Object.freeze(["listings-blocked", "people-blocked"]),
  "may-sell-listing-curated": Object.freeze(["listings-allowed", "listings-blocked", "people-blocked"]),
});

/**
 * The role a list curator is given in the root's role document: it may keep
 * every named list, and nothing else (no roles, no policy).
 *
 * @type {Readonly<Record<string, readonly import('@bitgate/core').GovernanceCapability[]>>}
 */
export const NAMED_LIST_ROLES = Object.freeze({
  ...DEFAULT_ROLE_CAPABILITIES,
  "list-curator": Object.freeze(/** @type {import('@bitgate/core').GovernanceCapability[]} */ ([
    "contribute-user-allow",
    "contribute-user-deny",
    "contribute-address-allow",
    "contribute-address-deny",
  ])),
});

/**
 * The exact `d` of a named list. Ask relays for this, by the curator's key.
 * @param {string} name
 * @returns {string}
 */
export function namedListIdentifier(name) {
  const definition = Object.hasOwn(NAMED_LISTS, name) ? NAMED_LISTS[name] : undefined;
  if (!definition) {
    throw new TypeError(`Not a named list: ${JSON.stringify(name)}`);
  }
  return canonicalIdentifier(definition.namespace, definition.scope);
}

/**
 * A listing's coordinate, exactly as BitUnlock states it
 * (`src/protocol/product-coordinate.ts`) and the NSWP kit's `cleanListing`
 * reads it: `30078:<64 lowercase hex>:<name>`, the name 1 to 256 characters
 * (JavaScript string length) on one line, not starting with a colon. Spaces,
 * and colons after the first character, are allowed. A listing is known only
 * by this coordinate, never by an event id, so a block survives the seller
 * republishing it.
 */
export const LISTING_COORDINATE = /^30078:([0-9a-f]{64}):([^:\r\n][^\r\n]{0,255})$/;

/**
 * Parse a listing coordinate by {@link LISTING_COORDINATE}. The name is kept
 * exactly: no trimming, unlike the general coordinate reader.
 * @param {unknown} value
 * @returns {import('@bitgate/core').AddressTarget|null}
 */
export function parseListingCoordinate(value) {
  const match = typeof value === "string" ? LISTING_COORDINATE.exec(value) : null;
  return match ? { type: "address", kind: "30078", pubkey: match[1], identifier: match[2] } : null;
}

/** @type {Map<string, string>} */
const NAME_BY_D = new Map(Object.keys(NAMED_LISTS).map((name) => [namedListIdentifier(name), name]));

/**
 * Which named list an event is, by its exact `d`, or null.
 * @param {unknown} event
 * @returns {string|null}
 */
export function namedListOf(event) {
  if (!event || typeof event !== "object" || /** @type {any} */ (event).kind !== CANONICAL_KIND) {
    return null;
  }
  const ds = getTags(/** @type {NostrEvent} */ (event), "d");
  if (ds.length !== 1) {
    return null;
  }
  return NAME_BY_D.get(ds[0][1]) ?? null;
}

/**
 * Encode a named list as an unsigned event template.
 * @param {string} name
 * @param {GovernanceTarget[]} targets
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeNamedList(name, targets) {
  const definition = NAMED_LISTS[name];
  namedListIdentifier(name);
  return encodeContribution({ actor: "", kind: definition.scope, targets }, definition.namespace);
}

/**
 * Read one named list.
 *
 * @param {unknown} event
 * @param {Object} options
 * @param {(event: NostrEvent) => boolean} options.verify - Required; anything but `true` fails
 * Entries that do not fit are skipped and counted: a person must be 64
 * lowercase hex (`p`), a listing must fit {@link LISTING_COORDINATE} (`a`).
 *
 * @returns {{ ok: true, name: string, contribution: Contribution, skipped: number }
 *   | { ok: false, reason: "no_verifier" | "not_a_named_list" | "invalid" | "bad_signature" }}
 */
export function readNamedList(event, { verify } = /** @type {any} */ ({})) {
  if (typeof verify !== "function") {
    return { ok: false, reason: "no_verifier" };
  }
  const name = namedListOf(event);
  if (!name) {
    return { ok: false, reason: "not_a_named_list" };
  }
  const contribution = decodeContribution(/** @type {NostrEvent} */ (event));
  if (!contribution || contribution.kind !== NAMED_LISTS[name].scope) {
    return { ok: false, reason: "invalid" };
  }
  let verified = false;
  try {
    verified = verify(/** @type {NostrEvent} */ (event)) === true;
  } catch {
    verified = false;
  }
  if (!verified) {
    return { ok: false, reason: "bad_signature" };
  }
  const definition = NAMED_LISTS[name];
  const isListingList = definition.scope === "address-allow" || definition.scope === "address-deny";
  const tagName = isListingList ? "a" : "p";
  const values = getTags(/** @type {NostrEvent} */ (event), tagName).map((tag) => tag[1]);
  /** @type {Map<string, GovernanceTarget>} */
  const targets = new Map();
  let skipped = 0;
  for (const value of values) {
    const target = isListingList
      ? parseListingCoordinate(value)
      : typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
        ? /** @type {GovernanceTarget} */ ({ type: "user", pubkey: value })
        : null;
    if (target) {
      targets.set(String(value), target);
    } else {
      skipped += 1;
    }
  }
  return { ok: true, name, contribution: { ...contribution, targets: Array.from(targets.values()) }, skipped };
}

/**
 * Read every named list from whatever relays returned, choosing the current
 * copy of each.
 *
 * Each list is a replaceable event per signer and `d`, so relays can return
 * several copies, and a forged one can claim to be the newest: a copy
 * tampered with after signing keeps the genuine id and can carry a later
 * `created_at`. So signatures are checked **before** choosing: only copies
 * that pass are candidates, and the newest of those per signer and `d` is the
 * list (ties to the smallest id). Choosing first and checking afterwards
 * would let a forged newer copy push the genuine list out. A replaced copy no
 * longer counts.
 *
 * @param {unknown[]} events
 * @param {Object} options
 * @param {(event: NostrEvent) => boolean} options.verify - Required; anything but `true` fails
 * @returns {{ lists: Array<{ name: string, contribution: Contribution, skipped: number }>, dropped: { unverified: number } }}
 * @throws {TypeError} Without a verifier
 */
export function resolveNamedLists(events, { verify } = /** @type {any} */ ({})) {
  if (typeof verify !== "function") {
    throw new TypeError("resolveNamedLists needs a signature check: pass { verify }. There is no unverified mode.");
  }
  /** @type {NostrEvent[]} */
  const candidates = [];
  let unverified = 0;
  for (const event of Array.isArray(events) ? events : []) {
    if (!namedListOf(event)) {
      continue;
    }
    let ok = false;
    try {
      ok = verify(/** @type {NostrEvent} */ (event)) === true;
    } catch {
      ok = false;
    }
    if (ok) {
      candidates.push(/** @type {NostrEvent} */ (event));
    } else {
      unverified += 1;
    }
  }
  /** @type {Array<{ name: string, contribution: Contribution, skipped: number }>} */
  const lists = [];
  for (const event of selectReplaceable(candidates).values()) {
    const read = readNamedList(event, { verify });
    if (read.ok) {
      lists.push({ name: read.name, contribution: read.contribution, skipped: read.skipped });
    }
  }
  return { lists, dropped: { unverified } };
}

/**
 * The contributions a decision reads, from lists already read.
 * @param {string} decision - A key of {@link NAMED_DECISIONS}
 * @param {Array<{ name: string, contribution: Contribution }>} lists
 * @returns {Contribution[]}
 */
export function contributionsForDecision(decision, lists) {
  const names = Object.hasOwn(NAMED_DECISIONS, decision) ? NAMED_DECISIONS[decision] : undefined;
  if (!names) {
    throw new TypeError(`Not a named decision: ${JSON.stringify(decision)}`);
  }
  return lists.filter((list) => names.includes(list.name)).map((list) => list.contribution);
}
