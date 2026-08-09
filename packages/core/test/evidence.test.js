import { describe, expect, it } from "vitest";

import {
  createEmptyEvidence,
  freezeEvidence,
  mergeEvidence,
  redactEvidence,
} from "../src/evidence.js";

const populated = () => ({
  ...createEmptyEvidence(),
  trustedReportTotal: 3,
  trustedReportsByCategory: { spam: 2, nudity: 1 },
  trustedReporterPubkeys: ["cc", "aa", "bb"],
  trustedMuteTotal: 2,
  trustedMutesByCategory: { other: 2 },
  trustedMuterPubkeys: ["zz", "yy"],
});

describe("createEmptyEvidence", () => {
  it("starts at zero with no flags set", () => {
    const evidence = createEmptyEvidence();
    expect(evidence.trustedReportTotal).toBe(0);
    expect(evidence.personalBlock).toBe(false);
    expect(evidence.protectedTarget).toBe(false);
    expect(evidence.trustedReporterPubkeys).toEqual([]);
  });

  it("returns a fresh object each call", () => {
    const first = createEmptyEvidence();
    first.trustedReportTotal = 9;
    expect(createEmptyEvidence().trustedReportTotal).toBe(0);
  });
});

describe("freezeEvidence", () => {
  it("sorts pubkey lists for stable serialization", () => {
    expect(freezeEvidence(populated()).trustedReporterPubkeys).toEqual(["aa", "bb", "cc"]);
  });

  it("sorts category keys", () => {
    expect(Object.keys(freezeEvidence(populated()).trustedReportsByCategory)).toEqual([
      "nudity",
      "spam",
    ]);
  });

  it("preserves counts", () => {
    const frozen = freezeEvidence(populated());
    expect(frozen.trustedReportTotal).toBe(3);
    expect(frozen.trustedReportsByCategory.spam).toBe(2);
  });

  it("does not mutate its input", () => {
    const evidence = populated();
    freezeEvidence(evidence);
    expect(evidence.trustedReporterPubkeys).toEqual(["cc", "aa", "bb"]);
  });

  it("is stable across repeated calls", () => {
    expect(freezeEvidence(populated())).toEqual(freezeEvidence(populated()));
  });
});

describe("redactEvidence", () => {
  it("drops contributor pubkeys", () => {
    const redacted = redactEvidence(populated());
    expect(redacted.trustedReporterPubkeys).toEqual([]);
    expect(redacted.trustedMuterPubkeys).toEqual([]);
  });

  it("keeps the counts that explain the decision", () => {
    const redacted = redactEvidence(populated());
    expect(redacted.trustedReportTotal).toBe(3);
    expect(redacted.trustedMuteTotal).toBe(2);
    expect(redacted.trustedReportsByCategory).toEqual({ nudity: 1, spam: 2 });
  });
});

describe("mergeEvidence", () => {
  it("sums counts across targets", () => {
    const merged = mergeEvidence([populated(), populated()]);
    expect(merged.trustedReportTotal).toBe(6);
    expect(merged.trustedReportsByCategory.spam).toBe(4);
  });

  it("unions contributor lists without duplicating", () => {
    const merged = mergeEvidence([populated(), populated()]);
    expect(merged.trustedReporterPubkeys).toEqual(["aa", "bb", "cc"]);
  });

  it("ors the boolean flags", () => {
    const denied = { ...createEmptyEvidence(), userDenied: true };
    const blocked = { ...createEmptyEvidence(), personalBlock: true };
    const merged = mergeEvidence([denied, blocked]);
    expect(merged.userDenied).toBe(true);
    expect(merged.personalBlock).toBe(true);
    expect(merged.eventDenied).toBe(false);
  });

  it("tolerates empty and malformed input", () => {
    expect(mergeEvidence([]).trustedReportTotal).toBe(0);
    expect(mergeEvidence(/** @type {any} */ ([null])).trustedReportTotal).toBe(0);
  });

  it("returns sorted, stable output", () => {
    expect(mergeEvidence([populated()])).toEqual(mergeEvidence([populated()]));
  });
});
