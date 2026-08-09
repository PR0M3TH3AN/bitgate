// Conformance harness for BitGate
//
// Turns a JSON fixture into a snapshot, evaluates it, and compares the decision
// against the fixture's expectation. Expectations are partial by design: a
// fixture asserts the dimensions it characterizes and stays silent about the
// rest, so adding a new decision field does not require touching every case.

import {
  createAuthorityState,
  createSnapshot,
  createViewerState,
  evaluateTarget,
  reduceAdminState,
} from "@bitgate/core";

/**
 * @typedef {Object} FixtureExpectation
 * @property {{ effect: string, weight?: number }} [ranking]
 * @property {{ effect: string, overridable?: boolean }} [visibility]
 * @property {{ effect: string }} [interaction]
 * @property {{ effect: string }} [transaction]
 * @property {string[]} [reasons] - Exact set of reason ids, order-insensitive
 * @property {Record<string, number|boolean>} [evidence] - Subset of evidence fields
 */

/**
 * Build a governance snapshot from a fixture.
 * @param {Object} fixture
 * @returns {{ snapshot: ReturnType<typeof createSnapshot>, viewer: ReturnType<typeof createViewerState> }}
 */
export function buildSnapshot(fixture) {
  const authority = createAuthorityState({
    root: fixture.authority?.root,
    actors: fixture.authority?.actors,
    protectedActors: fixture.authority?.protectedActors,
  });

  const admin = reduceAdminState(fixture.contributions ?? [], authority);

  /** @type {Map<string, Array<{ reporter: string, category: string, createdAt?: number }>>} */
  const reports = new Map();
  for (const [key, records] of Object.entries(fixture.reports ?? {})) {
    reports.set(key, records);
  }

  /** @type {Map<string, Array<{ muter: string, category?: string, updatedAt?: number }>>} */
  const trustedMutes = new Map();
  for (const [key, records] of Object.entries(fixture.trustedMutes ?? {})) {
    trustedMutes.set(key, records);
  }

  const snapshot = createSnapshot({
    authority,
    admin,
    trust: {
      contacts: new Set(fixture.trust?.contacts ?? []),
      seeds: new Set(fixture.trust?.seeds ?? []),
    },
    reports,
    trustedMutes,
  });

  /** @type {Map<string, { visibility: string, reason?: string }>} */
  const overrides = new Map();
  for (const entry of fixture.viewer?.overrides ?? []) {
    overrides.set(entry.key, { visibility: entry.visibility, reason: entry.reason });
  }

  const viewer = createViewerState({
    blocks: new Set(fixture.viewer?.blocks ?? []),
    mutes: new Set(fixture.viewer?.mutes ?? []),
    overrides,
  });

  return { snapshot, viewer };
}

/**
 * Evaluate a fixture against a policy definition.
 * @param {Object} fixture
 * @param {import('@bitgate/core').PolicyDefinition} policy
 * @returns {import('@bitgate/core').GovernanceDecision}
 */
export function evaluateFixture(fixture, policy) {
  const { snapshot, viewer } = buildSnapshot(fixture);
  return evaluateTarget(
    fixture.target,
    snapshot,
    { surface: fixture.profile, policyProfile: fixture.profile, policy, now: fixture.now },
    viewer,
  );
}

/**
 * Compare a decision against a fixture expectation.
 * @param {import('@bitgate/core').GovernanceDecision} decision
 * @param {FixtureExpectation} expectation
 * @returns {string[]} Human-readable mismatches; empty when the fixture passes
 */
export function diffExpectation(decision, expectation) {
  /** @type {string[]} */
  const mismatches = [];

  if (expectation.ranking) {
    if (decision.ranking.effect !== expectation.ranking.effect) {
      mismatches.push(
        `ranking.effect: expected "${expectation.ranking.effect}", got "${decision.ranking.effect}"`,
      );
    }
    if (
      expectation.ranking.weight !== undefined &&
      decision.ranking.weight !== expectation.ranking.weight
    ) {
      mismatches.push(
        `ranking.weight: expected ${expectation.ranking.weight}, got ${decision.ranking.weight}`,
      );
    }
  }

  if (expectation.visibility) {
    if (decision.visibility.effect !== expectation.visibility.effect) {
      mismatches.push(
        `visibility.effect: expected "${expectation.visibility.effect}", got "${decision.visibility.effect}"`,
      );
    }
    if (
      expectation.visibility.overridable !== undefined &&
      decision.visibility.overridable !== expectation.visibility.overridable
    ) {
      mismatches.push(
        `visibility.overridable: expected ${expectation.visibility.overridable}, got ${decision.visibility.overridable}`,
      );
    }
  }

  if (expectation.interaction && decision.interaction.effect !== expectation.interaction.effect) {
    mismatches.push(
      `interaction.effect: expected "${expectation.interaction.effect}", got "${decision.interaction.effect}"`,
    );
  }

  if (expectation.transaction) {
    const actual = decision.transaction?.effect ?? "(absent)";
    if (actual !== expectation.transaction.effect) {
      mismatches.push(
        `transaction.effect: expected "${expectation.transaction.effect}", got "${actual}"`,
      );
    }
  }

  if (expectation.reasons) {
    const actual = [...new Set(decision.reasons.map((reason) => reason.id))].sort();
    const expected = [...new Set(expectation.reasons)].sort();
    if (actual.join(",") !== expected.join(",")) {
      mismatches.push(`reasons: expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
    }
  }

  if (expectation.evidence) {
    const evidence = decision.evidence;
    if (!evidence) {
      mismatches.push("evidence: expected evidence on the decision, got none");
    } else {
      for (const [field, expected] of Object.entries(expectation.evidence)) {
        // Pubkey lists are asserted by length: identity is covered elsewhere and
        // spelling out 20 keys per fixture would obscure what the case is about.
        if (field.endsWith("Count")) {
          const listField = field.slice(0, -"Count".length);
          const actual = /** @type {Record<string, unknown>} */ (evidence)[listField];
          const length = Array.isArray(actual) ? actual.length : -1;
          if (length !== expected) {
            mismatches.push(`evidence.${listField}.length: expected ${expected}, got ${length}`);
          }
          continue;
        }
        const actual = /** @type {Record<string, unknown>} */ (evidence)[field];
        if (actual !== expected) {
          mismatches.push(`evidence.${field}: expected ${expected}, got ${actual}`);
        }
      }
    }
  }

  return mismatches;
}

/**
 * Run one fixture end to end.
 * @param {Object} fixture
 * @param {import('@bitgate/core').PolicyDefinition} policy
 * @returns {{ passed: boolean, mismatches: string[], decision: import('@bitgate/core').GovernanceDecision }}
 */
export function runConformanceCase(fixture, policy) {
  const decision = evaluateFixture(fixture, policy);
  const mismatches = diffExpectation(decision, fixture.expect ?? {});
  return { passed: mismatches.length === 0, mismatches, decision };
}
