// Resolve an authority actor->roles map from signed kind-30000 "role set"
// events, ready to feed createAuthorityState.
//
// createAuthorityState({ root, actors }) needs to know who holds which role, but
// "who is a moderator" is data that should change without a redeploy: the root
// publishes a signed kind-30000 set naming them, clients resolve it at runtime.
// This turns those signed sets into the actors map, honoring ONLY sets published
// by an authorized signer -- the root, or (with delegation) an actor the root
// already granted a naming role. An unsigned or unauthorized set changes
// nothing, which is the whole security property: the roster is only as
// trustworthy as the key that signed it.
//
// A "role set" is a kind-30000 event whose `d` tag is the set identifier and
// whose `p` tags name the members. Signature verification is the caller's job
// (inject @bitgate/verify upstream): this reads already-trusted events.

import { getTagValue, getTags } from "./replaceable.js";
import { normalizePubkeyInput } from "./nip19.js";

/** NIP-51 people-set kind, reused here as the role-set carrier. */
export const ROLE_SET_KIND = 30000;

/**
 * @typedef {Object} RosterSpec
 * @property {string} identifier  The set's `d` tag, e.g. "bitgate:moderators".
 * @property {string} role        Role granted to each `p`-tagged member.
 * @property {string} [signer]    Who may publish this set: "root" (default), or
 *   a role name -- the delegation hook. When a role name, any actor who ALREADY
 *   holds that role may publish this set. List a delegated roster AFTER the set
 *   that grants its signer role, since resolution is a single ordered pass.
 */

/**
 * Resolve the honored actor->roles map.
 *
 * @param {import('./replaceable.js').NostrEvent[]} events  Candidate kind-30000
 *   events off your relays (verify their signatures first).
 * @param {Object} [options]
 * @param {string} [options.root]  Root pubkey (hex) -- the source of authority.
 *   With no root, nothing is authorized and the roster is empty.
 * @param {string} [options.rootRole]  Role for the root. Default "super_admin".
 * @param {RosterSpec[]} [options.rosters]  Sets to resolve, in dependency order.
 * @returns {{ root: string, actors: Record<string, string[]> }}  Spread into
 *   createAuthorityState(...).
 */
export function resolveAuthorityRoster(events, { root, rootRole = "super_admin", rosters = [] } = {}) {
  const rootPk = normalizePubkeyInput(root ?? "") ?? "";

  /** @type {Record<string, Set<string>>} pubkey -> roles */
  const actors = Object.create(null);
  const grant = (pubkey, role) => {
    const pk = normalizePubkeyInput(pubkey);
    if (!pk || !role) return;
    (actors[pk] ??= new Set()).add(role);
  };
  if (rootPk) grant(rootPk, rootRole);

  const roleSets = (Array.isArray(events) ? events : []).filter(
    (event) => event && event.kind === ROLE_SET_KIND,
  );

  for (const roster of Array.isArray(rosters) ? rosters : []) {
    if (!roster || typeof roster.identifier !== "string" || typeof roster.role !== "string") {
      continue;
    }
    const signerRole = roster.signer && roster.signer !== "root" ? roster.signer : null;
    // Authorization is evaluated against the roles resolved SO FAR, which is why
    // a delegated roster must be listed after the roster granting its signer.
    const authorized = (pubkey) => {
      const pk = normalizePubkeyInput(pubkey);
      if (!pk) return false;
      if (pk === rootPk) return true; // root may publish any set
      return signerRole ? (actors[pk]?.has(signerRole) ?? false) : false;
    };

    // Keep the latest set per authorized publisher for this identifier (kind
    // 30000 is replaceable; relays may still hand back older copies).
    /** @type {Map<string, import('./replaceable.js').NostrEvent>} */
    const latestByPublisher = new Map();
    for (const event of roleSets) {
      if (getTagValue(event, "d") !== roster.identifier || !authorized(event.pubkey)) continue;
      const prev = latestByPublisher.get(event.pubkey);
      if (
        !prev ||
        event.created_at > prev.created_at ||
        (event.created_at === prev.created_at && event.id < prev.id)
      ) {
        latestByPublisher.set(event.pubkey, event);
      }
    }

    for (const event of latestByPublisher.values()) {
      for (const tag of getTags(event, "p")) {
        grant(tag[1], roster.role);
      }
    }
  }

  /** @type {Record<string, string[]>} */
  const out = Object.create(null);
  for (const [pk, roles] of Object.entries(actors)) out[pk] = [...roles];
  return { root: rootPk, actors: out };
}
