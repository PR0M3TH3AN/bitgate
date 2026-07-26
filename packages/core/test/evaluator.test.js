import { describe, it, expect } from "vitest";
import {
  evaluateTarget,
  evaluateMany,
  createGovernanceState,
  createReport,
  createTrustedMute,
  createOverride,
  DEFAULT_THRESHOLDS
} from "../src/evaluator.js";
import {
  createUserTarget,
  createEventTarget
} from "../src/identifiers.js";
import {
  createAuthorityState,
  createActor
} from "../src/authority.js";
import {
  createPolicyContext
} from "../src/policy.js";

describe("evaluator", () => {
  describe("evaluateTarget", () => {
    it("should return default allow decision for target with no reports or mutes", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const state = createGovernanceState();
      const context = createPolicyContext("feed", "default");
      
      const decision = evaluateTarget(target, state, context);
      expect(decision).toEqual({
        visibility: { effect: "allow" },
        interaction: { effect: "allow" },
        reasons: [],
        evidence: []
      });
    });

    it("should hide target with sufficient trusted reports", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const reporter = "1234567890123456789012345678901234567890123456789012345678901234";
      
      // Create authority state with reporter as moderator (can submit reports)
      const authorityState = createAuthorityState({}, {
        [reporter]: createActor(reporter, ["moderator"])
      });
      
      const state = createGovernanceState(
        authorityState,
        {
          "user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": [
            createReport(reporter, target, "spam", Date.now())
          ]
        }
      );
      
      const context = createPolicyContext("feed", "default");
      
      // Add enough reports to exceed the hide threshold
      for (let i = 0; i < DEFAULT_THRESHOLDS.trustedReportHideThreshold; i++) {
        state.reports["user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"].push(
          createReport(reporter, target, "spam", Date.now() + i)
        );
      }
      
      const decision = evaluateTarget(target, state, context);
      expect(decision.visibility.effect).toBe("hide");
      expect(decision.interaction.effect).toBe("deny");
    });

    it("should restrict target with moderate number of trusted reports", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const reporter = "1234567890123456789012345678901234567890123456789012345678901234";
      
      // Create authority state with reporter as moderator (can submit reports)
      const authorityState = createAuthorityState({}, {
        [reporter]: createActor(reporter, ["moderator"])
      });
      
      const state = createGovernanceState(
        authorityState,
        {
          "user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": [
            createReport(reporter, target, "spam", Date.now())
          ]
        }
      );
      
      const context = createPolicyContext("feed", "default");
      
      // Add enough reports to exceed the restrict threshold but not the hide threshold
      for (let i = 0; i < DEFAULT_THRESHOLDS.trustedReportRestrictThreshold; i++) {
        state.reports["user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"].push(
          createReport(reporter, target, "spam", Date.now() + i)
        );
      }
      
      const decision = evaluateTarget(target, state, context);
      expect(decision.visibility.effect).toBe("restrict");
      expect(decision.interaction.effect).toBe("allow");
    });

    it("should hide target with sufficient trusted mutes", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      
      const state = createGovernanceState(
        undefined,
        undefined,
        {
          "user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": 
            createTrustedMute(target, DEFAULT_THRESHOLDS.trustedMuteHideThreshold, {
              "mute": DEFAULT_THRESHOLDS.trustedMuteHideThreshold
            })
        }
      );
      
      const context = createPolicyContext("feed", "default");
      
      const decision = evaluateTarget(target, state, context);
      expect(decision.visibility.effect).toBe("hide");
      expect(decision.interaction.effect).toBe("deny");
    });

    it("should restrict target with moderate number of trusted mutes", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      
      const state = createGovernanceState(
        undefined,
        undefined,
        {
          "user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": 
            createTrustedMute(target, DEFAULT_THRESHOLDS.trustedMuteRestrictThreshold, {
              "mute": DEFAULT_THRESHOLDS.trustedMuteRestrictThreshold
            })
        }
      );
      
      const context = createPolicyContext("feed", "default");
      
      const decision = evaluateTarget(target, state, context);
      expect(decision.visibility.effect).toBe("restrict");
      expect(decision.interaction.effect).toBe("allow");
    });

    it("should apply explicit overrides", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      
      const state = createGovernanceState(
        undefined,
        undefined,
        undefined,
        {
          "user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": 
            createOverride(target, "hide", "Administrative override")
        }
      );
      
      const context = createPolicyContext("feed", "default");
      
      const decision = evaluateTarget(target, state, context);
      expect(decision.visibility.effect).toBe("hide");
      expect(decision.interaction.effect).toBe("hide");
      expect(decision.reasons).toContain("Administrative override");
    });

    it("should ignore overrides when enforcement disallows them", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      
      const state = createGovernanceState(
        undefined,
        undefined,
        undefined,
        {
          "user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": 
            createOverride(target, "hide", "Administrative override")
        }
      );
      
      const context = createPolicyContext("feed", "default", {
        allowOverrides: false
      });
      
      const decision = evaluateTarget(target, state, context);
      expect(decision.visibility.effect).toBe("allow");
      expect(decision.interaction.effect).toBe("allow");
    });
  });

  describe("evaluateMany", () => {
    it("should evaluate multiple targets", () => {
      const target1 = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const target2 = createEventTarget("1234567890123456789012345678901234567890123456789012345678901234");
      
      const state = createGovernanceState();
      const context = createPolicyContext("feed", "default");
      
      const results = evaluateMany([target1, target2], state, context);
      
      expect(results).toHaveProperty("user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(results).toHaveProperty("event:1234567890123456789012345678901234567890123456789012345678901234");
      
      expect(results["user:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"]).toEqual({
        visibility: { effect: "allow" },
        interaction: { effect: "allow" },
        reasons: [],
        evidence: []
      });
      
      expect(results["event:1234567890123456789012345678901234567890123456789012345678901234"]).toEqual({
        visibility: { effect: "allow" },
        interaction: { effect: "allow" },
        reasons: [],
        evidence: []
      });
    });
  });

  describe("createGovernanceState", () => {
    it("should create a valid governance state", () => {
      const authority = createAuthorityState();
      const reports = {};
      const trustedMutes = {};
      const overrides = {};
      const policies = {};
      
      const state = createGovernanceState(authority, reports, trustedMutes, overrides, policies);
      expect(state).toEqual({
        authority,
        reports,
        trustedMutes,
        overrides,
        policies
      });
    });

    it("should create a governance state with default empty objects", () => {
      const state = createGovernanceState();
      expect(state).toEqual({
        authority: { roles: {}, actors: {} },
        reports: {},
        trustedMutes: {},
        overrides: {},
        policies: {}
      });
    });
  });

  describe("createReport", () => {
    it("should create a valid report", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const report = createReport(
        "1234567890123456789012345678901234567890123456789012345678901234",
        target,
        "spam",
        Date.now()
      );
      
      expect(report).toEqual({
        reporter: "1234567890123456789012345678901234567890123456789012345678901234",
        target,
        category: "spam",
        timestamp: expect.any(Number)
      });
    });

    it("should throw error for invalid reporter", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createReport("invalid", target, "spam", Date.now())).toThrow();
    });

    it("should throw error for invalid target", () => {
      expect(() => createReport(
        "1234567890123456789012345678901234567890123456789012345678901234",
        null,
        "spam",
        Date.now()
      )).toThrow();
    });

    it("should throw error for invalid category", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createReport(
        "1234567890123456789012345678901234567890123456789012345678901234",
        target,
        "",
        Date.now()
      )).toThrow();
    });

    it("should throw error for invalid timestamp", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createReport(
        "1234567890123456789012345678901234567890123456789012345678901234",
        target,
        "spam",
        -1
      )).toThrow();
    });
  });

  describe("createTrustedMute", () => {
    it("should create a valid trusted mute", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const trustedMute = createTrustedMute(target, 5, { "mute": 5 });
      
      expect(trustedMute).toEqual({
        target,
        count: 5,
        categories: { "mute": 5 }
      });
    });

    it("should throw error for invalid target", () => {
      expect(() => createTrustedMute(null, 5, { "mute": 5 })).toThrow();
    });

    it("should throw error for invalid count", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createTrustedMute(target, -1, { "mute": 5 })).toThrow();
    });

    it("should throw error for invalid categories", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createTrustedMute(target, 5, null)).toThrow();
    });

    it("should throw error for invalid category names", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createTrustedMute(target, 5, { "": 5 })).toThrow();
    });

    it("should throw error for invalid category counts", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createTrustedMute(target, 5, { "mute": -1 })).toThrow();
    });
  });

  describe("createOverride", () => {
    it("should create a valid override", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const override = createOverride(target, "hide", "Administrative override");
      
      expect(override).toEqual({
        target,
        visibility: "hide",
        reason: "Administrative override"
      });
    });

    it("should create an override without reason", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      const override = createOverride(target, "hide");
      
      expect(override).toEqual({
        target,
        visibility: "hide"
      });
    });

    it("should throw error for invalid target", () => {
      expect(() => createOverride(null, "hide")).toThrow();
    });

    it("should throw error for invalid visibility", () => {
      const target = createUserTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(() => createOverride(target, /** @type {any} */ ("invalid"))).toThrow();
    });
  });
});