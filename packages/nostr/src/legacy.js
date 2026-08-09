// Legacy administrative-list codec.
//
// The reference application stores administrative state in kind:30000 lists
// with unversioned `d` identifiers. Reading them is not optional: a destructive
// migration would drop existing moderation state, so the runtime reads legacy
// and canonical formats side by side and the application chooses what to write.
//
// Migration stages this codec supports:
//   1. read legacy, write legacy
//   2. read both, write legacy
//   3. read both, dual-write
//   4. read both, write canonical
//   5. retain legacy reading indefinitely

import { normalizeEventIdInput, normalizePubkeyInput } from "./nip19.js";
import { getTagValue, getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').Contribution} Contribution
 */

/** Legacy people-list kind used by the reference application. */
export const LEGACY_KIND = 30000;

/**
 * Legacy `d` identifiers mapped onto contribution kinds.
 *
 * `editors` has no contribution equivalent — it granted UI permissions rather
 * than signing authority — so it is surfaced separately by {@link decodeLegacyEditors}.
 *
 * @type {Record<string, Contribution["kind"]>}
 */
export const LEGACY_IDENTIFIERS = {
  "bitvid:admin:whitelist": "user-allow",
  "bitvid:admin:blacklist": "user-deny",
  "bitvid:admin:event-blacklist": "event-deny",
};

/** Legacy identifier naming the editor roster. */
export const LEGACY_EDITORS_IDENTIFIER = "bitvid:admin:editors";

/** Legacy identifier naming community blacklist sources. */
export const LEGACY_COMMUNITY_SOURCES_IDENTIFIER = "bitvid:admin:community-sources";

/**
 * Whether an event is a recognized legacy administrative list.
 * @param {NostrEvent} event
 * @returns {boolean}
 */
export function isLegacyAdminEvent(event) {
  if (!event || event.kind !== LEGACY_KIND) {
    return false;
  }
  const identifier = getTagValue(event, "d");
  return (
    identifier in LEGACY_IDENTIFIERS ||
    identifier === LEGACY_EDITORS_IDENTIFIER ||
    identifier === LEGACY_COMMUNITY_SOURCES_IDENTIFIER
  );
}

/**
 * Decode a legacy administrative list into a contribution.
 *
 * Legacy lists accept both hex and npub entries, so every value is normalized
 * before it becomes a target.
 *
 * @param {NostrEvent} event
 * @returns {Contribution|null}
 */
export function decodeLegacyList(event) {
  if (!event || event.kind !== LEGACY_KIND) {
    return null;
  }

  const identifier = getTagValue(event, "d");
  const kind = LEGACY_IDENTIFIERS[identifier];
  if (!kind) {
    return null;
  }

  const actor = normalizePubkeyInput(event.pubkey);
  if (!actor) {
    return null;
  }

  /** @type {import('@bitgate/core').GovernanceTarget[]} */
  const targets = [];

  if (kind === "event-deny") {
    for (const tag of getTags(event, "e")) {
      const id = normalizeEventIdInput(tag[1]);
      if (id) {
        targets.push({ type: "event", id });
      }
    }
  } else {
    for (const tag of getTags(event, "p")) {
      const pubkey = normalizePubkeyInput(tag[1]);
      if (pubkey) {
        targets.push({ type: "user", pubkey });
      }
    }
  }

  return { actor, kind, targets, createdAt: event.created_at };
}

/**
 * Decode the legacy editor roster.
 *
 * Editors were a UI-level permission, not cryptographic authority. They are
 * returned as plain pubkeys so an application can migrate them into real roles
 * deliberately, rather than having them silently become moderators.
 *
 * @param {NostrEvent} event
 * @returns {string[]}
 */
export function decodeLegacyEditors(event) {
  if (!event || event.kind !== LEGACY_KIND) {
    return [];
  }
  if (getTagValue(event, "d") !== LEGACY_EDITORS_IDENTIFIER) {
    return [];
  }

  /** @type {string[]} */
  const editors = [];
  for (const tag of getTags(event, "p")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    if (pubkey && !editors.includes(pubkey)) {
      editors.push(pubkey);
    }
  }
  return editors;
}

/**
 * Decode community blacklist source references.
 *
 * The root administrator publishes pointers to curator lists; the runtime
 * fetches those lists separately. Each reference is a coordinate the caller can
 * resolve.
 *
 * @param {NostrEvent} event
 * @returns {Array<{ curator: string, identifier: string, kind: number }>}
 */
export function decodeLegacyCommunitySources(event) {
  if (!event || event.kind !== LEGACY_KIND) {
    return [];
  }
  if (getTagValue(event, "d") !== LEGACY_COMMUNITY_SOURCES_IDENTIFIER) {
    return [];
  }

  /** @type {Array<{ curator: string, identifier: string, kind: number }>} */
  const sources = [];

  for (const tag of getTags(event, "a")) {
    const coordinate = typeof tag[1] === "string" ? tag[1] : "";
    const first = coordinate.indexOf(":");
    const second = coordinate.indexOf(":", first + 1);
    if (first < 1 || second < 0) {
      continue;
    }

    const kind = Number.parseInt(coordinate.slice(0, first), 10);
    const curator = normalizePubkeyInput(coordinate.slice(first + 1, second));
    const identifier = coordinate.slice(second + 1);

    if (!Number.isFinite(kind) || !curator || !identifier) {
      continue;
    }
    sources.push({ curator, identifier, kind });
  }

  return sources;
}

/**
 * Decode any recognized legacy or canonical administrative event.
 *
 * Convenience for the migration stages where both formats are read at once.
 *
 * @param {NostrEvent[]} events
 * @param {(event: NostrEvent) => Contribution|null} canonicalDecoder
 * @returns {Contribution[]}
 */
export function decodeMixedContributions(events, canonicalDecoder) {
  /** @type {Contribution[]} */
  const contributions = [];

  for (const event of events ?? []) {
    const canonical = canonicalDecoder(event);
    if (canonical) {
      contributions.push(canonical);
      continue;
    }
    const legacy = decodeLegacyList(event);
    if (legacy) {
      contributions.push(legacy);
    }
  }

  return contributions;
}
