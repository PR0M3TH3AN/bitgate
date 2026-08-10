// NIP-65 relay list metadata (kind 10002).
//
// This is what makes trusted mutes actually work. Each contact publishes their
// mute list to *their own* write relays, so querying a fixed relay set finds
// only the subset who happen to write where you read. Without reading relay
// lists, a trust graph is silently under-fed and the counts come out low —
// which looks like "nobody muted them" rather than like a bug.

import { normalizePubkeyInput } from "./nip19.js";
import { getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 */

/** NIP-65 relay list metadata kind. */
export const RELAY_LIST_KIND = 10002;

/**
 * @typedef {Object} RelayList
 * @property {string} pubkey - Whose list this is
 * @property {number} updatedAt
 * @property {string[]} read - Relays they read from (where to find mentions of them)
 * @property {string[]} write - Relays they write to (where to find their events)
 */

/**
 * Normalize a relay URL for comparison.
 *
 * Relays are commonly written with and without a trailing slash, and casing
 * varies. Treating those as different URLs would open duplicate connections to
 * the same relay.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRelayUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();

  // A relay URL comes from a followed contact's kind:10002 and flows straight
  // to `new WebSocket(url)`. Control characters or internal whitespace have no
  // legitimate place in a URL and are exactly what a CRLF-injection attempt
  // looks like, so reject anything that is not a clean ws(s) URL. The URL
  // constructor does the structural validation the old prefix regex skipped.
  if (!/^wss?:\/\//i.test(trimmed) || /[\s\u0000-\u001f]/.test(trimmed)) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if ((parsed.protocol !== "wss:" && parsed.protocol !== "ws:") || !parsed.hostname) {
    return "";
  }

  return trimmed.replace(/\/+$/, "").toLowerCase();
}

/**
 * Decode a NIP-65 relay list.
 *
 * An `r` tag with no marker means both read and write, so an unmarked relay
 * appears in both lists rather than neither.
 *
 * @param {NostrEvent} event
 * @returns {RelayList|null}
 */
export function decodeRelayList(event) {
  if (!event || event.kind !== RELAY_LIST_KIND) {
    return null;
  }

  const pubkey = normalizePubkeyInput(event.pubkey);
  if (!pubkey) {
    return null;
  }

  /** @type {Set<string>} */
  const read = new Set();
  /** @type {Set<string>} */
  const write = new Set();

  for (const tag of getTags(event, "r")) {
    const url = normalizeRelayUrl(tag[1]);
    if (!url) {
      continue;
    }
    const marker = typeof tag[2] === "string" ? tag[2].trim().toLowerCase() : "";

    if (marker === "read") {
      read.add(url);
    } else if (marker === "write") {
      write.add(url);
    } else {
      read.add(url);
      write.add(url);
    }
  }

  return {
    pubkey,
    updatedAt: Number.isFinite(event.created_at) ? event.created_at : 0,
    read: Array.from(read),
    write: Array.from(write),
  };
}

/**
 * Group authors by the relays their events should be fetched from.
 *
 * Returns a map of relay URL to the authors who write there, which is exactly
 * the shape a batched outbox query needs: one subscription per relay carrying
 * every author that relay can answer for.
 *
 * Authors with no known relay list fall back to the caller's default relays —
 * omitting them entirely would quietly drop people who simply have not
 * published a kind:10002.
 *
 * @param {string[]} authors
 * @param {Map<string, RelayList>} relayLists - By author pubkey
 * @param {Object} [options]
 * @param {string[]} [options.fallback] - Relays for authors with no list
 * @param {number} [options.maxRelaysPerAuthor] - Cap on relays queried per author
 * @returns {Map<string, string[]>} Relay URL to author pubkeys
 */
export function groupAuthorsByWriteRelay(authors, relayLists, options = {}) {
  const fallback = (options.fallback ?? []).map(normalizeRelayUrl).filter(Boolean);
  // Some accounts advertise a dozen relays. Querying all of them multiplies
  // connections for diminishing returns, so take the first few and rely on
  // relay overlap for the rest.
  const maxPerAuthor = options.maxRelaysPerAuthor ?? 3;

  /** @type {Map<string, Set<string>>} */
  const byRelay = new Map();

  for (const author of authors ?? []) {
    const pubkey = normalizePubkeyInput(author);
    if (!pubkey) {
      continue;
    }

    const list = relayLists.get(pubkey);
    const relays = list?.write?.length ? list.write.slice(0, maxPerAuthor) : fallback;

    for (const relay of relays) {
      const url = normalizeRelayUrl(relay);
      if (!url) {
        continue;
      }
      if (!byRelay.has(url)) {
        byRelay.set(url, new Set());
      }
      /** @type {Set<string>} */ (byRelay.get(url)).add(pubkey);
    }
  }

  /** @type {Map<string, string[]>} */
  const grouped = new Map();
  for (const [relay, pubkeys] of byRelay) {
    grouped.set(relay, Array.from(pubkeys));
  }
  return grouped;
}

/**
 * Encode a relay list as an unsigned event template.
 * @param {{ read?: string[], write?: string[], both?: string[] }} relays
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeRelayList(relays) {
  /** @type {string[][]} */
  const tags = [];

  for (const url of relays.both ?? []) {
    const normalized = normalizeRelayUrl(url);
    if (normalized) tags.push(["r", normalized]);
  }
  for (const url of relays.read ?? []) {
    const normalized = normalizeRelayUrl(url);
    if (normalized) tags.push(["r", normalized, "read"]);
  }
  for (const url of relays.write ?? []) {
    const normalized = normalizeRelayUrl(url);
    if (normalized) tags.push(["r", normalized, "write"]);
  }

  return { kind: RELAY_LIST_KIND, content: "", tags };
}
