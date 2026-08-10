// NIP-51 mute list codec.
//
// A mute list is a replaceable kind:10000 event. Public entries are `p` tags;
// private entries are a JSON array of the same shape, NIP-44 encrypted into
// `content` to the author's own key.
//
// The privacy rule here is asymmetric on purpose. Another account's private
// mutes are none of our business and are never decoded — only counted as
// present. The *viewer's own* private mutes are theirs, they hold the key, and
// ignoring them means a user who mutes privately gets no effect at all, which
// reads as the product being broken.

import { normalizePubkeyInput } from "./nip19.js";
import { getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 */

/** NIP-51 mute list kind. */
export const MUTE_LIST_KIND = 10000;

/** Largest encrypted mute payload decoded, in bytes of ciphertext. */
export const MAX_MUTE_CONTENT_BYTES = 128 * 1024;

/**
 * Resolve the category attached to a mute tag.
 *
 * Clients disagree about the position: some put it at index 3, some at index 2
 * where a relay hint would otherwise sit. Index 2 is only accepted when it is
 * clearly not a URL.
 *
 * @param {string[]} tag
 * @returns {string}
 */
export function extractMuteCategory(tag) {
  if (!Array.isArray(tag)) {
    return "";
  }

  const direct = typeof tag[3] === "string" ? tag[3].trim().toLowerCase() : "";
  if (direct) {
    return direct;
  }

  const candidate = typeof tag[2] === "string" ? tag[2].trim() : "";
  if (!candidate) {
    return "";
  }

  const lower = candidate.toLowerCase();
  const looksLikeRelay =
    lower.startsWith("wss://") ||
    lower.startsWith("ws://") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://");

  return looksLikeRelay ? "" : lower;
}

/**
 * @typedef {Object} DecodedMuteList
 * @property {string} owner - Pubkey that published the list
 * @property {number} updatedAt - Unix seconds, used for window expiry
 * @property {Array<{ pubkey: string, category?: string }>} entries
 * @property {boolean} hasEncryptedEntries - Whether private entries were present but not read
 */

/**
 * Decode the private half of a mute list.
 *
 * NIP-51 stores private entries as a JSON array mirroring the tag structure,
 * encrypted to the author's own key. Decryption is delegated to a signer so
 * this package needs no crypto implementation and no access to a secret key.
 *
 * Refuses outright when the list is not the viewer's own: the caller could
 * technically pass any list, and the check belongs where the boundary is, not
 * in the caller's discipline.
 *
 * @param {NostrEvent} event
 * @param {Object} options
 * @param {string} options.viewerPubkey - The signed-in viewer
 * @param {(pubkey: string, ciphertext: string) => Promise<string>} [options.decrypt] - NIP-44 decrypt
 * @returns {Promise<Array<{ pubkey: string, category?: string }>>}
 */
export async function decodePrivateMuteEntries(event, { viewerPubkey, decrypt }) {
  if (!event || event.kind !== MUTE_LIST_KIND) {
    return [];
  }

  const owner = normalizePubkeyInput(event.pubkey);
  const viewer = normalizePubkeyInput(viewerPubkey);
  if (!owner || !viewer || owner !== viewer) {
    return [];
  }

  const content = typeof event.content === "string" ? event.content.trim() : "";
  if (!content || typeof decrypt !== "function") {
    return [];
  }
  // Bound the ciphertext before spending a decrypt and a parse on it. A mute
  // list of any realistic size is far under this; anything larger is a resource
  // trap, not a real list.
  if (content.length > MAX_MUTE_CONTENT_BYTES) {
    return [];
  }

  let tags;
  try {
    const plaintext = await decrypt(owner, content);
    tags = JSON.parse(plaintext);
  } catch {
    // A list encrypted with a key we do not hold, or written by a client we do
    // not understand, degrades to "no private entries" rather than throwing.
    return [];
  }

  if (!Array.isArray(tags)) {
    return [];
  }

  /** @type {Array<{ pubkey: string, category?: string }>} */
  const entries = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "p") {
      continue;
    }
    const pubkey = normalizePubkeyInput(tag[1]);
    if (!pubkey || seen.has(pubkey)) {
      continue;
    }
    seen.add(pubkey);

    const category = extractMuteCategory(tag);
    entries.push(category ? { pubkey, category } : { pubkey });
  }

  return entries;
}

/**
 * Decode a NIP-51 mute list.
 * @param {NostrEvent} event
 * @returns {DecodedMuteList|null}
 */
export function decodeMuteList(event) {
  if (!event || event.kind !== MUTE_LIST_KIND) {
    return null;
  }

  const owner = normalizePubkeyInput(event.pubkey);
  if (!owner) {
    return null;
  }

  /** @type {Array<{ pubkey: string, category?: string }>} */
  const entries = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const tag of getTags(event, "p")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    if (!pubkey || seen.has(pubkey)) {
      continue;
    }
    seen.add(pubkey);

    const category = extractMuteCategory(tag);
    entries.push(category ? { pubkey, category } : { pubkey });
  }

  return {
    owner,
    updatedAt: Number.isFinite(event.created_at) ? event.created_at : 0,
    entries,
    hasEncryptedEntries: typeof event.content === "string" && event.content.length > 0,
  };
}

/**
 * Turn decoded mute lists into per-target mute records for the evaluator.
 *
 * Keyed by governance target key so the result drops straight into a snapshot.
 *
 * @param {DecodedMuteList[]} lists
 * @returns {Map<string, Array<{ muter: string, category?: string, updatedAt: number }>>}
 */
export function toMuteRecords(lists) {
  /** @type {Map<string, Array<{ muter: string, category?: string, updatedAt: number }>>} */
  const records = new Map();

  for (const list of lists ?? []) {
    if (!list) {
      continue;
    }
    for (const entry of list.entries) {
      const key = `user:${entry.pubkey}`;
      const bucket = records.get(key) ?? [];
      bucket.push({
        muter: list.owner,
        ...(entry.category ? { category: entry.category } : {}),
        updatedAt: list.updatedAt,
      });
      records.set(key, bucket);
    }
  }

  return records;
}

/**
 * Encode a mute list as an unsigned event template.
 * @param {Array<{ pubkey: string, category?: string }>} entries
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeMuteList(entries) {
  const tags = (entries ?? []).map((entry) =>
    entry.category ? ["p", entry.pubkey, "", entry.category] : ["p", entry.pubkey],
  );
  return { kind: MUTE_LIST_KIND, content: "", tags };
}
