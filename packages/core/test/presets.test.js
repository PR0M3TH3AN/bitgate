import { describe, expect, it } from "vitest";

import { createAuthorityState } from "../src/authority.js";
import { reduceAdminState } from "../src/adminState.js";
import { createSnapshot, evaluateTarget } from "../src/evaluator.js";
import {
  ADMIN_ONLY_POLICY,
  COMMERCE_POLICY,
  POLICY_PRESETS,
  SOCIAL_POLICY,
  getPolicyPreset,
} from "../src/presets.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const NOW = 1_750_000_000;

const trusted = (index) => index.toString(16).padStart(2, "0").repeat(32);
const TRUSTED = Array.from({ length: 16 }, (_, index) => trusted(index + 1));

const authority = () =>
  createAuthorityState({
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
  });

/** Evaluate a user target with `count` trusted reports in `category`. */
function evaluateWithReports(policy, profile, category, count, contributions = []) {
  const auth = authority();
  const snapshot = createSnapshot({
    authority: auth,
    admin: reduceAdminState(contributions, auth),
    trust: { contacts: new Set(TRUSTED) },
    reports: new Map([
      [
        `user:${CREATOR}`,
        TRUSTED.slice(0, count).map((reporter) => ({ reporter, category, createdAt: NOW - 100 })),
      ],
    ]),
  });

  return evaluateTarget({ type: "user", pubkey: CREATOR }, snapshot, {
    surface: profile,
    policyProfile: profile,
    policy,
    now: NOW,
  });
}

describe("preset registry", () => {
  it("resolves each preset by name", () => {
    expect(getPolicyPreset("social")).toBe(SOCIAL_POLICY);
    expect(getPolicyPreset("commerce")).toBe(COMMERCE_POLICY);
    expect(getPolicyPreset("admin-only")).toBe(ADMIN_ONLY_POLICY);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(getPolicyPreset("  SOCIAL ")).toBe(SOCIAL_POLICY);
  });

  it("returns null for anything else", () => {
    expect(getPolicyPreset("nonsense")).toBeNull();
    expect(getPolicyPreset(/** @type {any} */ (null))).toBeNull();
  });

  it("exposes every preset in the registry", () => {
    expect(Object.keys(POLICY_PRESETS).sort()).toEqual(["admin-only", "commerce", "social"]);
  });
});

describe("social preset", () => {
  it("escalates malware fastest", () => {
    const decision = evaluateWithReports(SOCIAL_POLICY, "playback", "malware", 1);
    expect(decision.visibility.effect).toBe("restrict");
    expect(decision.interaction.effect).toBe("deny");
  });

  it("requires more agreement before acting on spam", () => {
    // One report of spam must not restrict anything: it is the category most
    // easily weaponized against an unpopular account.
    expect(evaluateWithReports(SOCIAL_POLICY, "playback", "spam", 1).visibility.effect).toBe("allow");
    expect(evaluateWithReports(SOCIAL_POLICY, "playback", "spam", 4).visibility.effect).toBe("restrict");
  });

  it("declines to hard-hide on the feed", () => {
    const decision = evaluateWithReports(SOCIAL_POLICY, "feed", "spam", 8);
    expect(decision.visibility.effect).toBe("restrict");
    expect(decision.reasons.map((reason) => reason.id)).toContain("surface-policy-bypass");
  });

  it("does hide on playback, where the viewer chose the item", () => {
    expect(evaluateWithReports(SOCIAL_POLICY, "playback", "spam", 8).visibility.effect).toBe("hide");
  });

  it("exposes evidence only on playback", () => {
    const playback = evaluateWithReports(SOCIAL_POLICY, "playback", "spam", 4);
    const feed = evaluateWithReports(SOCIAL_POLICY, "feed", "spam", 4);
    expect(playback.evidence?.trustedReporterPubkeys.length).toBe(4);
    expect(feed.evidence?.trustedReporterPubkeys).toEqual([]);
  });

  it("leaves a clean target entirely alone", () => {
    const decision = evaluateWithReports(SOCIAL_POLICY, "feed", "spam", 0);
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.ranking.effect).toBe("normal");
  });
});

describe("commerce preset", () => {
  it("blocks checkout on a single malware report", () => {
    expect(evaluateWithReports(COMMERCE_POLICY, "checkout", "malware", 1).transaction?.effect).toBe(
      "deny",
    );
  });

  it("escalates scam through review before denial", () => {
    expect(evaluateWithReports(COMMERCE_POLICY, "checkout", "scam", 2).transaction?.effect).toBe(
      "require-review",
    );
    expect(evaluateWithReports(COMMERCE_POLICY, "checkout", "scam", 3).transaction?.effect).toBe(
      "deny",
    );
  });

  it("keeps a denied listing visible to its own seller", () => {
    const denial = [
      { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
    ];
    const dashboard = evaluateWithReports(
      COMMERCE_POLICY,
      "seller-dashboard",
      "scam",
      0,
      /** @type {any} */ (denial),
    );
    const browse = evaluateWithReports(
      COMMERCE_POLICY,
      "browse",
      "scam",
      0,
      /** @type {any} */ (denial),
    );

    expect(dashboard.visibility.effect).toBe("warn");
    expect(browse.visibility.effect).toBe("hide");
    expect(dashboard.transaction?.effect).toBe("deny");
  });

  it("keeps visibility more generous than transaction", () => {
    const decision = evaluateWithReports(COMMERCE_POLICY, "checkout", "scam", 3);
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.transaction?.effect).toBe("deny");
  });

  it("never hides a listing from its own seller", () => {
    // Strong evidence hides it everywhere else, but the seller still needs to
    // see it to appeal.
    expect(evaluateWithReports(COMMERCE_POLICY, "browse", "scam", 5).visibility.effect).toBe("hide");
    expect(
      evaluateWithReports(COMMERCE_POLICY, "seller-dashboard", "scam", 5).visibility.effect,
    ).toBe("warn");
  });

  it("gives one product different answers per surface from one snapshot", () => {
    const byProfile = Object.fromEntries(
      ["browse", "detail", "checkout", "seller-dashboard"].map((profile) => [
        profile,
        evaluateWithReports(COMMERCE_POLICY, profile, "scam", 5),
      ]),
    );

    expect(byProfile.browse.visibility.effect).toBe("hide");
    expect(byProfile["seller-dashboard"].visibility.effect).toBe("warn");
    expect(byProfile.checkout.visibility.effect).toBe("allow");
    expect(byProfile.checkout.transaction?.effect).toBe("deny");
  });
});

describe("admin-only preset", () => {
  it("enforces administrative denial", () => {
    const decision = evaluateWithReports(ADMIN_ONLY_POLICY, "default", "spam", 0, [
      /** @type {any} */ ({
        actor: MODERATOR,
        kind: "user-deny",
        targets: [{ type: "user", pubkey: CREATOR }],
      }),
    ]);
    expect(decision.visibility.effect).toBe("hide");
  });

  it("ignores trust signals entirely", () => {
    // Even sixteen trusted reports do nothing: this preset is for operators who
    // do not want crowd signals affecting what anyone sees.
    const decision = evaluateWithReports(ADMIN_ONLY_POLICY, "default", "malware", 16);
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.ranking.effect).toBe("normal");
  });
});

describe("preset hygiene", () => {
  it("gives every preset a version and a named default profile", () => {
    for (const [name, policy] of Object.entries(POLICY_PRESETS)) {
      expect(policy.version, name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(policy.defaultProfile, name).toBeTruthy();
      expect(policy.profiles[/** @type {string} */ (policy.defaultProfile)], name).toBeTruthy();
    }
  });

  it("names every profile consistently with its key", () => {
    for (const policy of Object.values(POLICY_PRESETS)) {
      for (const [key, profile] of Object.entries(policy.profiles)) {
        expect(profile.name).toBe(key);
      }
    }
  });
});
