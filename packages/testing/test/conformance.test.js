import { describe, expect, it } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";

import { buildSnapshot, diffExpectation, evaluateFixture, runConformanceCase } from "../src/conformance.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const TRUSTED = "01".repeat(32);

const POLICY = createPolicyDefinition({
  id: "harness",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: { default: { restrict: 1 } },
      mutes: {},
    },
  },
});

const baseFixture = () => ({
  name: "sample",
  profile: "feed",
  now: 1_750_000_000,
  authority: {
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
    protectedActors: [ROOT],
  },
  target: { type: "user", pubkey: CREATOR },
  expect: {
    visibility: { effect: "allow" },
    interaction: { effect: "allow" },
  },
});

describe("buildSnapshot", () => {
  it("reduces contributions through the authority state", () => {
    const fixture = {
      ...baseFixture(),
      contributions: [
        { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
      ],
    };
    const { snapshot } = buildSnapshot(fixture);
    expect(snapshot.admin.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("converts viewer arrays into sets and maps", () => {
    const fixture = {
      ...baseFixture(),
      viewer: {
        blocks: [CREATOR],
        mutes: [MODERATOR],
        overrides: [{ key: `user:${CREATOR}`, visibility: "allow" }],
      },
    };
    const { viewer } = buildSnapshot(fixture);
    expect(viewer.blocks?.has(CREATOR)).toBe(true);
    expect(viewer.mutes?.has(MODERATOR)).toBe(true);
    expect(viewer.overrides?.get(`user:${CREATOR}`)).toEqual({
      visibility: "allow",
      reason: undefined,
    });
  });

  it("defaults every optional section", () => {
    const { snapshot, viewer } = buildSnapshot(baseFixture());
    expect(snapshot.reports?.size).toBe(0);
    expect(snapshot.trustedMutes?.size).toBe(0);
    expect(viewer.blocks?.size).toBe(0);
  });
});

describe("evaluateFixture", () => {
  it("evaluates against the fixture's profile", () => {
    const decision = evaluateFixture(baseFixture(), POLICY);
    expect(decision.policyProfile).toBe("feed");
    expect(decision.visibility.effect).toBe("allow");
  });
});

describe("diffExpectation", () => {
  const decision = () => evaluateFixture(baseFixture(), POLICY);

  it("reports no mismatches when the expectation holds", () => {
    expect(diffExpectation(decision(), { visibility: { effect: "allow" } })).toEqual([]);
  });

  it("reports a visibility mismatch", () => {
    const [mismatch] = diffExpectation(decision(), { visibility: { effect: "hide" } });
    expect(mismatch).toMatch(/visibility.effect: expected "hide", got "allow"/);
  });

  it("reports a ranking weight mismatch", () => {
    const [mismatch] = diffExpectation(decision(), { ranking: { effect: "normal", weight: 3 } });
    expect(mismatch).toMatch(/ranking.weight/);
  });

  it("compares reasons order-insensitively", () => {
    const fixture = {
      ...baseFixture(),
      contributions: [
        { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
      ],
    };
    const result = evaluateFixture(fixture, POLICY);
    expect(diffExpectation(result, { reasons: ["admin-user-deny"] })).toEqual([]);
  });

  it("reports a missing transaction dimension", () => {
    const [mismatch] = diffExpectation(decision(), { transaction: { effect: "deny" } });
    expect(mismatch).toMatch(/\(absent\)/);
  });

  it("compares evidence fields", () => {
    const fixture = {
      ...baseFixture(),
      trust: { contacts: [TRUSTED] },
      reports: {
        [`user:${CREATOR}`]: [{ reporter: TRUSTED, category: "spam", createdAt: 1_749_000_000 }],
      },
    };
    const result = evaluateFixture(fixture, POLICY);
    expect(diffExpectation(result, { evidence: { trustedReportTotal: 1 } })).toEqual([]);
    expect(diffExpectation(result, { evidence: { trustedReportTotal: 5 } })).toHaveLength(1);
  });

  it("compares pubkey lists by length via the Count suffix", () => {
    const result = decision();
    expect(diffExpectation(result, { evidence: { trustedReporterPubkeysCount: 0 } })).toEqual([]);
    expect(diffExpectation(result, { evidence: { trustedReporterPubkeysCount: 2 } })).toHaveLength(1);
  });
});

describe("runConformanceCase", () => {
  it("passes a fixture whose expectation holds", () => {
    const { passed, mismatches } = runConformanceCase(baseFixture(), POLICY);
    expect(passed).toBe(true);
    expect(mismatches).toEqual([]);
  });

  it("fails a fixture whose expectation does not hold", () => {
    const fixture = { ...baseFixture(), expect: { visibility: { effect: "deny" } } };
    const { passed, mismatches } = runConformanceCase(fixture, POLICY);
    expect(passed).toBe(false);
    expect(mismatches).toHaveLength(1);
  });
});
