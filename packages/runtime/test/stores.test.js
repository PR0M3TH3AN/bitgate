import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";

import { Emitter } from "../src/emitter.js";
import {
  GovernanceAdminStore,
  OverrideStore,
  PolicyStore,
  ReportStore,
  TrustGraphStore,
  TrustedMuteStore,
} from "../src/stores.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const OTHER = "e5".repeat(32);
const DAY = 86_400;

/** @param {string} pubkey @returns {import("@bitgate/core").UserTarget} */
const user = (pubkey) => ({ type: "user", pubkey });

const roster = {
  root: ROOT,
  actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
};

describe("Emitter", () => {
  it("delivers events to subscribers", () => {
    const emitter = new Emitter();
    const handler = vi.fn();
    emitter.on("change", handler);
    emitter.emit("change", { a: 1 });
    expect(handler).toHaveBeenCalledWith({ a: 1 });
  });

  it("unsubscribes", () => {
    const emitter = new Emitter();
    const handler = vi.fn();
    emitter.on("change", handler)();
    emitter.emit("change");
    expect(handler).not.toHaveBeenCalled();
  });

  it("contains a throwing listener", () => {
    const emitter = new Emitter();
    const good = vi.fn();
    emitter.on("change", () => {
      throw new Error("boom");
    });
    emitter.on("change", good);
    expect(() => emitter.emit("change")).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it("ignores malformed subscriptions", () => {
    const emitter = new Emitter();
    expect(() => emitter.on(/** @type {any} */ (null), () => {})()).not.toThrow();
  });
});

describe("GovernanceAdminStore", () => {
  it("reduces contributions through the roster", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    store.upsertContribution({ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] });
    expect(store.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("emits only when effective state changes", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    const handler = vi.fn();
    store.on("change", handler);

    store.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [user(CREATOR)],
      createdAt: 1,
    });
    expect(handler).toHaveBeenCalledTimes(1);

    store.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [user(CREATOR)],
      createdAt: 2,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("replaces an actor's list rather than accumulating", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    store.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [user(CREATOR)],
      createdAt: 1,
    });
    store.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [user(OTHER)],
      createdAt: 2,
    });
    expect(store.state.userDeny.has(`user:${CREATOR}`)).toBe(false);
    expect(store.state.userDeny.has(`user:${OTHER}`)).toBe(true);
  });

  it("ignores an out-of-order older list", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    store.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [user(OTHER)],
      createdAt: 5,
    });
    store.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [user(CREATOR)],
      createdAt: 1,
    });
    expect(store.state.userDeny.has(`user:${OTHER}`)).toBe(true);
  });

  it("drops entries when the contributor's role is revoked", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    store.upsertContribution({ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] });
    expect(store.state.userDeny.size).toBe(1);

    store.setRoles({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(store.state.userDeny.size).toBe(0);
  });

  it("changes its root fingerprint when the roster changes", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    const before = store.rootFingerprint;
    store.setRoles({ root: OTHER, actors: {} });
    expect(store.rootFingerprint).not.toBe(before);
  });

  it("ignores a malformed contribution", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    store.upsertContribution(/** @type {any} */ ({}));
    expect(store.state.userDeny.size).toBe(0);
  });
});

describe("TrustGraphStore", () => {
  it("prefers contacts over seeds", () => {
    const store = new TrustGraphStore();
    store.setSeeds([MODERATOR]);
    expect(store.trustSet.has(MODERATOR)).toBe(true);
    store.setContacts([CREATOR]);
    expect(store.trustSet.has(CREATOR)).toBe(true);
    expect(store.trustSet.has(MODERATOR)).toBe(false);
  });

  it("emits only on real change", () => {
    const store = new TrustGraphStore();
    const handler = vi.fn();
    store.on("change", handler);
    store.setContacts([CREATOR]);
    store.setContacts([CREATOR]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("normalizes and drops invalid pubkeys", () => {
    const store = new TrustGraphStore();
    store.setContacts([CREATOR.toUpperCase(), "junk"]);
    expect([...store.contacts]).toEqual([CREATOR]);
  });

  it("clears viewer state but keeps operator seeds", () => {
    const store = new TrustGraphStore();
    store.setSeeds([MODERATOR]);
    store.setContacts([CREATOR]);
    store.setBlocks([OTHER]);
    store.clearViewerState();
    expect(store.contacts.size).toBe(0);
    expect(store.blocks.size).toBe(0);
    expect(store.seeds.has(MODERATOR)).toBe(true);
  });
});

describe("ReportStore", () => {
  const report = (reporter, category, createdAt = 1) => ({
    reporter,
    target: user(CREATOR),
    category,
    createdAt,
  });
  const KEY = `user:${CREATOR}`;

  it("aggregates reports per target", () => {
    const store = new ReportStore();
    store.ingest(report(MODERATOR, "spam"), KEY);
    expect(store.recordsFor(KEY)).toEqual([
      { reporter: MODERATOR, category: "spam", createdAt: 1 },
    ]);
  });

  it("deduplicates a redelivered report", () => {
    const store = new ReportStore();
    store.ingest(report(MODERATOR, "spam", 5), KEY);
    store.ingest(report(MODERATOR, "spam", 5), KEY);
    expect(store.recordsFor(KEY)).toHaveLength(1);
  });

  it("keeps distinct categories from one reporter", () => {
    const store = new ReportStore();
    store.ingest(report(MODERATOR, "spam"), KEY);
    store.ingest(report(MODERATOR, "nudity"), KEY);
    expect(store.recordsFor(KEY)).toHaveLength(2);
  });

  it("does not emit for a duplicate", () => {
    const store = new ReportStore();
    const handler = vi.fn();
    store.on("change", handler);
    store.ingest(report(MODERATOR, "spam", 5), KEY);
    store.ingest(report(MODERATOR, "spam", 5), KEY);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed reports", () => {
    const store = new ReportStore();
    store.ingest(/** @type {any} */ ({ reporter: "", category: "" }), KEY);
    expect(store.recordsFor(KEY)).toEqual([]);
  });

  it("builds a record map for the evaluator", () => {
    const store = new ReportStore();
    store.ingest(report(MODERATOR, "spam"), KEY);
    expect(store.toRecordMap().get(KEY)).toHaveLength(1);
  });

  it("clears a target", () => {
    const store = new ReportStore();
    store.ingest(report(MODERATOR, "spam"), KEY);
    store.clearTarget(KEY);
    expect(store.recordsFor(KEY)).toEqual([]);
  });
});

describe("TrustedMuteStore", () => {
  const list = (owner, updatedAt, entries) => ({
    owner,
    updatedAt,
    entries,
    hasEncryptedEntries: false,
  });

  it("stores a mute list", () => {
    const store = new TrustedMuteStore();
    store.replaceList(list(MODERATOR, 100, [{ pubkey: CREATOR }]));
    expect(store.toRecordMap().get(`user:${CREATOR}`)).toHaveLength(1);
  });

  it("replaces an older list from the same owner", () => {
    const store = new TrustedMuteStore();
    store.replaceList(list(MODERATOR, 100, [{ pubkey: CREATOR }]));
    store.replaceList(list(MODERATOR, 200, [{ pubkey: OTHER }]));
    expect(store.toRecordMap().has(`user:${CREATOR}`)).toBe(false);
    expect(store.toRecordMap().has(`user:${OTHER}`)).toBe(true);
  });

  it("ignores an out-of-order older list", () => {
    const store = new TrustedMuteStore();
    store.replaceList(list(MODERATOR, 200, [{ pubkey: OTHER }]));
    store.replaceList(list(MODERATOR, 100, [{ pubkey: CREATOR }]));
    expect(store.toRecordMap().has(`user:${OTHER}`)).toBe(true);
  });

  it("counts distinct owners for one target", () => {
    const store = new TrustedMuteStore();
    store.replaceList(list(MODERATOR, 100, [{ pubkey: CREATOR }]));
    store.replaceList(list(ROOT, 100, [{ pubkey: CREATOR }]));
    expect(store.toRecordMap().get(`user:${CREATOR}`)).toHaveLength(2);
  });

  it("prunes lists outside the window using the injected clock", () => {
    const store = new TrustedMuteStore({ windowSeconds: 60 * DAY, now: () => 100 * DAY });
    store.replaceList(list(MODERATOR, 10 * DAY, [{ pubkey: CREATOR }]));
    store.replaceList(list(ROOT, 90 * DAY, [{ pubkey: CREATOR }]));
    expect(store.prune()).toBe(1);
    expect(store.toRecordMap().get(`user:${CREATOR}`)).toHaveLength(1);
  });

  it("does not prune when no window is configured", () => {
    const store = new TrustedMuteStore();
    store.replaceList(list(MODERATOR, 1, [{ pubkey: CREATOR }]));
    expect(store.prune()).toBe(0);
  });

  it("answers batched author queries", () => {
    const store = new TrustedMuteStore();
    store.replaceList(list(MODERATOR, 100, [{ pubkey: CREATOR }]));
    const counts = store.countsForAuthors([CREATOR, OTHER]);
    expect(counts.get(CREATOR)).toBe(1);
    expect(counts.get(OTHER)).toBe(0);
  });
});

describe("PolicyStore", () => {
  const policy = (id) =>
    createPolicyDefinition({ id, version: "1.0.0", profiles: { feed: { name: "feed" } } });

  it("falls back to the default policy", () => {
    const store = new PolicyStore(policy("default"));
    expect(store.policy.id).toBe("default");
  });

  it("prefers a root policy over the default", () => {
    const store = new PolicyStore(policy("default"));
    store.setRootPolicy(policy("root"));
    expect(store.policy.id).toBe("root");
  });

  it("prefers a local policy over a root policy", () => {
    const store = new PolicyStore(policy("default"));
    store.setRootPolicy(policy("root"));
    store.setLocalPolicy(policy("local"));
    expect(store.policy.id).toBe("local");
  });

  it("emits when the effective policy changes", () => {
    const store = new PolicyStore(policy("default"));
    const handler = vi.fn();
    store.on("change", handler);
    store.setRootPolicy(policy("root"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reverts to the default when the root policy is cleared", () => {
    const store = new PolicyStore(policy("default"));
    store.setRootPolicy(policy("root"));
    store.setRootPolicy(null);
    expect(store.policy.id).toBe("default");
  });
});

describe("OverrideStore", () => {
  it("stores and reads an override", () => {
    const store = new OverrideStore();
    store.set("user:x", { visibility: "allow" });
    expect(store.toMap().get("user:x")).toEqual({ visibility: "allow", reason: undefined });
  });

  it("filters expired overrides using the injected clock", () => {
    const store = new OverrideStore({ now: () => 100 });
    store.set("user:x", { visibility: "allow", expiresAt: 50 });
    store.set("user:y", { visibility: "allow", expiresAt: 150 });
    expect(store.toMap().has("user:x")).toBe(false);
    expect(store.toMap().has("user:y")).toBe(true);
  });

  it("removes an override", () => {
    const store = new OverrideStore();
    store.set("user:x", { visibility: "allow" });
    store.remove("user:x");
    expect(store.toMap().size).toBe(0);
  });

  it("clears overrides without clearing listeners", () => {
    const store = new OverrideStore();
    const handler = vi.fn();
    store.on("change", handler);
    store.set("user:x", { visibility: "allow" });
    store.clearOverrides();
    expect(store.toMap().size).toBe(0);

    store.set("user:y", { visibility: "allow" });
    expect(handler).toHaveBeenCalledTimes(3);
  });
});

describe("GovernanceAdminStore authority changes", () => {
  it("emits when a role is revoked even if no denial changes", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    const handler = vi.fn();
    store.on("change", handler);

    // No contributions exist, so effective denial state is empty before and
    // after. The capability change must still be announced.
    store.setRoles({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits when protected actors change", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    const handler = vi.fn();
    store.on("change", handler);

    store.setRoles({ ...roster, protectedActors: [CREATOR] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the roster is set to the same thing", () => {
    const store = new GovernanceAdminStore();
    store.setRoles(roster);
    const handler = vi.fn();
    store.on("change", handler);

    store.setRoles(roster);
    expect(handler).not.toHaveBeenCalled();
  });
});
