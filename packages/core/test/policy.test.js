import { describe, it, expect } from "vitest";
import {
  BUILTIN_POLICY_PROFILES,
  createPolicyEffect,
  createPolicyProfile,
  createPolicyDefinition,
  createPolicyContext,
  createGovernanceDecision,
  getPolicyEffect,
  composeGovernanceDecisions
} from "../src/policy.js";

describe("policy", () => {
  describe("BUILTIN_POLICY_PROFILES", () => {
    it("should define built-in policy profiles with effects", () => {
      expect(BUILTIN_POLICY_PROFILES).toHaveProperty("default");
      expect(BUILTIN_POLICY_PROFILES).toHaveProperty("moderate");
      expect(BUILTIN_POLICY_PROFILES).toHaveProperty("strict");
      expect(BUILTIN_POLICY_PROFILES).toHaveProperty("commerce-default");
      expect(BUILTIN_POLICY_PROFILES).toHaveProperty("commerce-transaction");
      
      // Check that each profile has a name and effects
      for (const [name, profile] of Object.entries(BUILTIN_POLICY_PROFILES)) {
        expect(profile.name).toBe(name);
        expect(profile.effects).toBeDefined();
        expect(typeof profile.effects).toBe("object");
      }
    });
  });

  describe("createPolicyEffect", () => {
    it("should create a valid policy effect", () => {
      const effect = createPolicyEffect("hide", "User is blocked", { details: "more info" });
      expect(effect).toEqual({
        effect: "hide",
        reason: "User is blocked",
        details: { details: "more info" }
      });
    });

    it("should create a policy effect without optional fields", () => {
      const effect = createPolicyEffect("allow");
      expect(effect).toEqual({ effect: "allow" });
    });

    it("should throw error for invalid effect", () => {
      expect(() => createPolicyEffect(/** @type {any} */ ("invalid"))).toThrow();
      expect(() => createPolicyEffect(/** @type {any} */ (123))).toThrow();
    });
  });

  describe("createPolicyProfile", () => {
    it("should create a valid policy profile", () => {
      const profile = createPolicyProfile("test-profile", {
        "visibility": { effect: "hide", reason: "Hidden" },
        "interaction": { effect: "deny", reason: "Denied" }
      });
      
      expect(profile).toEqual({
        name: "test-profile",
        effects: {
          "visibility": { effect: "hide", reason: "Hidden" },
          "interaction": { effect: "deny", reason: "Denied" }
        }
      });
    });

    it("should throw error for invalid profile name", () => {
      expect(() => createPolicyProfile("", {})).toThrow();
      expect(() => createPolicyProfile(/** @type {any} */ (123), {})).toThrow();
    });

    it("should throw error for invalid effects", () => {
      expect(() => createPolicyProfile("test-profile", /** @type {any} */ (null))).toThrow();
      expect(() => createPolicyProfile("test-profile", /** @type {any} */ ("not-an-object"))).toThrow();
    });

    it("should throw error for invalid effect types", () => {
      expect(() => createPolicyProfile("test-profile", {
        "": { effect: "allow" }
      })).toThrow();
      
      expect(() => createPolicyProfile("test-profile", {
        "visibility": /** @type {any} */ (null)
      })).toThrow();
      
      expect(() => createPolicyProfile("test-profile", {
        "visibility": { effect: /** @type {any} */ ("invalid") }
      })).toThrow();
    });
  });

  describe("createPolicyDefinition", () => {
    it("should create a valid policy definition", () => {
      const definition = createPolicyDefinition(
        "test-policy",
        "Test Policy",
        "A test policy",
        {
          "default": {
            name: "default",
            effects: {
              "visibility": { effect: "allow" }
            }
          }
        }
      );
      
      expect(definition).toEqual({
        id: "test-policy",
        name: "Test Policy",
        description: "A test policy",
        profiles: {
          "default": {
            name: "default",
            effects: {
              "visibility": { effect: "allow" }
            }
          }
        }
      });
    });

    it("should throw error for invalid ID", () => {
      expect(() => createPolicyDefinition("", "Test Policy", "A test policy", {})).toThrow();
      expect(() => createPolicyDefinition(/** @type {any} */ (123), "Test Policy", "A test policy", {})).toThrow();
    });

    it("should throw error for invalid name", () => {
      expect(() => createPolicyDefinition("test-policy", "", "A test policy", {})).toThrow();
      expect(() => createPolicyDefinition("test-policy", /** @type {any} */ (123), "A test policy", {})).toThrow();
    });

    it("should throw error for invalid description", () => {
      expect(() => createPolicyDefinition("test-policy", "Test Policy", /** @type {any} */ (123), {})).toThrow();
    });

    it("should throw error for invalid profiles", () => {
      expect(() => createPolicyDefinition("test-policy", "Test Policy", "A test policy", /** @type {any} */ (null))).toThrow();
      expect(() => createPolicyDefinition("test-policy", "Test Policy", "A test policy", /** @type {any} */ ("not-an-object"))).toThrow();
    });

    it("should throw error for invalid profile names", () => {
      expect(() => createPolicyDefinition(
        "test-policy",
        "Test Policy",
        "A test policy",
        {
          "": {
            name: "",
            effects: {}
          }
        }
      )).toThrow();
    });

    it("should throw error for profile name mismatch", () => {
      expect(() => createPolicyDefinition(
        "test-policy",
        "Test Policy",
        "A test policy",
        {
          "default": {
            name: "different-name",
            effects: {}
          }
        }
      )).toThrow();
    });
  });

  describe("createPolicyContext", () => {
    it("should create a valid policy context", () => {
      const context = createPolicyContext("feed", "default");
      expect(context).toEqual({
        surface: "feed",
        policyProfile: "default"
      });
    });

    it("should create a policy context with enforcement options", () => {
      const context = createPolicyContext("feed", "default", {
        hardHide: true,
        allowOverrides: false
      });
      
      expect(context).toEqual({
        surface: "feed",
        policyProfile: "default",
        enforcement: {
          hardHide: true,
          allowOverrides: false
        }
      });
    });

    it("should throw error for invalid surface", () => {
      expect(() => createPolicyContext("", "default")).toThrow();
      expect(() => createPolicyContext(/** @type {any} */ (123), "default")).toThrow();
    });

    it("should throw error for invalid policy profile", () => {
      expect(() => createPolicyContext("feed", "")).toThrow();
      expect(() => createPolicyContext("feed", /** @type {any} */ (123))).toThrow();
    });
  });

  describe("createGovernanceDecision", () => {
    it("should create a valid governance decision", () => {
      const decision = createGovernanceDecision(
        { effect: "hide", reason: "Hidden" },
        { effect: "deny", reason: "Denied" },
        { effect: "deny", reason: "Transaction denied" },
        ["reason1", "reason2"],
        [{ evidence: "evidence1" }, { evidence: "evidence2" }],
        { metadata: "data" }
      );
      
      expect(decision).toEqual({
        visibility: { effect: "hide", reason: "Hidden" },
        interaction: { effect: "deny", reason: "Denied" },
        transaction: { effect: "deny", reason: "Transaction denied" },
        reasons: ["reason1", "reason2"],
        evidence: [{ evidence: "evidence1" }, { evidence: "evidence2" }],
        metadata: { metadata: "data" }
      });
    });

    it("should create a governance decision without optional fields", () => {
      const decision = createGovernanceDecision(
        { effect: "allow" },
        { effect: "allow" }
      );
      
      expect(decision).toEqual({
        visibility: { effect: "allow" },
        interaction: { effect: "allow" },
        reasons: [],
        evidence: []
      });
    });

    it("should throw error for invalid visibility effect", () => {
      expect(() => createGovernanceDecision(
        /** @type {any} */ ({ effect: "invalid" }),
        { effect: "allow" }
      )).toThrow();
    });

    it("should throw error for invalid interaction effect", () => {
      expect(() => createGovernanceDecision(
        { effect: "allow" },
        /** @type {any} */ ({ effect: "invalid" })
      )).toThrow();
    });

    it("should throw error for invalid transaction effect", () => {
      expect(() => createGovernanceDecision(
        { effect: "allow" },
        { effect: "allow" },
        /** @type {any} */ ({ effect: "invalid" })
      )).toThrow();
    });

    it("should throw error for invalid reasons", () => {
      expect(() => createGovernanceDecision(
        { effect: "allow" },
        { effect: "allow" },
        undefined,
        /** @type {any} */ ("not-an-array")
      )).toThrow();
    });

    it("should throw error for invalid evidence", () => {
      expect(() => createGovernanceDecision(
        { effect: "allow" },
        { effect: "allow" },
        undefined,
        [],
        /** @type {any} */ ("not-an-array")
      )).toThrow();
    });
  });

  describe("getPolicyEffect", () => {
    it("should return effect for built-in profiles", () => {
      const effect = getPolicyEffect("strict", "visibility");
      expect(effect).toEqual({ effect: "hide" });
    });

    it("should return effect for custom policies", () => {
      const customPolicies = {
        "custom-policy": {
          id: "custom-policy",
          name: "Custom Policy",
          description: "A custom policy",
          profiles: {
            "custom-profile": {
              name: "custom-profile",
              effects: {
                "visibility": { effect: "hide", reason: "Custom hidden" }
              }
            }
          }
        }
      };
      
      const effect = getPolicyEffect("custom-profile", "visibility", /** @type {any} */ (customPolicies));
      expect(effect).toEqual({ effect: "hide", reason: "Custom hidden" });
    });

    it("should prefer custom policies over built-in profiles", () => {
      const customPolicies = {
        "custom-policy": {
          id: "custom-policy",
          name: "Custom Policy",
          description: "A custom policy",
          profiles: {
            "default": {
              name: "default",
              effects: {
                "visibility": { effect: "hide", reason: "Custom default" }
              }
            }
          }
        }
      };
      
      const effect = getPolicyEffect("default", "visibility", /** @type {any} */ (customPolicies));
      expect(effect).toEqual({ effect: "hide", reason: "Custom default" });
    });

    it("should return default allow effect for unknown profiles/effects", () => {
      const effect = getPolicyEffect("unknown-profile", "unknown-effect");
      expect(effect).toEqual({ effect: "allow" });
    });
  });

  describe("composeGovernanceDecisions", () => {
    it("should return default allow decision for empty array", () => {
      const decision = composeGovernanceDecisions([]);
      expect(decision).toEqual({
        visibility: { effect: "allow" },
        interaction: { effect: "allow" },
        reasons: [],
        evidence: []
      });
    });

    it("should return the single decision for array with one element", () => {
      const inputDecision = createGovernanceDecision(
        { effect: "hide", reason: "Hidden" },
        { effect: "deny", reason: "Denied" },
        undefined,
        ["reason1"],
        [{ evidence: "evidence1" }]
      );
      
      const decision = composeGovernanceDecisions([inputDecision]);
      expect(decision).toEqual(inputDecision);
    });

    it("should compose multiple decisions with most restrictive effects", () => {
      const decisions = [
        createGovernanceDecision(
          { effect: "allow" },
          { effect: "allow" }
        ),
        createGovernanceDecision(
          { effect: "hide", reason: "Hidden" },
          { effect: "deny", reason: "Denied" }
        ),
        createGovernanceDecision(
          { effect: "restrict", reason: "Restricted" },
          { effect: "allow" }
        )
      ];
      
      const decision = composeGovernanceDecisions(decisions);
      expect(decision.visibility).toEqual({ effect: "hide", reason: "Hidden" });
      expect(decision.interaction).toEqual({ effect: "deny", reason: "Denied" });
    });

    it("should combine reasons and evidence from all decisions", () => {
      const decisions = [
        createGovernanceDecision(
          { effect: "allow" },
          { effect: "allow" },
          undefined,
          ["reason1", "reason2"],
          [{ evidence: "evidence1" }]
        ),
        createGovernanceDecision(
          { effect: "hide" },
          { effect: "deny" },
          undefined,
          ["reason2", "reason3"],
          [{ evidence: "evidence2" }]
        )
      ];
      
      const decision = composeGovernanceDecisions(decisions);
      expect(decision.reasons).toEqual(["reason1", "reason2", "reason3"]);
      expect(decision.evidence).toEqual([
        { evidence: "evidence1" },
        { evidence: "evidence2" }
      ]);
    });

    it("should compose transaction effects when present", () => {
      const decisions = [
        createGovernanceDecision(
          { effect: "allow" },
          { effect: "allow" },
          { effect: "allow" }
        ),
        createGovernanceDecision(
          { effect: "hide" },
          { effect: "deny" },
          { effect: "deny", reason: "Transaction denied" }
        )
      ];
      
      const decision = composeGovernanceDecisions(decisions);
      expect(decision.transaction).toEqual({ effect: "deny", reason: "Transaction denied" });
    });
  });
});