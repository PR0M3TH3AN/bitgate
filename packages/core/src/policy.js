// Policy handling for Nostr Governance
//
// This module handles policy definitions, decision making, and effect calculations
// for the governance system.

/**
 * @typedef {Object} PolicyEffect
 * @property {"allow"|"restrict"|"hide"|"deny"} effect - The base effect
 * @property {string} [reason] - Reason for the effect
 * @property {any} [details] - Additional details about the effect
 */

/**
 * @typedef {Object} PolicyProfile
 * @property {string} name - Profile name
 * @property {Record<string, PolicyEffect>} effects - Map of effect types to policy effects
 */

/**
 * @typedef {Object} PolicyDefinition
 * @property {string} id - Unique policy identifier
 * @property {string} name - Human-readable name
 * @property {string} description - Description of what the policy does
 * @property {Record<string, PolicyProfile>} profiles - Map of profile names to policy profiles
 */

/**
 * @typedef {Object} PolicyContext
 * @property {string} surface - The surface where the policy is being applied (e.g., "feed", "search", "checkout")
 * @property {string} policyProfile - The policy profile to use
 * @property {Object} [enforcement] - Enforcement options
 * @property {boolean} [enforcement.hardHide] - Whether to hard hide denied items
 * @property {boolean} [enforcement.allowOverrides] - Whether to allow viewer overrides
 */

/**
 * @typedef {Object} GovernanceDecision
 * @property {PolicyEffect} visibility - Visibility effect
 * @property {PolicyEffect} interaction - Interaction effect
 * @property {PolicyEffect} [transaction] - Transaction effect (for commerce)
 * @property {string[]} reasons - Array of reasons for the decision
 * @property {any[]} evidence - Array of evidence supporting the decision
 * @property {Object} [metadata] - Additional metadata about the decision
 */

/**
 * Built-in policy profiles
 * @type {Record<string, PolicyProfile>}
 */
export const BUILTIN_POLICY_PROFILES = {
  "default": {
    name: "default",
    effects: {
      "visibility": { effect: "allow" },
      "interaction": { effect: "allow" }
    }
  },
  "moderate": {
    name: "moderate",
    effects: {
      "visibility": { effect: "restrict" },
      "interaction": { effect: "allow" }
    }
  },
  "strict": {
    name: "strict",
    effects: {
      "visibility": { effect: "hide" },
      "interaction": { effect: "deny" }
    }
  },
  "commerce-default": {
    name: "commerce-default",
    effects: {
      "visibility": { effect: "allow" },
      "interaction": { effect: "allow" },
      "transaction": { effect: "allow" }
    }
  },
  "commerce-transaction": {
    name: "commerce-transaction",
    effects: {
      "visibility": { effect: "allow" },
      "interaction": { effect: "allow" },
      "transaction": { effect: "deny" }
    }
  }
};

/**
 * Create a policy effect
 * @param {"allow"|"restrict"|"hide"|"deny"} effect
 * @param {string} [reason]
 * @param {any} [details]
 * @returns {PolicyEffect}
 */
export function createPolicyEffect(effect, reason, details) {
  if (!["allow", "restrict", "hide", "deny"].includes(effect)) {
    throw new Error("Invalid policy effect: " + effect);
  }
  
  const policyEffect = { effect };
  
  if (reason) {
    policyEffect.reason = reason;
  }
  
  if (details) {
    policyEffect.details = details;
  }
  
  return policyEffect;
}

/**
 * Create a policy profile
 * @param {string} name
 * @param {Record<string, PolicyEffect>} effects
 * @returns {PolicyProfile}
 */
export function createPolicyProfile(name, effects) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Policy profile name must be a non-empty string");
  }
  
  if (!effects || typeof effects !== "object") {
    throw new Error("Policy profile effects must be an object");
  }
  
  // Validate each effect
  for (const [effectType, effect] of Object.entries(effects)) {
    if (typeof effectType !== "string" || !effectType.trim()) {
      throw new Error("Effect types must be non-empty strings");
    }
    
    if (!effect || typeof effect !== "object") {
      throw new Error("Effects must be objects");
    }
    
    if (!["allow", "restrict", "hide", "deny"].includes(effect.effect)) {
      throw new Error("Invalid policy effect: " + effect.effect);
    }
  }
  
  return {
    name: name.trim(),
    effects
  };
}

/**
 * Create a policy definition
 * @param {string} id
 * @param {string} name
 * @param {string} description
 * @param {Record<string, PolicyProfile>} profiles
 * @returns {PolicyDefinition}
 */
export function createPolicyDefinition(id, name, description, profiles) {
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Policy ID must be a non-empty string");
  }
  
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Policy name must be a non-empty string");
  }
  
  if (typeof description !== "string") {
    throw new Error("Policy description must be a string");
  }
  
  if (!profiles || typeof profiles !== "object") {
    throw new Error("Policy profiles must be an object");
  }
  
  // Validate each profile
  for (const [profileName, profile] of Object.entries(profiles)) {
    if (typeof profileName !== "string" || !profileName.trim()) {
      throw new Error("Profile names must be non-empty strings");
    }
    
    if (!profile || typeof profile !== "object") {
      throw new Error("Profiles must be objects");
    }
    
    if (profile.name !== profileName) {
      throw new Error(`Profile name mismatch: ${profileName} !== ${profile.name}`);
    }
  }
  
  return {
    id: id.trim(),
    name: name.trim(),
    description,
    profiles
  };
}

/**
 * Create a policy context
 * @param {string} surface
 * @param {string} policyProfile
 * @param {Object} [enforcement]
 * @returns {PolicyContext}
 */
export function createPolicyContext(surface, policyProfile, enforcement) {
  if (typeof surface !== "string" || !surface.trim()) {
    throw new Error("Surface must be a non-empty string");
  }
  
  if (typeof policyProfile !== "string" || !policyProfile.trim()) {
    throw new Error("Policy profile must be a non-empty string");
  }
  
  const context = {
    surface: surface.trim(),
    policyProfile: policyProfile.trim()
  };
  
  if (enforcement) {
    context.enforcement = {};
    
    if (typeof enforcement.hardHide === "boolean") {
      context.enforcement.hardHide = enforcement.hardHide;
    }
    
    if (typeof enforcement.allowOverrides === "boolean") {
      context.enforcement.allowOverrides = enforcement.allowOverrides;
    }
  }
  
  return context;
}

/**
 * Create a governance decision
 * @param {PolicyEffect} visibility
 * @param {PolicyEffect} interaction
 * @param {PolicyEffect} [transaction]
 * @param {string[]} [reasons]
 * @param {any[]} [evidence]
 * @param {Object} [metadata]
 * @returns {GovernanceDecision}
 */
export function createGovernanceDecision(visibility, interaction, transaction, reasons, evidence, metadata) {
  // Validate visibility effect
  if (!visibility || typeof visibility !== "object" || 
      !["allow", "restrict", "hide", "deny"].includes(visibility.effect)) {
    throw new Error("Invalid visibility effect");
  }
  
  // Validate interaction effect
  if (!interaction || typeof interaction !== "object" || 
      !["allow", "restrict", "hide", "deny"].includes(interaction.effect)) {
    throw new Error("Invalid interaction effect");
  }
  
  // Validate transaction effect if provided
  if (transaction && (typeof transaction !== "object" || 
      !["allow", "restrict", "hide", "deny"].includes(transaction.effect))) {
    throw new Error("Invalid transaction effect");
  }
  
  // Validate reasons
  if (reasons && !Array.isArray(reasons)) {
    throw new Error("Reasons must be an array");
  }
  
  // Validate evidence
  if (evidence && !Array.isArray(evidence)) {
    throw new Error("Evidence must be an array");
  }
  
  const decision = {
    visibility,
    interaction,
    reasons: reasons || [],
    evidence: evidence || []
  };
  
  if (transaction) {
    decision.transaction = transaction;
  }
  
  if (metadata) {
    decision.metadata = metadata;
  }
  
  return decision;
}

/**
 * Get effect for a policy profile
 * @param {string} profileName
 * @param {string} effectType
 * @param {Record<string, PolicyDefinition>} [customPolicies]
 * @returns {PolicyEffect}
 */
export function getPolicyEffect(profileName, effectType, customPolicies) {
  // Check custom policies first
  if (customPolicies) {
    for (const policy of Object.values(customPolicies)) {
      if (policy.profiles[profileName] && policy.profiles[profileName].effects[effectType]) {
        return policy.profiles[profileName].effects[effectType];
      }
    }
  }
  
  // Check built-in profiles
  if (BUILTIN_POLICY_PROFILES[profileName] && 
      BUILTIN_POLICY_PROFILES[profileName].effects[effectType]) {
    return BUILTIN_POLICY_PROFILES[profileName].effects[effectType];
  }
  
  // Default to allow
  return { effect: "allow" };
}

/**
 * Compose multiple governance decisions into a single decision
 * @param {GovernanceDecision[]} decisions
 * @returns {GovernanceDecision}
 */
export function composeGovernanceDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    // Return a default allow decision
    return createGovernanceDecision(
      { effect: "allow" },
      { effect: "allow" },
      undefined,
      [],
      []
    );
  }
  
  // Start with the first decision
  const composed = { ...decisions[0] };
  
  // For each subsequent decision, apply the most restrictive effects
  for (let i = 1; i < decisions.length; i++) {
    const decision = decisions[i];
    
    // Compose visibility effect (hide > restrict > deny > allow)
    const visibilityOrder = { "allow": 0, "restrict": 1, "hide": 2, "deny": 3 };
    if (visibilityOrder[decision.visibility.effect] > visibilityOrder[composed.visibility.effect]) {
      composed.visibility = decision.visibility;
    }
    
    // Compose interaction effect (deny > hide > restrict > allow)
    const interactionOrder = { "allow": 0, "restrict": 1, "hide": 2, "deny": 3 };
    if (interactionOrder[decision.interaction.effect] > interactionOrder[composed.interaction.effect]) {
      composed.interaction = decision.interaction;
    }
    
    // Compose transaction effect if present
    if (decision.transaction) {
      if (!composed.transaction) {
        composed.transaction = decision.transaction;
      } else {
        const transactionOrder = { "allow": 0, "restrict": 1, "hide": 2, "deny": 3 };
        if (transactionOrder[decision.transaction.effect] > transactionOrder[composed.transaction.effect]) {
          composed.transaction = decision.transaction;
        }
      }
    }
    
    // Combine reasons and evidence
    for (const reason of decision.reasons) {
      if (!composed.reasons.includes(reason)) {
        composed.reasons.push(reason);
      }
    }
    
    for (const evidence of decision.evidence) {
      composed.evidence.push(evidence);
    }
  }
  
  return composed;
}