import { describe, expect, it } from "vitest";

import {
  INTERACTION_LADDER,
  NEUTRAL_POLICY,
  RANKING_LADDER,
  TRANSACTION_LADDER,
  VISIBILITY_LADDER,
  applyEffects,
  applyThresholds,
  composeDecisions,
  createNeutralDecision,
  createPolicyDefinition,
  effectSeverity,
  maxEffect,
  normalizeCategoryThresholds,
  normalizeDimensionEffects,
  normalizePolicyDefinition,
  resolveProfile,
  resolveThresholds,
} from "../src/policy.js";
import { createReason } from "../src/reasons.js";

describe("effect ladders", () => {
  it("orders visibility from permissive to severe", () => {
    expect(VISIBILITY_LADDER).toEqual(["allow", "warn", "restrict", "hide", "deny"]);
  });

  it("orders the remaining dimensions", () => {
    expect(RANKING_LADDER).toEqual(["normal", "downrank"]);
    expect(INTERACTION_LADDER).toEqual(["allow", "require-explicit-action", "deny"]);
    expect(TRANSACTION_LADDER).toEqual(["allow", "require-review", "deny"]);
  });

  it("ranks effects by severity", () => {
    expect(effectSeverity("visibility", "allow")).toBeLessThan(effectSeverity("visibility", "hide"));
    expect(effectSeverity("visibility", "hide")).toBeLessThan(effectSeverity("visibility", "deny"));
  });

  it("returns -1 for effects outside the ladder", () => {
    expect(effectSeverity("visibility", "banish")).toBe(-1);
  });

  it("throws for an unknown dimension", () => {
    expect(() => effectSeverity(/** @type {any} */ ("vibes"), "allow")).toThrow(/Unknown decision dimension/);
  });

  it("keeps the more severe effect", () => {
    expect(maxEffect("visibility", "allow", "hide")).toBe("hide");
    expect(maxEffect("visibility", "deny", "warn")).toBe("deny");
    expect(maxEffect("interaction", "allow", "require-explicit-action")).toBe("require-explicit-action");
  });

  it("falls back to the valid effect when one side is unknown", () => {
    expect(maxEffect("visibility", "nonsense", "warn")).toBe("warn");
    expect(maxEffect("visibility", "warn", "nonsense")).toBe("warn");
  });
});

describe("normalizeDimensionEffects", () => {
  it("passes valid effects through", () => {
    expect(normalizeDimensionEffects({ visibility: "hide", interaction: "deny" })).toEqual({
      visibility: "hide",
      interaction: "deny",
    });
  });

  it("rejects an effect from the wrong ladder", () => {
    expect(() => normalizeDimensionEffects({ interaction: /** @type {any} */ ("hide") })).toThrow(
      /invalid interaction effect/,
    );
  });

  it("returns an empty object for missing input", () => {
    expect(normalizeDimensionEffects(/** @type {any} */ (undefined))).toEqual({});
  });
});

describe("normalizeCategoryThresholds", () => {
  it("lowercases categories and floors values", () => {
    expect(normalizeCategoryThresholds({ SPAM: { hide: 5.7 } })).toEqual({ spam: { hide: 5 } });
  });

  it("drops non-numeric gates", () => {
    expect(normalizeCategoryThresholds({ spam: { hide: /** @type {any} */ ("many") } })).toEqual({
      spam: {},
    });
  });

  it("rejects negative thresholds", () => {
    expect(() => normalizeCategoryThresholds({ spam: { hide: -1 } })).toThrow(/must be >= 0/);
  });
});

describe("normalizePolicyDefinition", () => {
  const valid = {
    id: "app",
    version: "1.0.0",
    profiles: { feed: { name: "feed" } },
  };

  it("normalizes a minimal policy", () => {
    const policy = normalizePolicyDefinition(valid);
    expect(policy.id).toBe("app");
    expect(policy.defaultProfile).toBe("feed");
    expect(policy.profiles.feed.allowViewerOverride).toBe(true);
  });

  it("requires an id and a version", () => {
    expect(() => normalizePolicyDefinition({ ...valid, id: "" })).toThrow(/non-empty id/);
    expect(() => normalizePolicyDefinition({ ...valid, version: "" })).toThrow(/version string/);
  });

  it("requires at least one profile", () => {
    expect(() => normalizePolicyDefinition({ ...valid, profiles: {} })).toThrow(/at least one profile/);
  });

  it("rejects a default profile that does not exist", () => {
    expect(() => normalizePolicyDefinition({ ...valid, defaultProfile: "nope" })).toThrow(
      /is not defined/,
    );
  });

  it("names a profile from its map key when the profile omits a name", () => {
    const policy = normalizePolicyDefinition({
      ...valid,
      profiles: { checkout: /** @type {any} */ ({}) },
    });
    expect(policy.profiles.checkout.name).toBe("checkout");
  });

  it("defaults the hide ceiling when bypassHide is set", () => {
    const policy = normalizePolicyDefinition({
      ...valid,
      profiles: { feed: { name: "feed", bypassHide: true } },
    });
    expect(policy.profiles.feed.bypassHideCeiling).toBe("restrict");
  });

  it("rejects a negative mute window", () => {
    expect(() =>
      normalizePolicyDefinition({
        ...valid,
        profiles: { feed: { name: "feed", muteWindowSeconds: -5 } },
      }),
    ).toThrow(/muteWindowSeconds/);
  });

  it("is exposed as createPolicyDefinition", () => {
    expect(createPolicyDefinition(valid).id).toBe("app");
  });
});

describe("resolveProfile", () => {
  const policy = createPolicyDefinition({
    id: "app",
    version: "1.0.0",
    defaultProfile: "feed",
    profiles: { feed: { name: "feed" }, checkout: { name: "checkout" } },
  });

  it("returns the requested profile", () => {
    expect(resolveProfile(policy, { surface: "x", policyProfile: "checkout" }).name).toBe("checkout");
  });

  it("falls back to the default profile", () => {
    expect(resolveProfile(policy, { surface: "x" }).name).toBe("feed");
  });

  it("throws for an unknown profile rather than silently falling back", () => {
    expect(() => resolveProfile(policy, { surface: "x", policyProfile: "ghost" })).toThrow(
      /Unknown policy profile/,
    );
  });
});

describe("resolveThresholds", () => {
  const table = { spam: { hide: 5 }, default: { restrict: 3 } };

  it("prefers an exact category match", () => {
    expect(resolveThresholds(table, "spam")).toEqual({ hide: 5 });
  });

  it("falls back to the default entry", () => {
    expect(resolveThresholds(table, "nudity")).toEqual({ restrict: 3 });
  });

  it("returns an empty object when nothing matches", () => {
    expect(resolveThresholds({ spam: { hide: 5 } }, "nudity")).toEqual({});
    expect(resolveThresholds(undefined, "spam")).toEqual({});
  });
});

describe("applyThresholds", () => {
  it("fires gates at or above the threshold", () => {
    const { effects } = applyThresholds(3, { restrict: 3 });
    expect(effects.visibility).toBe("restrict");
  });

  it("does not fire below the threshold", () => {
    const { effects, firedGates } = applyThresholds(2, { restrict: 3 });
    expect(effects).toEqual({});
    expect(firedGates).toEqual([]);
  });

  it("keeps the most severe gate when several fire", () => {
    const { effects } = applyThresholds(10, { warn: 1, restrict: 3, hide: 5 });
    expect(effects.visibility).toBe("hide");
  });

  it("treats a zero threshold as disabled rather than always-on", () => {
    const { effects } = applyThresholds(5, { hide: 0 });
    expect(effects).toEqual({});
  });

  it("ignores non-positive counts", () => {
    expect(applyThresholds(0, { warn: 1 }).effects).toEqual({});
    expect(applyThresholds(Number.NaN, { warn: 1 }).effects).toEqual({});
  });

  it("maps gates onto their own dimensions", () => {
    const { effects } = applyThresholds(5, {
      downrank: 1,
      restrict: 2,
      requireExplicitAction: 3,
      transactionDeny: 4,
    });
    expect(effects).toEqual({
      ranking: "downrank",
      visibility: "restrict",
      interaction: "require-explicit-action",
      transaction: "deny",
    });
  });
});

describe("applyEffects", () => {
  it("escalates but never softens", () => {
    const decision = createNeutralDecision();
    applyEffects(decision, { visibility: "hide" });
    applyEffects(decision, { visibility: "warn" });
    expect(decision.visibility.effect).toBe("hide");
  });

  it("accumulates downrank weight", () => {
    const decision = createNeutralDecision();
    applyEffects(decision, { ranking: "downrank" });
    applyEffects(decision, { ranking: "downrank" });
    expect(decision.ranking.weight).toBe(2);
    expect(decision.ranking.effect).toBe("downrank");
  });

  it("creates the transaction dimension on demand", () => {
    const decision = createNeutralDecision();
    expect(decision.transaction).toBeUndefined();
    applyEffects(decision, { transaction: "deny" });
    expect(decision.transaction).toEqual({ effect: "deny" });
  });

  it("deduplicates reasons", () => {
    const decision = createNeutralDecision();
    applyEffects(decision, {}, [createReason("viewer-block"), createReason("viewer-block")]);
    expect(decision.reasons).toHaveLength(1);
  });
});

describe("composeDecisions", () => {
  const withVisibility = (effect, weight = 0) => {
    const decision = createNeutralDecision();
    decision.visibility.effect = effect;
    decision.ranking.weight = weight;
    return decision;
  };

  it("returns a neutral decision for an empty list", () => {
    const composed = composeDecisions([]);
    expect(composed.visibility.effect).toBe("allow");
  });

  it("keeps the most severe effect", () => {
    expect(composeDecisions([withVisibility("warn"), withVisibility("hide")]).visibility.effect).toBe(
      "hide",
    );
  });

  it("is order-independent", () => {
    const a = composeDecisions([withVisibility("warn"), withVisibility("hide")]);
    const b = composeDecisions([withVisibility("hide"), withVisibility("warn")]);
    expect(a.visibility.effect).toBe(b.visibility.effect);
  });

  it("sums ranking weight", () => {
    expect(composeDecisions([withVisibility("allow", 2), withVisibility("allow", 3)]).ranking.weight).toBe(5);
  });

  it("makes a decision non-overridable if any input was", () => {
    const locked = createNeutralDecision();
    locked.visibility.overridable = false;
    expect(composeDecisions([createNeutralDecision(), locked]).visibility.overridable).toBe(false);
  });

  it("does not mutate its inputs", () => {
    const first = withVisibility("warn");
    composeDecisions([first, withVisibility("deny")]);
    expect(first.visibility.effect).toBe("warn");
  });
});

describe("NEUTRAL_POLICY", () => {
  it("enforces administrative denial", () => {
    expect(NEUTRAL_POLICY.profiles.default.administrativeDeny?.visibility).toBe("hide");
  });

  it("applies no trust thresholds of its own", () => {
    expect(NEUTRAL_POLICY.profiles.default.reports).toEqual({});
    expect(NEUTRAL_POLICY.profiles.default.mutes).toEqual({});
  });
});
