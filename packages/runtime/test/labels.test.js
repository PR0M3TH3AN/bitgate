// NIP-32 label ingestion in the runtime.
//
// The property that matters most: a label is a contribution, so it is subject
// to the identical capability gate. An untrusted labeller's "deny" must do
// nothing.

import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";
import { LABEL_KIND, encodeLabel } from "@bitgate/nostr";

import { createBitGate, createCommands, createMemoryTransport } from "@bitgate/runtime";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const STRANGER = "f6".repeat(32);
const VICTIM = "d4".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "labels",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: {},
      mutes: {},
    },
  },
});

function makeRuntime(options = {}) {
  const runtime = createBitGate({
    applicationId: "labels",
    namespace: "app",
    root: ROOT,
    transport: createMemoryTransport(),
    policy: POLICY,
    now: () => NOW,
    trustUnsignedEvents: true,
    labelMapping: { namespace: "app.mod", denyValues: ["deny"], allowValues: ["allow"] },
    ...options,
  });
  runtime.admin.setRoles({
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
  });
  return runtime;
}

const labelEvent = (pubkey, value, target, id = "01") => ({
  id: id.repeat(32),
  pubkey,
  created_at: NOW,
  ...encodeLabel({ value, namespace: "app.mod", targets: [target] }),
});

describe("label ingestion", () => {
  it("denies a user when an authorized moderator labels them", () => {
    const runtime = makeRuntime();
    const accepted = runtime.ingestEvent(labelEvent(MODERATOR, "deny", { type: "user", pubkey: VICTIM }));

    expect(accepted).toBe(true);
    expect(runtime.admin.state.userDeny.has(`user:${VICTIM}`)).toBe(true);
    expect(runtime.evaluate({ type: "user", pubkey: VICTIM }, { profile: "feed" }).visibility.effect).toBe(
      "hide",
    );
  });

  it("does nothing when the labeller lacks the capability", () => {
    // The whole safety story: a label is not privileged. A stranger's deny
    // label reduces to nothing because they hold no capability.
    const runtime = makeRuntime();
    runtime.ingestEvent(labelEvent(STRANGER, "deny", { type: "user", pubkey: VICTIM }));
    expect(runtime.admin.state.userDeny.has(`user:${VICTIM}`)).toBe(false);
  });

  it("stops honouring a labeller's labels once their role is revoked", () => {
    const runtime = makeRuntime();
    runtime.ingestEvent(labelEvent(MODERATOR, "deny", { type: "user", pubkey: VICTIM }));
    expect(runtime.admin.state.userDeny.size).toBe(1);

    runtime.admin.setRoles({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(runtime.admin.state.userDeny.size).toBe(0);
  });

  it("ignores labels outside the configured namespace", () => {
    const runtime = makeRuntime({ labelMapping: { namespace: "other", denyValues: ["deny"] } });
    expect(runtime.ingestEvent(labelEvent(MODERATOR, "deny", { type: "user", pubkey: VICTIM }))).toBe(
      false,
    );
    expect(runtime.admin.state.userDeny.size).toBe(0);
  });

  it("records the labeller as a community source", () => {
    const runtime = makeRuntime();
    runtime.ingestEvent(labelEvent(MODERATOR, "deny", { type: "user", pubkey: VICTIM }));
    expect(runtime.admin.state.communitySources.get(`user:${VICTIM}`)).toBeDefined();
  });

  it("maps an event-deny label", () => {
    const runtime = makeRuntime();
    const eventId = "1b".repeat(32);
    runtime.ingestEvent(labelEvent(MODERATOR, "deny", { type: "event", id: eventId }));
    expect(runtime.admin.state.eventDeny.has(`event:${eventId}`)).toBe(true);
  });

  it("fails closed without a verifier, like any administrative event", () => {
    const runtime = createBitGate({
      applicationId: "labels",
      namespace: "app",
      root: ROOT,
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
      labelMapping: { namespace: "app.mod", denyValues: ["deny"] },
    });
    runtime.admin.setRoles({ root: ROOT, actors: { [MODERATOR]: ["moderator"] } });

    expect(runtime.ingestEvent(labelEvent(MODERATOR, "deny", { type: "user", pubkey: VICTIM }))).toBe(
      false,
    );
  });
});

describe("loadLabels", () => {
  it("fetches and applies a labeller's labels", async () => {
    const transport = createMemoryTransport([
      labelEvent(MODERATOR, "deny", { type: "user", pubkey: VICTIM }),
    ]);
    const runtime = createBitGate({
      applicationId: "labels",
      namespace: "app",
      root: ROOT,
      transport,
      policy: POLICY,
      now: () => NOW,
      trustUnsignedEvents: true,
      labelMapping: { namespace: "app.mod", denyValues: ["deny"] },
    });
    runtime.admin.setRoles({ root: ROOT, actors: { [MODERATOR]: ["moderator"] } });

    expect(await runtime.loadLabels([MODERATOR])).toBe(1);
    expect(runtime.admin.state.userDeny.has(`user:${VICTIM}`)).toBe(true);
  });

  it("does nothing for an empty labeller list", async () => {
    expect(await makeRuntime().loadLabels([])).toBe(0);
  });
});

describe("publishLabel command", () => {
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

  function commandsAs(pubkey) {
    const runtime = createBitGate({
      applicationId: "labels",
      namespace: "app",
      root: ROOT,
      transport: createMemoryTransport(),
      signer: signerFor(pubkey),
      policy: POLICY,
      now: () => NOW,
      labelMapping: { namespace: "app.mod", denyValues: ["deny"] },
    });
    runtime.admin.setRoles({ root: ROOT, actors: { [MODERATOR]: ["moderator"] } });
    return { runtime, commands: createCommands(runtime) };
  }

  it("publishes a label for an authorized moderator", async () => {
    const { commands } = commandsAs(MODERATOR);
    const result = await commands.publishLabel({ type: "user", pubkey: VICTIM }, "deny");
    expect(result.ok).toBe(true);
    expect(result.event?.kind).toBe(LABEL_KIND);
  });

  it("refuses a labeller who lacks the capability", async () => {
    const { commands } = commandsAs(STRANGER);
    const result = await commands.publishLabel({ type: "user", pubkey: VICTIM }, "deny");
    expect(result.code).toBe("not-authorized");
  });

  it("defaults the namespace to the runtime's label mapping", async () => {
    const { commands } = commandsAs(MODERATOR);
    const result = await commands.publishLabel({ type: "user", pubkey: VICTIM }, "deny");
    expect(result.event?.tags).toContainEqual(["L", "app.mod"]);
  });

  it("rejects a malformed target", async () => {
    const { commands } = commandsAs(MODERATOR);
    const result = await commands.publishLabel(
      /** @type {any} */ ({ type: "user", pubkey: "bad" }),
      "deny",
    );
    expect(result.code).toBe("invalid-target");
  });

  it("round-trips: a published label denies when read back", async () => {
    const { commands, runtime } = commandsAs(MODERATOR);
    const result = await commands.publishLabel({ type: "user", pubkey: VICTIM }, "deny");

    const fresh = createBitGate({
      applicationId: "labels",
      namespace: "app",
      root: ROOT,
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
      trustUnsignedEvents: true,
      labelMapping: { namespace: "app.mod", denyValues: ["deny"] },
    });
    fresh.admin.setRoles({ root: ROOT, actors: { [MODERATOR]: ["moderator"] } });
    fresh.ingestEvent(/** @type {any} */ ({ ...result.event, pubkey: MODERATOR }));

    expect(fresh.admin.state.userDeny.has(`user:${VICTIM}`)).toBe(true);
    expect(runtime).toBeDefined();
  });
});
