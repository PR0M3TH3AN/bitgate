// Target handling for Nostr Governance
//
// This module builds on the identifiers to provide higher-level target
// handling, including target validation, comparison, and utility functions.

import {
  normalizePubkey,
  normalizeEventId,
  normalizeAddress,
  createUserTarget,
  createEventTarget,
  getTargetKey
} from "./identifiers.js";

/**
 * @typedef {import('./identifiers.js').UserTarget} UserTarget
 * @typedef {import('./identifiers.js').EventTarget} EventTarget
 * @typedef {import('./identifiers.js').AddressTarget} AddressTarget
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 */

/**
 * Check if two targets are equal
 * @param {GovernanceTarget} a
 * @param {GovernanceTarget} b
 * @returns {boolean}
 */
export function areTargetsEqual(a, b) {
  return getTargetKey(a) === getTargetKey(b);
}

/**
 * Check if a target is valid
 * @param {any} target
 * @returns {target is GovernanceTarget}
 */
export function isValidTarget(target) {
  if (!target || typeof target !== "object") return false;
  
  switch (target.type) {
    case "user":
      return typeof target.pubkey === "string" && 
             /^[0-9a-f]{64}$/i.test(target.pubkey);
    case "event":
      return typeof target.id === "string" && 
             /^[0-9a-f]{64}$/i.test(target.id);
    case "address":
      return typeof target.kind === "string" &&
             typeof target.pubkey === "string" && 
             /^[0-9a-f]{64}$/i.test(target.pubkey) &&
             typeof target.identifier === "string";
    default:
      return false;
  }
}

/**
 * Create a target from various input formats
 * @param {string|{type: string, pubkey?: string, id?: string, kind?: string|number, identifier?: string}|null|undefined} input
 * @returns {GovernanceTarget|null}
 */
export function createTarget(input) {
  // Handle null/undefined inputs
  if (input === null || input === undefined) {
    return null;
  }
  
  // If it's already a valid target, return it
  if (isValidTarget(input)) {
    return input;
  }
  
  // If it's a string, try to determine what kind of target it is
  if (typeof input === "string") {
    const trimmed = input.trim();
    
    // Check if it's a hex pubkey or event ID
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      // Try pubkey first, then event ID
      const userTarget = createUserTarget(trimmed);
      if (userTarget) return userTarget;
      
      const eventTarget = createEventTarget(trimmed);
      if (eventTarget) return eventTarget;
      
      return null;
    }
    
    // Try to decode Nostr identifiers (npub, note, etc.)
    try {
      // In a real implementation, we would use a Nostr library here
      // For now, we'll just return null
      // const decoded = NostrTools.nip19.decode(trimmed);
      // switch (decoded?.type) {
      //   case "npub":
      //     return createUserTarget(decoded.data);
      //   case "note":
      //     return createEventTarget(decoded.data);
      //   case "nevent":
      //     return createEventTarget(decoded.data?.id || decoded.data);
      // }
      return null; // Placeholder for now
    } catch (error) {
      return null;
    }
  }
  
  // If it's an object, try to create the appropriate target type
  if (typeof input === "object") {
    // Check if it has a type property
    if (!input.type) {
      return null;
    }
    
    switch (input.type) {
      case "user":
        return createUserTarget(/** @type {string} */ (input.pubkey));
      case "event":
        return createEventTarget(/** @type {string} */ (input.id));
      case "address":
        return normalizeAddress(
          /** @type {string|number} */ (input.kind), 
          /** @type {string} */ (input.pubkey), 
          /** @type {string} */ (input.identifier)
        );
      default:
        return null;
    }
  }
  
  return null;
}

/**
 * Get the parent target of a target, if applicable
 * For event targets, the parent is the user target of the event author
 * For address targets, the parent is the user target of the address author
 * User targets have no parent
 * @param {GovernanceTarget} target
 * @param {string} [authorPubkey] Required for event targets to determine parent
 * @returns {UserTarget|null}
 */
export function getParentTarget(target, authorPubkey) {
  switch (target.type) {
    case "user":
      // User targets have no parent
      return null;
    case "event":
      // Event targets have the author as parent, but we need the author pubkey
      if (!authorPubkey) {
        throw new Error("authorPubkey is required for event targets");
      }
      return createUserTarget(authorPubkey);
    case "address":
      // Address targets have the author as parent
      return createUserTarget(target.pubkey);
    default:
      return null;
  }
}

/**
 * Check if a target is a descendant of another target
 * @param {GovernanceTarget} target
 * @param {GovernanceTarget} ancestor
 * @param {string} [eventAuthorPubkey] Required if checking event descendants
 * @returns {boolean}
 */
export function isDescendantOf(target, ancestor, eventAuthorPubkey) {
  // A target cannot be a descendant of itself
  if (areTargetsEqual(target, ancestor)) {
    return false;
  }
  
  // Get the parent of the target
  const parent = getParentTarget(target, eventAuthorPubkey);
  if (!parent) {
    // No parent means no descendants
    return false;
  }
  
  // If the parent is the ancestor, then target is a descendant
  if (areTargetsEqual(parent, ancestor)) {
    return true;
  }
  
  // Otherwise, recursively check if the parent is a descendant of the ancestor
  return isDescendantOf(parent, ancestor, eventAuthorPubkey);
}