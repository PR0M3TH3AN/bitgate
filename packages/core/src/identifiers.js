// Core identifiers for Nostr Governance targets
//
// These are the fundamental building blocks for identifying targets in the
// governance system. Each target type has a specific structure that allows
// for consistent identification and comparison.

/**
 * @typedef {Object} UserTarget
 * @property {"user"} type
 * @property {string} pubkey - 64-character hex pubkey
 */

/**
 * @typedef {Object} EventTarget
 * @property {"event"} type
 * @property {string} id - 64-character hex event ID
 */

/**
 * @typedef {Object} AddressTarget
 * @property {"address"} type
 * @property {string} kind - Event kind as string
 * @property {string} pubkey - 64-character hex pubkey of author
 * @property {string} identifier - d-tag identifier for parameterized replaceable events
 */

/**
 * @typedef {UserTarget|EventTarget|AddressTarget} GovernanceTarget
 */

/**
 * Normalize a Nostr pubkey to lowercase hex format
 * @param {string} pubkey - Pubkey in either hex or npub format
 * @returns {string} 64-character lowercase hex pubkey, or empty string if invalid
 */
export function normalizePubkey(pubkey) {
  if (typeof pubkey !== "string") return "";
  
  const trimmed = pubkey.trim();
  if (!trimmed) return "";
  
  // Already a hex pubkey
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  
  // Try to decode npub
  try {
    // In a real implementation, we would use a Nostr library here
    // For now, we'll just return a placeholder
    // const decoded = NostrTools.nip19.decode(trimmed);
    // if (decoded?.type === "npub") {
    //   return decoded.data.toLowerCase();
    // }
    return ""; // Placeholder for now
  } catch (error) {
    return "";
  }
}

/**
 * Normalize a Nostr event ID to lowercase hex format
 * @param {string} id - Event ID in either hex or note/nevent format
 * @returns {string} 64-character lowercase hex event ID, or empty string if invalid
 */
export function normalizeEventId(id) {
  if (typeof id !== "string") return "";
  
  const trimmed = id.trim();
  if (!trimmed) return "";
  
  // Already a hex event ID
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  
  // Try to decode note/nevent
  try {
    // In a real implementation, we would use a Nostr library here
    // For now, we'll just return a placeholder
    // const decoded = NostrTools.nip19.decode(trimmed);
    // if (decoded?.type === "note" || decoded?.type === "nevent") {
    //   return (decoded.data?.id || decoded.data).toLowerCase();
    // }
    return ""; // Placeholder for now
  } catch (error) {
    return "";
  }
}

/**
 * Validate and normalize an address target
 * @param {string|number} kind - Event kind
 * @param {string} pubkey - Author pubkey in hex or npub format
 * @param {string} identifier - d-tag identifier
 * @returns {AddressTarget|null} Normalized address target or null if invalid
 */
export function normalizeAddress(kind, pubkey, identifier) {
  // Validate kind
  const kindStr = String(kind).trim();
  if (!kindStr) return null;
  
  // Validate pubkey
  const normalizedPubkey = normalizePubkey(pubkey);
  if (!normalizedPubkey) return null;
  
  // Validate identifier
  const identifierStr = String(identifier).trim();
  if (!identifierStr) return null;
  
  return {
    type: "address",
    kind: kindStr,
    pubkey: normalizedPubkey,
    identifier: identifierStr
  };
}

/**
 * Create a user target
 * @param {string} pubkey - User pubkey in hex or npub format
 * @returns {UserTarget|null} User target or null if invalid
 */
export function createUserTarget(pubkey) {
  const normalizedPubkey = normalizePubkey(pubkey);
  if (!normalizedPubkey) return null;
  
  return {
    type: "user",
    pubkey: normalizedPubkey
  };
}

/**
 * Create an event target
 * @param {string} id - Event ID in hex or note/nevent format
 * @returns {EventTarget|null} Event target or null if invalid
 */
export function createEventTarget(id) {
  const normalizedId = normalizeEventId(id);
  if (!normalizedId) return null;
  
  return {
    type: "event",
    id: normalizedId
  };
}

/**
 * Get a string key for a target for use in maps/sets
 * @param {GovernanceTarget} target
 * @returns {string} Unique string key for the target
 */
export function getTargetKey(target) {
  // Type guard functions to help TypeScript
  /**
   * @param {any} t
   * @returns {t is UserTarget}
   */
  function isUserTarget(t) {
    return t && typeof t === "object" && t.type === "user";
  }
  
  /**
   * @param {any} t
   * @returns {t is EventTarget}
   */
  function isEventTarget(t) {
    return t && typeof t === "object" && t.type === "event";
  }
  
  /**
   * @param {any} t
   * @returns {t is AddressTarget}
   */
  function isAddressTarget(t) {
    return t && typeof t === "object" && t.type === "address";
  }
  
  if (isUserTarget(target)) {
    return `user:${target.pubkey}`;
  } else if (isEventTarget(target)) {
    return `event:${target.id}`;
  } else if (isAddressTarget(target)) {
    return `address:${target.kind}:${target.pubkey}:${target.identifier}`;
  } else {
    throw new Error(`Unknown target type: ${JSON.stringify(target)}`);
  }
}