// Pins examples/headless-quickstart.mjs: the NIP-32-labels -> decision round
// trip, and specifically that the `transaction` dimension gates a non-visual
// action (install) while the listing stays visible. If this drifts, the example
// in the docs is wrong.
import { describe, expect, it } from "vitest";

import {
  createAuthorityState,
  createEventTarget,
  createPolicyDefinition,
  createSnapshot,
  evaluateTarget,
  reduceAdminState,
} from "@bitgate/core";
import { decodeLabels, encodeLabel, labelsToContributions } from "@bitgate/nostr";

const ROOT = "a1".repeat(32);
const MOD_A = "b2".repeat(32);
const MOD_B = "c3".repeat(32);
const OUTSIDER = "f6".repeat(32); // not in the honored moderator set
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

const signed = (pubkey, template) => ({ ...template, pubkey, created_at: NOW, id: "0".repeat(64), sig: "" });
const denyLabel = (pubkey, eventId) =>
  signed(pubkey, encodeLabel({ value: "deny", namespace: NS, targets: [eventTarget(eventId)] }));

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
  const contributions = labelsToContributions(
    events.flatMap((e) => decodeLabels(e)),
    { namespace: NS, denyValues: ["deny"], allowValues: ["allow"] },
  );
  const snapshot = createSnapshot({ authority, admin: reduceAdminState(contributions, authority) });
  return evaluateTarget(eventTarget(eventId), snapshot, {
    surface: "registry",
    policyProfile: "registry",
    policy,
    now: NOW,
  });
}

describe("headless quickstart: NIP-32 labels -> decision", () => {
  const events = [denyLabel(MOD_A, MALWARE), denyLabel(MOD_B, MALWARE)];

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
    const d = decide([denyLabel(OUTSIDER, MALWARE)], MALWARE);
    expect(d.transaction?.effect ?? "allow").toBe("allow");
  });
});
