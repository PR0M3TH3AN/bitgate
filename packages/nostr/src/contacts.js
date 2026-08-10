// NIP-02 follow list (kind 3).
//
// The follow list is the trust graph. BitGate previously required the host
// application to supply it, which is fine for an app that already has one and
// impossible for a page whose only configuration is markup.
//
// Note the deliberate asymmetry with mute lists: a follow list is public by
// design, so there is nothing here to decrypt and no privacy decision to make.

import { normalizePubkeyInput } from "./nip19.js";
import { getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 */

/** NIP-02 follow list kind. */
export const CONTACT_LIST_KIND = 3;

/**
 * @typedef {Object} ContactList
 * @property {string} owner
 * @property {number} updatedAt
 * @property {string[]} contacts - Followed pubkeys, deduplicated
 * @property {Map<string, string>} relayHints - Contact pubkey to the relay hint they were listed with
 */

/**
 * Decode a NIP-02 follow list.
 *
 * The relay hint in the third tag position is captured because it is a useful
 * fallback for someone who has published no kind:10002 — it is the only hint
 * their follower left about where to find them.
 *
 * `.content` is unused by NIP-02 and is ignored here; some clients have
 * historically stored relay JSON in it, but reading that is not part of the
 * spec and guessing at it would be worse than not trying.
 *
 * @param {NostrEvent} event
 * @returns {ContactList|null}
 */
export function decodeContactList(event) {
  if (!event || event.kind !== CONTACT_LIST_KIND) {
    return null;
  }

  const owner = normalizePubkeyInput(event.pubkey);
  if (!owner) {
    return null;
  }

  /** @type {string[]} */
  const contacts = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Map<string, string>} */
  const relayHints = new Map();

  for (const tag of getTags(event, "p")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    if (!pubkey || seen.has(pubkey)) {
      continue;
    }
    seen.add(pubkey);
    contacts.push(pubkey);

    const hint = typeof tag[2] === "string" ? tag[2].trim() : "";
    if (hint) {
      relayHints.set(pubkey, hint);
    }
  }

  return {
    owner,
    updatedAt: Number.isFinite(event.created_at) ? event.created_at : 0,
    contacts,
    relayHints,
  };
}

/**
 * Encode a follow list as an unsigned event template.
 *
 * A follow list is a complete replacement, not a delta — publishing a partial
 * list unfollows everyone omitted from it.
 *
 * @param {Array<string | { pubkey: string, relay?: string, petname?: string }>} contacts
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeContactList(contacts) {
  /** @type {string[][]} */
  const tags = [];

  for (const entry of contacts ?? []) {
    const pubkey = normalizePubkeyInput(typeof entry === "string" ? entry : entry?.pubkey);
    if (!pubkey) {
      continue;
    }
    if (typeof entry === "string") {
      tags.push(["p", pubkey]);
      continue;
    }
    tags.push(["p", pubkey, entry.relay ?? "", entry.petname ?? ""]);
  }

  return { kind: CONTACT_LIST_KIND, content: "", tags };
}
