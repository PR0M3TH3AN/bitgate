// Evaluator for Nostr Governance
//
// This module brings together all the core components to evaluate governance
// decisions for targets based on state and policies.

import { getTargetKey } from "./identifiers.js";
import { areTargetsEqual, isDescendantOf } from "./targets.js";
import { hasCapability } from "./authority.js";
import {
  createGovernanceDecision,
  getPolicyEffect,
  composeGovernanceDecisions
} from "./policy.js";

/**
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 * @typedef {import('./authority.js').AuthorityState} AuthorityState
 * @typedef {import('./policy.js').PolicyContext} PolicyContext
 * @typedef {import('./policy.js').GovernanceDecision} GovernanceDecision
 * @typedef {import('./policy.js').PolicyDefinition} PolicyDefinition
 */

/**
 * @typedef {Object} Report
 * @property {string} reporter - Pubkey of the reporter
 * @property {GovernanceTarget} target - Target being reported
 * @property {string} category - Report category
 * @property {number} timestamp - Unix timestamp of the report
 */

/**
 * @typedef {Object} TrustedMute
 * @property {GovernanceTarget} target - Target being muted
 * @property {number} count - Number of trusted mutes
 * @property {Record<string, number>} categories - Count of mutes per category
 */

/**
 * @typedef {Object} Override
 * @property {GovernanceTarget} target - Target being overridden
 * @property {"allow"|"restrict"|"hide"|"deny"} visibility - Visibility override
 * @property {string} [reason] - Reason for the override
 */

/**
 * @typedef {Object} GovernanceState
 * @property {AuthorityState} authority - Authority state
 * @property {Record<string, Report[]>} reports - Reports by target key
 * @property {Record<string, TrustedMute>} trustedMutes - Trusted mutes by target key
 * @property {Record<string, Override>} overrides - Overrides by target key
 * @property {Record<string, PolicyDefinition>} policies - Policy definitions by ID
 */

/**
 * Default thresholds for governance decisions
 */
export const DEFAULT_THRESHOLDS = {
  // Number of trusted reports needed to hide a target
  trustedReportHideThreshold: 5,
  // Number of trusted reports needed to restrict a target
  trustedReportRestrictThreshold: 3,
  // Number of trusted mutes needed to hide a target
  trustedMuteHideThreshold: 10,
  // Number of trusted mutes needed to restrict a target
  trustedMuteRestrictThreshold: 5
};

/**
 * Evaluate a single target against the governance state
 * @param {GovernanceTarget} target
 * @param {GovernanceState} state
 * @param {PolicyContext} context
 * @param {string} [viewerPubkey] - Pubkey of the viewer (for personal overrides)
 * @returns {GovernanceDecision}
 */
export function evaluateTarget(target, state, context, viewerPubkey) {
  const decisions = [];
  
  // 1. Check for personal overrides first
  if (viewerPubkey) {
    const overrideDecision = checkPersonalOverrides(target, state, viewerPubkey);
    if (overrideDecision) {
      decisions.push(overrideDecision);
    }
  }
  
  // 2. Check for explicit overrides
  const explicitOverrideDecision = checkExplicitOverrides(target, state, context);
  if (explicitOverrideDecision) {
    decisions.push(explicitOverrideDecision);
  }
  
  // 3. Check reports
  const reportDecision = checkReports(target, state, context);
  if (reportDecision) {
    decisions.push(reportDecision);
  }
  
  // 4. Check trusted mutes
  const muteDecision = checkTrustedMutes(target, state, context);
  if (muteDecision) {
    decisions.push(muteDecision);
  }
  
  // 5. Check if target is a descendant of a denied ancestor
  const ancestorDecision = checkAncestorDeny(target, state, context);
  if (ancestorDecision) {
    decisions.push(ancestorDecision);
  }
  
  // Compose all decisions into a final decision
  if (decisions.length === 0) {
    // Default allow decision
    return createGovernanceDecision(
      { effect: /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("allow") },
      { effect: /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("allow") }
    );
  }
  
  return composeGovernanceDecisions(decisions);
}

/**
 * Check for personal overrides for a viewer
 * @param {GovernanceTarget} target
 * @param {GovernanceState} state
 * @param {string} viewerPubkey
 * @returns {GovernanceDecision|null}
 */
function checkPersonalOverrides(target, state, viewerPubkey) {
  // This would check for personal allowlists, blocklists, etc.
  // For now, we'll return null to indicate no personal override
  return null;
}

/**
 * Check for explicit overrides
 * @param {GovernanceTarget} target
 * @param {GovernanceState} state
 * @param {PolicyContext} context
 * @returns {GovernanceDecision|null}
 */
function checkExplicitOverrides(target, state, context) {
  const targetKey = getTargetKey(target);
  const override = state.overrides[targetKey];
  
  if (!override) {
    return null;
  }
  
  // Check if the override should be applied based on context
  if (context.enforcement && context.enforcement.allowOverrides === false) {
    return null;
  }
  
  const reasons = [];
  if (override.reason) {
    reasons.push(override.reason);
  }
  
  return createGovernanceDecision(
    { 
      effect: /** @type {import('./policy.js').PolicyEffect["effect"]} */ (override.visibility), 
      reason: override.reason 
    },
    { 
      effect: /** @type {import('./policy.js').PolicyEffect["effect"]} */ (override.visibility), 
      reason: override.reason 
    },
    undefined,
    reasons,
    [override]
  );
}

/**
 * Check reports against a target
 * @param {GovernanceTarget} target
 * @param {GovernanceState} state
 * @param {PolicyContext} context
 * @returns {GovernanceDecision|null}
 */
function checkReports(target, state, context) {
  const targetKey = getTargetKey(target);
  const targetReports = state.reports[targetKey] || [];
  
  if (targetReports.length === 0) {
    return null;
  }
  
  // Count trusted reports by category
  /** @type {Record<string, number>} */
  const trustedReportCounts = {};
  /** @type {any[]} */
  const evidence = [];
  
  for (const report of targetReports) {
    // Check if the reporter is trusted
    if (hasCapability(report.reporter, "submit-reports", state.authority)) {
      if (!trustedReportCounts[report.category]) {
        trustedReportCounts[report.category] = 0;
      }
      trustedReportCounts[report.category]++;
      evidence.push(report);
    }
  }
  
  // Determine effect based on trusted report counts
  let visibilityEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("allow");
  let interactionEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("allow");
  /** @type {string[]} */
  const reasons = [];
  
  for (const [category, count] of Object.entries(trustedReportCounts)) {
    if (count >= DEFAULT_THRESHOLDS.trustedReportHideThreshold) {
      visibilityEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("hide");
      interactionEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("deny");
      reasons.push(`Hidden due to ${count} trusted reports in category ${category}`);
    } else if (count >= DEFAULT_THRESHOLDS.trustedReportRestrictThreshold) {
      visibilityEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("restrict");
      reasons.push(`Restricted due to ${count} trusted reports in category ${category}`);
    }
  }
  
  if (visibilityEffect === "allow" && interactionEffect === "allow") {
    return null;
  }
  
  return createGovernanceDecision(
    { effect: visibilityEffect, reason: reasons.join("; ") },
    { effect: interactionEffect, reason: reasons.join("; ") },
    undefined,
    reasons,
    evidence
  );
}

/**
 * Check trusted mutes against a target
 * @param {GovernanceTarget} target
 * @param {GovernanceState} state
 * @param {PolicyContext} context
 * @returns {GovernanceDecision|null}
 */
function checkTrustedMutes(target, state, context) {
  const targetKey = getTargetKey(target);
  const trustedMute = state.trustedMutes[targetKey];
  
  if (!trustedMute) {
    return null;
  }
  
  // Determine effect based on trusted mute count
  let visibilityEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("allow");
  let interactionEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("allow");
  /** @type {string[]} */
  const reasons = [];
  const evidence = [trustedMute];
  
  if (trustedMute.count >= DEFAULT_THRESHOLDS.trustedMuteHideThreshold) {
    visibilityEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("hide");
    interactionEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("deny");
    reasons.push(`Hidden due to ${trustedMute.count} trusted mutes`);
  } else if (trustedMute.count >= DEFAULT_THRESHOLDS.trustedMuteRestrictThreshold) {
    visibilityEffect = /** @type {import('./policy.js').PolicyEffect["effect"]} */ ("restrict");
    reasons.push(`Restricted due to ${trustedMute.count} trusted mutes`);
  }
  
  if (visibilityEffect === "allow" && interactionEffect === "allow") {
    return null;
  }
  
  return createGovernanceDecision(
    { effect: visibilityEffect, reason: reasons.join("; ") },
    { effect: interactionEffect, reason: reasons.join("; ") },
    undefined,
    reasons,
    evidence
  );
}

/**
 * Check if target is a descendant of a denied ancestor
 * @param {GovernanceTarget} target
 * @param {GovernanceState} state
 * @param {PolicyContext} context
 * @returns {GovernanceDecision|null}
 */
function checkAncestorDeny(target, state, context) {
  // This would check if any ancestor of the target is denied
  // For now, we'll return null to indicate no ancestor deny
  return null;
}

/**
 * Evaluate multiple targets against the governance state
 * @param {GovernanceTarget[]} targets
 * @param {GovernanceState} state
 * @param {PolicyContext} context
 * @param {string} [viewerPubkey] - Pubkey of the viewer (for personal overrides)
 * @returns {Record<string, GovernanceDecision>}
 */
export function evaluateMany(targets, state, context, viewerPubkey) {
  /** @type {Record<string, GovernanceDecision>} */
  const results = {};
  
  for (const target of targets) {
    const targetKey = getTargetKey(target);
    results[targetKey] = evaluateTarget(target, state, context, viewerPubkey);
  }
  
  return results;
}

/**
 * Create a governance state
 * @param {AuthorityState} [authority]
 * @param {Record<string, Report[]>} [reports]
 * @param {Record<string, TrustedMute>} [trustedMutes]
 * @param {Record<string, Override>} [overrides]
 * @param {Record<string, PolicyDefinition>} [policies]
 * @returns {GovernanceState}
 */
export function createGovernanceState(authority, reports, trustedMutes, overrides, policies) {
  return {
    authority: authority || { roles: {}, actors: {} },
    reports: reports || {},
    trustedMutes: trustedMutes || {},
    overrides: overrides || {},
    policies: policies || {}
  };
}

/**
 * Create a report
 * @param {string} reporter
 * @param {GovernanceTarget} target
 * @param {string} category
 * @param {number} timestamp
 * @returns {Report}
 */
export function createReport(reporter, target, category, timestamp) {
  // Validate reporter pubkey
  if (typeof reporter !== "string" || !/^[0-9a-f]{64}$/i.test(reporter)) {
    throw new Error("Reporter must be a 64-character hex pubkey");
  }
  
  // Validate target
  if (!target || typeof target !== "object") {
    throw new Error("Target must be an object");
  }
  
  // Validate category
  if (typeof category !== "string" || !category.trim()) {
    throw new Error("Category must be a non-empty string");
  }
  
  // Validate timestamp
  if (typeof timestamp !== "number" || timestamp <= 0) {
    throw new Error("Timestamp must be a positive number");
  }
  
  return {
    reporter: reporter.toLowerCase(),
    target,
    category: category.trim(),
    timestamp
  };
}

/**
 * Create a trusted mute
 * @param {GovernanceTarget} target
 * @param {number} count
 * @param {Record<string, number>} categories
 * @returns {TrustedMute}
 */
export function createTrustedMute(target, count, categories) {
  // Validate target
  if (!target || typeof target !== "object") {
    throw new Error("Target must be an object");
  }
  
  // Validate count
  if (typeof count !== "number" || count < 0) {
    throw new Error("Count must be a non-negative number");
  }
  
  // Validate categories
  if (!categories || typeof categories !== "object") {
    throw new Error("Categories must be an object");
  }
  
  // Validate each category count
  for (const [category, categoryCount] of Object.entries(categories)) {
    if (typeof category !== "string" || !category.trim()) {
      throw new Error("Category names must be non-empty strings");
    }
    
    if (typeof categoryCount !== "number" || categoryCount < 0) {
      throw new Error("Category counts must be non-negative numbers");
    }
  }
  
  return {
    target,
    count,
    categories
  };
}

/**
 * Create an override
 * @param {GovernanceTarget} target
 * @param {"allow"|"restrict"|"hide"|"deny"} visibility
 * @param {string} [reason]
 * @returns {Override}
 */
export function createOverride(target, visibility, reason) {
  // Validate target
  if (!target || typeof target !== "object") {
    throw new Error("Target must be an object");
  }
  
  // Validate visibility
  if (!["allow", "restrict", "hide", "deny"].includes(visibility)) {
    throw new Error("Invalid visibility effect");
  }
  
  /** @type {Override} */
  const override = {
    target,
    visibility
  };
  
  if (reason) {
    override.reason = reason;
  }
  
  return override;
}