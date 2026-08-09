import { describe, expect, it } from "vitest";

import { REASON_IDS, createReason, dedupeReasons, isReasonId } from "../src/reasons.js";

describe("reason identifiers", () => {
  it("exposes the documented set", () => {
    expect(REASON_IDS).toContain("viewer-block");
    expect(REASON_IDS).toContain("trusted-mute-threshold");
    expect(REASON_IDS).toContain("surface-policy-bypass");
  });

  it("has no duplicates", () => {
    expect(new Set(REASON_IDS).size).toBe(REASON_IDS.length);
  });

  it("recognizes known ids only", () => {
    expect(isReasonId("viewer-block")).toBe(true);
    expect(isReasonId("made-up")).toBe(false);
    expect(isReasonId(undefined)).toBe(false);
  });
});

describe("createReason", () => {
  it("creates a bare reason", () => {
    expect(createReason("viewer-block")).toEqual({ id: "viewer-block" });
  });

  it("attaches detail fields", () => {
    expect(
      createReason("trusted-report-threshold", { category: " Spam ", count: 4, threshold: 3 }),
    ).toEqual({ id: "trusted-report-threshold", category: "Spam", count: 4, threshold: 3 });
  });

  it("omits blank and non-numeric detail", () => {
    expect(createReason("trusted-report", { category: "  ", count: Number.NaN })).toEqual({
      id: "trusted-report",
    });
  });

  it("rejects an unknown identifier", () => {
    expect(() => createReason(/** @type {any} */ ("invented"))).toThrow(/Unknown reason identifier/);
  });
});

describe("dedupeReasons", () => {
  it("collapses identical reasons", () => {
    expect(dedupeReasons([createReason("viewer-block"), createReason("viewer-block")])).toHaveLength(1);
  });

  it("keeps reasons that differ by category", () => {
    const reasons = dedupeReasons([
      createReason("trusted-report", { category: "spam" }),
      createReason("trusted-report", { category: "nudity" }),
    ]);
    expect(reasons).toHaveLength(2);
  });

  it("keeps the highest count when merging", () => {
    const reasons = dedupeReasons([
      createReason("trusted-report", { count: 2 }),
      createReason("trusted-report", { count: 7 }),
    ]);
    expect(reasons[0].count).toBe(7);
  });

  it("preserves first-seen order", () => {
    const reasons = dedupeReasons([createReason("viewer-mute"), createReason("viewer-block")]);
    expect(reasons.map((r) => r.id)).toEqual(["viewer-mute", "viewer-block"]);
  });

  it("drops malformed entries", () => {
    expect(
      dedupeReasons(/** @type {any[]} */ ([null, { id: "not-real" }, createReason("viewer-block")])),
    ).toHaveLength(1);
  });
});
