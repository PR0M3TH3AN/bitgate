// Conformance suite for the characterization corpus.
//
// Every fixture under fixtures/bitvid/cases is evaluated against the reference
// application profile. A change to a threshold, a precedence rule, or an effect
// ladder must show up here as a failing case.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runConformanceCase } from "@bitgate/testing/conformance";
import { REFERENCE_POLICY } from "@bitgate/bitvid-compat/profile";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CASES_DIR = join(ROOT, "fixtures", "bitvid", "cases");
const CASE_INDEX = join(ROOT, "fixtures", "bitvid", "characterization-cases.json");

const caseFiles = readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).sort();
const fixtures = caseFiles.map((name) => JSON.parse(readFileSync(join(CASES_DIR, name), "utf8")));

describe("characterization corpus", () => {
  it("has fixtures on disk", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(15);
  });

  it("index matches the files on disk", () => {
    const index = JSON.parse(readFileSync(CASE_INDEX, "utf8"));
    expect([...index].sort()).toEqual(fixtures.map((fixture) => fixture.name).sort());
  });

  it("covers every behavior the migration plan requires", () => {
    const names = new Set(fixtures.map((fixture) => fixture.name));
    const required = [
      "trusted-report-threshold-reached",
      "duplicate-reporter-dedupe",
      "blocked-reporter-ignored",
      "trusted-mute-below-threshold",
      "trusted-mute-at-threshold",
      "expired-trusted-mute",
      "personal-block-precedence",
      "admin-user-deny",
      "admin-event-deny",
      "community-blacklist-merge",
      "moderator-trust-seed",
      "viewer-override-softens-hide",
      "author-override",
      "home-hide-bypass",
      "cache-fallback-effective",
    ];
    for (const name of required) {
      expect(names, `missing required characterization case: ${name}`).toContain(name);
    }
  });
});

describe.each(fixtures.map((fixture) => [fixture.name, fixture]))("%s", (_name, fixture) => {
  it(fixture.description, () => {
    const { passed, mismatches, decision } = runConformanceCase(fixture, REFERENCE_POLICY);
    expect(passed, `${fixture.behavior}\n  ${mismatches.join("\n  ")}`).toBe(true);
    expect(decision.policyProfile).toBe(fixture.profile);
    expect(decision.policyVersion).toBe(REFERENCE_POLICY.version);
    expect(decision.snapshotFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("evaluation determinism", () => {
  it("produces identical decisions for identical snapshots", () => {
    for (const fixture of fixtures) {
      const first = runConformanceCase(fixture, REFERENCE_POLICY).decision;
      const second = runConformanceCase(fixture, REFERENCE_POLICY).decision;
      expect(second).toEqual(first);
      expect(second.snapshotFingerprint).toBe(first.snapshotFingerprint);
    }
  });

  it("does not mutate fixture inputs", () => {
    for (const fixture of fixtures) {
      const before = JSON.stringify(fixture);
      runConformanceCase(fixture, REFERENCE_POLICY);
      expect(JSON.stringify(fixture)).toBe(before);
    }
  });
});
