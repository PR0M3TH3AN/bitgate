// Curation sets (kind 30004, NSWP-08) as BitGate input.
//
// Two sets of vectors hold the reader: NSWP's own, copied unchanged and
// pinned by hash, for the structure; and BitGate's, for the signature check
// and for choosing the current copy.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALLOWLIST_POLICY, createAuthorityState, createSnapshot, evaluateTarget, reduceAdminState } from "@bitgate/core";
import { curationSetToContribution, parseCurationSet, readCurationSet, resolveCurationSet } from "@bitgate/nostr";
import { verifyEvent } from "@bitgate/verify";

import { CURATION_VECTORS_PATH, serializeCurationVectors } from "../../scripts/build-curation-set-vectors.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NSWP_LISTS = join(ROOT, "vectors", "nswp", "lists.json");
const nswpText = readFileSync(NSWP_LISTS, "utf8");
const nswp = JSON.parse(nswpText);
const ours = JSON.parse(readFileSync(CURATION_VECTORS_PATH, "utf8"));

describe("NSWP's own list vectors", () => {
  it("are the copy the README names", () => {
    const readme = readFileSync(join(ROOT, "vectors", "nswp", "README.md"), "utf8");
    const hash = createHash("sha256").update(nswpText).digest("hex");
    expect(readme).toContain(hash);
  });

  for (const vector of nswp.vectors) {
    it(`parse: ${vector.name}`, () => {
      const result = parseCurationSet(vector.event);
      const expectation = vector.expect;
      expect(result.valid).toBe(expectation.valid);
      expect(result.errors).toEqual([...expectation.errors].sort());
      expect(result.warnings).toEqual([...expectation.warnings].sort());
      if (expectation.signatureValid !== null) {
        expect(verifyEvent(vector.event)).toBe(expectation.signatureValid);
      }
      if (!expectation.valid) {
        return;
      }
      expect(result.list?.title).toBe(expectation.title);
      const worlds = result.list?.coordinates ?? [];
      if (Array.isArray(expectation.worlds)) {
        expect(worlds).toEqual(expectation.worlds);
      } else {
        expect(worlds).toHaveLength(expectation.worlds.count);
        expect(worlds.at(-1)).toBe(expectation.worlds.last);
      }
    });
  }
});

describe("NSWP's own choosing vectors", () => {
  it("are present in the copy", () => {
    expect(nswp.choosing?.vectors?.length ?? 0).toBeGreaterThan(0);
  });

  for (const vector of nswp.choosing?.vectors ?? []) {
    it(`choose: ${vector.name}`, () => {
      const result = resolveCurationSet(vector.events, { coordinate: vector.coordinate, now: vector.now, verify: verifyEvent });
      expect(result.ok ? result.id : null).toBe(vector.expect.chosen);
      expect(result.futureDated).toEqual(vector.expect.futureDated);
      if (vector.expect.chosen !== null && result.ok) {
        expect(result.list.title).toBe(vector.expect.title);
      }
    });
  }
});

/** What a reader made of a list, in the vectors' terms. */
function observed(result) {
  if (!result.ok) {
    return { ok: false, reason: result.reason, ...(result.errors ? { errors: result.errors } : {}) };
  }
  return {
    ok: true,
    curator: result.list.pubkey,
    d: result.list.d,
    title: result.list.title,
    worlds: result.list.coordinates,
    warnings: result.warnings,
  };
}

describe("curation-set governance vectors", () => {
  it("are current with their generator", () => {
    expect(readFileSync(CURATION_VECTORS_PATH, "utf8")).toBe(serializeCurationVectors());
  });

  for (const testCase of ours.read) {
    it(`read: ${testCase.name}`, () => {
      expect(observed(readCurationSet(testCase.event, { verify: verifyEvent }))).toEqual(testCase.expect);
    });
  }

  for (const testCase of ours.resolve) {
    it(`resolve: ${testCase.name}`, () => {
      expect(observed(resolveCurationSet(testCase.events, { ...testCase.query, verify: verifyEvent }))).toEqual(
        testCase.expect,
      );
    });
  }

  it("reads nothing without a verifier", () => {
    const event = ours.read[0].event;
    expect(readCurationSet(event, /** @type {any} */ ({}))).toEqual({ ok: false, reason: "no_verifier" });
    expect(resolveCurationSet([event], /** @type {any} */ ({ pubkey: ours.keys.host, d: "bitportal" }))).toEqual({
      ok: false,
      reason: "no_verifier",
      futureDated: [],
    });
    expect(readCurationSet(event, { verify: () => { throw new Error("boom"); } })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("a host's list as an allowlist", () => {
  it("shows the worlds on it, hides the rest, and still lets a block win", () => {
    const read = readCurationSet(ours.read.find((c) => c.name === "host-allow-list").event, { verify: verifyEvent });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const host = ours.keys.host;
    const [grove, museum] = read.list.targets;
    const authority = createAuthorityState({ root: host });
    const admin = reduceAdminState(
      [
        curationSetToContribution(read.list),
        { actor: host, kind: "address-deny", targets: [museum] },
      ],
      authority,
    );
    const snapshot = createSnapshot({ authority, admin });
    const shown = (/** @type {import('@bitgate/core').AddressTarget} */ target) =>
      evaluateTarget(target, snapshot, { surface: "default", policy: ALLOWLIST_POLICY, now: 0 }).visibility.effect;

    expect(shown(grove)).toBe("allow");
    expect(shown(museum)).toBe("hide"); // listed, then blocked: the block wins
    expect(shown({ type: "address", kind: "37300", pubkey: ours.keys.maker, identifier: "not-listed" })).toBe("hide");
  });

  it("contributes only address-allow or address-deny", () => {
    const read = readCurationSet(ours.read[0].event, { verify: verifyEvent });
    if (!read.ok) throw new Error("vector should read");
    expect(curationSetToContribution(read.list, { kind: "address-deny" }).kind).toBe("address-deny");
    expect(() => curationSetToContribution(read.list, { kind: /** @type {any} */ ("user-allow") })).toThrow(TypeError);
  });

  it("a list signed by a key without the capability allows nothing", () => {
    const read = readCurationSet(ours.read[0].event, { verify: verifyEvent });
    if (!read.ok) throw new Error("vector should read");
    const authority = createAuthorityState({ root: ours.keys.otherCurator });
    const admin = reduceAdminState([curationSetToContribution(read.list)], authority);
    expect(admin.addressAllow?.size).toBe(0);
  });
});
