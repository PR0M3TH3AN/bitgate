// @nostr-governance/core
//
// Pure, headless governance primitives. No I/O, no browser globals, no
// application thresholds. Applications supply a policy definition and a
// snapshot; the evaluator returns a decision they apply.

export {
  normalizePubkey,
  normalizeEventId,
  normalizeAddress,
  createUserTarget,
  createEventTarget,
  getTargetKey,
} from "./identifiers.js";

export {
  areTargetsEqual,
  isValidTarget,
  createTarget,
  getParentTarget,
  isDescendantOf,
} from "./targets.js";

export {
  GOVERNANCE_CAPABILITIES,
  DEFAULT_ROLE_CAPABILITIES,
  isGovernanceCapability,
  createAuthorityState,
  getActorRoles,
  getActorCapabilities,
  hasCapability,
  hasRole,
  isProtectedActor,
  createRoleDefinition,
} from "./authority.js";

export {
  createEmptyAdminState,
  reduceAdminState,
  protectActors,
  mergeCommunitySource,
  isDenied,
  serializeAdminState,
} from "./adminState.js";

export {
  REASON_IDS,
  isReasonId,
  createReason,
  dedupeReasons,
} from "./reasons.js";

export {
  createEmptyEvidence,
  freezeEvidence,
  mergeEvidence,
  redactEvidence,
} from "./evidence.js";

export {
  RANKING_LADDER,
  VISIBILITY_LADDER,
  INTERACTION_LADDER,
  TRANSACTION_LADDER,
  NEUTRAL_POLICY,
  effectSeverity,
  maxEffect,
  createNeutralDecision,
  normalizeDimensionEffects,
  normalizeCategoryThresholds,
  normalizePolicyProfile,
  normalizePolicyDefinition,
  createPolicyDefinition,
  resolveProfile,
  resolveThresholds,
  applyThresholds,
  applyEffects,
  composeDecisions,
} from "./policy.js";

export {
  createApplicationAdapter,
  evaluateObject,
  evaluateObjects,
  collectTargets,
} from "./adapter.js";

export {
  canonicalStringify,
  hashString,
  fingerprint,
  snapshotFingerprint,
} from "./fingerprint.js";

export {
  evaluateTarget,
  evaluateMany,
  createSnapshot,
  createViewerState,
  resolveTrustSet,
  aggregateReports,
  aggregateMutes,
} from "./evaluator.js";

/**
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 * @typedef {import('./identifiers.js').UserTarget} UserTarget
 * @typedef {import('./identifiers.js').EventTarget} EventTarget
 * @typedef {import('./identifiers.js').AddressTarget} AddressTarget
 * @typedef {import('./authority.js').AuthorityState} AuthorityState
 * @typedef {import('./authority.js').GovernanceCapability} GovernanceCapability
 * @typedef {import('./adminState.js').AdminState} AdminState
 * @typedef {import('./adminState.js').Contribution} Contribution
 * @typedef {import('./policy.js').PolicyDefinition} PolicyDefinition
 * @typedef {import('./policy.js').PolicyProfile} PolicyProfile
 * @typedef {import('./policy.js').PolicyContext} PolicyContext
 * @typedef {import('./policy.js').GovernanceDecision} GovernanceDecision
 * @typedef {import('./policy.js').CategoryThresholds} CategoryThresholds
 * @typedef {import('./evidence.js').GovernanceEvidence} GovernanceEvidence
 * @typedef {import('./reasons.js').GovernanceReason} GovernanceReason
 * @typedef {import('./reasons.js').ReasonId} ReasonId
 * @typedef {import('./evaluator.js').GovernanceSnapshot} GovernanceSnapshot
 * @typedef {import('./evaluator.js').ViewerState} ViewerState
 * @typedef {import('./evaluator.js').ReportRecord} ReportRecord
 * @typedef {import('./evaluator.js').MuteRecord} MuteRecord
 * @typedef {import('./adapter.js').GovernanceApplicationAdapter<any>} GovernanceApplicationAdapter
 */
