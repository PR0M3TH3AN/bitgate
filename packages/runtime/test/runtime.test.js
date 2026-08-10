import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";
import {
  CANONICAL_KIND,
  MUTE_LIST_KIND,
  REPORT_KIND,
  canonicalIdentifier,
  encodeContribution,
  encodeRoles,
} from "@bitgate/nostr";

import { GovernanceRuntime, chunk, createBitGate } from "../src/runtime.js";
import { createMemoryTransport, storageKey } from "../src/interfaces.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const VIEWER = "e5".repeat(32);
const TRUSTED = "01".repeat(32);
const EVENT_ID = "1b".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "app",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      reports: { default: { restrict: 1 } },
      mutes: {},
    },
  },
});

/**
 * @param {Partial<import('@bitgate/nostr').NostrEvent>} parts
 * @returns {import('@bitgate/nostr').NostrEvent}
 */
const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: MODERATOR,
  kind: CANONICAL_KIND,
  created_at: NOW,
  tags: [],
  content: "",
  ...parts,
});

const rolesEvent = () =>
  event({
    pubkey: ROOT,
    id: "aa".repeat(32),
    ...encodeRoles({ actors: { [MODERATOR]: ["moderator"] }, protectedActors: [] }, "app"),
  });

/** @param {import('@bitgate/core').GovernanceTarget} [target] */
const denyEvent = (target = { type: "user", pubkey: CREATOR }) =>
  event({
    id: "bb".repeat(32),
    ...encodeContribution({ actor: MODERATOR, kind: "user-deny", targets: [target] }, "app"),
  });

function makeRuntime(events = []) {
  const transport = createMemoryTransport(events);
  const runtime = createBitGate({
    applicationId: "test-app",
    namespace: "app",
    transport,
    policy: POLICY,
    now: () => NOW,
    root: ROOT,
    trustUnsignedEvents: true,
  });
  return { runtime, transport };
}

describe("chunk", () => {
  it("splits into bounded pieces", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk for a non-positive size", () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
  });

  it("handles an empty list", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("storageKey", () => {
  it("namespaces by deployment and schema", () => {
    expect(
      storageKey({
        applicationId: "bitroad",
        namespace: "bitroad",
        rootFingerprint: "abcd",
        schemaVersion: "v1",
        scope: "admin",
      }),
    ).toBe("bitgate:bitroad:bitroad:abcd:v1:admin");
  });

  it("appends the viewer for viewer-scoped state", () => {
    const key = storageKey({
      applicationId: "a",
      namespace: "n",
      rootFingerprint: "f",
      schemaVersion: "v1",
      scope: "overrides",
      viewerPubkey: VIEWER,
    });
    expect(key.endsWith(VIEWER)).toBe(true);
  });
});

describe("construction", () => {
  it("requires an application id and namespace", () => {
    expect(() =>
      new GovernanceRuntime(/** @type {any} */ ({ transport: createMemoryTransport() })),
    ).toThrow(/applicationId and namespace/);
  });

  it("requires a transport", () => {
    expect(() =>
      new GovernanceRuntime(/** @type {any} */ ({ applicationId: "a", namespace: "n" })),
    ).toThrow(/transport adapter/);
  });

  it("changes its storage key when the root authority changes", () => {
    const { runtime } = makeRuntime();
    const before = runtime.storageKeyFor("admin");
    // Rotating the root must invalidate the cache namespace so a new
    // administration cannot inherit the previous one's stored state.
    runtime.admin.setRoles({ root: CREATOR, actors: {} });
    expect(runtime.storageKeyFor("admin")).not.toBe(before);
  });
});

describe("ingestEvent", () => {
  it("routes a roles document", () => {
    const { runtime } = makeRuntime();
    expect(runtime.ingestEvent(rolesEvent())).toBe(true);
    expect(runtime.admin.authority.root).toBe(ROOT);
  });

  it("routes a contribution", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());
    expect(runtime.ingestEvent(denyEvent())).toBe(true);
    expect(runtime.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("routes a report", () => {
    const { runtime } = makeRuntime();
    const report = event({
      kind: REPORT_KIND,
      pubkey: TRUSTED,
      tags: [["e", EVENT_ID, "spam"]],
    });
    expect(runtime.ingestEvent(report)).toBe(true);
    expect(runtime.reports.recordsFor(`event:${EVENT_ID}`)).toHaveLength(1);
  });

  it("routes a mute list", () => {
    const { runtime } = makeRuntime();
    const list = event({ kind: MUTE_LIST_KIND, pubkey: TRUSTED, tags: [["p", CREATOR]] });
    expect(runtime.ingestEvent(list)).toBe(true);
    expect(runtime.mutes.toRecordMap().get(`user:${CREATOR}`)).toHaveLength(1);
  });

  it("rejects a policy document from anyone but the root", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());

    const rejected = vi.fn();
    runtime.on("policy-rejected", rejected);
    runtime.ingestEvent(
      event({
        pubkey: MODERATOR,
        tags: [["d", canonicalIdentifier("app", "policy")]],
        content: JSON.stringify({ id: "x", version: "1", profiles: { f: { name: "f" } } }),
      }),
    );

    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "not-root" }));
    expect(runtime.policies.rootPolicy).toBeNull();
  });

  it("applies a root-published policy", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());

    runtime.ingestEvent(
      event({
        pubkey: ROOT,
        tags: [["d", canonicalIdentifier("app", "policy")]],
        content: JSON.stringify({
          id: "root-policy",
          version: "3.0.0",
          profiles: { feed: { name: "feed" } },
        }),
      }),
    );

    expect(runtime.policies.policy.id).toBe("root-policy");
  });

  it("keeps the working policy when the root publishes a malformed one", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());

    const rejected = vi.fn();
    runtime.on("policy-rejected", rejected);
    runtime.ingestEvent(
      event({
        pubkey: ROOT,
        tags: [["d", canonicalIdentifier("app", "policy")]],
        content: JSON.stringify({ id: "broken" }),
      }),
    );

    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "invalid" }));
    expect(runtime.policies.policy.id).toBe("app");
  });

  it("counts unrecognized events instead of throwing", () => {
    const { runtime } = makeRuntime();
    expect(runtime.ingestEvent(event({ kind: 1 }))).toBe(false);
    expect(runtime.diagnostics.unknownEvents).toBe(1);
  });

  it("ignores malformed input", () => {
    const { runtime } = makeRuntime();
    expect(runtime.ingestEvent(/** @type {any} */ (null))).toBe(false);
  });
});

describe("loadAdministrativeState", () => {
  it("ingests only the newest document per coordinate", async () => {
    const older = event({
      id: "11".repeat(32),
      created_at: NOW - 100,
      ...encodeContribution(
        { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
        "app",
      ),
    });
    const newer = event({
      id: "22".repeat(32),
      created_at: NOW,
      ...encodeContribution({ actor: MODERATOR, kind: "user-deny", targets: [] }, "app"),
    });

    const { runtime } = makeRuntime([rolesEvent(), older, newer]);
    await runtime.loadAdministrativeState();
    expect(runtime.admin.state.userDeny.size).toBe(0);
  });

  it("can restrict the query to known authors", async () => {
    const transport = createMemoryTransport([rolesEvent(), denyEvent()]);
    const listSpy = vi.spyOn(transport, "list");
    const runtime = createBitGate({
      applicationId: "a",
      namespace: "app",
      transport,
      policy: POLICY,
      now: () => NOW,
      root: ROOT,
      trustUnsignedEvents: true,
    });

    await runtime.loadAdministrativeState({ authors: [MODERATOR] });
    expect(listSpy.mock.calls[0][0][0]).toMatchObject({ authors: [MODERATOR] });
  });
});

describe("active targets and subscriptions", () => {
  it("chunks report subscriptions rather than opening one per target", () => {
    const transport = createMemoryTransport();
    const subscribeSpy = vi.spyOn(transport, "subscribe");
    const runtime = createBitGate({
      applicationId: "a",
      namespace: "app",
      transport,
      policy: POLICY,
      now: () => NOW,
      chunkSize: 2,
      root: ROOT,
      trustUnsignedEvents: true,
    });

    runtime.setActiveTargets([
      { type: "event", id: "01".repeat(32) },
      { type: "event", id: "02".repeat(32) },
      { type: "event", id: "03".repeat(32) },
    ]);
    runtime.subscribeToActiveTargetReports();

    expect(subscribeSpy).toHaveBeenCalledTimes(2);
  });

  it("separates event and user filters", () => {
    const transport = createMemoryTransport();
    const subscribeSpy = vi.spyOn(transport, "subscribe");
    const runtime = createBitGate({
      applicationId: "a",
      namespace: "app",
      transport,
      policy: POLICY,
      now: () => NOW,
      root: ROOT,
      trustUnsignedEvents: true,
    });

    runtime.setActiveTargets([
      { type: "event", id: EVENT_ID },
      { type: "user", pubkey: CREATOR },
    ]);
    runtime.subscribeToActiveTargetReports();

    const filters = subscribeSpy.mock.calls.map((call) => call[0][0]);
    expect(filters.some((filter) => "#e" in filter)).toBe(true);
    expect(filters.some((filter) => "#p" in filter)).toBe(true);
  });

  it("ingests reports delivered to a live subscription", () => {
    const { runtime, transport } = makeRuntime();
    runtime.setActiveTargets([{ type: "event", id: EVENT_ID }]);
    runtime.subscribeToActiveTargetReports();

    transport.deliver(
      event({ kind: REPORT_KIND, pubkey: TRUSTED, tags: [["e", EVENT_ID, "spam"]] }),
    );
    expect(runtime.reports.recordsFor(`event:${EVENT_ID}`)).toHaveLength(1);
  });

  it("skips invalid targets", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTargets([
      { type: "user", pubkey: CREATOR },
      /** @type {any} */ ({ type: "user", pubkey: "bad" }),
    ]);
    expect(runtime.activeTargets.size).toBe(1);
  });

  it("closes subscriptions on close", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTargets([{ type: "event", id: EVENT_ID }]);
    const handle = runtime.subscribeToActiveTargetReports();
    expect(runtime.subscriptions.size).toBe(1);
    handle.close();
    expect(runtime.subscriptions.size).toBe(0);
  });
});

describe("viewer lifecycle", () => {
  it("clears viewer-specific state on switch", () => {
    const { runtime } = makeRuntime();
    runtime.setViewer(VIEWER);
    runtime.trust.setBlocks([CREATOR]);
    runtime.overrides.set(`user:${CREATOR}`, { visibility: "allow" });

    runtime.setViewer(TRUSTED);
    expect(runtime.trust.blocks.size).toBe(0);
    expect(runtime.overrides.toMap().size).toBe(0);
  });

  it("keeps operator seeds across a viewer switch", () => {
    const { runtime } = makeRuntime();
    runtime.trust.setSeeds([TRUSTED]);
    runtime.setViewer(VIEWER);
    expect(runtime.trust.seeds.has(TRUSTED)).toBe(true);
  });

  it("does not churn when the viewer is unchanged", () => {
    const { runtime } = makeRuntime();
    runtime.setViewer(VIEWER);
    const handler = vi.fn();
    runtime.on("viewer", handler);
    runtime.setViewer(VIEWER);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("evaluation", () => {
  it("evaluates against live store state", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());
    runtime.ingestEvent(denyEvent());

    const decision = runtime.evaluate({ type: "user", pubkey: CREATOR }, { profile: "feed" });
    expect(decision.visibility.effect).toBe("hide");
  });

  it("reflects a report ingested afterwards", () => {
    const { runtime } = makeRuntime();
    runtime.trust.setContacts([TRUSTED]);
    runtime.ingestEvent(
      event({ kind: REPORT_KIND, pubkey: TRUSTED, tags: [["e", EVENT_ID, "spam"]] }),
    );

    const decision = runtime.evaluate({ type: "event", id: EVENT_ID }, { profile: "feed" });
    expect(decision.visibility.effect).toBe("restrict");
  });

  it("applies viewer blocks", () => {
    const { runtime } = makeRuntime();
    runtime.trust.setBlocks([CREATOR]);
    expect(
      runtime.evaluate({ type: "user", pubkey: CREATOR }, { profile: "feed" }).visibility.effect,
    ).toBe("hide");
  });

  it("evaluates many targets consistently with one", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());
    runtime.ingestEvent(denyEvent());

    /** @type {import('@bitgate/core').GovernanceTarget} */
    const target = { type: "user", pubkey: CREATOR };
    const many = runtime.evaluateMany([target], { profile: "feed" });
    expect(many.get(`user:${CREATOR}`)).toEqual(runtime.evaluate(target, { profile: "feed" }));
  });
});

describe("diagnostics and teardown", () => {
  it("describes runtime state", () => {
    const { runtime } = makeRuntime();
    runtime.ingestEvent(rolesEvent());
    const description = runtime.describe();
    expect(description.applicationId).toBe("test-app");
    expect(description.policyId).toBe("app");
    expect(description.eventsIngested).toBeGreaterThan(0);
  });

  it("closes subscriptions and detaches listeners on destroy", () => {
    const { runtime } = makeRuntime();
    runtime.setActiveTargets([{ type: "event", id: EVENT_ID }]);
    runtime.subscribeToActiveTargetReports();

    const handler = vi.fn();
    runtime.on("change", handler);
    runtime.destroy();

    expect(runtime.subscriptions.size).toBe(0);
    runtime.admin.setRoles({ root: ROOT, actors: {} });
    expect(handler).not.toHaveBeenCalled();
  });

  it("is safe to destroy twice", () => {
    const { runtime } = makeRuntime();
    runtime.destroy();
    expect(() => runtime.destroy()).not.toThrow();
  });
});
