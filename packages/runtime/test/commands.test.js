import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";
import { REPORT_KIND, encodeRoles } from "@bitgate/nostr";

import { ERROR_CODES, createCommands } from "../src/commands.js";
import { createBitGate } from "../src/runtime.js";
import { createMemoryTransport } from "../src/interfaces.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CURATOR = "c3".repeat(32);
const CREATOR = "d4".repeat(32);
const STRANGER = "f6".repeat(32);
const EVENT_ID = "1b".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "app",
  version: "1.0.0",
  profiles: { feed: { name: "feed" } },
});

/**
 * A signer for a given pubkey. Signing simply stamps an id, which is enough for
 * transport assertions and keeps crypto out of the test.
 * @param {string} pubkey
 */
function signerFor(pubkey) {
  return {
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(template) {
      return { ...template, id: "ff".repeat(32), pubkey, sig: "00".repeat(64) };
    },
  };
}

/**
 * @param {Object} [options]
 * @param {string} [options.actor]
 * @param {any} [options.signer]
 * @param {any} [options.transport]
 */
function setup({ actor = MODERATOR, signer, transport } = {}) {
  const memory = transport ?? createMemoryTransport();
  const runtime = createBitGate({
    applicationId: "test",
    namespace: "app",
    transport: memory,
    signer: signer ?? signerFor(actor),
    policy: POLICY,
    now: () => NOW,
  });

  runtime.admin.setRoles({
    root: ROOT,
    actors: {
      [ROOT]: ["super_admin"],
      [MODERATOR]: ["moderator"],
      [CURATOR]: ["curator"],
    },
  });

  return { runtime, commands: createCommands(runtime), transport: memory };
}

describe("authority enforcement", () => {
  it("permits a moderator to deny a user", async () => {
    const { commands, transport } = setup();
    const result = await commands.denyUser(CREATOR);
    expect(result.ok).toBe(true);
    expect(transport.published).toHaveLength(1);
  });

  it("refuses an actor with no roles", async () => {
    const { commands, transport } = setup({ actor: STRANGER });
    const result = await commands.denyUser(CREATOR);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.NOT_AUTHORIZED);
    expect(transport.published).toHaveLength(0);
  });

  it("refuses a curator denying an event", async () => {
    const { commands } = setup({ actor: CURATOR });
    const result = await commands.denyEvent(EVENT_ID);
    expect(result.code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });

  it("permits a curator denying a user", async () => {
    const { commands } = setup({ actor: CURATOR });
    expect((await commands.denyUser(CREATOR)).ok).toBe(true);
  });

  it("never invokes the signer for an unauthorized command", async () => {
    const signer = signerFor(STRANGER);
    const signSpy = vi.spyOn(signer, "signEvent");
    const { commands } = setup({ signer });

    await commands.denyUser(CREATOR);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("stops accepting commands after a role is revoked", async () => {
    const { runtime, commands } = setup();
    expect((await commands.denyUser(CREATOR)).ok).toBe(true);

    runtime.admin.setRoles({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect((await commands.denyUser(CREATOR)).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });

  it("refuses role management to a moderator", async () => {
    const { commands } = setup();
    expect((await commands.setRoles({ actors: {} })).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });

  it("permits role management to the root", async () => {
    const { commands } = setup({ actor: ROOT });
    expect((await commands.setRoles({ actors: { [MODERATOR]: ["moderator"] } })).ok).toBe(true);
  });

  it("refuses policy management to a moderator", async () => {
    const { commands } = setup();
    expect((await commands.setPolicy(POLICY)).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });

  it("refuses community-source management to a curator", async () => {
    const { commands } = setup({ actor: CURATOR });
    const result = await commands.setCommunitySources([
      { curator: CURATOR, identifier: "list", kind: 30078 },
    ]);
    expect(result.code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });
});

describe("protected targets", () => {
  it("refuses to deny the root", async () => {
    const { commands } = setup();
    const result = await commands.denyUser(ROOT);
    expect(result.code).toBe(ERROR_CODES.PROTECTED_TARGET);
  });

  it("does not publish a refused denial", async () => {
    const { commands, transport } = setup();
    await commands.denyUser(ROOT);
    expect(transport.published).toHaveLength(0);
  });
});

describe("argument validation", () => {
  it("rejects an unknown contribution kind", async () => {
    const { commands } = setup();
    const result = await commands.contribute(/** @type {any} */ ("nonsense"), [
      { type: "user", pubkey: CREATOR },
    ]);
    expect(result.code).toBe(ERROR_CODES.INVALID_ARGUMENT);
  });

  it("rejects an empty target list", async () => {
    const { commands } = setup();
    expect((await commands.contribute("user-deny", [])).code).toBe(ERROR_CODES.INVALID_ARGUMENT);
  });

  it("rejects a malformed target", async () => {
    const { commands } = setup();
    expect((await commands.denyUser("not-a-pubkey")).code).toBe(ERROR_CODES.INVALID_TARGET);
  });

  it("rejects a non-object policy", async () => {
    const { commands } = setup({ actor: ROOT });
    expect((await commands.setPolicy(/** @type {any} */ (null))).code).toBe(
      ERROR_CODES.INVALID_ARGUMENT,
    );
  });
});

describe("signer failures", () => {
  it("reports a missing signer", async () => {
    const runtime = createBitGate({
      applicationId: "test",
      namespace: "app",
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
    });
    const commands = createCommands(runtime);
    const result = await commands.denyUser(CREATOR);
    expect(result.code).toBe(ERROR_CODES.NO_SIGNER);
  });
});

describe("publishing", () => {
  it("succeeds on partial relay acceptance and keeps failures visible", async () => {
    const transport = createMemoryTransport();
    transport.publish = async (event) => ({
      ok: true,
      accepted: ["wss://a"],
      failed: [{ relay: "wss://b", error: "rejected" }],
    });
    const { commands } = setup({ transport });

    const result = await commands.denyUser(CREATOR);
    expect(result.ok).toBe(true);
    expect(result.accepted).toEqual(["wss://a"]);
    expect(result.failed).toHaveLength(1);
  });

  it("fails when no relay accepts", async () => {
    const transport = createMemoryTransport();
    transport.publish = async () => ({
      ok: false,
      accepted: [],
      failed: [{ relay: "wss://b", error: "rejected" }],
    });
    const { commands } = setup({ transport });

    const result = await commands.denyUser(CREATOR);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ERROR_CODES.PUBLISH_FAILED);
  });

  it("reports a transport that throws", async () => {
    const transport = createMemoryTransport();
    transport.publish = async () => {
      throw new Error("network down");
    };
    const { commands } = setup({ transport });

    const result = await commands.denyUser(CREATOR);
    expect(result.code).toBe(ERROR_CODES.PUBLISH_FAILED);
    expect(result.event).toBeDefined();
  });

  it("stamps the injected clock onto signed events", async () => {
    const { commands, transport } = setup();
    await commands.denyUser(CREATOR);
    expect(transport.published[0].created_at).toBe(NOW);
  });
});

describe("contribution round-trip", () => {
  it("produces an event the runtime can ingest back into state", async () => {
    const { runtime, commands, transport } = setup();
    await commands.denyUser(CREATOR);

    const fresh = createBitGate({
      applicationId: "test",
      namespace: "app",
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
      root: ROOT,
      trustUnsignedEvents: true,
    });
    fresh.admin.setRoles({
      root: ROOT,
      actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
    });
    fresh.ingestEvent(transport.published[0]);

    expect(fresh.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("marks a community source on the published event", async () => {
    const { commands, transport } = setup({ actor: CURATOR });
    await commands.denyUser(CREATOR, { source: "list-a" });
    expect(transport.published[0].tags).toContainEqual(["source", "list-a"]);
  });

  it("denies an address coordinate", async () => {
    const { commands, transport } = setup();
    const result = await commands.denyAddress("30078", CREATOR, "sku-001");
    expect(result.ok).toBe(true);
    expect(transport.published[0].tags).toContainEqual(["a", `30078:${CREATOR}:sku-001`]);
  });

  it("adds trust seeds", async () => {
    const { commands } = setup();
    expect((await commands.addTrustSeeds([CREATOR])).ok).toBe(true);
  });

  it("allows a user when the actor holds the capability", async () => {
    const { commands } = setup({ actor: ROOT });
    expect((await commands.allowUser(CREATOR)).ok).toBe(true);
  });

  it("refuses user-allow to a moderator", async () => {
    const { commands } = setup();
    expect((await commands.allowUser(CREATOR)).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });
});

describe("reporting", () => {
  it("needs no capability", async () => {
    const { commands, transport } = setup({ actor: STRANGER });
    const result = await commands.report({ type: "event", id: EVENT_ID }, "spam");
    expect(result.ok).toBe(true);
    expect(transport.published[0].kind).toBe(REPORT_KIND);
  });

  it("rejects a malformed target", async () => {
    const { commands } = setup();
    const result = await commands.report(/** @type {any} */ ({ type: "event", id: "x" }), "spam");
    expect(result.code).toBe(ERROR_CODES.INVALID_TARGET);
  });

  it("rejects an empty category", async () => {
    const { commands } = setup();
    const result = await commands.report({ type: "event", id: EVENT_ID }, "   ");
    expect(result.code).toBe(ERROR_CODES.INVALID_ARGUMENT);
  });
});

describe("viewer overrides", () => {
  it("sets an override locally without publishing", () => {
    const { runtime, commands, transport } = setup();
    const result = commands.setOverride({ type: "user", pubkey: CREATOR }, "allow");
    expect(result.ok).toBe(true);
    expect(transport.published).toHaveLength(0);
    expect(runtime.overrides.toMap().has(`user:${CREATOR}`)).toBe(true);
  });

  it("clears an override", () => {
    const { runtime, commands } = setup();
    commands.setOverride({ type: "user", pubkey: CREATOR }, "allow");
    commands.clearOverride({ type: "user", pubkey: CREATOR });
    expect(runtime.overrides.toMap().size).toBe(0);
  });

  it("rejects a malformed target", () => {
    const { commands } = setup();
    expect(commands.setOverride(/** @type {any} */ ({ type: "user", pubkey: "x" }), "allow").code).toBe(
      ERROR_CODES.INVALID_TARGET,
    );
  });
});
