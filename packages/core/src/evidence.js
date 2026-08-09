// Governance evidence for Nostr Governance
//
// Evidence explains a decision without leaking anything the application has not
// already resolved. Pubkeys are included because callers need them to render
// "muted by people you follow" affordances; display names and profile data are
// never resolved here.

/**
 * @typedef {Object} EvidenceThresholds
 * @property {number} [warn]
 * @property {number} [restrict]
 * @property {number} [hide]
 * @property {number} [deny]
 */

/**
 * @typedef {Object} GovernanceEvidence
 * @property {number} trustedReportTotal
 * @property {Record<string, number>} trustedReportsByCategory
 * @property {string[]} trustedReporterPubkeys
 * @property {number} trustedMuteTotal
 * @property {Record<string, number>} trustedMutesByCategory
 * @property {string[]} trustedMuterPubkeys
 * @property {boolean} personalBlock
 * @property {boolean} personalMute
 * @property {boolean} userDenied
 * @property {boolean} eventDenied
 * @property {boolean} addressDenied
 * @property {boolean} userAllowed
 * @property {boolean} protectedTarget
 * @property {EvidenceThresholds} thresholds
 */

/**
 * Create an empty evidence record.
 * @returns {GovernanceEvidence}
 */
export function createEmptyEvidence() {
  return {
    trustedReportTotal: 0,
    trustedReportsByCategory: {},
    trustedReporterPubkeys: [],
    trustedMuteTotal: 0,
    trustedMutesByCategory: {},
    trustedMuterPubkeys: [],
    personalBlock: false,
    personalMute: false,
    userDenied: false,
    eventDenied: false,
    addressDenied: false,
    userAllowed: false,
    protectedTarget: false,
    thresholds: {},
  };
}

/**
 * Produce a stable, structurally-cloned copy of an evidence record.
 *
 * Pubkey lists and category maps are sorted so that two evaluations over the
 * same snapshot serialize identically, which conformance fixtures depend on.
 *
 * @param {GovernanceEvidence} evidence
 * @returns {GovernanceEvidence}
 */
export function freezeEvidence(evidence) {
  /** @type {Record<string, number>} */
  const reportsByCategory = {};
  for (const key of Object.keys(evidence.trustedReportsByCategory).sort()) {
    reportsByCategory[key] = evidence.trustedReportsByCategory[key];
  }

  /** @type {Record<string, number>} */
  const mutesByCategory = {};
  for (const key of Object.keys(evidence.trustedMutesByCategory).sort()) {
    mutesByCategory[key] = evidence.trustedMutesByCategory[key];
  }

  return {
    ...evidence,
    trustedReportsByCategory: reportsByCategory,
    trustedMutesByCategory: mutesByCategory,
    trustedReporterPubkeys: [...evidence.trustedReporterPubkeys].sort(),
    trustedMuterPubkeys: [...evidence.trustedMuterPubkeys].sort(),
    thresholds: { ...evidence.thresholds },
  };
}

/**
 * Strip evidence down to counts, dropping the pubkey lists.
 *
 * Used when a policy profile does not set `exposeEvidence`: the consumer still
 * learns how strong the signal was, but not who produced it.
 *
 * @param {GovernanceEvidence} evidence
 * @returns {GovernanceEvidence}
 */
export function redactEvidence(evidence) {
  return {
    ...freezeEvidence(evidence),
    trustedReporterPubkeys: [],
    trustedMuterPubkeys: [],
  };
}
