// Persistence, signature verification, and the ingestion flows that were
// previously interface-only.

import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";
import {
  CANONICAL_KIND,
  MUTE_LIST_KIND,
  encodeContribution,
  encodeRoles,
} from "@bitgate/nostr";

import { createBitGate } from "../src/runtime.js";
import { createMemoryStorage, createMemoryTransport } from "../src/interfaces.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CURATOR = "c3".repeat(32);
const CREATOR = "d4".repeat(32);
const VIEWER = "e5".repeat(32);
const TRUSTED = "01".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "app",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: {},
      mutes: { default: { hide: 1 } },
    },
  },
});

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

const denyEvent = () =>
  event({
    id: "bb".repeat(32),
    ...encodeContribution(
      { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
      "app",
    ),
  });

/**
 * @param {Object} [options]
 * @param {import('../src/interfaces.js').GovernanceStorage} [options.storage]
 * @param {any} [options.transport]
 * @param {import('@bitgate/nostr').SignatureVerifier} [options.verifySignature]
 * @param {string} [options.root]
 */
function makeRuntime({ storage, transport, verifySignature, root = ROOT } = {}) {
  return createBitGate({
    applicationId: "test",
    namespace: "app",
    transport: transport ?? createMemoryTransport([rolesEvent(), denyEvent()]),
    storage,
    policy: POLICY,
    now: () => NOW,
    verifySignature,
    root,
    trustUnsignedEvents: true,
  });
}

describe("persistence", () => {
  it("writes administrative state under a namespaced key", async () => {
    const storage = createMemoryStorage();
    const writes = vi.spyOn(storage, "write");
    const runtime = makeRuntime({ storage });

    await runtime.loadAdministrativeState();

    expect(writes).toHaveBeenCalled();
    const [key] = writes.mock.calls[0];
    expect(key).toMatch(/^bitgate:test:app:[0-9a-f]{16}:v1:admin$/);
  });

  it("restores administrative state without touching a relay", async () => {
    const storage = createMemoryStorage();
    const first = makeRuntime({ storage });
    await first.loadAdministrativeState();
    expect(first.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);

    // A fresh runtime with an empty relay, sharing the same storage.
    const offline = createMemoryTransport([]);
    const second = makeRuntime({ storage, transport: offline });
    const restored = await second.hydrate();

    expect(restored).toBe(true);
    expect(second.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
    expect(second.diagnostics.hydratedFromCache).toBe(true);
  });

  it("keeps administrative state effective when the relay is unreachable", async () => {
    const storage = createMemoryStorage();
    const first = makeRuntime({ storage });
    await first.loadAdministrativeState();

    const failing = createMemoryTransport([]);
    failing.list = async () => {
      throw new Error("relay unreachable");
    };
    const second = makeRuntime({ storage, transport: failing });

    await expect(second.loadAdministrativeState()).rejects.toThrow(/unreachable/);

    expect(second.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
    expect(second.stale).toBe(true);
    expect(second.describe().stale).toBe(true);
  });

  it("announces staleness so an application can warn the viewer", async () => {
    const failing = createMemoryTransport([]);
    failing.list = async () => {
      throw new Error("down");
    };
    const runtime = makeRuntime({ transport: failing });
    const handler = vi.fn();
    runtime.on("stale", handler);

    await expect(runtime.loadAdministrativeState()).rejects.toThrow();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ reason: "relay-unreachable" }));
  });

  it("clears staleness after a successful load", async () => {
    const runtime = makeRuntime();
    await runtime.loadAdministrativeState();
    expect(runtime.stale).toBe(false);
    expect(runtime.lastLoadedAt).toBe(NOW);
  });

  it("separates cached state by root authority", async () => {
    const storage = createMemoryStorage();
    const runtime = makeRuntime({ storage });
    await runtime.loadAdministrativeState();

    const underOldRoot = runtime.storageKeyFor("admin");
    runtime.admin.setRoles({ root: CREATOR, actors: {} });
    expect(runtime.storageKeyFor("admin")).not.toBe(underOldRoot);

    // The cache written by the previous administration must not be readable
    // under the new one.
    expect(await storage.read(runtime.storageKeyFor("admin"))).toBeNull();
  });

  it("persists and restores viewer-scoped state separately", async () => {
    const storage = createMemoryStorage();
    const runtime = makeRuntime({ storage });
    runtime.setViewer(VIEWER);
    runtime.trust.setBlocks([CREATOR]);
    runtime.overrides.set(`user:${CREATOR}`, { visibility: "allow" });
    await runtime.persist();

    const second = makeRuntime({ storage });
    second.setViewer(VIEWER);
    await second.hydrate();

    expect(second.trust.blocks.has(CREATOR)).toBe(true);
    expect(second.overrides.toMap().has(`user:${CREATOR}`)).toBe(true);
  });

  it("does not leak one viewer's cached state into another", async () => {
    const storage = createMemoryStorage();
    const runtime = makeRuntime({ storage });
    runtime.setViewer(VIEWER);
    runtime.trust.setBlocks([CREATOR]);
    await runtime.persist();

    const other = makeRuntime({ storage });
    other.setViewer(TRUSTED);
    await other.hydrate();

    expect(other.trust.blocks.size).toBe(0);
  });

  it("ignores a cache written under a different schema version", async () => {
    const storage = createMemoryStorage();
    const runtime = makeRuntime({ storage });
    await storage.write(runtime.storageKeyFor("admin"), {
      schemaVersion: "v0",
      contributions: [{ actor: MODERATOR, kind: "user-deny", targets: [] }],
    });

    expect(await runtime.hydrate()).toBe(false);
  });

  it("can skip hydration and persistence when asked", async () => {
    const storage = createMemoryStorage();
    const writes = vi.spyOn(storage, "write");
    const runtime = makeRuntime({ storage });

    await runtime.loadAdministrativeState({ hydrateFirst: false, persistAfter: false });
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("signature verification", () => {
  it("accepts state when the verifier passes it", async () => {
    const runtime = makeRuntime({ verifySignature: () => true });
    await runtime.loadAdministrativeState();
    expect(runtime.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("rejects unsigned state before it becomes authoritative", async () => {
    const runtime = makeRuntime({ verifySignature: () => false });
    await runtime.loadAdministrativeState();

    expect(runtime.admin.state.userDeny.size).toBe(0);
    expect(runtime.diagnostics.rejectedSignatures).toBeGreaterThan(0);
  });

  it("accepts only the events that verify", async () => {
    const runtime = makeRuntime({
      verifySignature: (candidate) => candidate.pubkey === ROOT,
    });
    await runtime.loadAdministrativeState();

    expect(runtime.admin.authority.root).toBe(ROOT);
    expect(runtime.admin.state.userDeny.size).toBe(0);
  });

  it("supports an async verifier", async () => {
    const runtime = makeRuntime({ verifySignature: async () => true });
    await runtime.loadAdministrativeState();
    expect(runtime.admin.state.userDeny.size).toBe(1);
  });

  it("reports whether verification is enabled", () => {
    expect(makeRuntime().describe().signatureVerification).toBe("disabled");
    expect(makeRuntime({ verifySignature: () => true }).describe().signatureVerification).toBe(
      "enabled",
    );
  });
});

describe("trusted mute list subscriptions", () => {
  it("subscribes by author, chunked", () => {
    const transport = createMemoryTransport();
    const subscribe = vi.spyOn(transport, "subscribe");
    const runtime = createBitGate({
      applicationId: "t",
      namespace: "app",
      transport,
      policy: POLICY,
      now: () => NOW,
      chunkSize: 2,
    });

    runtime.trust.setContacts(["01".repeat(32), "02".repeat(32), "03".repeat(32)]);
    runtime.subscribeToTrustedMuteLists();

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[0][0][0]).toMatchObject({ kinds: [MUTE_LIST_KIND] });
  });

  it("ingests a delivered mute list into evaluation", () => {
    const transport = createMemoryTransport();
    const runtime = createBitGate({
      applicationId: "t",
      namespace: "app",
      transport,
      policy: POLICY,
      now: () => NOW,
    });

    runtime.trust.setContacts([TRUSTED]);
    runtime.subscribeToTrustedMuteLists();

    transport.deliver({
      id: "cc".repeat(32),
      pubkey: TRUSTED,
      kind: MUTE_LIST_KIND,
      created_at: NOW,
      tags: [["p", CREATOR]],
      content: "",
    });

    expect(
      runtime.evaluate({ type: "user", pubkey: CREATOR }, { profile: "feed" }).visibility.effect,
    ).toBe("hide");
  });

  it("closes mute subscriptions on destroy", () => {
    const runtime = makeRuntime();
    runtime.trust.setContacts([TRUSTED]);
    runtime.subscribeToTrustedMuteLists();
    expect(runtime.subscriptions.size).toBe(1);

    runtime.destroy();
    expect(runtime.subscriptions.size).toBe(0);
  });
});

describe("community sources", () => {
  const curatedList = () => ({
    id: "dd".repeat(32),
    pubkey: CURATOR,
    created_at: NOW,
    ...encodeContribution(
      { actor: CURATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
      "app",
    ),
  });

  it("resolves a curator list and marks it as community-sourced", async () => {
    const transport = createMemoryTransport([curatedList()]);
    const runtime = makeRuntime({ transport });
    runtime.admin.setRoles({
      root: ROOT,
      actors: { [ROOT]: ["super_admin"], [CURATOR]: ["curator"] },
    });

    const merged = await runtime.loadCommunitySources([
      { curator: CURATOR, identifier: "app:governance:user-deny:v1", kind: CANONICAL_KIND },
    ]);

    expect(merged).toBe(1);
    expect(runtime.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
    expect(runtime.admin.state.communitySources.get(`user:${CREATOR}`)).toEqual([
      `${CURATOR}:app:governance:user-deny:v1`,
    ]);
  });

  it("still refuses a curator contribution beyond their capability", async () => {
    const transport = createMemoryTransport([
      {
        id: "ee".repeat(32),
        pubkey: CURATOR,
        created_at: NOW,
        ...encodeContribution(
          { actor: CURATOR, kind: "event-deny", targets: [{ type: "event", id: "1b".repeat(32) }] },
          "app",
        ),
      },
    ]);
    const runtime = makeRuntime({ transport });
    runtime.admin.setRoles({ root: ROOT, actors: { [CURATOR]: ["curator"] } });

    await runtime.loadCommunitySources([
      { curator: CURATOR, identifier: "app:governance:event-deny:v1", kind: CANONICAL_KIND },
    ]);

    expect(runtime.admin.state.eventDeny.size).toBe(0);
  });

  it("survives an unreachable curator relay", async () => {
    const transport = createMemoryTransport([]);
    transport.list = async () => {
      throw new Error("curator relay down");
    };
    const runtime = makeRuntime({ transport });
    const handler = vi.fn();
    runtime.on("stale", handler);

    await expect(
      runtime.loadCommunitySources([{ curator: CURATOR, identifier: "x", kind: CANONICAL_KIND }]),
    ).resolves.toBe(0);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "community-source-unreachable" }),
    );
  });
});

describe("import and export", () => {
  it("round-trips administrative state", async () => {
    const source = makeRuntime();
    await source.loadAdministrativeState();

    const target = makeRuntime({ transport: createMemoryTransport([]) });
    expect(target.importState(source.exportState())).toBe(true);
    expect(target.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("exports contributions rather than conclusions", async () => {
    const source = makeRuntime();
    await source.loadAdministrativeState();
    const snapshot = source.exportState();

    expect(Array.isArray(snapshot.contributions)).toBe(true);
    expect(snapshot.effectiveState.userDeny).toContain(`user:${CREATOR}`);
  });

  it("re-derives effective state against the importing roster", async () => {
    const source = makeRuntime();
    await source.loadAdministrativeState();
    const snapshot = source.exportState();

    // Strip the moderator's role before importing: their contribution should
    // no longer take effect.
    snapshot.authority = { root: ROOT, actors: {}, protectedActors: [ROOT] };

    const target = makeRuntime({ transport: createMemoryTransport([]) });
    target.importState(snapshot);
    expect(target.admin.state.userDeny.size).toBe(0);
  });

  it("rejects a snapshot from another schema version or namespace", () => {
    const runtime = makeRuntime();
    expect(runtime.importState({ schemaVersion: "v0" })).toBe(false);
    expect(runtime.importState({ schemaVersion: "v1", namespace: "elsewhere" })).toBe(false);
    expect(runtime.importState(null)).toBe(false);
  });
});

describe("capability queries", () => {
  it("answers what an actor may do", async () => {
    const runtime = makeRuntime();
    await runtime.loadAdministrativeState();

    expect(runtime.can(MODERATOR, "contribute-user-deny")).toBe(true);
    expect(runtime.can(MODERATOR, "manage-roles")).toBe(false);
    expect(runtime.capabilitiesOf(MODERATOR)).toContain("contribute-event-deny");
  });

  it("answers what the current viewer may do", async () => {
    const runtime = makeRuntime();
    await runtime.loadAdministrativeState();

    expect(runtime.viewerCapabilities()).toEqual([]);
    runtime.setViewer(MODERATOR);
    expect(runtime.viewerCapabilities()).toContain("contribute-user-deny");
  });
});
