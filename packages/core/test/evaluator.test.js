import { describe, expect, it } from "vitest";

import { createAuthorityState } from "../src/authority.js";
import { reduceAdminState } from "../src/adminState.js";
import { createPolicyDefinition } from "../src/policy.js";
import {
  aggregateMutes,
  aggregateReports,
  createSnapshot,
  createViewerState,
  evaluateMany,
  evaluateTarget,
  resolveTrustSet,
} from "../src/evaluator.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const STRANGER = "f6".repeat(32);
const EVENT_ID = "1b".repeat(32);
const NOW = 1_750_000_000;
const DAY = 86_400;

const trusted = (index) => index.toString(16).padStart(2, "0").repeat(32);
const TRUSTED = Array.from({ length: 24 }, (_, index) => trusted(index + 1));

/** @param {string} pubkey @returns {import("../src/identifiers.js").UserTarget} */
const user = (pubkey) => ({ type: "user", pubkey });
/** @param {string} id @param {string} author @returns {import("../src/identifiers.js").EventTarget} */
const event = (id, author) => ({ type: "event", id, author });

const POLICY = createPolicyDefinition({
  id: "test",
  version: "2.1.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      muteWindowSeconds: 60 * DAY,
      reports: { default: { restrict: 3 }, spam: { hide: 5 } },
      mutes: { default: { downrank: 1, hide: 20 } },
    },
    strict: {
      name: "strict",
      administrativeDeny: { visibility: "deny", interaction: "deny" },
      allowViewerOverride: false,
      requireAllowlist: true,
      allowlistMiss: { visibility: "hide", interaction: "deny" },
      exposeEvidence: true,
      reports: {},
      mutes: {},
    },
    off: { name: "off", disabled: true },
    commerce: {
      name: "commerce",
      administrativeDeny: { visibility: "allow", transaction: "deny" },
      reports: { scam: { transactionReview: 2, transactionDeny: 4 } },
      mutes: {},
    },
  },
});

const authority = () =>
  createAuthorityState({
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
  });

/**
 * @param {Object} [parts]
 * @param {import("../src/adminState.js").Contribution[]} [parts.contributions]
 * @param {{ contacts?: Set<string>, seeds?: Set<string> }} [parts.trust]
 * @param {Map<string, import("../src/evaluator.js").ReportRecord[]>} [parts.reports]
 * @param {Map<string, import("../src/evaluator.js").MuteRecord[]>} [parts.trustedMutes]
 */
function snapshotWith({ contributions = [], trust, reports, trustedMutes } = {}) {
  const auth = authority();
  return createSnapshot({
    authority: auth,
    admin: reduceAdminState(contributions, auth),
    trust: trust ?? { contacts: new Set(TRUSTED) },
    reports: reports ?? new Map(),
    trustedMutes: trustedMutes ?? new Map(),
  });
}

const context = (profile = "feed") => ({
  surface: profile,
  policyProfile: profile,
  policy: POLICY,
  now: NOW,
});

const reportsFrom = (count, category) =>
  TRUSTED.slice(0, count).map((reporter) => ({ reporter, category, createdAt: NOW - DAY }));

const mutesFrom = (count, updatedAt = NOW - DAY) =>
  TRUSTED.slice(0, count).map((muter) => ({ muter, updatedAt }));

describe("evaluateTarget", () => {
  it("allows a target with no signals", () => {
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), context());
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.interaction.effect).toBe("allow");
    expect(decision.ranking.effect).toBe("normal");
    expect(decision.reasons).toEqual([]);
  });

  it("rejects an invalid target", () => {
    expect(() => evaluateTarget(/** @type {any} */ ({ type: "user", pubkey: "nope" }), snapshotWith(), context())).toThrow(
      /Invalid governance target/,
    );
  });

  it("stamps policy identity and a snapshot fingerprint on the decision", () => {
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), context());
    expect(decision.policyProfile).toBe("feed");
    expect(decision.policyVersion).toBe("2.1.0");
    expect(decision.evaluatedAt).toBe(NOW);
    expect(decision.snapshotFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(decision.key).toBe(`user:${CREATOR}`);
  });

  it("reports a disabled surface instead of pretending to evaluate", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, context("off"));
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.reasons.map((r) => r.id)).toEqual(["policy-disabled"]);
  });
});

describe("administrative denial", () => {
  it("applies the profile's denial effects", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, context());
    expect(decision.visibility.effect).toBe("hide");
    expect(decision.interaction.effect).toBe("deny");
    expect(decision.reasons.map((r) => r.id)).toContain("admin-user-deny");
  });

  it("varies by surface", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    expect(evaluateTarget(user(CREATOR), snapshot, context("strict")).visibility.effect).toBe("deny");
  });

  it("reaches an author's events", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    expect(evaluateTarget(event(EVENT_ID, CREATOR), snapshot, context()).visibility.effect).toBe("hide");
  });

  it("does not reach events of other authors", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    expect(evaluateTarget(event(EVENT_ID, STRANGER), snapshot, context()).visibility.effect).toBe("allow");
  });

  it("leaves a protected actor untouched", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(ROOT)] }],
    });
    const decision = evaluateTarget(user(ROOT), snapshot, context());
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.evidence?.protectedTarget).toBe(true);
  });

  it("blocks a transaction while leaving a product visible", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, context("commerce"));
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.transaction?.effect).toBe("deny");
  });
});

describe("allowlist", () => {
  it("hides a target that misses the allowlist when the profile requires one", () => {
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), context("strict"));
    expect(decision.visibility.effect).toBe("hide");
    expect(decision.reasons.map((r) => r.id)).toContain("allowlist-miss");
  });

  it("permits an allowlisted target", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: ROOT, kind: "user-allow", targets: [user(CREATOR)] }],
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, context("strict"));
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.evidence?.userAllowed).toBe(true);
  });

  it("does not enforce the allowlist on surfaces that do not require it", () => {
    expect(evaluateTarget(user(CREATOR), snapshotWith(), context()).visibility.effect).toBe("allow");
  });

  it("grants no trust from being allowlisted", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: ROOT, kind: "user-allow", targets: [user(CREATOR)] }],
      trust: { contacts: new Set() },
      reports: new Map([[`user:${STRANGER}`, [{ reporter: CREATOR, category: "spam", createdAt: NOW }]]]),
    });
    const decision = evaluateTarget(user(STRANGER), snapshot, context());
    expect(decision.evidence?.trustedReportTotal).toBe(0);
  });
});

describe("viewer state", () => {
  it("hides a blocked author", () => {
    const viewer = createViewerState({ blocks: new Set([CREATOR]) });
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), context(), viewer);
    expect(decision.visibility.effect).toBe("hide");
    expect(decision.evidence?.personalBlock).toBe(true);
  });

  it("applies a block through to the author's events", () => {
    const viewer = createViewerState({ blocks: new Set([CREATOR]) });
    expect(evaluateTarget(event(EVENT_ID, CREATOR), snapshotWith(), context(), viewer).visibility.effect).toBe(
      "hide",
    );
  });

  it("records a viewer mute without changing effects", () => {
    const viewer = createViewerState({ mutes: new Set([CREATOR]) });
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), context(), viewer);
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.evidence?.personalMute).toBe(true);
    expect(decision.reasons.map((r) => r.id)).toContain("viewer-mute");
  });

  it("softens a decision through an override and requires explicit action", () => {
    const viewer = createViewerState({
      overrides: new Map([[`user:${CREATOR}`, { visibility: "allow" }]]),
    });
    const snapshot = snapshotWith({ trustedMutes: new Map([[`user:${CREATOR}`, mutesFrom(20)]]) });
    const decision = evaluateTarget(user(CREATOR), snapshot, context(), viewer);
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.interaction.effect).toBe("require-explicit-action");
  });

  it("never lets an override escalate", () => {
    const viewer = createViewerState({
      overrides: new Map([[`user:${CREATOR}`, { visibility: "deny" }]]),
    });
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), context(), viewer);
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.reasons.map((r) => r.id)).not.toContain("viewer-override");
  });

  it("ignores overrides on a profile that forbids them", () => {
    const viewer = createViewerState({
      overrides: new Map([[`user:${CREATOR}`, { visibility: "allow" }]]),
    });
    expect(evaluateTarget(user(CREATOR), snapshotWith(), context("strict"), viewer).visibility.effect).toBe(
      "hide",
    );
  });

  it("ignores overrides when enforcement disables them", () => {
    const viewer = createViewerState({
      overrides: new Map([[`user:${CREATOR}`, { visibility: "allow" }]]),
    });
    const snapshot = snapshotWith({ trustedMutes: new Map([[`user:${CREATOR}`, mutesFrom(20)]]) });
    const decision = evaluateTarget(
      user(CREATOR),
      snapshot,
      { ...context(), enforcement: { allowOverrides: false } },
      viewer,
    );
    expect(decision.visibility.effect).toBe("hide");
  });

  it("ignores an override naming an unknown effect", () => {
    const viewer = createViewerState({
      overrides: new Map([[`user:${CREATOR}`, /** @type {any} */ ({ visibility: "sideways" })]]),
    });
    const snapshot = snapshotWith({ trustedMutes: new Map([[`user:${CREATOR}`, mutesFrom(20)]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context(), viewer).visibility.effect).toBe("hide");
  });
});

describe("trust resolution", () => {
  it("prefers real contacts over seeds", () => {
    const set = resolveTrustSet({ contacts: new Set([CREATOR]), seeds: new Set([STRANGER]) });
    expect(set.has(CREATOR)).toBe(true);
    expect(set.has(STRANGER)).toBe(false);
  });

  it("falls back to seeds when the viewer follows nobody", () => {
    const set = resolveTrustSet({ contacts: new Set(), seeds: new Set([STRANGER]) });
    expect(set.has(STRANGER)).toBe(true);
  });

  it("returns an empty set when neither is present", () => {
    expect(resolveTrustSet(undefined).size).toBe(0);
  });
});

describe("report aggregation", () => {
  it("restricts at the threshold", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(3, "nudity")]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context()).visibility.effect).toBe("restrict");
  });

  it("stays permissive below the threshold", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(2, "nudity")]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context()).visibility.effect).toBe("allow");
  });

  it("deduplicates a reporter within a category", () => {
    const records = [
      { reporter: TRUSTED[0], category: "spam", createdAt: NOW },
      { reporter: TRUSTED[0], category: "spam", createdAt: NOW - 1 },
    ];
    const result = aggregateReports(
      "k",
      { ...snapshotWith(), reports: new Map([["k", records]]) },
      {},
      new Set(TRUSTED),
    );
    expect(result.total).toBe(1);
  });

  it("counts distinct categories from the same reporter separately", () => {
    const records = [
      { reporter: TRUSTED[0], category: "spam", createdAt: NOW },
      { reporter: TRUSTED[0], category: "nudity", createdAt: NOW },
    ];
    const result = aggregateReports(
      "k",
      { ...snapshotWith(), reports: new Map([["k", records]]) },
      {},
      new Set(TRUSTED),
    );
    expect(result.total).toBe(2);
    expect(result.byCategory).toEqual({ spam: 1, nudity: 1 });
  });

  it("skips untrusted, blocked, and denied reporters", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(TRUSTED[1])] }],
      reports: new Map([
        [
          `user:${CREATOR}`,
          [
            { reporter: TRUSTED[0], category: "spam", createdAt: NOW },
            { reporter: TRUSTED[1], category: "spam", createdAt: NOW },
            { reporter: TRUSTED[2], category: "spam", createdAt: NOW },
            { reporter: STRANGER, category: "spam", createdAt: NOW },
          ],
        ],
      ]),
    });
    const viewer = createViewerState({ blocks: new Set([TRUSTED[2]]) });
    const decision = evaluateTarget(user(CREATOR), snapshot, context(), viewer);
    expect(decision.evidence?.trustedReportTotal).toBe(1);
  });

  it("ignores reports with no category", () => {
    const result = aggregateReports(
      "k",
      { ...snapshotWith(), reports: new Map([["k", [{ reporter: TRUSTED[0], category: "  " }]]]) },
      {},
      new Set(TRUSTED),
    );
    expect(result.total).toBe(0);
  });

  it("applies category-specific thresholds", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(5, "spam")]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context()).visibility.effect).toBe("hide");
  });

  it("drives the transaction dimension on a commerce surface", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(2, "scam")]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context("commerce")).transaction?.effect).toBe(
      "require-review",
    );
  });
});

describe("mute aggregation", () => {
  it("downranks below the hide threshold without hiding", () => {
    const snapshot = snapshotWith({ trustedMutes: new Map([[`user:${CREATOR}`, mutesFrom(19)]]) });
    const decision = evaluateTarget(user(CREATOR), snapshot, context());
    expect(decision.ranking.effect).toBe("downrank");
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.interaction.effect).toBe("allow");
  });

  it("hides at the threshold", () => {
    const snapshot = snapshotWith({ trustedMutes: new Map([[`user:${CREATOR}`, mutesFrom(20)]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context()).visibility.effect).toBe("hide");
  });

  it("counts muters uniquely", () => {
    const records = [
      { muter: TRUSTED[0], updatedAt: NOW },
      { muter: TRUSTED[0], updatedAt: NOW - 1 },
      { muter: TRUSTED[1], updatedAt: NOW },
    ];
    const result = aggregateMutes(
      "k",
      { ...snapshotWith(), trustedMutes: new Map([["k", records]]) },
      {},
      new Set(TRUSTED),
      NOW,
      60 * DAY,
    );
    expect(result.total).toBe(2);
  });

  it("ignores mutes outside the validity window", () => {
    const snapshot = snapshotWith({
      trustedMutes: new Map([[`user:${CREATOR}`, mutesFrom(20, NOW - 61 * DAY)]]),
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, context());
    expect(decision.evidence?.trustedMuteTotal).toBe(0);
    expect(decision.visibility.effect).toBe("allow");
  });

  it("keeps every mute when the window is disabled", () => {
    const result = aggregateMutes(
      "k",
      { ...snapshotWith(), trustedMutes: new Map([["k", mutesFrom(3, NOW - 4000 * DAY)]]) },
      {},
      new Set(TRUSTED),
      NOW,
      0,
    );
    expect(result.total).toBe(3);
  });
});

describe("surface exceptions", () => {
  const bypassPolicy = createPolicyDefinition({
    id: "bypass",
    version: "1.0.0",
    profiles: {
      home: {
        name: "home",
        administrativeDeny: { visibility: "hide", interaction: "deny" },
        bypassHide: true,
        bypassHideCeiling: "restrict",
        reports: {},
        mutes: {},
      },
    },
  });

  it("caps a hide at the configured ceiling", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, {
      surface: "home",
      policyProfile: "home",
      policy: bypassPolicy,
      now: NOW,
    });
    expect(decision.visibility.effect).toBe("restrict");
    expect(decision.reasons.map((r) => r.id)).toContain("surface-policy-bypass");
  });

  it("leaves a decision below the ceiling untouched", () => {
    const decision = evaluateTarget(user(CREATOR), snapshotWith(), {
      surface: "home",
      policyProfile: "home",
      policy: bypassPolicy,
      now: NOW,
    });
    expect(decision.visibility.effect).toBe("allow");
    expect(decision.reasons.map((r) => r.id)).not.toContain("surface-policy-bypass");
  });
});

describe("evidence exposure", () => {
  it("withholds contributor pubkeys by default", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(3, "nudity")]]) });
    const decision = evaluateTarget(user(CREATOR), snapshot, context());
    expect(decision.evidence?.trustedReportTotal).toBe(3);
    expect(decision.evidence?.trustedReporterPubkeys).toEqual([]);
  });

  it("exposes them when the profile opts in", () => {
    const snapshot = snapshotWith({
      contributions: [{ actor: ROOT, kind: "user-allow", targets: [user(CREATOR)] }],
      reports: new Map([[`user:${CREATOR}`, reportsFrom(3, "nudity")]]),
    });
    const decision = evaluateTarget(user(CREATOR), snapshot, context("strict"));
    expect(decision.evidence?.trustedReporterPubkeys).toHaveLength(3);
  });
});

describe("purity and determinism", () => {
  it("produces identical decisions for identical inputs", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(3, "spam")]]) });
    expect(evaluateTarget(user(CREATOR), snapshot, context())).toEqual(
      evaluateTarget(user(CREATOR), snapshot, context()),
    );
  });

  it("does not mutate the snapshot", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(3, "spam")]]) });
    const serialize = () =>
      JSON.stringify({
        deny: [...snapshot.admin.userDeny],
        reports: [...(snapshot.reports ?? new Map()).entries()],
      });
    const before = serialize();
    evaluateTarget(user(CREATOR), snapshot, context());
    expect(serialize()).toBe(before);
  });

  it("does not mutate the target", () => {
    const target = user(CREATOR);
    evaluateTarget(target, snapshotWith(), context());
    expect(target).toEqual({ type: "user", pubkey: CREATOR });
  });

  it("changes the fingerprint when the snapshot changes", () => {
    const clean = evaluateTarget(user(CREATOR), snapshotWith(), context());
    const denied = evaluateTarget(
      user(CREATOR),
      snapshotWith({ contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }] }),
      context(),
    );
    expect(denied.snapshotFingerprint).not.toBe(clean.snapshotFingerprint);
  });

  it("keeps the fingerprint stable across viewers", () => {
    const snapshot = snapshotWith();
    const a = evaluateTarget(user(CREATOR), snapshot, context(), createViewerState({ blocks: new Set() }));
    const b = evaluateTarget(
      user(CREATOR),
      snapshot,
      context(),
      createViewerState({ blocks: new Set([CREATOR]) }),
    );
    expect(a.snapshotFingerprint).toBe(b.snapshotFingerprint);
  });
});

describe("evaluateMany", () => {
  it("evaluates every target and keys results", () => {
    const results = evaluateMany([user(CREATOR), user(STRANGER)], snapshotWith(), context());
    expect(results.size).toBe(2);
    expect(results.get(`user:${CREATOR}`)?.visibility.effect).toBe("allow");
  });

  it("skips invalid targets rather than throwing", () => {
    const results = evaluateMany(
      [user(CREATOR), /** @type {any} */ ({ type: "user", pubkey: "bad" })],
      snapshotWith(),
      context(),
    );
    expect(results.size).toBe(1);
  });

  it("deduplicates repeated targets", () => {
    const results = evaluateMany([user(CREATOR), user(CREATOR)], snapshotWith(), context());
    expect(results.size).toBe(1);
  });

  it("agrees with evaluateTarget", () => {
    const snapshot = snapshotWith({ reports: new Map([[`user:${CREATOR}`, reportsFrom(3, "spam")]]) });
    const many = evaluateMany([user(CREATOR)], snapshot, context()).get(`user:${CREATOR}`);
    expect(many).toEqual(evaluateTarget(user(CREATOR), snapshot, context()));
  });
});
