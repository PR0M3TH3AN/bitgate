// The standalone entry must surface the whole headless path from one import —
// engine (core) + label codec (nostr) — so a no-build site gets everything from
// the single bundled file. Tests the entry, not the built artifact (dist is
// gitignored); the build itself is exercised by `npm run build:standalone`.
import { describe, expect, it } from "vitest";

import * as bitgate from "../src/index.js";

describe("standalone entry surface", () => {
  it("re-exports the core engine and the Nostr label codec together", () => {
    for (const name of [
      // core engine
      "evaluateTarget",
      "createSnapshot",
      "reduceAdminState",
      "createAuthorityState",
      "createPolicyDefinition",
      "createEventTarget",
      "ALLOWLIST_POLICY",
      // nostr label codec
      "decodeLabels",
      "encodeLabel",
      "labelsToContributions",
      "LABEL_KIND",
    ]) {
      expect(bitgate[name], name).toBeDefined();
    }
  });

  it("composes a headless decision end to end from the single entry", () => {
    const ROOT = "a1".repeat(32);
    const MOD = "b2".repeat(32);
    const PLUGIN = "e5".repeat(32);
    const NOW = 1_750_000_000;

    const target = bitgate.createEventTarget(PLUGIN);
    expect(target).not.toBeNull();

    const labelEvent = {
      ...bitgate.encodeLabel({ value: "deny", namespace: "ns", targets: [/** @type {any} */ (target)] }),
      pubkey: MOD,
      created_at: NOW,
      id: "0".repeat(64),
      sig: "",
    };

    const contributions = bitgate.labelsToContributions(bitgate.decodeLabels(labelEvent), {
      namespace: "ns",
      denyValues: ["deny"],
    });
    const authority = bitgate.createAuthorityState({ root: ROOT, actors: { [MOD]: ["moderator"] } });
    const snapshot = bitgate.createSnapshot({ authority, admin: bitgate.reduceAdminState(contributions, authority) });

    const policy = bitgate.createPolicyDefinition({
      id: "p",
      version: "1.0.0",
      defaultProfile: "d",
      profiles: { d: { name: "d", administrativeDeny: { visibility: "warn", transaction: "deny" }, reports: {}, mutes: {} } },
    });

    const decision = bitgate.evaluateTarget(/** @type {any} */ (target), snapshot, {
      surface: "d",
      policyProfile: "d",
      policy,
      now: NOW,
    });

    expect(decision.transaction?.effect).toBe("deny");
  });
});
