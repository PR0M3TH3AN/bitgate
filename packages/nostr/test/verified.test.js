// The headless path's verified readers: a signature check is required, and an
// event that fails it never reaches the engine.

import { describe, expect, it } from "vitest";
import { schnorr } from "@noble/curves/secp256k1";

import { computeEventId, verifyEvent } from "@bitgate/verify";

import { encodeContribution } from "../src/canonical.js";
import { encodeLabel } from "../src/labels.js";
import { ROLE_SET_KIND } from "../src/roster.js";
import { keepVerified, readContributionLists, readLabelContributions, resolveVerifiedRoster } from "../src/verified.js";

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString("hex");
const secret = (/** @type {number} */ n) => n.toString(16).padStart(64, "0");
const ROOT_SK = secret(1);
const MOD_SK = secret(2);
const ROOT = hex(schnorr.getPublicKey(ROOT_SK));
const MOD = hex(schnorr.getPublicKey(MOD_SK));
const TARGET = "e5".repeat(32);
const PERSON = "d4".repeat(32);
const NOW = 1_763_700_000;

/** @param {{ kind: number, tags: string[][], content: string }} template */
function sign(template, sk, createdAt = NOW) {
  const event = { pubkey: hex(schnorr.getPublicKey(sk)), created_at: createdAt, ...template };
  const id = computeEventId(event);
  return { id, ...event, sig: hex(schnorr.sign(id, sk, new Uint8Array(32))) };
}

/** The same event claiming a signer's key, but not signed by them. */
function forge(event, changes) {
  const forged = { ...event, ...changes };
  forged.id = computeEventId(forged);
  return forged; // the old signature no longer matches the new id
}

const deny = () => encodeLabel({ value: "deny", namespace: "ns", targets: [{ type: "event", id: TARGET }] });

describe("a signature check is required", () => {
  for (const [name, call] of /** @type {Array<[string, () => unknown]>} */ ([
    ["keepVerified", () => keepVerified([], /** @type {any} */ (undefined))],
    ["readLabelContributions", () => readLabelContributions([], /** @type {any} */ ({ namespace: "ns" }))],
    ["readContributionLists", () => readContributionLists([], /** @type {any} */ ({}))],
    ["resolveVerifiedRoster", () => resolveVerifiedRoster([], /** @type {any} */ ({ root: ROOT }))],
  ])) {
    it(`${name} throws without one`, () => {
      expect(call).toThrow(TypeError);
    });
  }

  it("treats an asynchronous verifier, or one that throws, as a failed check", () => {
    const event = sign(deny(), MOD_SK);
    expect(keepVerified([event], () => /** @type {any} */ (Promise.resolve(true))).dropped.unverified).toBe(1);
    expect(
      keepVerified([event], () => {
        throw new Error("curve exploded");
      }).dropped.unverified,
    ).toBe(1);
  });
});

describe("readLabelContributions", () => {
  it("reads signed labels and drops a forged one under a moderator's key", () => {
    const real = sign(deny(), MOD_SK);
    const forged = forge(real, { tags: [...real.tags, ["e", "f6".repeat(32)]] });
    const { contributions, dropped } = readLabelContributions([real, forged], {
      verify: verifyEvent,
      namespace: "ns",
      denyValues: ["deny"],
    });
    expect(dropped.unverified).toBe(1);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({ actor: MOD, kind: "event-deny", targets: [{ type: "event", id: TARGET }] });
  });
});

describe("readContributionLists", () => {
  it("lets no unsigned copy replace a signed list", () => {
    const list = sign(encodeContribution({ actor: ROOT, kind: "user-deny", targets: [{ type: "user", pubkey: PERSON }] }, "app"), ROOT_SK);
    const emptied = forge(list, { created_at: NOW + 100, tags: list.tags.filter((tag) => tag[0] !== "p") });
    const { contributions, dropped } = readContributionLists([list, emptied], { verify: verifyEvent });
    expect(dropped.unverified).toBe(1);
    expect(contributions).toEqual([
      expect.objectContaining({ actor: ROOT, kind: "user-deny", targets: [{ type: "user", pubkey: PERSON }] }),
    ]);
  });

  it("keeps the newest signed copy and reads only the namespace asked for", () => {
    const older = sign(encodeContribution({ actor: ROOT, kind: "user-deny", targets: [] }, "app"), ROOT_SK);
    const newer = sign(
      encodeContribution({ actor: ROOT, kind: "user-deny", targets: [{ type: "user", pubkey: PERSON }] }, "app"),
      ROOT_SK,
      NOW + 1,
    );
    const elsewhere = sign(encodeContribution({ actor: ROOT, kind: "user-deny", targets: [] }, "other"), ROOT_SK);
    const { contributions } = readContributionLists([older, newer, elsewhere], { verify: verifyEvent, namespace: "app" });
    expect(contributions).toHaveLength(1);
    expect(contributions[0].targets).toEqual([{ type: "user", pubkey: PERSON }]);
  });
});

describe("resolveVerifiedRoster", () => {
  const rosters = [{ identifier: "bitgate:moderators", role: "moderator" }];
  const roleSet = (/** @type {string} */ member) => ({
    kind: ROLE_SET_KIND,
    content: "",
    tags: [["d", "bitgate:moderators"], ["p", member]],
  });

  it("honors the root's signed set", () => {
    const { actors, dropped } = resolveVerifiedRoster([sign(roleSet(MOD), ROOT_SK)], { verify: verifyEvent, root: ROOT, rosters });
    expect(dropped.unverified).toBe(0);
    expect(actors[MOD]).toContain("moderator");
  });

  it("ignores a set that claims the root's key without its signature", () => {
    const real = sign(roleSet(MOD), ROOT_SK);
    const forged = forge(real, { created_at: NOW + 100, tags: [["d", "bitgate:moderators"], ["p", PERSON]] });
    const { actors, dropped } = resolveVerifiedRoster([real, forged], { verify: verifyEvent, root: ROOT, rosters });
    expect(dropped.unverified).toBe(1);
    expect(actors[PERSON]).toBeUndefined();
    expect(actors[MOD]).toContain("moderator");
  });
});
