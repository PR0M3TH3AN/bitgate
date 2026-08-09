// Stable reason identifiers for Nostr Governance
//
// Reason identifiers are part of the public contract. Applications map these
// identifiers to their own wording; the engine never emits user-facing prose.
// Adding a new identifier is a minor change. Renaming or removing one is a
// breaking change.

/**
 * @typedef {"viewer-block"
 *   | "viewer-mute"
 *   | "viewer-override"
 *   | "admin-user-deny"
 *   | "admin-event-deny"
 *   | "admin-address-deny"
 *   | "community-user-deny"
 *   | "trusted-report"
 *   | "trusted-report-threshold"
 *   | "trusted-mute"
 *   | "trusted-mute-threshold"
 *   | "allowlist-miss"
 *   | "protected-target"
 *   | "surface-policy-bypass"
 *   | "policy-disabled"} ReasonId
 */

/**
 * Every stable reason identifier the evaluator may emit.
 * @type {readonly ReasonId[]}
 */
export const REASON_IDS = Object.freeze([
  "viewer-block",
  "viewer-mute",
  "viewer-override",
  "admin-user-deny",
  "admin-event-deny",
  "admin-address-deny",
  "community-user-deny",
  "trusted-report",
  "trusted-report-threshold",
  "trusted-mute",
  "trusted-mute-threshold",
  "allowlist-miss",
  "protected-target",
  "surface-policy-bypass",
  "policy-disabled",
]);

const REASON_ID_SET = new Set(REASON_IDS);

/**
 * @typedef {Object} GovernanceReason
 * @property {ReasonId} id - Stable identifier
 * @property {string} [category] - Report or mute category the reason relates to
 * @property {number} [count] - Observed count that produced the reason
 * @property {number} [threshold] - Threshold the count was compared against
 * @property {string} [source] - Opaque origin marker (e.g. a curator pubkey)
 */

/**
 * Check whether a value is a known reason identifier.
 * @param {unknown} value
 * @returns {value is ReasonId}
 */
export function isReasonId(value) {
  return typeof value === "string" && REASON_ID_SET.has(/** @type {ReasonId} */ (value));
}

/**
 * Create a governance reason.
 * @param {ReasonId} id
 * @param {Object} [detail]
 * @param {string} [detail.category]
 * @param {number} [detail.count]
 * @param {number} [detail.threshold]
 * @param {string} [detail.source]
 * @returns {GovernanceReason}
 */
export function createReason(id, detail = {}) {
  if (!isReasonId(id)) {
    throw new Error(`Unknown reason identifier: ${String(id)}`);
  }

  /** @type {GovernanceReason} */
  const reason = { id };

  if (typeof detail.category === "string" && detail.category.trim()) {
    reason.category = detail.category.trim();
  }
  if (Number.isFinite(detail.count)) {
    reason.count = /** @type {number} */ (detail.count);
  }
  if (Number.isFinite(detail.threshold)) {
    reason.threshold = /** @type {number} */ (detail.threshold);
  }
  if (typeof detail.source === "string" && detail.source.trim()) {
    reason.source = detail.source.trim();
  }

  return reason;
}

/**
 * Deduplicate reasons, preserving first-seen order.
 *
 * Two reasons are the same when their identifier, category, and threshold all
 * match; counts are allowed to differ and the highest is kept so that a merged
 * decision reports the strongest observed evidence.
 *
 * @param {GovernanceReason[]} reasons
 * @returns {GovernanceReason[]}
 */
export function dedupeReasons(reasons) {
  /** @type {Map<string, GovernanceReason>} */
  const byKey = new Map();

  for (const reason of reasons) {
    if (!reason || !isReasonId(reason.id)) {
      continue;
    }
    const key = `${reason.id}|${reason.category ?? ""}|${reason.threshold ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...reason });
      continue;
    }
    if (Number.isFinite(reason.count)) {
      const nextCount = /** @type {number} */ (reason.count);
      if (!Number.isFinite(existing.count) || nextCount > /** @type {number} */ (existing.count)) {
        existing.count = nextCount;
      }
    }
  }

  return Array.from(byKey.values());
}
