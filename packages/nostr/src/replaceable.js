// Replaceable-event selection.
//
// Parameterized-replaceable events (kind 30000-39999) are identified by
// (kind, pubkey, d-tag). Only the newest event per coordinate is effective.

/**
 * @typedef {Object} NostrEvent
 * @property {string} id
 * @property {string} pubkey
 * @property {number} kind
 * @property {number} created_at
 * @property {string[][]} tags
 * @property {string} content
 * @property {string} [sig]
 */

/**
 * Read the first value of a tag.
 * @param {NostrEvent} event
 * @param {string} name
 * @returns {string}
 */
export function getTagValue(event, name) {
  for (const tag of event.tags ?? []) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") {
      return tag[1];
    }
  }
  return "";
}

/**
 * Every value of a repeated tag.
 * @param {NostrEvent} event
 * @param {string} name
 * @returns {string[][]}
 */
export function getTags(event, name) {
  return (event.tags ?? []).filter((tag) => Array.isArray(tag) && tag[0] === name);
}

/**
 * The replaceable coordinate for an event: `kind:pubkey:d`.
 * @param {NostrEvent} event
 * @returns {string}
 */
export function coordinateOf(event) {
  return `${event.kind}:${event.pubkey}:${getTagValue(event, "d")}`;
}

/**
 * Select the effective event for each replaceable coordinate.
 *
 * Newest `created_at` wins. Ties are broken by the lexicographically smallest
 * event id, which is arbitrary but deterministic — without a tiebreak, two
 * relays returning the same two events in different orders would produce
 * different state on different clients.
 *
 * @param {NostrEvent[]} events
 * @returns {Map<string, NostrEvent>} Coordinate to winning event
 */
export function selectReplaceable(events) {
  /** @type {Map<string, NostrEvent>} */
  const winners = new Map();

  for (const event of events ?? []) {
    if (!event || typeof event.kind !== "number") {
      continue;
    }
    const coordinate = coordinateOf(event);
    const current = winners.get(coordinate);

    if (!current) {
      winners.set(coordinate, event);
      continue;
    }

    if (event.created_at > current.created_at) {
      winners.set(coordinate, event);
      continue;
    }

    if (event.created_at === current.created_at && event.id < current.id) {
      winners.set(coordinate, event);
    }
  }

  return winners;
}

/**
 * The single newest event from a list, using the same tiebreak.
 * @param {NostrEvent[]} events
 * @returns {NostrEvent|null}
 */
export function selectLatest(events) {
  let winner = null;
  for (const event of events ?? []) {
    if (!event) {
      continue;
    }
    if (
      !winner ||
      event.created_at > winner.created_at ||
      (event.created_at === winner.created_at && event.id < winner.id)
    ) {
      winner = event;
    }
  }
  return winner;
}

/**
 * @typedef {(event: NostrEvent) => boolean | Promise<boolean>} SignatureVerifier
 */

/**
 * Filter events through an injected signature verifier.
 *
 * Verification is injected rather than implemented here: signature checking
 * needs a crypto library, and forcing one into this package would make it
 * unusable in environments that already have their own.
 *
 * @param {NostrEvent[]} events
 * @param {SignatureVerifier} [verify]
 * @returns {Promise<NostrEvent[]>}
 */
export async function verifyEvents(events, verify) {
  if (typeof verify !== "function") {
    return [...(events ?? [])];
  }

  /** @type {NostrEvent[]} */
  const verified = [];
  for (const event of events ?? []) {
    try {
      if (await verify(event)) {
        verified.push(event);
      }
    } catch {
      // A verifier that throws is treated as a rejection, never as a pass.
    }
  }
  return verified;
}
