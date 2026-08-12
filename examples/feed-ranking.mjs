/**
 * The `ranking` dimension as a feed score multiplier.
 *
 * Moderation is not only hide/allow. The fourth dimension, `ranking`, is the
 * soft one: it says "still show this, but lower." A feed reads
 * `decision.ranking` — `{ effect: "normal" | "downrank", weight }`, where
 * `weight` grows with each downrank signal — and turns it into a multiplier on
 * whatever score the feed already computed. Nothing is hidden; the order just
 * reflects the governance signal.
 *
 * The multiplier is an application policy, so it lives here, not in the engine
 * (the core ships no such numbers on purpose). Tune `base` to say how hard a
 * downrank bites.
 *
 *   node examples/feed-ranking.mjs
 */
import { SOCIAL_POLICY, createAuthorityState, createSnapshot, evaluateTarget } from "@bitgate/core";

const ROOT = "a1".repeat(32);
const NOW = 1_750_000_000;
const trusted = (i) => i.toString(16).padStart(2, "0").repeat(32);
const TRUSTED = Array.from({ length: 16 }, (_, i) => trusted(i + 1));

// A base feed score the app already computed (recency, affinity, whatever).
// Bob and Carol START ABOVE Alice — the point is that the ranking dimension
// reorders them below her without hiding anything.
// author -> { score, reports: [category, trustedReporterCount] }
const authors = {
  alice: { pubkey: "d1".repeat(32), score: 0.70, reports: [] },
  bob: { pubkey: "d2".repeat(32), score: 0.95, reports: [["spam", 4]] },
  carol: { pubkey: "d3".repeat(32), score: 0.90, reports: [["spam", 8]] },
};

const authority = createAuthorityState({ root: ROOT });

/** Build a snapshot carrying `count` trusted reports of `category` against pubkey. */
function snapshotFor(pubkey, reports) {
  return createSnapshot({
    authority,
    trust: { contacts: new Set(TRUSTED) },
    reports: new Map(
      reports.map(([category, count]) => [
        `user:${pubkey}`,
        TRUSTED.slice(0, count).map((reporter) => ({ reporter, category, createdAt: NOW - 100 })),
      ]),
    ),
  });
}

/**
 * Application policy: turn a ranking decision into a score multiplier. A
 * `normal` ranking is neutral (×1); a `downrank` bites harder the more signals
 * back it (`weight`). Nothing here hides anything — visibility is a separate
 * dimension.
 */
function rankingMultiplier(ranking, { base = 0.5 } = {}) {
  if (!ranking || ranking.effect !== "downrank") return 1;
  return base ** Math.max(1, ranking.weight);
}

const ranked = Object.entries(authors)
  .map(([name, author]) => {
    const decision = evaluateTarget({ type: "user", pubkey: author.pubkey }, snapshotFor(author.pubkey, author.reports), {
      surface: "feed",
      policyProfile: "feed",
      policy: SOCIAL_POLICY,
      now: NOW,
    });
    const multiplier = rankingMultiplier(decision.ranking);
    return {
      name,
      base: author.score,
      ranking: decision.ranking.effect,
      weight: decision.ranking.weight,
      multiplier,
      final: author.score * multiplier,
      visible: decision.visibility.effect, // still shown — ranking never hides
    };
  })
  .sort((a, b) => b.final - a.final);

console.log("Feed after applying the ranking dimension as a score multiplier:\n");
console.log("  name    base   ranking    weight  ×mult   final   visible");
for (const r of ranked) {
  console.log(
    `  ${r.name.padEnd(6)}  ${r.base.toFixed(2)}   ${r.ranking.padEnd(9)}  ${String(r.weight).padStart(4)}   ${r.multiplier
      .toFixed(2)
      .padStart(5)}   ${r.final.toFixed(2)}   ${r.visible}`,
  );
}
console.log(`
Bob and Carol led on base score, but their trusted spam reports downranked
them (×0.5) and both dropped below clean Alice — nothing was hidden (visibility
is a separate dimension, capped at "restrict" on a feed). weight is 1 here
because each crossed the downrank threshold once; a target downranked by several
independent signals accrues more weight and bites harder. That reordering is the
ranking dimension doing its job.`);
