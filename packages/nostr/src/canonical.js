// Canonical v1 governance codec.
//
// Governance documents are parameterized-replaceable kind:30078 events with a
// namespaced `d` identifier. The core never learns these details — it receives
// decoded contributions, roles, and policy.

import { normalizeAddress } from "@bitgate/core";

import { normalizeEventIdInput, normalizePubkeyInput } from "./nip19.js";
import { getTagValue, getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').Contribution} Contribution
 * @typedef {import('@bitgate/core').GovernanceCapability} GovernanceCapability
 */

/** Parameterized-replaceable application-data kind used for governance documents. */
export const CANONICAL_KIND = 30078;

/** Schema version carried in the `v` tag. */
export const CANONICAL_VERSION = "1";

/** @type {Record<string, Contribution["kind"]>} */
const SCOPE_TO_KIND = {
  "user-allow": "user-allow",
  "user-deny": "user-deny",
  "event-deny": "event-deny",
  "address-deny": "address-deny",
  "trust-seed": "trust-seed",
};

/**
 * Build a canonical `d` identifier.
 * @param {string} namespace - Application namespace, e.g. "bitroad"
 * @param {string} scope - e.g. "user-deny"
 * @returns {string}
 */
export function canonicalIdentifier(namespace, scope) {
  return `${namespace}:bitgate:${scope}:v${CANONICAL_VERSION}`;
}

/**
 * Parse a canonical `d` identifier.
 * @param {string} identifier
 * @returns {{ namespace: string, scope: string, version: string } | null}
 */
export function parseIdentifier(identifier) {
  if (typeof identifier !== "string") {
    return null;
  }
  const match = /^([^:]+):bitgate:([^:]+):v(\d+)$/.exec(identifier.trim());
  if (!match) {
    return null;
  }
  return { namespace: match[1], scope: match[2], version: match[3] };
}

/**
 * Whether an event is a canonical governance document.
 * @param {NostrEvent} event
 * @param {string} [namespace] - Restrict to one application namespace
 * @returns {boolean}
 */
export function isCanonicalGovernanceEvent(event, namespace) {
  if (!event || event.kind !== CANONICAL_KIND) {
    return false;
  }
  const parsed = parseIdentifier(getTagValue(event, "d"));
  if (!parsed) {
    return false;
  }
  return namespace ? parsed.namespace === namespace : true;
}

/**
 * Decode a contribution list event.
 *
 * Malformed tags are skipped rather than failing the whole document: a single
 * bad entry in a moderator's list must not silently drop every other entry.
 *
 * @param {NostrEvent} event
 * @returns {Contribution|null}
 */
export function decodeContribution(event) {
  if (!isCanonicalGovernanceEvent(event)) {
    return null;
  }

  const parsed = parseIdentifier(getTagValue(event, "d"));
  const scope = getTagValue(event, "scope") || parsed?.scope || "";
  const kind = SCOPE_TO_KIND[scope];
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
  } else if (kind === "address-deny") {
    for (const tag of getTags(event, "a")) {
      const target = decodeAddressCoordinate(tag[1]);
      if (target) {
        targets.push(target);
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

  /** @type {Contribution} */
  const contribution = { actor, kind, targets, createdAt: event.created_at };

  const source = getTagValue(event, "source");
  if (source) {
    contribution.source = source;
  }

  return contribution;
}

/**
 * Decode an `a` coordinate (`kind:pubkey:d`) into an address target.
 * @param {string} coordinate
 * @returns {import('@bitgate/core').AddressTarget|null}
 */
export function decodeAddressCoordinate(coordinate) {
  if (typeof coordinate !== "string") {
    return null;
  }

  // The d-tag may itself contain colons, so split only on the first two.
  const first = coordinate.indexOf(":");
  const second = coordinate.indexOf(":", first + 1);
  if (first < 1 || second < 0) {
    return null;
  }

  const kind = coordinate.slice(0, first);
  const pubkey = coordinate.slice(first + 1, second);
  const identifier = coordinate.slice(second + 1);

  if (!/^\d+$/.test(kind) || !identifier) {
    return null;
  }

  return normalizeAddress(kind, normalizePubkeyInput(pubkey), identifier);
}

/**
 * Encode an address target back into an `a` coordinate.
 * @param {import('@bitgate/core').AddressTarget} target
 * @returns {string}
 */
export function encodeAddressCoordinate(target) {
  return `${target.kind}:${target.pubkey}:${target.identifier}`;
}

/**
 * Decode a role document into authority-state input.
 *
 * `p` tags carry role labels and `cap` tags carry explicit capabilities, so an
 * application can grant a capability without inventing a role for it.
 *
 * @param {NostrEvent} event
 * @returns {{ root: string, actors: Record<string, string[]>, capabilities: Record<string, string[]>, protectedActors: string[] } | null}
 */
export function decodeRoles(event) {
  if (!isCanonicalGovernanceEvent(event)) {
    return null;
  }
  const parsed = parseIdentifier(getTagValue(event, "d"));
  if (parsed?.scope !== "roles") {
    return null;
  }

  const root = normalizePubkeyInput(event.pubkey);
  if (!root) {
    return null;
  }

  /** @type {Record<string, string[]>} */
  const actors = {};
  for (const tag of getTags(event, "p")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    const role = typeof tag[2] === "string" ? tag[2].trim() : "";
    if (!pubkey || !role) {
      continue;
    }
    actors[pubkey] = actors[pubkey] ?? [];
    if (!actors[pubkey].includes(role)) {
      actors[pubkey].push(role);
    }
  }

  /** @type {Record<string, string[]>} */
  const capabilities = {};
  for (const tag of getTags(event, "cap")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    const capability = typeof tag[2] === "string" ? tag[2].trim() : "";
    if (!pubkey || !capability) {
      continue;
    }
    capabilities[pubkey] = capabilities[pubkey] ?? [];
    if (!capabilities[pubkey].includes(capability)) {
      capabilities[pubkey].push(capability);
    }
  }

  const protectedActors = [root];
  for (const tag of getTags(event, "protected")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    if (pubkey && !protectedActors.includes(pubkey)) {
      protectedActors.push(pubkey);
    }
  }

  return { root, actors, capabilities, protectedActors };
}

/** Largest policy document accepted, in bytes of JSON content. */
export const MAX_POLICY_BYTES = 64 * 1024;

/**
 * Decode a policy document.
 *
 * Content is size-bounded before parsing so that a hostile relay cannot force
 * an unbounded JSON parse, and parse failures return null rather than throwing:
 * a malformed policy must leave the previous policy in place.
 *
 * @param {NostrEvent} event
 * @returns {Object|null}
 */
export function decodePolicy(event) {
  if (!isCanonicalGovernanceEvent(event)) {
    return null;
  }
  const parsed = parseIdentifier(getTagValue(event, "d"));
  if (parsed?.scope !== "policy") {
    return null;
  }

  const content = typeof event.content === "string" ? event.content : "";
  if (!content || content.length > MAX_POLICY_BYTES) {
    return null;
  }

  try {
    const policy = JSON.parse(content);
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      return null;
    }
    return policy;
  } catch {
    return null;
  }
}

/**
 * Encode a contribution as a canonical event template.
 *
 * Returns an unsigned template: signing belongs to the application's signer.
 *
 * @param {Contribution} contribution
 * @param {string} namespace
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeContribution(contribution, namespace) {
  const tags = [
    ["d", canonicalIdentifier(namespace, contribution.kind)],
    ["v", CANONICAL_VERSION],
    ["client", "bitgate"],
    ["scope", contribution.kind],
  ];

  if (contribution.source) {
    tags.push(["source", contribution.source]);
  }

  for (const target of contribution.targets ?? []) {
    if (target.type === "user") {
      tags.push(["p", target.pubkey]);
    } else if (target.type === "event") {
      tags.push(["e", target.id]);
    } else if (target.type === "address") {
      tags.push(["a", encodeAddressCoordinate(target)]);
    }
  }

  return { kind: CANONICAL_KIND, content: "", tags };
}

/**
 * Encode a role roster as a canonical event template.
 * @param {Object} roster
 * @param {Record<string, string[]>} [roster.actors]
 * @param {Record<string, string[]>} [roster.capabilities]
 * @param {string[]} [roster.protectedActors]
 * @param {string} namespace
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeRoles(roster, namespace) {
  const tags = [
    ["d", canonicalIdentifier(namespace, "roles")],
    ["v", CANONICAL_VERSION],
    ["client", "bitgate"],
    ["scope", "roles"],
  ];

  for (const [pubkey, roles] of Object.entries(roster.actors ?? {})) {
    for (const role of roles) {
      tags.push(["p", pubkey, role]);
    }
  }

  for (const [pubkey, capabilities] of Object.entries(roster.capabilities ?? {})) {
    for (const capability of capabilities) {
      tags.push(["cap", pubkey, capability]);
    }
  }

  for (const pubkey of roster.protectedActors ?? []) {
    tags.push(["protected", pubkey]);
  }

  return { kind: CANONICAL_KIND, content: "", tags };
}
