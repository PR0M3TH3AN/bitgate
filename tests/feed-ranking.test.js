// Pins examples/feed-ranking.mjs: the `ranking` dimension, applied as a score
// multiplier, reorders a downranked author below a clean one without hiding it.
import { describe, expect, it } from "vitest";

import { SOCIAL_POLICY, createAuthorityState, createSnapshot, evaluateTarget } from "@bitgate/core";

const ROOT = "a1".repeat(32);
const NOW = 1_750_000_000;
const TRUSTED = Array.from({ length: 16 }, (_, i) => (i + 1).toString(16).padStart(2, "0").repeat(32));
const authority = createAuthorityState({ root: ROOT });

const snapshotFor = (pubkey, category, count) =>
  createSnapshot({
    authority,
    trust: { contacts: new Set(TRUSTED) },
    reports: count
      ? new Map([
          [
            `user:${pubkey}`,
            TRUSTED.slice(0, count).map((reporter) => ({ reporter, category, createdAt: NOW - 100 })),
          ],
        ])
      : new Map(),
  });

const rankingOf = (pubkey, category, count) =>
  evaluateTarget({ type: "user", pubkey }, snapshotFor(pubkey, category, count), {
    surface: "feed",
    policyProfile: "feed",
    policy: SOCIAL_POLICY,
    now: NOW,
  });

// The same multiplier the example documents.
const multiplier = (ranking, base = 0.5) =>
  ranking?.effect === "downrank" ? base ** Math.max(1, ranking.weight) : 1;

describe("ranking dimension as a feed multiplier", () => {
  it("downranks a reported author but never hides them on a feed", () => {
    const decision = rankingOf("d2".repeat(32), "spam", 4);
    expect(decision.ranking.effect).toBe("downrank");
    expect(decision.ranking.weight).toBeGreaterThanOrEqual(1);
    // Ranking is the soft dimension: visibility stays out of hide/deny on a feed.
    expect(["allow", "warn", "restrict"]).toContain(decision.visibility.effect);
  });

  it("reorders a high-base downranked author below a clean lower-base one", () => {
    const clean = { base: 0.7, ranking: rankingOf("d1".repeat(32), "spam", 0).ranking };
    const reported = { base: 0.95, ranking: rankingOf("d2".repeat(32), "spam", 4).ranking };

    const cleanFinal = clean.base * multiplier(clean.ranking);
    const reportedFinal = reported.base * multiplier(reported.ranking);

    expect(reported.base).toBeGreaterThan(clean.base); // led on base score
    expect(reportedFinal).toBeLessThan(cleanFinal); // ...but sinks after ranking
  });

  it("leaves a clean author's score untouched (×1)", () => {
    expect(multiplier(rankingOf("d1".repeat(32), "spam", 0).ranking)).toBe(1);
  });
});
