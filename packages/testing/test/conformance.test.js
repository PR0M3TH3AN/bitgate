// Test the conformance utilities
import { describe, it, expect } from "vitest";
import { createFixture, runConformanceTest } from "../src/conformance.js";

describe("conformance utilities", () => {
  it("creates valid fixture objects", () => {
    const fixture = createFixture(
      "test-fixture",
      {
        adminState: { editors: [] },
        trust: {},
        reports: [],
        trustedMutes: [],
        overrides: {},
      },
      { type: "user", pubkey: "test" },
      { visibility: "allow" }
    );
    
    expect(fixture.name).toBe("test-fixture");
    expect(fixture.state.adminState.editors).toEqual([]);
    expect(fixture.target).toEqual({ type: "user", pubkey: "test" });
    expect(fixture.expectation).toEqual({ visibility: "allow" });
  });
  
  it("runs conformance tests", () => {
    const fixture = createFixture(
      "test-fixture",
      {},
      { type: "user", pubkey: "test" },
      { visibility: "allow" }
    );
    
    // Mock evaluator that always returns the expectation
    const mockEvaluator = () => ({ visibility: "allow" });
    
    const result = runConformanceTest(fixture, mockEvaluator);
    expect(result.passed).toBe(true);
    expect(result.actual).toEqual({ visibility: "allow" });
    expect(result.expected).toEqual({ visibility: "allow" });
  });
});