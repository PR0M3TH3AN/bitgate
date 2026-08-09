// NIP-51 mute list codec.
//
// A mute list is a replaceable kind:10000 event whose public entries are `p`
// tags. Encrypted entries live in `content` and are deliberately not decoded
// here: a private mute is private, and the governance engine has no business
// reading another account's encrypted list even when it could.

import { normalizePubkeyInput } from "./nip19.js";
import { getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 */

/** NIP-51 mute list kind. */
export const MUTE_LIST_KIND = 10000;

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
