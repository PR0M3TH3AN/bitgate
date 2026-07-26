// Authority handling for Nostr Governance
//
// This module handles role resolution, capability checking, and authority
// validation for the governance system.

/**
 * @typedef {Object} RoleDefinition
 * @property {string} name - Role name
 * @property {string[]} capabilities - Array of capability names this role has
 */

/**
 * @typedef {Object} Actor
 * @property {string} pubkey - 64-character hex pubkey of the actor
 * @property {string[]} roles - Array of role names assigned to this actor
 */

/**
 * @typedef {Object} AuthorityState
 * @property {Record<string, RoleDefinition>} roles - Map of role names to definitions
 * @property {Record<string, Actor>} actors - Map of pubkeys to actors
 */

/**
 * Built-in role definitions
 * @type {Record<string, RoleDefinition>}
 */
export const BUILTIN_ROLES = {
  "root": {
    name: "root",
    capabilities: [
      "manage-roles",
      "manage-capabilities",
      "manage-actors",
      "manage-policies",
      "manage-admin-lists",
      "manage-trust-graph",
      "manage-overrides",
      "view-reports",
      "view-trust-graph",
      "view-admin-lists",
      "view-policies"
    ]
  },
  "administrator": {
    name: "administrator",
    capabilities: [
      "manage-admin-lists",
      "manage-trust-graph",
      "view-reports",
      "view-trust-graph",
      "view-admin-lists"
    ]
  },
  "moderator": {
    name: "moderator",
    capabilities: [
      "submit-reports",
      "submit-trust-endorsements",
      "view-reports"
    ]
  },
  "trusted-user": {
    name: "trusted-user",
    capabilities: [
      "submit-reports",
      "view-reports"
    ]
  },
  "user": {
    name: "user",
    capabilities: [
      "submit-reports"
    ]
  }
};

/**
 * Get capabilities for a role
 * @param {string} roleName
 * @param {AuthorityState} [authorityState]
 * @returns {string[]}
 */
export function getRoleCapabilities(roleName, authorityState) {
  // Check custom roles first
  if (authorityState && authorityState.roles[roleName]) {
    return authorityState.roles[roleName].capabilities;
  }
  
  // Check built-in roles
  if (BUILTIN_ROLES[roleName]) {
    return BUILTIN_ROLES[roleName].capabilities;
  }
  
  // Unknown role has no capabilities
  return [];
}

/**
 * Check if an actor has a specific role
 * @param {string} pubkey - 64-character hex pubkey
 * @param {string} roleName
 * @param {AuthorityState} [authorityState]
 * @returns {boolean}
 */
export function hasRole(pubkey, roleName, authorityState) {
  // Normalize pubkey
  const normalizedPubkey = pubkey.toLowerCase();
  
  // Check custom actors first
  if (authorityState && authorityState.actors[normalizedPubkey]) {
    return authorityState.actors[normalizedPubkey].roles.includes(roleName);
  }
  
  // No actor found means no roles
  return false;
}

/**
 * Get all roles for an actor
 * @param {string} pubkey - 64-character hex pubkey
 * @param {AuthorityState} [authorityState]
 * @returns {string[]}
 */
export function getActorRoles(pubkey, authorityState) {
  // Normalize pubkey
  const normalizedPubkey = pubkey.toLowerCase();
  
  // Check custom actors first
  if (authorityState && authorityState.actors[normalizedPubkey]) {
    return authorityState.actors[normalizedPubkey].roles;
  }
  
  // No actor found means no roles
  return [];
}

/**
 * Check if an actor has a specific capability
 * @param {string} pubkey - 64-character hex pubkey
 * @param {string} capability
 * @param {AuthorityState} [authorityState]
 * @returns {boolean}
 */
export function hasCapability(pubkey, capability, authorityState) {
  // Get all roles for the actor
  const roles = getActorRoles(pubkey, authorityState);
  
  // Check if any role has the capability
  for (const role of roles) {
    const capabilities = getRoleCapabilities(role, authorityState);
    if (capabilities.includes(capability)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all capabilities for an actor
 * @param {string} pubkey - 64-character hex pubkey
 * @param {AuthorityState} [authorityState]
 * @returns {string[]}
 */
export function getActorCapabilities(pubkey, authorityState) {
  // Get all roles for the actor
  const roles = getActorRoles(pubkey, authorityState);
  
  // Collect all capabilities from all roles
  const capabilities = new Set();
  for (const role of roles) {
    const roleCapabilities = getRoleCapabilities(role, authorityState);
    for (const capability of roleCapabilities) {
      capabilities.add(capability);
    }
  }
  
  return Array.from(capabilities);
}

/**
 * Create a new role definition
 * @param {string} name - Role name
 * @param {string[]} capabilities - Array of capability names
 * @returns {RoleDefinition}
 */
export function createRoleDefinition(name, capabilities) {
  // Validate input
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Role name must be a non-empty string");
  }
  
  if (!Array.isArray(capabilities)) {
    throw new Error("Capabilities must be an array");
  }
  
  // Validate each capability
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !capability.trim()) {
      throw new Error("All capabilities must be non-empty strings");
    }
  }
  
  return {
    name: name.trim(),
    capabilities: capabilities.map(c => c.trim())
  };
}

/**
 * Create a new actor
 * @param {string} pubkey - 64-character hex pubkey
 * @param {string[]} roles - Array of role names
 * @returns {Actor}
 */
export function createActor(pubkey, roles) {
  // Validate pubkey
  if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error("Pubkey must be a 64-character hex string");
  }
  
  // Validate roles
  if (!Array.isArray(roles)) {
    throw new Error("Roles must be an array");
  }
  
  // Validate each role
  for (const role of roles) {
    if (typeof role !== "string" || !role.trim()) {
      throw new Error("All roles must be non-empty strings");
    }
  }
  
  return {
    pubkey: pubkey.toLowerCase(),
    roles: roles.map(r => r.trim())
  };
}

/**
 * Create a new authority state
 * @param {Record<string, RoleDefinition>} [roles]
 * @param {Record<string, Actor>} [actors]
 * @returns {AuthorityState}
 */
export function createAuthorityState(roles = {}, actors = {}) {
  // Validate roles
  for (const [name, role] of Object.entries(roles)) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Role names must be non-empty strings");
    }
    if (!role || typeof role !== "object") {
      throw new Error("Role definitions must be objects");
    }
    if (role.name !== name) {
      throw new Error(`Role name mismatch: ${name} !== ${role.name}`);
    }
  }
  
  // Validate actors
  for (const [pubkey, actor] of Object.entries(actors)) {
    if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/i.test(pubkey)) {
      throw new Error("Actor pubkeys must be 64-character hex strings");
    }
    if (!actor || typeof actor !== "object") {
      throw new Error("Actors must be objects");
    }
    if (actor.pubkey !== pubkey.toLowerCase()) {
      throw new Error(`Actor pubkey mismatch: ${pubkey} !== ${actor.pubkey}`);
    }
  }
  
  return {
    roles,
    actors
  };
}