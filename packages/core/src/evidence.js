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
 * Merge evidence from several decisions about the same object.
 *
 * An object may answer to more than one target — a product to its seller, its
 * address, and its exact event — and the evidence that explains the composed
 * decision is the union of what each target carried. Counts are summed per
 * category and contributor lists are unioned, so a seller-level report and an
 * address-level report both show up in one explanation.
 *
 * @param {GovernanceEvidence[]} records
 * @returns {GovernanceEvidence}
 */
export function mergeEvidence(records) {
  const merged = createEmptyEvidence();

  /** @type {Set<string>} */
  const reporters = new Set();
  /** @type {Set<string>} */
  const muters = new Set();

  for (const record of records ?? []) {
    if (!record) {
      continue;
    }

    for (const [category, count] of Object.entries(record.trustedReportsByCategory ?? {})) {
      merged.trustedReportsByCategory[category] =
        (merged.trustedReportsByCategory[category] ?? 0) + count;
    }
    for (const [category, count] of Object.entries(record.trustedMutesByCategory ?? {})) {
      merged.trustedMutesByCategory[category] =
        (merged.trustedMutesByCategory[category] ?? 0) + count;
    }

    merged.trustedReportTotal += record.trustedReportTotal ?? 0;
    merged.trustedMuteTotal += record.trustedMuteTotal ?? 0;

    for (const pubkey of record.trustedReporterPubkeys ?? []) {
      reporters.add(pubkey);
    }
    for (const pubkey of record.trustedMuterPubkeys ?? []) {
      muters.add(pubkey);
    }

    merged.personalBlock ||= record.personalBlock === true;
    merged.personalMute ||= record.personalMute === true;
    merged.userDenied ||= record.userDenied === true;
    merged.eventDenied ||= record.eventDenied === true;
    merged.addressDenied ||= record.addressDenied === true;
    merged.userAllowed ||= record.userAllowed === true;
    merged.protectedTarget ||= record.protectedTarget === true;

    merged.thresholds = { ...merged.thresholds, ...record.thresholds };
  }

  merged.trustedReporterPubkeys = Array.from(reporters);
  merged.trustedMuterPubkeys = Array.from(muters);

  return freezeEvidence(merged);
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
