// Canonical evaluator for Nostr Governance
//
// This is the single place policy is decided. Applications collect targets and
// apply the returned decision; they must not recompute thresholds themselves.
//
// Evaluation is pure: it performs no I/O, reads an injected clock, and never
// mutates its inputs. The same snapshot and context always produce the same
// decision, which is what makes the conformance corpus meaningful.

import { getTargetKey } from "./identifiers.js";
import { isValidTarget } from "./targets.js";
import { isProtectedActor } from "./authority.js";
import { isDenied } from "./adminState.js";
import { createEmptyEvidence, freezeEvidence, redactEvidence } from "./evidence.js";
import { createReason, dedupeReasons } from "./reasons.js";
import {
  NEUTRAL_POLICY,
  applyEffects,
  applyThresholds,
  createNeutralDecision,
  effectSeverity,
  resolveProfile,
  resolveThresholds,
} from "./policy.js";
import { snapshotFingerprint } from "./fingerprint.js";

/**
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 * @typedef {import('./authority.js').AuthorityState} AuthorityState
 * @typedef {import('./adminState.js').AdminState} AdminState
 * @typedef {import('./policy.js').PolicyContext} PolicyContext
 * @typedef {import('./policy.js').PolicyProfile} PolicyProfile
 * @typedef {import('./policy.js').GovernanceDecision} GovernanceDecision
 * @typedef {import('./evidence.js').GovernanceEvidence} GovernanceEvidence
 * @typedef {import('./reasons.js').GovernanceReason} GovernanceReason
 */

/**
 * @typedef {Object} ReportRecord
 * @property {string} reporter - Reporter pubkey
 * @property {string} category - Report category
 * @property {number} [createdAt] - Unix seconds
 */

/**
 * @typedef {Object} MuteRecord
 * @property {string} muter - Muting pubkey
 * @property {string} [category] - Optional mute category
 * @property {number} [updatedAt] - Unix seconds; compared against the mute window
 */

/**
 * @typedef {Object} ViewerState
 * @property {Set<string>} [blocks] - Pubkeys the viewer blocks outright
 * @property {Set<string>} [mutes] - Pubkeys the viewer mutes
 * @property {Map<string, { visibility: string, reason?: string }>} [overrides] - Viewer overrides by target key
 */

/**
 * @typedef {Object} TrustState
 * @property {Set<string>} [contacts] - Pubkeys the viewer trusts directly
 * @property {Set<string>} [seeds] - Fallback trust seeds for anonymous viewers
 */

/**
 * @typedef {Object} GovernanceSnapshot
 * @property {AuthorityState} authority
 * @property {AdminState} admin
 * @property {TrustState} [trust]
 * @property {Map<string, ReportRecord[]>} [reports] - Reports by target key
 * @property {Map<string, MuteRecord[]>} [trustedMutes] - Mutes by target key
 */

/**
 * Resolve the effective trust set for a viewer.
 *
 * Trust seeds are a fallback for anonymous or not-yet-hydrated viewers, not an
 * addition to a real follow graph: once the viewer has contacts, seeds stop
 * contributing so that following nobody is not equivalent to following the
 * seed set.
 *
 * @param {TrustState} [trust]
 * @returns {Set<string>}
 */
export function resolveTrustSet(trust) {
  const contacts = trust?.contacts;
  if (contacts && contacts.size > 0) {
    return contacts;
  }
  return trust?.seeds ?? new Set();
}

/**
 * Decide whether a contributor's signal counts.
 *
 * Blocked and administratively denied accounts are excluded before any
 * counting, so a denied account cannot manufacture reports.
 *
 * @param {string} pubkey
 * @param {Set<string>} trustSet
 * @param {GovernanceSnapshot} snapshot
 * @param {ViewerState} viewer
 * @returns {boolean}
 */
function isCountableSignal(pubkey, trustSet, snapshot, viewer) {
  if (typeof pubkey !== "string" || !pubkey) {
    return false;
  }
  if (!trustSet.has(pubkey)) {
    return false;
  }
  if (viewer.blocks?.has(pubkey)) {
    return false;
  }
  if (snapshot.admin.userDeny.has(`user:${pubkey}`)) {
    return false;
  }
  return true;
}

/**
 * Aggregate trusted reports for a target.
 *
 * Reports are deduplicated per (reporter, category): one account reporting the
 * same target for the same reason twice is one signal, but the same account may
 * legitimately report distinct categories.
 *
 * @param {string} key
 * @param {GovernanceSnapshot} snapshot
 * @param {ViewerState} viewer
 * @param {Set<string>} trustSet
 * @returns {{ total: number, byCategory: Record<string, number>, reporters: string[] }}
 */
export function aggregateReports(key, snapshot, viewer, trustSet) {
  const records = snapshot.reports?.get(key) ?? [];
  /** @type {Map<string, Set<string>>} */
  const byCategory = new Map();
  /** @type {Set<string>} */
  const reporters = new Set();

  for (const record of records) {
    if (!record || !isCountableSignal(record.reporter, trustSet, snapshot, viewer)) {
      continue;
    }
    const category = typeof record.category === "string" ? record.category.trim().toLowerCase() : "";
    if (!category) {
      continue;
    }
    if (!byCategory.has(category)) {
      byCategory.set(category, new Set());
    }
    /** @type {Set<string>} */ (byCategory.get(category)).add(record.reporter);
    reporters.add(record.reporter);
  }

  /** @type {Record<string, number>} */
  const counts = {};
  let total = 0;
  for (const [category, set] of byCategory.entries()) {
    counts[category] = set.size;
    total += set.size;
  }

  return { total, byCategory: counts, reporters: Array.from(reporters) };
}

/**
 * Aggregate trusted mutes for a target.
 *
 * Muters are counted uniquely and mutes outside the profile's validity window
 * are ignored, so a stale list cannot hold a target down indefinitely.
 *
 * @param {string} key
 * @param {GovernanceSnapshot} snapshot
 * @param {ViewerState} viewer
 * @param {Set<string>} trustSet
 * @param {number} now - Unix seconds
 * @param {number} [windowSeconds] - 0 or undefined disables expiry
 * @returns {{ total: number, byCategory: Record<string, number>, muters: string[] }}
 */
export function aggregateMutes(key, snapshot, viewer, trustSet, now, windowSeconds) {
  const records = snapshot.trustedMutes?.get(key) ?? [];
  const cutoff = Number.isFinite(windowSeconds) && /** @type {number} */ (windowSeconds) > 0
    ? now - /** @type {number} */ (windowSeconds)
    : Number.NEGATIVE_INFINITY;

  /** @type {Set<string>} */
  const muters = new Set();
  /** @type {Map<string, Set<string>>} */
  const byCategory = new Map();

  for (const record of records) {
    if (!record || !isCountableSignal(record.muter, trustSet, snapshot, viewer)) {
      continue;
    }
    const updatedAt = Number.isFinite(record.updatedAt) ? /** @type {number} */ (record.updatedAt) : 0;
    if (updatedAt < cutoff) {
      continue;
    }
    muters.add(record.muter);

    const category = typeof record.category === "string" ? record.category.trim().toLowerCase() : "";
    if (category) {
      if (!byCategory.has(category)) {
        byCategory.set(category, new Set());
      }
      /** @type {Set<string>} */ (byCategory.get(category)).add(record.muter);
    }
  }

  /** @type {Record<string, number>} */
  const counts = {};
  for (const [category, set] of byCategory.entries()) {
    counts[category] = set.size;
  }

  return { total: muters.size, byCategory: counts, muters: Array.from(muters) };
}

/**
 * Collect the pubkeys whose administrative denial should reach this target.
 *
 * An event or address inherits its author's denial: denying a seller must take
 * down that seller's listings. An exact-event denial does not travel the other
 * way — it applies only to the event named.
 *
 * @param {GovernanceTarget} target
 * @returns {string[]}
 */
function authorChain(target) {
  if (target.type === "user") {
    return [target.pubkey];
  }
  if (target.type === "address") {
    return [target.pubkey];
  }
  const author = /** @type {{ author?: string }} */ (target).author;
  return typeof author === "string" && author ? [author] : [];
}

/**
 * Evaluate one target.
 *
 * @param {GovernanceTarget} target
 * @param {GovernanceSnapshot} snapshot
 * @param {PolicyContext} [context]
 * @param {ViewerState} [viewerState]
 * @returns {GovernanceDecision}
 */
export function evaluateTarget(target, snapshot, context = { surface: "default" }, viewerState = {}) {
  // 1. Validate and normalize the target.
  if (!isValidTarget(target)) {
    throw new Error(`Invalid governance target: ${JSON.stringify(target)}`);
  }

  const key = getTargetKey(target);
  const policy = context.policy ?? NEUTRAL_POLICY;
  const profile = resolveProfile(policy, context);
  const now = Number.isFinite(context.now) ? /** @type {number} */ (context.now) : 0;
  const viewer = viewerState ?? {};

  const includeTransaction =
    profile.administrativeDeny?.transaction !== undefined ||
    hasTransactionGate(profile);

  /** @type {GovernanceDecision} */
  const decision = createNeutralDecision({ key, target, includeTransaction });
  decision.policyProfile = profile.name;
  decision.policyVersion = policy.version;
  decision.evaluatedAt = now;

  // Fingerprinting walks the whole snapshot, so a caller evaluating many
  // targets against one snapshot should compute it once and pass it in.
  // Recomputing per target makes a large feed quadratic in state size.
  decision.snapshotFingerprint =
    context.snapshotFingerprint ??
    snapshotFingerprint({
      authority: snapshot.authority,
      admin: snapshot.admin,
      reports: snapshot.reports,
      trustedMutes: snapshot.trustedMutes,
      policy: { id: policy.id, version: policy.version, profile: profile.name },
    });

  const evidence = createEmptyEvidence();

  // A disabled surface reports why it decided nothing rather than silently
  // returning a neutral decision that looks like a real evaluation.
  if (profile.disabled) {
    decision.reasons = [createReason("policy-disabled")];
    decision.evidence = evidence;
    return decision;
  }

  const authors = authorChain(target);

  // 2. Protected-target status. Checked before any denial path so that a
  //    protected actor cannot be denied even by a malformed admin snapshot.
  const isProtected = authors.some((pubkey) => isProtectedActor(pubkey, snapshot.authority));
  evidence.protectedTarget = isProtected;

  // 3. Viewer personal block. Viewer-local and always enforced: a viewer's own
  //    block is never softened by an application profile.
  const blockedAuthor = authors.find((pubkey) => viewer.blocks?.has(pubkey));
  if (blockedAuthor) {
    evidence.personalBlock = true;
    applyEffects(
      decision,
      profile.viewerBlock ?? { visibility: "hide", interaction: "deny" },
      [createReason("viewer-block")],
    );
  }

  if (authors.some((pubkey) => viewer.mutes?.has(pubkey))) {
    evidence.personalMute = true;
    decision.reasons = dedupeReasons([...decision.reasons, createReason("viewer-mute")]);
  }

  // 4-6. Administrative denial: the target itself, then its author.
  if (!isProtected) {
    const targetDenied = isDenied(target, snapshot.admin);
    const authorDenied =
      target.type !== "user" && authors.some((pubkey) => snapshot.admin.userDeny.has(`user:${pubkey}`));

    if (target.type === "user" && targetDenied) {
      evidence.userDenied = true;
    }
    if (target.type === "event" && targetDenied) {
      evidence.eventDenied = true;
    }
    if (target.type === "address" && targetDenied) {
      evidence.addressDenied = true;
    }
    if (authorDenied) {
      evidence.userDenied = true;
    }

    if (targetDenied || authorDenied) {
      const reasonId =
        target.type === "event" && targetDenied
          ? "admin-event-deny"
          : target.type === "address" && targetDenied
            ? "admin-address-deny"
            : "admin-user-deny";

      const communitySources = snapshot.admin.communitySources.get(key) ?? [];
      /** @type {GovernanceReason[]} */
      const reasons = [createReason(reasonId)];
      if (communitySources.length) {
        reasons.push(createReason("community-user-deny", { source: communitySources[0] }));
      }

      applyEffects(
        decision,
        profile.administrativeDeny ?? { visibility: "hide", interaction: "deny" },
        reasons,
      );
    }
  } else if (isDenied(target, snapshot.admin)) {
    // A protected actor appearing in a denial set is a policy no-op, but the
    // consumer should be able to see that it was ignored.
    decision.reasons = dedupeReasons([...decision.reasons, createReason("protected-target")]);
  }

  // 7. Allowlist policy. Access control is separate from trust: being allowed
  //    to publish grants no trust, and missing the allowlist is not a moral
  //    judgement, so it is only enforced where the profile asks for it.
  if (profile.requireAllowlist && !isProtected) {
    const allowed = authors.some((pubkey) => snapshot.admin.userAllow.has(`user:${pubkey}`));
    evidence.userAllowed = allowed;
    if (!allowed) {
      applyEffects(
        decision,
        profile.allowlistMiss ?? { visibility: "hide", interaction: "deny" },
        [createReason("allowlist-miss")],
      );
    }
  } else {
    evidence.userAllowed = authors.some((pubkey) => snapshot.admin.userAllow.has(`user:${pubkey}`));
  }

  // 9-11. Trust signals. Aggregated after administrative state so that denied
  //       accounts are already excluded from counting.
  const trustSet = resolveTrustSet(snapshot.trust);

  const mutes = aggregateMutes(key, snapshot, viewer, trustSet, now, profile.muteWindowSeconds);
  evidence.trustedMuteTotal = mutes.total;
  evidence.trustedMutesByCategory = mutes.byCategory;
  evidence.trustedMuterPubkeys = mutes.muters;

  if (mutes.total > 0) {
    const thresholds = resolveThresholds(profile.mutes, undefined);
    const { effects, firedGates } = applyThresholds(mutes.total, thresholds);
    /** @type {GovernanceReason[]} */
    const reasons = [createReason("trusted-mute", { count: mutes.total })];
    if (firedGates.length) {
      reasons.push(
        createReason("trusted-mute-threshold", {
          count: mutes.total,
          threshold: lowestFiredThreshold(thresholds, firedGates),
        }),
      );
    }
    applyEffects(decision, effects, reasons);

    for (const [category, count] of Object.entries(mutes.byCategory)) {
      const categoryThresholds = profile.mutes?.[category];
      if (!categoryThresholds) {
        continue;
      }
      const categoryResult = applyThresholds(count, categoryThresholds);
      if (categoryResult.firedGates.length) {
        applyEffects(decision, categoryResult.effects, [
          createReason("trusted-mute-threshold", {
            category,
            count,
            threshold: lowestFiredThreshold(categoryThresholds, categoryResult.firedGates),
          }),
        ]);
      }
    }
  }

  const reports = aggregateReports(key, snapshot, viewer, trustSet);
  evidence.trustedReportTotal = reports.total;
  evidence.trustedReportsByCategory = reports.byCategory;
  evidence.trustedReporterPubkeys = reports.reporters;

  if (reports.total > 0) {
    decision.reasons = dedupeReasons([
      ...decision.reasons,
      createReason("trusted-report", { count: reports.total }),
    ]);

    for (const [category, count] of Object.entries(reports.byCategory)) {
      const thresholds = resolveThresholds(profile.reports, category);
      const { effects, firedGates } = applyThresholds(count, thresholds);
      if (!firedGates.length) {
        continue;
      }
      applyEffects(decision, effects, [
        createReason("trusted-report-threshold", {
          category,
          count,
          threshold: lowestFiredThreshold(thresholds, firedGates),
        }),
      ]);
    }
  }

  evidence.thresholds = summarizeThresholds(profile);

  // 8. Viewer override, applied after evidence so the viewer is overriding a
  //    decision that actually exists. Overrides may only soften, never
  //    escalate, and never reach a non-overridable decision.
  const override = viewer.overrides?.get(key);
  const overridesAllowed =
    context.enforcement?.allowOverrides !== false && profile.allowViewerOverride !== false;

  if (override && overridesAllowed && decision.visibility.overridable) {
    const requested = override.visibility;
    if (effectSeverity("visibility", requested) >= 0) {
      const isSoftening =
        effectSeverity("visibility", requested) < effectSeverity("visibility", decision.visibility.effect);
      if (isSoftening) {
        decision.visibility.effect = /** @type {import('./policy.js').VisibilityEffect} */ (requested);
        decision.interaction.effect = "require-explicit-action";
        decision.reasons = dedupeReasons([...decision.reasons, createReason("viewer-override")]);
      }
    }
  }

  // 13. Surface policy profile. A feed may decline to hide while still
  //     downranking, so the hide ceiling is applied last, over the composed
  //     decision, and records that it fired.
  if (profile.bypassHide && effectSeverity("visibility", decision.visibility.effect) >= effectSeverity("visibility", "hide")) {
    const ceiling = profile.bypassHideCeiling ?? "restrict";
    decision.visibility.effect = /** @type {import('./policy.js').VisibilityEffect} */ (ceiling);
    decision.reasons = dedupeReasons([...decision.reasons, createReason("surface-policy-bypass")]);
  }

  decision.evidence = profile.exposeEvidence ? freezeEvidence(evidence) : redactEvidence(evidence);
  decision.reasons = dedupeReasons(decision.reasons);

  return decision;
}

/**
 * Whether any category threshold in a profile can affect the transaction
 * dimension, which decides if the decision carries a transaction block at all.
 * @param {PolicyProfile} profile
 * @returns {boolean}
 */
function hasTransactionGate(profile) {
  for (const table of [profile.reports, profile.mutes]) {
    for (const thresholds of Object.values(table ?? {})) {
      if (
        Number.isFinite(thresholds.transactionDeny) ||
        Number.isFinite(thresholds.transactionReview)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The smallest threshold value among the gates that fired, which is the one
 * that explains why the decision changed.
 * @param {import('./policy.js').CategoryThresholds} thresholds
 * @param {string[]} firedGates
 * @returns {number|undefined}
 */
function lowestFiredThreshold(thresholds, firedGates) {
  let lowest;
  for (const gate of firedGates) {
    const value = /** @type {Record<string, number|undefined>} */ (thresholds)[gate];
    if (Number.isFinite(value) && (lowest === undefined || /** @type {number} */ (value) < lowest)) {
      lowest = /** @type {number} */ (value);
    }
  }
  return lowest;
}

/**
 * Summarize a profile's headline thresholds for evidence reporting.
 * @param {PolicyProfile} profile
 * @returns {import('./evidence.js').EvidenceThresholds}
 */
function summarizeThresholds(profile) {
  const defaults = profile.reports?.default ?? {};
  /** @type {import('./evidence.js').EvidenceThresholds} */
  const summary = {};
  for (const gate of /** @type {const} */ (["warn", "restrict", "hide", "deny"])) {
    if (Number.isFinite(defaults[gate])) {
      summary[gate] = /** @type {number} */ (defaults[gate]);
    }
  }
  return summary;
}

/**
 * Evaluate many targets against one snapshot.
 *
 * The snapshot fingerprint is computed once and reused, which is what keeps
 * large feeds from re-hashing identical state per item.
 *
 * @param {GovernanceTarget[]} targets
 * @param {GovernanceSnapshot} snapshot
 * @param {PolicyContext} [context]
 * @param {ViewerState} [viewerState]
 * @returns {Map<string, GovernanceDecision>}
 */
export function evaluateMany(targets, snapshot, context, viewerState) {
  /** @type {Map<string, GovernanceDecision>} */
  const results = new Map();

  const policy = context?.policy ?? NEUTRAL_POLICY;
  const profile = resolveProfile(policy, context);
  const sharedContext = {
    ...(context ?? { surface: "default" }),
    snapshotFingerprint:
      context?.snapshotFingerprint ??
      snapshotFingerprint({
        authority: snapshot.authority,
        admin: snapshot.admin,
        reports: snapshot.reports,
        trustedMutes: snapshot.trustedMutes,
        policy: { id: policy.id, version: policy.version, profile: profile.name },
      }),
  };

  for (const target of targets) {
    if (!isValidTarget(target)) {
      continue;
    }
    const key = getTargetKey(target);
    if (results.has(key)) {
      continue;
    }
    results.set(key, evaluateTarget(target, snapshot, sharedContext, viewerState));
  }

  return results;
}

/**
 * Create a governance snapshot with empty defaults.
 * @param {Partial<GovernanceSnapshot>} [parts]
 * @returns {GovernanceSnapshot}
 */
export function createSnapshot(parts = {}) {
  return {
    authority: parts.authority ?? { roles: {}, actors: {}, protectedActors: [] },
    admin: parts.admin ?? {
      userAllow: new Set(),
      userDeny: new Set(),
      eventDeny: new Set(),
      addressDeny: new Set(),
      trustSeeds: new Set(),
      contributors: new Map(),
      communitySources: new Map(),
    },
    trust: parts.trust ?? { contacts: new Set(), seeds: new Set() },
    reports: parts.reports ?? new Map(),
    trustedMutes: parts.trustedMutes ?? new Map(),
  };
}

/**
 * Create a viewer state with empty defaults.
 * @param {Partial<ViewerState>} [parts]
 * @returns {ViewerState}
 */
export function createViewerState(parts = {}) {
  return {
    blocks: parts.blocks ?? new Set(),
    mutes: parts.mutes ?? new Set(),
    overrides: parts.overrides ?? new Map(),
  };
}
