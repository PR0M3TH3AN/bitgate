// Regressions for findings from the security audit.
//
// Each case reproduces the original exploit. They exist so a refactor cannot
// quietly reopen a hole that was already closed once.

import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition, getPolicyPreset, resolveThresholds } from "@bitgate/core";
import { encodeContribution, encodeRoles } from "@bitgate/nostr";
import { createBitGate, createMemoryTransport } from "@bitgate/runtime";

const ROOT = "a1".repeat(32);
const ATTACKER = "ee".repeat(32);
const VICTIM = "d4".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "audit",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: { spam: { restrict: 3 }, default: { restrict: 1 } },
      mutes: {},
    },
  },
});

function makeRuntime(options = {}) {
  return createBitGate({
    applicationId: "audit",
    namespace: "app",
    root: ROOT,
    transport: createMemoryTransport(),
    policy: POLICY,
    now: () => NOW,
    trustUnsignedEvents: true,
    ...options,
  });
}

const signed = (pubkey, template, id = "01") => ({
  id: id.repeat(32),
  pubkey,
  created_at: NOW,
  ...template,
});

describe("finding 1: roster takeover", () => {
  it("refuses a roles document from anyone but the configured root", () => {
    const runtime = makeRuntime();
    const rejected = vi.fn();
    runtime.on("rejected", rejected);

    const accepted = runtime.ingestEvent(
      signed(ATTACKER, encodeRoles({ actors: { [ATTACKER]: ["super_admin"] } }, "app")),
    );

    expect(accepted).toBe(false);
    expect(runtime.admin.authority.root).toBe(ROOT);
    expect(runtime.can(ATTACKER, "manage-roles")).toBe(false);
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "roles-not-root" }));
  });

  it("still accepts the configured root's own roster", () => {
    const runtime = makeRuntime();
    const moderator = "b2".repeat(32);

    expect(
      runtime.ingestEvent(signed(ROOT, encodeRoles({ actors: { [moderator]: ["moderator"] } }, "app"))),
    ).toBe(true);
    expect(runtime.can(moderator, "contribute-user-deny")).toBe(true);
  });

  it("leaves an attacker unable to deny anyone", () => {
    const runtime = makeRuntime();

    runtime.ingestEvent(
      signed(ATTACKER, encodeRoles({ actors: { [ATTACKER]: ["super_admin"] } }, "app"), "01"),
    );
    runtime.ingestEvent(
      signed(
        ATTACKER,
        encodeContribution(
          { actor: ATTACKER, kind: "user-deny", targets: [{ type: "user", pubkey: VICTIM }] },
          "app",
        ),
        "02",
      ),
    );

    expect(runtime.admin.state.userDeny.has(`user:${VICTIM}`)).toBe(false);
    expect(runtime.evaluate({ type: "user", pubkey: VICTIM }, { profile: "feed" }).visibility.effect).toBe(
      "allow",
    );
  });

  it("compares against the configured root, not the current authority", () => {
    // Defence in depth: even if authority state were somehow rewritten, the
    // configured root is what authorship is checked against.
    const runtime = makeRuntime();
    runtime.admin.setRoles({ root: ATTACKER, actors: { [ATTACKER]: ["super_admin"] } });

    expect(
      runtime.ingestEvent(signed(ATTACKER, encodeRoles({ actors: {} }, "app"))),
    ).toBe(false);
  });

  it("refuses every roster when no root is configured", () => {
    const runtime = makeRuntime({ root: undefined });
    expect(runtime.ingestEvent(signed(ATTACKER, encodeRoles({ actors: {} }, "app")))).toBe(false);
  });
});

describe("finding 1b: administrative state fails closed without verification", () => {
  it("refuses administrative documents when no verifier is configured", () => {
    const runtime = createBitGate({
      applicationId: "audit",
      namespace: "app",
      root: ROOT,
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
    });
    const rejected = vi.fn();
    runtime.on("rejected", rejected);

    // Authored by the real root — but pubkey is an unauthenticated claim
    // without a signature check, so a relay could have forged it.
    expect(runtime.ingestEvent(signed(ROOT, encodeRoles({ actors: {} }, "app")))).toBe(false);
    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unverified-administrative-event" }),
    );
  });

  it("accepts them once a verifier is configured", () => {
    const runtime = createBitGate({
      applicationId: "audit",
      namespace: "app",
      root: ROOT,
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
      verifySignature: () => true,
    });

    expect(runtime.ingestEvent(signed(ROOT, encodeRoles({ actors: {} }, "app")))).toBe(true);
  });

  it("reports the posture in diagnostics", () => {
    const runtime = createBitGate({
      applicationId: "audit",
      namespace: "app",
      root: ROOT,
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
    });
    runtime.ingestEvent(signed(ROOT, encodeRoles({ actors: {} }, "app")));

    const description = runtime.describe();
    expect(description.signatureVerification).toBe("disabled");
    expect(description.rejectedUnverified).toBeGreaterThan(0);
  });
});

describe("finding 2: threshold evasion through inherited keys", () => {
  const table = { spam: { restrict: 3 }, default: { restrict: 1 } };

  it("falls back to the default for prototype-chain category names", () => {
    // "constructor" previously resolved to the Object constructor: truthy, with
    // every gate undefined, which exempted the category from all thresholds.
    for (const category of ["constructor", "__proto__", "valueof", "hasownproperty"]) {
      expect(resolveThresholds(table, category), category).toEqual({ restrict: 1 });
    }
  });

  it("still resolves real categories and unknown ones", () => {
    expect(resolveThresholds(table, "spam")).toEqual({ restrict: 3 });
    expect(resolveThresholds(table, "unknown")).toEqual({ restrict: 1 });
  });

  it("returns an empty object when there is no default", () => {
    expect(resolveThresholds({ spam: { restrict: 3 } }, "constructor")).toEqual({});
  });

  it("applies the default threshold to a crafted report category end to end", () => {
    const runtime = makeRuntime();
    const trusted = "01".repeat(32);
    runtime.trust.setContacts([trusted]);
    runtime.reports.ingest(
      { reporter: trusted, category: "constructor", createdAt: NOW },
      `user:${VICTIM}`,
    );

    // One trusted report, default threshold restrict: 1 — it must bite.
    expect(runtime.evaluate({ type: "user", pubkey: VICTIM }, { profile: "feed" }).visibility.effect).toBe(
      "restrict",
    );
  });

  it("counts a crafted category in evidence rather than dropping it", () => {
    const runtime = makeRuntime();
    const trusted = "01".repeat(32);
    runtime.trust.setContacts([trusted]);
    runtime.reports.ingest(
      { reporter: trusted, category: "__proto__", createdAt: NOW },
      `user:${VICTIM}`,
    );

    const evidence = runtime.evaluate({ type: "user", pubkey: VICTIM }, { profile: "feed" }).evidence;
    expect(evidence?.trustedReportTotal).toBe(1);
    expect(evidence?.trustedReportsByCategory.__proto__).toBe(1);
  });

  it("does not hand back a prototype member as a policy preset", () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      expect(getPolicyPreset(name), name).toBeNull();
    }
    expect(getPolicyPreset("social")).not.toBeNull();
  });

  it("rejects a prototype member as a profile name", () => {
    const runtime = makeRuntime();
    expect(() =>
      runtime.evaluate({ type: "user", pubkey: VICTIM }, { profile: "constructor" }),
    ).toThrow(/Unknown policy profile/);
  });
});

describe("finding 3: live subscriptions are verified", () => {
  it("drops a subscription event the verifier rejects", () => {
    const transport = createMemoryTransport();
    const runtime = createBitGate({
      applicationId: "audit",
      namespace: "app",
      root: ROOT,
      transport,
      policy: POLICY,
      now: () => NOW,
      verifySignature: () => false,
    });

    runtime.setActiveTargets([{ type: "user", pubkey: VICTIM }]);
    runtime.subscribeToActiveTargetReports();

    transport.deliver({
      id: "aa".repeat(32),
      pubkey: "01".repeat(32),
      kind: 1984,
      created_at: NOW,
      tags: [["p", VICTIM, "spam"]],
      content: "",
    });

    expect(runtime.reports.recordsFor(`user:${VICTIM}`)).toEqual([]);
  });
});

describe("finding 4: the administrative query is bounded", () => {
  it("filters by governance identifiers and a limit", async () => {
    const captured = [];
    const transport = {
      ...createMemoryTransport(),
      relays: ["wss://r.example"],
      async list(filters) {
        captured.push(...filters);
        return [];
      },
    };
    const runtime = makeRuntime({ transport });

    await runtime.loadAdministrativeState({ hydrateFirst: false, persistAfter: false });

    // Never an unfiltered request for every kind:30078 on the relay.
    expect(captured.length).toBeGreaterThan(0);
    for (const filter of captured) {
      expect(filter["#d"], JSON.stringify(filter)).toBeDefined();
      expect(filter.limit).toBeGreaterThan(0);
    }
    expect(captured[0]["#d"]).toContain("app:governance:roles:v1");
  });
});

describe("finding 5: cached state is not an authority", () => {
  it("refuses a cache naming a different root", async () => {
    const stored = new Map();
    const storage = {
      async read(key) {
        return stored.has(key) ? stored.get(key) : null;
      },
      async write(key, value) {
        stored.set(key, value);
      },
      async remove(key) {
        stored.delete(key);
      },
    };

    const runtime = makeRuntime({ storage });
    // Simulate storage tampered with by same-origin script.
    stored.set(runtime.storageKeyFor("admin"), {
      schemaVersion: "v1",
      authority: { root: ATTACKER, actors: { [ATTACKER]: ["super_admin"] } },
      contributions: [],
    });

    expect(await runtime.hydrate()).toBe(false);
    expect(runtime.admin.authority.root).toBe(ROOT);
    expect(runtime.can(ATTACKER, "manage-roles")).toBe(false);
  });
});

describe("finding 7: growth is bounded", () => {
  it("evicts report targets past the ceiling", () => {
    const runtime = makeRuntime({ maxReportTargets: 10 });
    for (let index = 0; index < 50; index += 1) {
      runtime.reports.ingest(
        { reporter: "01".repeat(32), category: "spam", createdAt: NOW },
        `user:${index.toString(16).padStart(2, "0").repeat(32)}`,
      );
    }
    expect(runtime.reports.reports.size).toBeLessThanOrEqual(11);
  });

  it("evicts cached decisions past the ceiling", () => {
    const runtime = makeRuntime({ maxCachedDecisions: 5 });
    for (let index = 1; index <= 30; index += 1) {
      runtime.evaluate(
        { type: "user", pubkey: index.toString(16).padStart(2, "0").repeat(32) },
        { profile: "feed" },
      );
    }
    expect(runtime.decisionCache.size).toBeLessThanOrEqual(6);
  });

  it("evicts mute lists past the ceiling", () => {
    const runtime = makeRuntime({ maxMuteLists: 5 });
    for (let index = 1; index <= 30; index += 1) {
      runtime.mutes.replaceList({
        owner: index.toString(16).padStart(2, "0").repeat(32),
        updatedAt: NOW,
        entries: [{ pubkey: VICTIM }],
        hasEncryptedEntries: false,
      });
    }
    expect(runtime.mutes.lists.size).toBeLessThanOrEqual(6);
  });
});

describe("second audit: relay url injection", () => {
  it("rejects relay urls with control characters or whitespace", async () => {
    const { normalizeRelayUrl } = await import("@bitgate/nostr");
    for (const url of ["wss://a\r\nb", "ws:// spaces", "wss://\thost", "wss://", "javascript:alert(1)"]) {
      expect(normalizeRelayUrl(url), url).toBe("");
    }
    expect(normalizeRelayUrl("wss://ok.example/")).toBe("wss://ok.example");
  });

  it("drops a malicious contact's crlf relay from an outbox grouping", async () => {
    const { groupAuthorsByWriteRelay } = await import("@bitgate/nostr");
    const pubkey = "d4".repeat(32);
    const lists = new Map([
      [pubkey, { pubkey, updatedAt: NOW, read: [], write: ["wss://evil\r\nInjected: x", "wss://good.example"] }],
    ]);
    const grouped = groupAuthorsByWriteRelay([pubkey], lists);
    expect([...grouped.keys()]).toEqual(["wss://good.example"]);
  });
});

describe("second audit: fingerprint cycle safety", () => {
  it("does not overflow on a self-referential value", async () => {
    const { canonicalStringify, fingerprint } = await import("@bitgate/core");
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).not.toThrow();
    expect(() => fingerprint(cyclic)).not.toThrow();
  });

  it("still distinguishes genuinely different structures", async () => {
    const { fingerprint } = await import("@bitgate/core");
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("second audit: private mute payload is bounded", () => {
  it("refuses an oversized encrypted payload before parsing", async () => {
    const { decodePrivateMuteEntries, MUTE_LIST_KIND } = await import("@bitgate/nostr");
    const viewer = "d4".repeat(32);
    const event = {
      id: "a".repeat(64),
      pubkey: viewer,
      kind: MUTE_LIST_KIND,
      created_at: 1,
      tags: [],
      content: "x".repeat(200 * 1024),
    };
    let decryptCalled = false;
    const entries = await decodePrivateMuteEntries(event, {
      viewerPubkey: viewer,
      decrypt: async () => {
        decryptCalled = true;
        return "[]";
      },
    });
    expect(entries).toEqual([]);
    // The bound is checked before spending a decrypt on it.
    expect(decryptCalled).toBe(false);
  });
});
