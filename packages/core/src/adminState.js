// Administrative state reduction for Nostr Governance
//
// Contributions arrive as per-actor lists signed under each actor's own key.
// Reduction resolves each contributor's capabilities against the current
// authority state and keeps only the entries that actor was allowed to publish.
// Because capabilities are resolved here rather than at ingest time, revoking a
// role immediately drops that actor's entries from effective state.

import { getTargetKey } from "./identifiers.js";
import { isValidTarget } from "./targets.js";
import { hasCapability, isProtectedActor } from "./authority.js";

/**
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 * @typedef {import('./authority.js').AuthorityState} AuthorityState
 * @typedef {import('./authority.js').GovernanceCapability} GovernanceCapability
 */

/**
 * @typedef {Object} Contribution
 * @property {string} actor - Pubkey of the contributing actor
 * @property {"user-allow"|"user-deny"|"event-deny"|"address-deny"|"trust-seed"} kind
 * @property {GovernanceTarget[]} targets
 * @property {number} [createdAt] - Unix seconds; used for replaceable selection
 * @property {string} [source] - Opaque origin marker (e.g. a community list id)
 */

/**
 * @typedef {Object} AdminState
 * @property {Set<string>} userAllow - Target keys explicitly allowed
 * @property {Set<string>} userDeny - Target keys denied
 * @property {Set<string>} eventDeny
 * @property {Set<string>} addressDeny
 * @property {Set<string>} trustSeeds - Pubkeys seeding the trust graph
 * @property {Map<string, string[]>} contributors - Target key to contributing actor pubkeys
 * @property {Map<string, string[]>} communitySources - Target key to community list ids that denied it
 */

/** @type {Record<Contribution["kind"], GovernanceCapability>} */
const KIND_CAPABILITY = {
  "user-allow": "contribute-user-allow",
  "user-deny": "contribute-user-deny",
  "event-deny": "contribute-event-deny",
  "address-deny": "contribute-address-deny",
  "trust-seed": "contribute-trust-seed",
};

/** @type {Record<Contribution["kind"], GovernanceTarget["type"]>} */
const KIND_TARGET_TYPE = {
  "user-allow": "user",
  "user-deny": "user",
  "event-deny": "event",
  "address-deny": "address",
  "trust-seed": "user",
};

/**
 * Create an empty administrative state.
 * @returns {AdminState}
 */
export function createEmptyAdminState() {
  return {
    userAllow: new Set(),
    userDeny: new Set(),
    eventDeny: new Set(),
    addressDeny: new Set(),
    trustSeeds: new Set(),
    contributors: new Map(),
    communitySources: new Map(),
  };
}

/**
 * Reduce contributions into effective administrative state.
 *
 * Denial entries are a union across authorized contributors, matching the merge
 * policy. Protected actors are removed from every denial set as the last step,
 * so no contributor list can deny the root administrator regardless of how many
 * curators list them.
 *
 * @param {Contribution[]} contributions
 * @param {AuthorityState} authority
 * @returns {AdminState}
 */
export function reduceAdminState(contributions, authority) {
  const state = createEmptyAdminState();

  if (!Array.isArray(contributions)) {
    return state;
  }

  for (const contribution of contributions) {
    if (!contribution || typeof contribution !== "object") {
      continue;
    }

    const capability = Object.hasOwn(KIND_CAPABILITY, contribution.kind)
      ? KIND_CAPABILITY[contribution.kind]
      : undefined;
    if (!capability) {
      continue;
    }
    if (!hasCapability(contribution.actor, capability, authority)) {
      continue;
    }

    const expectedType = KIND_TARGET_TYPE[contribution.kind];
    const targets = Array.isArray(contribution.targets) ? contribution.targets : [];

    for (const target of targets) {
      // A malformed identifier must never reach a denial set: getTargetKey
      // happily formats anything, so validation has to happen here.
      if (!target || target.type !== expectedType || !isValidTarget(target)) {
        continue;
      }

      let key;
      try {
        key = getTargetKey(target);
      } catch {
        continue;
      }

      switch (contribution.kind) {
        case "user-allow":
          state.userAllow.add(key);
          break;
        case "user-deny":
          state.userDeny.add(key);
          break;
        case "event-deny":
          state.eventDeny.add(key);
          break;
        case "address-deny":
          state.addressDeny.add(key);
          break;
        case "trust-seed":
          state.trustSeeds.add(/** @type {{ pubkey: string }} */ (target).pubkey);
          break;
      }

      if (contribution.kind !== "trust-seed") {
        const existing = state.contributors.get(key) ?? [];
        if (!existing.includes(contribution.actor)) {
          existing.push(contribution.actor);
        }
        state.contributors.set(key, existing);

        // Only contributions carrying a source marker are community-curated.
        // A moderator acting directly is an administrative denial, not a
        // federated one, and the two must stay distinguishable to consumers.
        if (typeof contribution.source === "string" && contribution.source.trim()) {
          const sources = state.communitySources.get(key) ?? [];
          if (!sources.includes(contribution.source)) {
            sources.push(contribution.source);
          }
          state.communitySources.set(key, sources);
        }
      }
    }
  }

  protectActors(state, authority);
  return state;
}

/**
 * Remove protected actors from every denial set.
 * @param {AdminState} state
 * @param {AuthorityState} authority
 * @returns {AdminState} The same state, mutated in place
 */
export function protectActors(state, authority) {
  for (const pubkey of authority.protectedActors) {
    const key = `user:${pubkey}`;
    state.userDeny.delete(key);
    state.contributors.delete(key);
    state.communitySources.delete(key);
  }
  return state;
}

/**
 * Merge a community-curated denial list into administrative state.
 *
 * Community curators contribute denials without gaining moderator authority:
 * the curator must hold `contribute-user-deny`, the merge is a union, and
 * protected actors are stripped afterwards.
 *
 * @param {AdminState} state
 * @param {Contribution} contribution
 * @param {AuthorityState} authority
 * @returns {AdminState} The same state, mutated in place
 */
export function mergeCommunitySource(state, contribution, authority) {
  const merged = reduceAdminState([contribution], authority);
  for (const key of merged.userDeny) {
    state.userDeny.add(key);

    const contributors = state.contributors.get(key) ?? [];
    for (const actor of merged.contributors.get(key) ?? []) {
      if (!contributors.includes(actor)) {
        contributors.push(actor);
      }
    }
    state.contributors.set(key, contributors);

    const sources = state.communitySources.get(key) ?? [];
    for (const source of merged.communitySources.get(key) ?? []) {
      if (!sources.includes(source)) {
        sources.push(source);
      }
    }
    if (sources.length) {
      state.communitySources.set(key, sources);
    }
  }
  return protectActors(state, authority);
}

/**
 * Check whether a target is denied by administrative state.
 * @param {GovernanceTarget} target
 * @param {AdminState} state
 * @returns {boolean}
 */
export function isDenied(target, state) {
  const key = getTargetKey(target);
  switch (target.type) {
    case "user":
      return state.userDeny.has(key);
    case "event":
      return state.eventDeny.has(key);
    case "address":
      return state.addressDeny.has(key);
    default:
      return false;
  }
}

/**
 * Serialize administrative state into a plain, ordered object.
 *
 * Sets are sorted so that fingerprints and fixtures are stable across runs.
 *
 * @param {AdminState} state
 * @returns {{ userAllow: string[], userDeny: string[], eventDeny: string[], addressDeny: string[], trustSeeds: string[] }}
 */
export function serializeAdminState(state) {
  return {
    userAllow: Array.from(state.userAllow).sort(),
    userDeny: Array.from(state.userDeny).sort(),
    eventDeny: Array.from(state.eventDeny).sort(),
    addressDeny: Array.from(state.addressDeny).sort(),
    trustSeeds: Array.from(state.trustSeeds).sort(),
  };
}
