// Policy engine for Nostr Governance
//
// The engine is deliberately generic: it carries no application thresholds of
// its own. Applications supply a policy definition made of named profiles, and
// each profile decides how evidence maps onto the four decision dimensions.
//
// Decision dimensions are independent ladders. A product can stay visible and
// inspectable while being downranked and blocked from checkout, without
// collapsing those states into a single "hidden" boolean.

import { createReason, dedupeReasons } from "./reasons.js";

/**
 * @typedef {import('./reasons.js').GovernanceReason} GovernanceReason
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 * @typedef {import('./evidence.js').GovernanceEvidence} GovernanceEvidence
 */

/**
 * @typedef {"normal"|"downrank"} RankingEffect
 * @typedef {"allow"|"warn"|"restrict"|"hide"|"deny"} VisibilityEffect
 * @typedef {"allow"|"require-explicit-action"|"deny"} InteractionEffect
 * @typedef {"allow"|"require-review"|"deny"} TransactionEffect
 */

/**
 * Severity ladders. Composition always keeps the most severe effect seen, so
 * these arrays define the entire merge semantics for each dimension.
 */
export const RANKING_LADDER = Object.freeze(["normal", "downrank"]);
export const VISIBILITY_LADDER = Object.freeze(["allow", "warn", "restrict", "hide", "deny"]);
export const INTERACTION_LADDER = Object.freeze(["allow", "require-explicit-action", "deny"]);
export const TRANSACTION_LADDER = Object.freeze(["allow", "require-review", "deny"]);

/** @type {Record<string, readonly string[]>} */
const LADDERS = {
  ranking: RANKING_LADDER,
  visibility: VISIBILITY_LADDER,
  interaction: INTERACTION_LADDER,
  transaction: TRANSACTION_LADDER,
};

/**
 * Rank an effect within its dimension's ladder.
 * @param {"ranking"|"visibility"|"interaction"|"transaction"} dimension
 * @param {string} effect
 * @returns {number} Ladder index, or -1 when the effect is not valid
 */
export function effectSeverity(dimension, effect) {
  const ladder = LADDERS[dimension];
  if (!ladder) {
    throw new Error(`Unknown decision dimension: ${dimension}`);
  }
  return ladder.indexOf(effect);
}

/**
 * Return the more severe of two effects in the same dimension.
 * @param {"ranking"|"visibility"|"interaction"|"transaction"} dimension
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function maxEffect(dimension, a, b) {
  const severityA = effectSeverity(dimension, a);
  const severityB = effectSeverity(dimension, b);
  if (severityA < 0) return b;
  if (severityB < 0) return a;
  return severityA >= severityB ? a : b;
}

/**
 * @typedef {Object} CategoryThresholds
 * @property {number} [downrank] - Count at which the target is downranked
 * @property {number} [warn] - Count at which the viewer is warned
 * @property {number} [restrict] - Count at which visibility is restricted
 * @property {number} [hide] - Count at which the target is hidden
 * @property {number} [deny] - Count at which the target is denied outright
 * @property {number} [interactionDeny] - Count at which interaction is denied
 * @property {number} [requireExplicitAction] - Count at which interaction needs explicit intent
 * @property {number} [transactionReview] - Count at which a transaction needs review
 * @property {number} [transactionDeny] - Count at which a transaction is denied
 */

/**
 * @typedef {Object} DimensionEffects
 * @property {RankingEffect} [ranking]
 * @property {VisibilityEffect} [visibility]
 * @property {InteractionEffect} [interaction]
 * @property {TransactionEffect} [transaction]
 */

/**
 * @typedef {Object} PolicyProfile
 * @property {string} name
 * @property {DimensionEffects} [administrativeDeny] - Applied on admin/community denial
 * @property {DimensionEffects} [viewerBlock] - Applied when the viewer personally blocks
 * @property {DimensionEffects} [allowlistMiss] - Applied when allowlist mode is on and the target misses
 * @property {boolean} [requireAllowlist] - Whether allowlist misses are enforced on this surface
 * @property {boolean} [allowViewerOverride] - Whether viewer overrides may soften a decision
 * @property {boolean} [exposeEvidence] - Whether the consumer may surface evidence detail
 * @property {boolean} [bypassHide] - Surface exception: cap visibility below `hide`
 * @property {VisibilityEffect} [bypassHideCeiling] - Effect used when `bypassHide` caps a hide
 * @property {boolean} [disabled] - Disable governance entirely for this surface
 * @property {Record<string, CategoryThresholds>} [reports] - Report thresholds by category ("default" applies to unlisted categories)
 * @property {Record<string, CategoryThresholds>} [mutes] - Trusted-mute thresholds by category ("default" applies to totals)
 * @property {number} [muteWindowSeconds] - Trusted mutes older than this are ignored (0 disables expiry)
 */

/**
 * @typedef {Object} PolicyDefinition
 * @property {string} id
 * @property {string} [name] - Defaults to the id when omitted
 * @property {string} [description]
 * @property {string} version - Policy version, reported on every decision
 * @property {Record<string, PolicyProfile>} profiles
 * @property {string} [defaultProfile]
 */

/**
 * @typedef {Object} PolicyContext
 * @property {string} surface - Surface being rendered (e.g. "feed", "checkout")
 * @property {string} [policyProfile] - Profile name; defaults to the policy's default profile
 * @property {PolicyDefinition} [policy] - Policy definition to evaluate against
 * @property {number} [now] - Evaluation time in unix seconds (injected clock)
 * @property {Object} [enforcement]
 * @property {boolean} [enforcement.allowOverrides] - Hard switch for viewer overrides
 */

/**
 * @typedef {Object} DecisionDimensions
 * @property {{ effect: RankingEffect, weight: number }} ranking
 * @property {{ effect: VisibilityEffect, overridable: boolean }} visibility
 * @property {{ effect: InteractionEffect }} interaction
 * @property {{ effect: TransactionEffect }} [transaction]
 */

/**
 * @typedef {Object} GovernanceDecision
 * @property {GovernanceTarget} [target]
 * @property {string} key
 * @property {{ effect: RankingEffect, weight: number }} ranking
 * @property {{ effect: VisibilityEffect, overridable: boolean }} visibility
 * @property {{ effect: InteractionEffect }} interaction
 * @property {{ effect: TransactionEffect }} [transaction]
 * @property {GovernanceReason[]} reasons
 * @property {GovernanceEvidence} [evidence]
 * @property {string} policyProfile
 * @property {string} policyVersion
 * @property {string} snapshotFingerprint
 * @property {number} evaluatedAt
 */

/**
 * A decision with every dimension at its most permissive value.
 * @param {Object} [options]
 * @param {string} [options.key]
 * @param {GovernanceTarget} [options.target]
 * @param {boolean} [options.includeTransaction]
 * @returns {GovernanceDecision}
 */
export function createNeutralDecision(options = {}) {
  /** @type {GovernanceDecision} */
  const decision = {
    key: options.key ?? "",
    ranking: { effect: "normal", weight: 0 },
    visibility: { effect: "allow", overridable: true },
    interaction: { effect: "allow" },
    reasons: [],
    policyProfile: "",
    policyVersion: "",
    snapshotFingerprint: "",
    evaluatedAt: 0,
  };

  if (options.target) {
    decision.target = options.target;
  }
  if (options.includeTransaction) {
    decision.transaction = { effect: "allow" };
  }

  return decision;
}

/**
 * Validate a set of dimension effects supplied by an application profile.
 * @param {DimensionEffects} [effects]
 * @param {string} location - Human-readable location for error messages
 * @returns {DimensionEffects}
 */
export function normalizeDimensionEffects(effects, location = "profile") {
  if (!effects || typeof effects !== "object") {
    return {};
  }

  /** @type {DimensionEffects} */
  const normalized = {};

  for (const dimension of /** @type {const} */ ([
    "ranking",
    "visibility",
    "interaction",
    "transaction",
  ])) {
    const value = effects[dimension];
    if (value === undefined) {
      continue;
    }
    if (effectSeverity(dimension, value) < 0) {
      throw new Error(`${location}: invalid ${dimension} effect "${String(value)}"`);
    }
    // @ts-expect-error -- the ladder check above narrows the value for us
    normalized[dimension] = value;
  }

  return normalized;
}

/**
 * Normalize category thresholds, dropping non-numeric entries.
 * @param {Record<string, CategoryThresholds>} [thresholds]
 * @param {string} [location]
 * @returns {Record<string, CategoryThresholds>}
 */
export function normalizeCategoryThresholds(thresholds, location = "profile") {
  if (!thresholds || typeof thresholds !== "object") {
    return {};
  }

  /** @type {Record<string, CategoryThresholds>} */
  const normalized = {};

  for (const [category, config] of Object.entries(thresholds)) {
    if (!config || typeof config !== "object") {
      continue;
    }
    const trimmed = category.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }

    /** @type {CategoryThresholds} */
    const entry = {};
    for (const [gate, value] of Object.entries(config)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (/** @type {number} */ (value) < 0) {
        throw new Error(`${location}: threshold "${gate}" for "${category}" must be >= 0`);
      }
      // Gate names are validated where thresholds are applied; unknown keys are
      // carried through harmlessly rather than rejected here.
      /** @type {Record<string, number>} */ (entry)[gate] = Math.floor(
        /** @type {number} */ (value),
      );
    }
    normalized[trimmed] = entry;
  }

  return normalized;
}

/**
 * Normalize a policy profile.
 * @param {PolicyProfile} profile
 * @returns {PolicyProfile}
 */
export function normalizePolicyProfile(profile) {
  if (!profile || typeof profile !== "object") {
    throw new Error("Policy profile must be an object");
  }
  if (typeof profile.name !== "string" || !profile.name.trim()) {
    throw new Error("Policy profile requires a non-empty name");
  }

  const name = profile.name.trim();
  const location = `profile "${name}"`;

  /** @type {PolicyProfile} */
  const normalized = {
    name,
    administrativeDeny: normalizeDimensionEffects(profile.administrativeDeny, location),
    viewerBlock: normalizeDimensionEffects(profile.viewerBlock, location),
    allowlistMiss: normalizeDimensionEffects(profile.allowlistMiss, location),
    requireAllowlist: profile.requireAllowlist === true,
    allowViewerOverride: profile.allowViewerOverride !== false,
    exposeEvidence: profile.exposeEvidence === true,
    bypassHide: profile.bypassHide === true,
    disabled: profile.disabled === true,
    reports: normalizeCategoryThresholds(profile.reports, location),
    mutes: normalizeCategoryThresholds(profile.mutes, location),
  };

  if (Number.isFinite(profile.muteWindowSeconds)) {
    const window = /** @type {number} */ (profile.muteWindowSeconds);
    if (window < 0) {
      throw new Error(`${location}: muteWindowSeconds must be >= 0`);
    }
    normalized.muteWindowSeconds = Math.floor(window);
  }

  if (profile.bypassHideCeiling !== undefined) {
    if (effectSeverity("visibility", profile.bypassHideCeiling) < 0) {
      throw new Error(`${location}: invalid bypassHideCeiling "${String(profile.bypassHideCeiling)}"`);
    }
    normalized.bypassHideCeiling = profile.bypassHideCeiling;
  } else if (normalized.bypassHide) {
    normalized.bypassHideCeiling = "restrict";
  }

  return normalized;
}

/**
 * Normalize a full policy definition.
 * @param {PolicyDefinition} policy
 * @returns {PolicyDefinition}
 */
export function normalizePolicyDefinition(policy) {
  if (!policy || typeof policy !== "object") {
    throw new Error("Policy definition must be an object");
  }
  if (typeof policy.id !== "string" || !policy.id.trim()) {
    throw new Error("Policy definition requires a non-empty id");
  }
  if (typeof policy.version !== "string" || !policy.version.trim()) {
    throw new Error("Policy definition requires a version string");
  }
  if (!policy.profiles || typeof policy.profiles !== "object") {
    throw new Error("Policy definition requires a profiles map");
  }

  /** @type {Record<string, PolicyProfile>} */
  const profiles = {};
  for (const [key, profile] of Object.entries(policy.profiles)) {
    const normalizedProfile = normalizePolicyProfile({ ...profile, name: profile?.name ?? key });
    profiles[key.trim()] = normalizedProfile;
  }

  const profileNames = Object.keys(profiles);
  if (profileNames.length === 0) {
    throw new Error("Policy definition requires at least one profile");
  }

  const defaultProfile = policy.defaultProfile?.trim() || profileNames[0];
  if (!profiles[defaultProfile]) {
    throw new Error(`Policy default profile "${defaultProfile}" is not defined`);
  }

  return {
    id: policy.id.trim(),
    name: typeof policy.name === "string" && policy.name.trim() ? policy.name.trim() : policy.id.trim(),
    description: typeof policy.description === "string" ? policy.description : "",
    version: policy.version.trim(),
    profiles,
    defaultProfile,
  };
}

/**
 * Resolve the profile a context selects.
 * @param {PolicyDefinition} policy
 * @param {PolicyContext} [context]
 * @returns {PolicyProfile}
 */
export function resolveProfile(policy, context) {
  const requested = context?.policyProfile?.trim();
  if (requested) {
    const profile = policy.profiles[requested];
    if (!profile) {
      throw new Error(`Unknown policy profile: ${requested}`);
    }
    return profile;
  }
  const fallback = policy.defaultProfile ?? Object.keys(policy.profiles)[0];
  return policy.profiles[fallback];
}

/**
 * Resolve thresholds for a category, falling back to the profile "default" entry.
 * @param {Record<string, CategoryThresholds>} [table]
 * @param {string} [category]
 * @returns {CategoryThresholds}
 */
export function resolveThresholds(table, category) {
  if (!table) {
    return {};
  }
  const normalizedCategory = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (normalizedCategory && table[normalizedCategory]) {
    return table[normalizedCategory];
  }
  return table.default ?? {};
}

/**
 * Map a count against category thresholds into dimension effects.
 *
 * A gate fires when `count >= threshold`. A threshold of 0 is treated as
 * "never fires" so that an application can disable a gate by zeroing it rather
 * than having it trigger on every target.
 *
 * @param {number} count
 * @param {CategoryThresholds} thresholds
 * @returns {{ effects: DimensionEffects, firedGates: string[] }}
 */
export function applyThresholds(count, thresholds) {
  /** @type {DimensionEffects} */
  const effects = {};
  /** @type {string[]} */
  const firedGates = [];

  if (!Number.isFinite(count) || count <= 0) {
    return { effects, firedGates };
  }

  /** @type {Array<[keyof CategoryThresholds, "ranking"|"visibility"|"interaction"|"transaction", string]>} */
  const gates = [
    ["downrank", "ranking", "downrank"],
    ["warn", "visibility", "warn"],
    ["restrict", "visibility", "restrict"],
    ["hide", "visibility", "hide"],
    ["deny", "visibility", "deny"],
    ["requireExplicitAction", "interaction", "require-explicit-action"],
    ["interactionDeny", "interaction", "deny"],
    ["transactionReview", "transaction", "require-review"],
    ["transactionDeny", "transaction", "deny"],
  ];

  for (const [gate, dimension, effect] of gates) {
    const threshold = thresholds[gate];
    if (!Number.isFinite(threshold) || /** @type {number} */ (threshold) <= 0) {
      continue;
    }
    if (count < /** @type {number} */ (threshold)) {
      continue;
    }
    const current = effects[dimension];
    // @ts-expect-error -- effect strings are drawn from the matching ladder
    effects[dimension] = current ? maxEffect(dimension, current, effect) : effect;
    firedGates.push(String(gate));
  }

  return { effects, firedGates };
}

/**
 * Apply dimension effects onto a decision, keeping the most severe value.
 * @param {GovernanceDecision} decision
 * @param {DimensionEffects} effects
 * @param {GovernanceReason[]} [reasons]
 * @returns {GovernanceDecision} The same decision, mutated in place
 */
export function applyEffects(decision, effects, reasons = []) {
  if (effects.ranking) {
    const next = maxEffect("ranking", decision.ranking.effect, effects.ranking);
    if (next !== decision.ranking.effect) {
      decision.ranking.effect = /** @type {RankingEffect} */ (next);
    }
    if (effects.ranking === "downrank") {
      decision.ranking.weight += 1;
    }
  }

  if (effects.visibility) {
    decision.visibility.effect = /** @type {VisibilityEffect} */ (
      maxEffect("visibility", decision.visibility.effect, effects.visibility)
    );
  }

  if (effects.interaction) {
    decision.interaction.effect = /** @type {InteractionEffect} */ (
      maxEffect("interaction", decision.interaction.effect, effects.interaction)
    );
  }

  if (effects.transaction) {
    if (!decision.transaction) {
      decision.transaction = { effect: "allow" };
    }
    decision.transaction.effect = /** @type {TransactionEffect} */ (
      maxEffect("transaction", decision.transaction.effect, effects.transaction)
    );
  }

  if (reasons.length) {
    decision.reasons = dedupeReasons([...decision.reasons, ...reasons]);
  }

  return decision;
}

/**
 * Compose several decisions into one, keeping the most severe effect per
 * dimension and the union of reasons.
 *
 * Composition is commutative and associative: every dimension merges by ladder
 * maximum, so the order decisions arrive in cannot change the result.
 *
 * @param {GovernanceDecision[]} decisions
 * @returns {GovernanceDecision}
 */
export function composeDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return createNeutralDecision();
  }

  const [first, ...rest] = decisions;
  /** @type {GovernanceDecision} */
  const composed = {
    ...first,
    ranking: { ...first.ranking },
    visibility: { ...first.visibility },
    interaction: { ...first.interaction },
    reasons: [...first.reasons],
  };
  if (first.transaction) {
    composed.transaction = { ...first.transaction };
  }

  for (const decision of rest) {
    composed.ranking.effect = /** @type {RankingEffect} */ (
      maxEffect("ranking", composed.ranking.effect, decision.ranking.effect)
    );
    composed.ranking.weight += decision.ranking.weight;

    composed.visibility.effect = /** @type {VisibilityEffect} */ (
      maxEffect("visibility", composed.visibility.effect, decision.visibility.effect)
    );
    composed.visibility.overridable = composed.visibility.overridable && decision.visibility.overridable;

    composed.interaction.effect = /** @type {InteractionEffect} */ (
      maxEffect("interaction", composed.interaction.effect, decision.interaction.effect)
    );

    if (decision.transaction) {
      if (!composed.transaction) {
        composed.transaction = { ...decision.transaction };
      } else {
        composed.transaction.effect = /** @type {TransactionEffect} */ (
          maxEffect("transaction", composed.transaction.effect, decision.transaction.effect)
        );
      }
    }

    composed.reasons = [...composed.reasons, ...decision.reasons];
  }

  composed.reasons = dedupeReasons(composed.reasons);
  return composed;
}

/**
 * Create a policy definition, validating and normalizing it.
 * @param {PolicyDefinition} policy
 * @returns {PolicyDefinition}
 */
export function createPolicyDefinition(policy) {
  return normalizePolicyDefinition(policy);
}

/**
 * A permissive policy used when an application supplies none. It enforces
 * administrative denials but applies no trust thresholds of its own, matching
 * the rule that the generic engine never hides content merely because one
 * trusted account acted against it.
 * @type {PolicyDefinition}
 */
export const NEUTRAL_POLICY = normalizePolicyDefinition({
  id: "neutral",
  name: "Neutral",
  description: "Enforces administrative denials only. Applications should supply their own policy.",
  version: "1.0.0",
  defaultProfile: "default",
  profiles: {
    default: {
      name: "default",
      administrativeDeny: { visibility: "hide", interaction: "deny", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowlistMiss: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      reports: {},
      mutes: {},
    },
  },
});

export { createReason };
