// Security requirements.
//
// One test per enumerated requirement in the migration plan's security section
// that is testable at this layer. Requirements about key custody (never export
// signer secrets, avoid shared moderator keys) are properties of the injected
// signer and of operational practice, not of this code; they are noted where
// they fall rather than silently skipped.

import { describe, expect, it } from "vitest";

import {
  createAuthorityState,
  createPolicyDefinition,
  createSnapshot,
  createViewerState,
  evaluateTarget,
  getActorCapabilities,
  hasCapability,
  isValidTarget,
  normalizeAddress,
  reduceAdminState,
} from "@nostr-governance/core";
import {
  MAX_POLICY_BYTES,
  canonicalIdentifier,
  decodePolicy,
  decodeReport,
  verifyEvents,
} from "@nostr-governance/nostr";
import {
  ERROR_CODES,
  createCommands,
  createGovernanceRuntime,
  createMemoryTransport,
} from "@nostr-governance/runtime";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CURATOR = "c3".repeat(32);
const CREATOR = "d4".repeat(32);
const STRANGER = "f6".repeat(32);
const TRUSTED = "01".repeat(32);
const NOW = 1_750_000_000;
const DAY = 86_400;

const authority = () =>
  createAuthorityState({
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"], [CURATOR]: ["curator"] },
  });

const POLICY = createPolicyDefinition({
  id: "sec",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: { default: { restrict: 1 } },
      mutes: { default: { hide: 1 } },
      muteWindowSeconds: 60 * DAY,
    },
  },
});

const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: MODERATOR,
  kind: 30078,
  created_at: NOW,
  tags: [],
  content: "",
  ...parts,
});

function runtimeWithSigner(pubkey) {
  const runtime = createGovernanceRuntime({
    applicationId: "sec",
    namespace: "sec",
    transport: createMemoryTransport(),
    signer: {
      async getPublicKey() {
        return pubkey;
      },
      async signEvent(template) {
        return /** @type {any} */ ({ ...template, id: "ff".repeat(32), pubkey, sig: "00".repeat(64) });
      },
    },
    policy: POLICY,
    now: () => NOW,
  });
  runtime.admin.setRoles({
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"], [CURATOR]: ["curator"] },
  });
  return runtime;
}

describe("1. verify signatures before accepting authoritative state", () => {
  it("drops events an injected verifier rejects", async () => {
    const good = event({ id: "aa".repeat(32) });
    const bad = event({ id: "bb".repeat(32) });
    const verified = await verifyEvents([good, bad], (candidate) => candidate.id === good.id);
    expect(verified).toEqual([good]);
  });

  it("treats a throwing verifier as rejection, never as a pass", async () => {
    expect(
      await verifyEvents([event({})], () => {
        throw new Error("verifier exploded");
      }),
    ).toEqual([]);
  });
});

describe("2. validate authority independently of UI state", () => {
  it("derives capabilities from the roster, not from any caller-supplied flag", () => {
    expect(hasCapability(MODERATOR, "contribute-user-deny", authority())).toBe(true);
    expect(hasCapability(STRANGER, "contribute-user-deny", authority())).toBe(false);
  });

  it("refuses a command from an actor without the capability", async () => {
    const commands = createCommands(runtimeWithSigner(STRANGER));
    expect((await commands.denyUser(CREATOR)).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });
});

describe("3. strict pubkey and event-id validation", () => {
  it("rejects identifiers that are not 64 hex characters", () => {
    expect(isValidTarget({ type: "user", pubkey: "a".repeat(63) })).toBe(false);
    expect(isValidTarget({ type: "user", pubkey: "g".repeat(64) })).toBe(false);
    expect(isValidTarget({ type: "event", id: "a".repeat(65) })).toBe(false);
  });

  it("accepts a well-formed identifier", () => {
    expect(isValidTarget({ type: "user", pubkey: CREATOR })).toBe(true);
  });
});

describe("4. validate address coordinates", () => {
  it("rejects a malformed coordinate", () => {
    expect(normalizeAddress("30078", "not-a-pubkey", "sku")).toBeNull();
    expect(normalizeAddress("", CREATOR, "sku")).toBeNull();
    expect(normalizeAddress("30078", CREATOR, "")).toBeNull();
  });

  it("accepts a well-formed coordinate", () => {
    expect(normalizeAddress("30078", CREATOR, "sku")).toEqual({
      type: "address",
      kind: "30078",
      pubkey: CREATOR,
      identifier: "sku",
    });
  });
});

describe("7. bound policy content size", () => {
  it("rejects oversized policy content before parsing it", () => {
    const oversized = event({
      tags: [["d", canonicalIdentifier("app", "policy")]],
      content: "x".repeat(MAX_POLICY_BYTES + 1),
    });
    expect(decodePolicy(oversized)).toBeNull();
  });

  it("returns null for malformed policy JSON rather than throwing", () => {
    const malformed = event({
      tags: [["d", canonicalIdentifier("app", "policy")]],
      content: "{not json",
    });
    expect(() => decodePolicy(malformed)).not.toThrow();
    expect(decodePolicy(malformed)).toBeNull();
  });
});

describe("8. ignore unknown capabilities", () => {
  it("filters unknown capabilities out of a role", () => {
    const state = createAuthorityState({
      roles: { odd: /** @type {any} */ (["manage-policy", "not-real"]) },
      actors: { [MODERATOR]: ["odd"] },
    });
    expect(getActorCapabilities(MODERATOR, state)).toEqual(["manage-policy"]);
  });

  it("never grants an unknown capability", () => {
    expect(hasCapability(ROOT, /** @type {any} */ ("invented"), authority())).toBe(false);
  });
});

describe("9. ignore unauthorized contributor events", () => {
  it("drops a contribution beyond the actor's capability", () => {
    const state = reduceAdminState(
      [{ actor: CURATOR, kind: "event-deny", targets: [{ type: "event", id: "1b".repeat(32) }] }],
      authority(),
    );
    expect(state.eventDeny.size).toBe(0);
  });

  it("drops contributions from an actor with no roles", () => {
    const state = reduceAdminState(
      [{ actor: STRANGER, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] }],
      authority(),
    );
    expect(state.userDeny.size).toBe(0);
  });

  it("stops honoring an actor's contributions the moment their role is revoked", () => {
    /** @type {import('@nostr-governance/core').Contribution[]} */
    const contributions = [
      { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
    ];
    expect(reduceAdminState(contributions, authority()).userDeny.size).toBe(1);

    const revoked = createAuthorityState({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(reduceAdminState(contributions, revoked).userDeny.size).toBe(0);
  });

  it("ignores malformed identifiers inside an authorized contribution", () => {
    const state = reduceAdminState(
      [
        {
          actor: MODERATOR,
          kind: "user-deny",
          targets: [/** @type {any} */ ({ type: "user", pubkey: "short" })],
        },
      ],
      authority(),
    );
    expect(state.userDeny.size).toBe(0);
  });
});

describe("10. protect root and configured system accounts", () => {
  it("cannot deny the root through any contributor list", () => {
    const state = reduceAdminState(
      [
        { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: ROOT }] },
        { actor: CURATOR, kind: "user-deny", targets: [{ type: "user", pubkey: ROOT }] },
      ],
      authority(),
    );
    expect(state.userDeny.has(`user:${ROOT}`)).toBe(false);
  });

  it("protects configured system accounts too", () => {
    const withSystem = createAuthorityState({
      root: ROOT,
      protectedActors: [CREATOR],
      actors: { [MODERATOR]: ["moderator"] },
    });
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] }],
      withSystem,
    );
    expect(state.userDeny.has(`user:${CREATOR}`)).toBe(false);
  });

  it("refuses the command outright rather than publishing a no-op", async () => {
    const commands = createCommands(runtimeWithSigner(MODERATOR));
    expect((await commands.denyUser(ROOT)).code).toBe(ERROR_CODES.PROTECTED_TARGET);
  });
});

describe("11. deduplicate reports by reporter, target, and category", () => {
  it("counts a repeated report once", () => {
    const snapshot = createSnapshot({
      authority: authority(),
      admin: reduceAdminState([], authority()),
      trust: { contacts: new Set([TRUSTED]) },
      reports: new Map([
        [
          `user:${CREATOR}`,
          [
            { reporter: TRUSTED, category: "spam", createdAt: NOW },
            { reporter: TRUSTED, category: "spam", createdAt: NOW - 1 },
          ],
        ],
      ]),
    });
    const decision = evaluateTarget({ type: "user", pubkey: CREATOR }, snapshot, {
      surface: "feed",
      policyProfile: "feed",
      policy: POLICY,
      now: NOW,
    });
    expect(decision.evidence?.trustedReportTotal).toBe(1);
  });

  it("does not let a denied account manufacture reports", () => {
    const auth = authority();
    const snapshot = createSnapshot({
      authority: auth,
      admin: reduceAdminState(
        [{ actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: TRUSTED }] }],
        auth,
      ),
      trust: { contacts: new Set([TRUSTED]) },
      reports: new Map([[`user:${CREATOR}`, [{ reporter: TRUSTED, category: "spam", createdAt: NOW }]]]),
    });
    const decision = evaluateTarget({ type: "user", pubkey: CREATOR }, snapshot, {
      surface: "feed",
      policyProfile: "feed",
      policy: POLICY,
      now: NOW,
    });
    expect(decision.evidence?.trustedReportTotal).toBe(0);
  });

  it("does not count a report the reporter never made against this target", () => {
    const reports = decodeReport(
      event({ kind: 1984, pubkey: TRUSTED, tags: [["e", "1b".repeat(32)]] }),
    );
    expect(reports).toEqual([]);
  });
});

describe("12. configurable mute-list expiry", () => {
  it("ignores mutes outside the configured window", () => {
    const snapshot = createSnapshot({
      authority: authority(),
      admin: reduceAdminState([], authority()),
      trust: { contacts: new Set([TRUSTED]) },
      trustedMutes: new Map([[`user:${CREATOR}`, [{ muter: TRUSTED, updatedAt: NOW - 61 * DAY }]]]),
    });
    const decision = evaluateTarget({ type: "user", pubkey: CREATOR }, snapshot, {
      surface: "feed",
      policyProfile: "feed",
      policy: POLICY,
      now: NOW,
    });
    expect(decision.evidence?.trustedMuteTotal).toBe(0);
    expect(decision.visibility.effect).toBe("allow");
  });
});

describe("13. namespace caches correctly", () => {
  it("separates state by root authority", () => {
    const runtime = runtimeWithSigner(MODERATOR);
    const before = runtime.storageKeyFor("admin");
    runtime.admin.setRoles({ root: STRANGER, actors: {} });
    expect(runtime.storageKeyFor("admin")).not.toBe(before);
  });

  it("separates viewer-scoped state by viewer", () => {
    const runtime = runtimeWithSigner(MODERATOR);
    runtime.setViewer(CREATOR);
    const first = runtime.storageKeyFor("overrides", true);
    runtime.setViewer(STRANGER);
    expect(runtime.storageKeyFor("overrides", true)).not.toBe(first);
  });
});

describe("14. prevent viewer-state leakage", () => {
  it("clears blocks, mutes, and overrides when the viewer changes", () => {
    const runtime = runtimeWithSigner(MODERATOR);
    runtime.setViewer(CREATOR);
    runtime.trust.setBlocks([STRANGER]);
    runtime.trust.setMutes([STRANGER]);
    runtime.overrides.set(`user:${STRANGER}`, { visibility: "allow" });

    runtime.setViewer(TRUSTED);

    expect(runtime.trust.blocks.size).toBe(0);
    expect(runtime.trust.mutes.size).toBe(0);
    expect(runtime.overrides.toMap().size).toBe(0);
  });

  it("drops cached decisions on a viewer switch", () => {
    const runtime = runtimeWithSigner(MODERATOR);
    runtime.setViewer(CREATOR);
    runtime.evaluate({ type: "user", pubkey: STRANGER }, { profile: "feed" });
    expect(runtime.decisionCache.size).toBe(1);

    runtime.setViewer(TRUSTED);
    expect(runtime.decisionCache.size).toBe(0);
  });
});

describe("17. treat relays as transport rather than authority", () => {
  it("does not accept a contribution merely because a relay served it", () => {
    const runtime = runtimeWithSigner(MODERATOR);
    runtime.ingestEvent(
      event({
        pubkey: STRANGER,
        tags: [["d", canonicalIdentifier("sec", "user-deny")], ["p", CREATOR]],
      }),
    );
    expect(runtime.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(false);
  });
});

describe("18-19. transient relay failure and diagnostics", () => {
  it("keeps the last known good state when a load fails", async () => {
    const runtime = runtimeWithSigner(MODERATOR);
    runtime.admin.upsertContribution({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: CREATOR }],
      createdAt: NOW,
    });

    runtime.transport.list = async () => {
      throw new Error("relay unreachable");
    };
    await expect(runtime.loadAdministrativeState()).rejects.toThrow(/unreachable/);

    expect(runtime.admin.state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("reports state fingerprints for staleness diagnosis", () => {
    const runtime = runtimeWithSigner(MODERATOR);
    const description = runtime.describe();
    expect(description.adminFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(description.trustFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(description.rootFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("20. fail closed when authority cannot be confirmed", () => {
  it("refuses an administrative command with no signer", async () => {
    const runtime = createGovernanceRuntime({
      applicationId: "sec",
      namespace: "sec",
      transport: createMemoryTransport(),
      policy: POLICY,
      now: () => NOW,
    });
    expect((await createCommands(runtime).denyUser(CREATOR)).code).toBe(ERROR_CODES.NO_SIGNER);
  });

  it("refuses every administrative command when the roster is empty", async () => {
    const runtime = createGovernanceRuntime({
      applicationId: "sec",
      namespace: "sec",
      transport: createMemoryTransport(),
      signer: {
        async getPublicKey() {
          return MODERATOR;
        },
        async signEvent(template) {
          return /** @type {any} */ ({
            ...template,
            id: "ff".repeat(32),
            pubkey: MODERATOR,
            sig: "00".repeat(64),
          });
        },
      },
      policy: POLICY,
      now: () => NOW,
    });

    const commands = createCommands(runtime);
    expect((await commands.denyUser(CREATOR)).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
    expect((await commands.setRoles({ actors: {} })).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
    expect((await commands.setPolicy(POLICY)).code).toBe(ERROR_CODES.NOT_AUTHORIZED);
  });
});

describe("21. policy-configured fail-open for public viewing", () => {
  it("permits a surface to disable governance explicitly and say so", () => {
    const openPolicy = createPolicyDefinition({
      id: "open",
      version: "1.0.0",
      profiles: { public: { name: "public", disabled: true } },
    });
    const auth = authority();
    const snapshot = createSnapshot({
      authority: auth,
      admin: reduceAdminState(
        [{ actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] }],
        auth,
      ),
    });

    const decision = evaluateTarget({ type: "user", pubkey: CREATOR }, snapshot, {
      surface: "public",
      policyProfile: "public",
      policy: openPolicy,
      now: NOW,
    });

    expect(decision.visibility.effect).toBe("allow");
    expect(decision.reasons.map((reason) => reason.id)).toEqual(["policy-disabled"]);
  });

  it("does not fail open by default", () => {
    const auth = authority();
    const snapshot = createSnapshot({
      authority: auth,
      admin: reduceAdminState(
        [{ actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] }],
        auth,
      ),
    });
    const decision = evaluateTarget({ type: "user", pubkey: CREATOR }, snapshot, {
      surface: "feed",
      policyProfile: "feed",
      policy: POLICY,
      now: NOW,
    });
    expect(decision.visibility.effect).toBe("hide");
  });
});

describe("viewer overrides cannot bypass transactional safety", () => {
  it("softens visibility without touching the transaction verdict", () => {
    const commercePolicy = createPolicyDefinition({
      id: "commerce",
      version: "1.0.0",
      profiles: {
        checkout: {
          name: "checkout",
          administrativeDeny: { visibility: "hide", transaction: "deny" },
          allowViewerOverride: true,
          reports: {},
          mutes: {},
        },
      },
    });

    const auth = authority();
    const snapshot = createSnapshot({
      authority: auth,
      admin: reduceAdminState(
        [{ actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] }],
        auth,
      ),
    });
    const viewer = createViewerState({
      overrides: new Map([[`user:${CREATOR}`, { visibility: "allow" }]]),
    });

    const decision = evaluateTarget(
      { type: "user", pubkey: CREATOR },
      snapshot,
      { surface: "checkout", policyProfile: "checkout", policy: commercePolicy, now: NOW },
      viewer,
    );

    expect(decision.visibility.effect).toBe("allow");
    expect(decision.transaction?.effect).toBe("deny");
  });
});
