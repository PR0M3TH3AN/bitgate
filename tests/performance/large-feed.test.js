// Performance fixture.
//
// The extraction must not regress to per-item store lookups or per-card
// subscriptions. These assertions are structural rather than wall-clock: they
// check that no network call happens, that invalidation is targeted, and that
// teardown leaves nothing running. A timing assertion is included but kept
// deliberately loose, because a CI runner's clock is not a benchmark.

import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@nostr-governance/core";
import { createGovernanceRuntime, createMemoryTransport } from "@nostr-governance/runtime";

const AUTHOR_COUNT = 500;
const TARGET_COUNT = 5_000;
const MUTERS_PER_AUTHOR = 100;
const NOW = 1_750_000_000;

const hex = (prefix, index) => `${prefix}${index.toString(16).padStart(10, "0")}`.padEnd(64, "0").slice(0, 64);

/** @param {number} index @returns {import('@nostr-governance/core').GovernanceTarget} */
const userTarget = (index) => ({ type: "user", pubkey: hex("a", index) });
/** @param {number} index @param {number} authorIndex @returns {import('@nostr-governance/core').GovernanceTarget} */
const eventTarget = (index, authorIndex) => ({
  type: "event",
  id: hex("c", index),
  author: hex("a", authorIndex),
});

const author = (index) => hex("a", index);
const muter = (index) => hex("b", index);
const eventId = (index) => hex("c", index);

const POLICY = createPolicyDefinition({
  id: "perf",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: { spam: { downrank: 1, hide: 8 }, scam: { restrict: 3 }, default: { downrank: 2 } },
      mutes: { default: { downrank: 1, hide: 20 } },
      muteWindowSeconds: 60 * 24 * 60 * 60,
    },
    strict: {
      name: "strict",
      administrativeDeny: { visibility: "deny", interaction: "deny" },
      reports: { default: { hide: 1 } },
      mutes: {},
    },
  },
});

/** Build a runtime loaded with a large, realistic governance state. */
function buildLargeRuntime() {
  const transport = createMemoryTransport();
  const runtime = createGovernanceRuntime({
    applicationId: "perf",
    namespace: "perf",
    transport,
    policy: POLICY,
    now: () => NOW,
  });

  const ROOT = hex("f", 1);
  const MODERATORS = [hex("d", 1), hex("d", 2), hex("d", 3)];

  runtime.setViewer(hex("e", 1));

  runtime.admin.setRoles({
    root: ROOT,
    actors: {
      [ROOT]: ["super_admin"],
      ...Object.fromEntries(MODERATORS.map((pubkey) => [pubkey, ["moderator"]])),
    },
  });

  // Several administrative contributors, each denying a slice of authors.
  MODERATORS.forEach((actor, index) => {
    runtime.admin.upsertContribution({
      actor,
      kind: "user-deny",
      createdAt: NOW,
      targets: Array.from({ length: 10 }, (_, offset) => userTarget(index * 10 + offset)),
    });
  });

  runtime.trust.setContacts(Array.from({ length: MUTERS_PER_AUTHOR }, (_, i) => muter(i)));

  // 100 trusted muters against each of the first 50 authors.
  for (let authorIndex = 0; authorIndex < 50; authorIndex += 1) {
    for (let muterIndex = 0; muterIndex < MUTERS_PER_AUTHOR; muterIndex += 1) {
      runtime.mutes.replaceList({
        owner: muter(muterIndex),
        updatedAt: NOW - 1000,
        entries: Array.from({ length: 50 }, (_, i) => ({ pubkey: author(i) })),
        hasEncryptedEntries: false,
      });
    }
  }

  // Reports across several categories.
  for (let index = 0; index < 1_000; index += 1) {
    runtime.reports.ingest(
      {
        reporter: muter(index % MUTERS_PER_AUTHOR),
        target: eventTarget(index, 0),
        category: ["spam", "scam", "misleading"][index % 3],
        createdAt: NOW - 500,
      },
      `event:${eventId(index)}`,
    );
  }

  const targets = Array.from({ length: TARGET_COUNT }, (_, index) =>
    eventTarget(index, index % AUTHOR_COUNT),
  );

  return { runtime, transport, targets, MODERATORS };
}

describe("large feed evaluation", () => {
  it("evaluates 5,000 targets without touching the network", () => {
    const { runtime, transport, targets } = buildLargeRuntime();
    const listSpy = vi.spyOn(transport, "list");
    const subscribeSpy = vi.spyOn(transport, "subscribe");
    const publishSpy = vi.spyOn(transport, "publish");

    const decisions = runtime.evaluateMany(targets, { profile: "feed" });

    expect(decisions.size).toBe(TARGET_COUNT);
    expect(listSpy).not.toHaveBeenCalled();
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("opens a bounded number of subscriptions, not one per card", () => {
    const { runtime, transport, targets } = buildLargeRuntime();
    const subscribeSpy = vi.spyOn(transport, "subscribe");

    runtime.setActiveTargets(targets);
    runtime.subscribeToActiveTargetReports();

    // 5,000 event targets at 200 per filter chunk.
    expect(subscribeSpy).toHaveBeenCalledTimes(Math.ceil(TARGET_COUNT / 200));
  });

  it("produces the same decisions on a second pass", () => {
    const { runtime, targets } = buildLargeRuntime();
    const first = runtime.evaluateMany(targets.slice(0, 200), { profile: "feed" });
    const second = runtime.evaluateMany(targets.slice(0, 200), { profile: "feed" });
    for (const [key, decision] of first) {
      expect(second.get(key)).toEqual(decision);
    }
  });

  it("serves a repeated pass from cache", () => {
    const { runtime, targets } = buildLargeRuntime();
    const slice = targets.slice(0, 500);

    runtime.evaluateMany(slice, { profile: "feed" });
    const missesAfterFirst = runtime.diagnostics.cacheMisses;

    runtime.evaluateMany(slice, { profile: "feed" });
    expect(runtime.diagnostics.cacheMisses).toBe(missesAfterFirst);
    expect(runtime.diagnostics.cacheHits).toBe(500);
  });

  it("keeps profiles separate in the cache", () => {
    const { runtime, targets } = buildLargeRuntime();
    const slice = targets.slice(0, 10);

    const feed = runtime.evaluateMany(slice, { profile: "feed" });
    const strict = runtime.evaluateMany(slice, { profile: "strict" });

    for (const [key, decision] of feed) {
      expect(strict.get(key)?.policyProfile).toBe("strict");
      expect(decision.policyProfile).toBe("feed");
    }
  });

  it("completes a 5,000-target pass in reasonable time", () => {
    const { runtime, targets } = buildLargeRuntime();
    const started = performance.now();
    runtime.evaluateMany(targets, { profile: "feed" });
    // Loose on purpose: this catches an accidental O(n^2), not a slow runner.
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("incremental invalidation", () => {
  it("updating one report invalidates only that target", () => {
    const { runtime, targets } = buildLargeRuntime();
    const slice = targets.slice(0, 100);
    runtime.evaluateMany(slice, { profile: "feed" });
    expect(runtime.decisionCache.size).toBe(100);

    const firstKey = `event:${eventId(0)}`;
    runtime.reports.ingest(
      { reporter: muter(0), target: slice[0], category: "spam", createdAt: NOW },
      firstKey,
    );

    expect(runtime.decisionCache.size).toBe(99);
    expect(runtime.decisionCache.has(`feed|${firstKey}`)).toBe(false);
  });

  it("updating one author's mute state invalidates only that author's targets", () => {
    const { runtime } = buildLargeRuntime();
    const userTargets = Array.from({ length: 20 }, (_, index) => userTarget(200 + index));
    runtime.evaluateMany(userTargets, { profile: "feed" });
    expect(runtime.decisionCache.size).toBe(20);

    runtime.mutes.replaceList({
      owner: muter(0),
      updatedAt: NOW,
      entries: [{ pubkey: author(200) }],
      hasEncryptedEntries: false,
    });

    expect(runtime.decisionCache.has(`feed|user:${author(200)}`)).toBe(false);
    expect(runtime.decisionCache.has(`feed|user:${author(201)}`)).toBe(true);
  });

  it("changing policy invalidates every decision", () => {
    const { runtime, targets } = buildLargeRuntime();
    runtime.evaluateMany(targets.slice(0, 50), { profile: "feed" });
    expect(runtime.decisionCache.size).toBe(50);

    runtime.policies.setLocalPolicy(
      createPolicyDefinition({
        id: "perf-v2",
        version: "2.0.0",
        profiles: { feed: { name: "feed", reports: { default: { hide: 1 } }, mutes: {} } },
      }),
    );
    expect(runtime.decisionCache.size).toBe(0);
  });

  it("changing the moderator roster invalidates every decision", () => {
    const { runtime, targets } = buildLargeRuntime();
    runtime.evaluateMany(targets.slice(0, 50), { profile: "feed" });

    runtime.admin.setRoles({ root: hex("f", 1), actors: {} });
    expect(runtime.decisionCache.size).toBe(0);
  });

  it("switching viewers invalidates every decision", () => {
    const { runtime, targets } = buildLargeRuntime();
    runtime.evaluateMany(targets.slice(0, 50), { profile: "feed" });

    runtime.setViewer(hex("e", 2));
    expect(runtime.decisionCache.size).toBe(0);
  });

  it("hands out frozen decisions so a consumer cannot corrupt the cache", () => {
    const { runtime, targets } = buildLargeRuntime();
    const decision = runtime.evaluate(targets[0], { profile: "feed" });
    expect(() => {
      decision.visibility.effect = "deny";
    }).toThrow();
  });
});

describe("teardown", () => {
  it("leaves no subscriptions or cached decisions", () => {
    const { runtime, targets } = buildLargeRuntime();
    runtime.setActiveTargets(targets.slice(0, 400));
    runtime.subscribeToActiveTargetReports();
    runtime.evaluateMany(targets.slice(0, 50), { profile: "feed" });

    runtime.destroy();

    expect(runtime.subscriptions.size).toBe(0);
    expect(runtime.decisionCache.size).toBe(0);
  });

  it("closes underlying transport subscriptions", () => {
    const { runtime, transport, targets } = buildLargeRuntime();
    const closes = [];
    vi.spyOn(transport, "subscribe").mockImplementation(() => {
      const handle = { close: vi.fn() };
      closes.push(handle);
      return handle;
    });

    runtime.setActiveTargets(targets.slice(0, 400));
    runtime.subscribeToActiveTargetReports();
    runtime.destroy();

    expect(closes.length).toBeGreaterThan(0);
    for (const handle of closes) {
      expect(handle.close).toHaveBeenCalled();
    }
  });
});
