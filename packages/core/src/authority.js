// Authority and delegation for Nostr Governance
//
// Root-authorized contributor model: the root administrator publishes the role
// roster, each authorized actor publishes contributions under their own key,
// and the runtime accepts a contribution only when the signing actor holds the
// matching capability. Revoking a role stops accepting that actor's
// contributions immediately, because capabilities are resolved at merge time
// rather than baked into stored state.

import { normalizePubkey } from "./identifiers.js";

/**
 * @typedef {"manage-roles"
 *   | "manage-policy"
 *   | "manage-community-sources"
 *   | "contribute-user-allow"
 *   | "contribute-user-deny"
 *   | "contribute-event-deny"
 *   | "contribute-address-deny"
 *   | "contribute-trust-seed"
 *   | "review-evidence"} GovernanceCapability
 */

/** @type {readonly GovernanceCapability[]} */
export const GOVERNANCE_CAPABILITIES = Object.freeze([
  "manage-roles",
  "manage-policy",
  "manage-community-sources",
  "contribute-user-allow",
  "contribute-user-deny",
  "contribute-event-deny",
  "contribute-address-deny",
  "contribute-trust-seed",
  "review-evidence",
]);

const CAPABILITY_SET = new Set(GOVERNANCE_CAPABILITIES);

/**
 * @param {GovernanceCapability[]} capabilities
 * @returns {readonly GovernanceCapability[]}
 */
const bundle = (capabilities) => Object.freeze(capabilities);

/**
 * Default role bundles. Roles are convenience only; capabilities are
 * authoritative, and applications may define additional roles.
 * @type {Record<string, readonly GovernanceCapability[]>}
 */
export const DEFAULT_ROLE_CAPABILITIES = Object.freeze({
  super_admin: bundle([
    "manage-roles",
    "manage-policy",
    "manage-community-sources",
    "contribute-user-allow",
    "contribute-user-deny",
    "contribute-event-deny",
    "contribute-address-deny",
    "contribute-trust-seed",
    "review-evidence",
  ]),
  moderator: bundle([
    "contribute-user-deny",
    "contribute-event-deny",
    "contribute-address-deny",
    "contribute-trust-seed",
    "review-evidence",
  ]),
  curator: bundle(["contribute-user-deny"]),
  reviewer: bundle(["review-evidence"]),
});

/**
 * @typedef {Object} AuthorityState
 * @property {Record<string, readonly GovernanceCapability[]>} roles - Role name to capabilities
 * @property {Record<string, string[]>} actors - Actor pubkey to role names
 * @property {string[]} protectedActors - Pubkeys that contributor lists cannot deny
 * @property {string} [root] - Root administrator pubkey
 */

/**
 * Check whether a value is a known capability.
 * @param {unknown} value
 * @returns {value is GovernanceCapability}
 */
export function isGovernanceCapability(value) {
  return typeof value === "string" && CAPABILITY_SET.has(/** @type {GovernanceCapability} */ (value));
}

/**
 * Create an authority state.
 *
 * The root administrator is always protected and always holds every
 * capability, so a misconfigured role roster cannot lock governance out of its
 * own instance.
 *
 * @param {Object} [options]
 * @param {Record<string, readonly GovernanceCapability[]>} [options.roles]
 * @param {Record<string, string[]>} [options.actors]
 * @param {string[]} [options.protectedActors]
 * @param {string} [options.root]
 * @returns {AuthorityState}
 */
export function createAuthorityState(options = {}) {
  // Role names arrive from published rosters; a null prototype keeps a
  // "__proto__" role from mutating the object instead of being stored.
  /** @type {Record<string, readonly GovernanceCapability[]>} */
  const roles = Object.create(null);
  for (const [name, capabilities] of Object.entries(options.roles ?? DEFAULT_ROLE_CAPABILITIES)) {
    const trimmed = name.trim();
    if (!trimmed) {
      continue;
    }
    roles[trimmed] = Object.freeze(
      (Array.isArray(capabilities) ? capabilities : []).filter(isGovernanceCapability),
    );
  }

  /** @type {Record<string, string[]>} */
  const actors = Object.create(null);
  for (const [pubkey, roleNames] of Object.entries(options.actors ?? {})) {
    const normalized = normalizePubkey(pubkey);
    if (!normalized) {
      continue;
    }
    const names = (Array.isArray(roleNames) ? roleNames : [])
      .filter((name) => typeof name === "string" && name.trim())
      .map((name) => name.trim());
    if (names.length) {
      actors[normalized] = Array.from(new Set(names));
    }
  }

  const root = options.root ? normalizePubkey(options.root) : "";

  const protectedActors = new Set(
    (options.protectedActors ?? [])
      .map((pubkey) => normalizePubkey(pubkey))
      .filter(Boolean),
  );
  if (root) {
    protectedActors.add(root);
  }

  /** @type {AuthorityState} */
  const state = {
    roles,
    actors,
    protectedActors: Array.from(protectedActors).sort(),
  };

  if (root) {
    state.root = root;
  }

  return state;
}

/**
 * Get the role names assigned to an actor.
 * @param {string} pubkey
 * @param {AuthorityState} authority
 * @returns {string[]}
 */
export function getActorRoles(pubkey, authority) {
  const normalized = normalizePubkey(pubkey);
  if (!normalized) {
    return [];
  }
  return [...(authority.actors[normalized] ?? [])];
}

/**
 * Get every capability an actor holds, resolved through their roles.
 * @param {string} pubkey
 * @param {AuthorityState} authority
 * @returns {GovernanceCapability[]}
 */
export function getActorCapabilities(pubkey, authority) {
  const normalized = normalizePubkey(pubkey);
  if (!normalized) {
    return [];
  }

  if (authority.root && normalized === authority.root) {
    return [...GOVERNANCE_CAPABILITIES];
  }

  /** @type {Set<GovernanceCapability>} */
  const capabilities = new Set();
  for (const roleName of authority.actors[normalized] ?? []) {
    const granted = Object.hasOwn(authority.roles, roleName) ? authority.roles[roleName] : [];
    for (const capability of granted) {
      capabilities.add(capability);
    }
  }

  return Array.from(capabilities);
}

/**
 * Check whether an actor holds a capability.
 * @param {string} pubkey
 * @param {GovernanceCapability} capability
 * @param {AuthorityState} authority
 * @returns {boolean}
 */
export function hasCapability(pubkey, capability, authority) {
  if (!isGovernanceCapability(capability)) {
    return false;
  }
  return getActorCapabilities(pubkey, authority).includes(capability);
}

/**
 * Check whether an actor holds a role.
 * @param {string} pubkey
 * @param {string} roleName
 * @param {AuthorityState} authority
 * @returns {boolean}
 */
export function hasRole(pubkey, roleName, authority) {
  return getActorRoles(pubkey, authority).includes(roleName);
}

/**
 * Check whether a pubkey is protected from contributor denial.
 * @param {string} pubkey
 * @param {AuthorityState} authority
 * @returns {boolean}
 */
export function isProtectedActor(pubkey, authority) {
  const normalized = normalizePubkey(pubkey);
  if (!normalized) {
    return false;
  }
  return authority.protectedActors.includes(normalized);
}

/**
 * Define a role's capability bundle, rejecting unknown capabilities.
 * @param {string} name
 * @param {GovernanceCapability[]} capabilities
 * @returns {{ name: string, capabilities: GovernanceCapability[] }}
 */
export function createRoleDefinition(name, capabilities) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Role name must be a non-empty string");
  }
  if (!Array.isArray(capabilities)) {
    throw new Error("Role capabilities must be an array");
  }

  for (const capability of capabilities) {
    if (!isGovernanceCapability(capability)) {
      throw new Error(`Unknown governance capability: ${String(capability)}`);
    }
  }

  return { name: name.trim(), capabilities: [...new Set(capabilities)] };
}
