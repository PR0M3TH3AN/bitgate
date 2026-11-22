// Pins examples/headless-quickstart.mjs: the NIP-32-labels -> decision round
// trip, and specifically that the `transaction` dimension gates a non-visual
// action (install) while the listing stays visible. If this drifts, the example
// in the docs is wrong.
import { describe, expect, it } from "vitest";
import { schnorr } from "@noble/curves/secp256k1";

import {
  createAuthorityState,
  createEventTarget,
  createPolicyDefinition,
  createSnapshot,
  evaluateTarget,
  reduceAdminState,
} from "@bitgate/core";
import { encodeLabel, readLabelContributions } from "@bitgate/nostr";
import { computeEventId, verifyEvent } from "@bitgate/verify";

// Secret keys 1-4 are public test keys, so the labels are really signed.
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString("hex");
const testKey = (/** @type {number} */ n) => n.toString(16).padStart(64, "0");
const pub = (/** @type {string} */ sk) => hex(schnorr.getPublicKey(sk));
const ROOT = pub(testKey(1));
const MOD_A_KEY = testKey(2);
const MOD_B_KEY = testKey(3);
const OUTSIDER_KEY = testKey(4); // not in the honored moderator set
const MOD_A = pub(MOD_A_KEY);
const MOD_B = pub(MOD_B_KEY);
const CLEAN = "d4".repeat(32);
const MALWARE = "e5".repeat(32);
const NOW = 1_750_000_000;
const NS = "org.bitblocks.plugins";

/** createEventTarget returns null on a bad id; every id here is valid 64-hex. */
const eventTarget = (id) => {
  const target = createEventTarget(id);
  if (!target) throw new Error(`bad event id: ${id}`);
  return target;
};

/** @param {string} sk @param {{ kind: number, tags: string[][], content: string }} template */
function signed(sk, template) {
  const event = { ...template, pubkey: pub(sk), created_at: NOW };
  const id = computeEventId(event);
  return { ...event, id, sig: hex(schnorr.sign(id, sk, new Uint8Array(32))) };
}
const denyLabel = (/** @type {string} */ sk, /** @type {string} */ eventId) =>
  signed(sk, encodeLabel({ value: "deny", namespace: NS, targets: [eventTarget(eventId)] }));

const policy = createPolicyDefinition({
  id: "plugin-registry",
  name: "Plugin registry",
  version: "1.0.0",
  defaultProfile: "registry",
  profiles: {
    registry: {
      name: "registry",
      administrativeDeny: { visibility: "warn", interaction: "allow", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: false,
      reports: {},
      mutes: {},
    },
  },
});

function decide(events, eventId) {
  const authority = createAuthorityState({ root: ROOT, actors: { [MOD_A]: ["moderator"], [MOD_B]: ["moderator"] } });
  const { contributions } = readLabelContributions(events, {
    verify: verifyEvent,
    namespace: NS,
    denyValues: ["deny"],
    allowValues: ["allow"],
  });
  const snapshot = createSnapshot({ authority, admin: reduceAdminState(contributions, authority) });
  return evaluateTarget(eventTarget(eventId), snapshot, {
    surface: "registry",
    policyProfile: "registry",
    policy,
    now: NOW,
  });
}

describe("headless quickstart: NIP-32 labels -> decision", () => {
  const events = [denyLabel(MOD_A_KEY, MALWARE), denyLabel(MOD_B_KEY, MALWARE)];

  it("leaves a clean plugin visible and installable", () => {
    const d = decide(events, CLEAN);
    expect(d.visibility.effect).toBe("allow");
    expect(d.transaction?.effect ?? "allow").toBe("allow");
  });

  it("gates install on the malware plugin while keeping the listing visible", () => {
    const d = decide(events, MALWARE);
    // The four-dimension point: shown (warn) but not installable (transaction deny).
    expect(d.visibility.effect).toBe("warn");
    expect(d.transaction?.effect).toBe("deny");
  });

  it("ignores a deny label from a labeller outside the honored moderator set", () => {
    const d = decide([denyLabel(OUTSIDER_KEY, MALWARE)], MALWARE);
    expect(d.transaction?.effect ?? "allow").toBe("allow");
  });

  it("ignores a label claiming a moderator's key without their signature", () => {
    const real = denyLabel(MOD_A_KEY, MALWARE);
    const forged = { ...real, tags: real.tags.map((tag) => (tag[0] === "e" ? ["e", CLEAN] : tag)) };
    const d = decide([forged], CLEAN);
    expect(d.transaction?.effect ?? "allow").toBe("allow");
  });

  it("refuses to read labels with no signature check at all", () => {
    expect(() => readLabelContributions([], /** @type {any} */ ({ namespace: NS }))).toThrow(TypeError);
  });
});
