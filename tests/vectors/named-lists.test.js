// The named-lists vocabulary, held to its vectors: every event is read with a
// signature check, the authority comes from the root's role document, and
// each decision reads only the lists the vocabulary names for it.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ALLOWLIST_POLICY, createAuthorityState, createPolicyDefinition, createSnapshot, evaluateTarget, reduceAdminState } from "@bitgate/core";
import {
  NAMED_DECISIONS,
  NAMED_LISTS,
  NAMED_LIST_ROLES,
  contributionsForDecision,
  decodeRoles,
  namedListIdentifier,
  parseListingCoordinate,
  readNamedList,
  resolveNamedLists,
} from "@bitgate/nostr";
import { verifyEvent } from "@bitgate/verify";

import { NAMED_VECTORS_PATH, serializeNamedVectors } from "../../scripts/build-named-list-vectors.mjs";

const vectors = JSON.parse(readFileSync(NAMED_VECTORS_PATH, "utf8"));

/** Listings are sold or not: a block or a miss denies the transaction. */
const LISTING_POLICY = createPolicyDefinition({
  id: "named-lists-listing",
  version: "1.0.0",
  defaultProfile: "open",
  profiles: {
    open: { name: "open", administrativeDeny: { visibility: "allow", transaction: "deny" } },
    curated: {
      name: "curated",
      administrativeDeny: { visibility: "allow", transaction: "deny" },
      requireAllowlist: true,
      allowlistMiss: { visibility: "allow", transaction: "deny" },
    },
  },
});

function decide(decision, target) {
  const { lists } = resolveNamedLists(Object.values(vectors.events), { verify: verifyEvent });
  const roles = decodeRoles(vectors.events.roles);
  if (!roles || !verifyEvent(vectors.events.roles) || roles.root !== vectors.keys.root) {
    throw new Error("the root's role document should read");
  }
  const authority = createAuthorityState({ root: vectors.keys.root, actors: roles.actors, roles: NAMED_LIST_ROLES });
  const admin = reduceAdminState(contributionsForDecision(decision, /** @type {any} */ (lists)), authority);
  const snapshot = createSnapshot({ authority, admin });
  const isListing = decision.startsWith("may-sell-listing");
  const subject = isListing ? parseListingCoordinate(target) : { type: "user", pubkey: target };
  if (!subject) throw new Error(`not a listing coordinate: ${target}`);
  const context = isListing
    ? { surface: "checkout", policy: LISTING_POLICY, policyProfile: decision.endsWith("curated") ? "curated" : "open", now: 0 }
    : { surface: "default", policy: ALLOWLIST_POLICY, now: 0 };
  return evaluateTarget(/** @type {any} */ (subject), snapshot, context).transaction?.effect ?? "allow";
}

describe("named-list vectors", () => {
  it("are current with their generator", () => {
    expect(readFileSync(NAMED_VECTORS_PATH, "utf8")).toBe(serializeNamedVectors());
  });

  it("name every list and every decision in the vocabulary", () => {
    const listed = new Set(vectors.read.filter((c) => c.expect.ok).map((c) => c.expect.list));
    expect([...listed].sort()).toEqual(Object.keys(NAMED_LISTS).sort());
    expect([...new Set(vectors.decisions.map((c) => c.decision))].sort()).toEqual(Object.keys(NAMED_DECISIONS).sort());
  });

  for (const testCase of vectors.read) {
    it(`read: ${testCase.name}`, () => {
      const result = readNamedList(vectors.events[testCase.event], { verify: verifyEvent });
      const seen = result.ok
        ? {
            ok: true,
            list: result.name,
            scope: result.contribution.kind,
            entries: result.contribution.targets
              .map((/** @type {any} */ t) => (t.type === "user" ? t.pubkey : `${t.kind}:${t.pubkey}:${t.identifier}`))
              .sort(),
            skipped: result.skipped,
          }
        : { ok: false, reason: result.reason };
      expect(seen).toEqual(testCase.expect);
    });
  }

  for (const testCase of vectors.decisions) {
    it(`decide: ${testCase.decision} ${testCase.target.slice(0, 12)}… → ${testCase.expect.transaction}`, () => {
      expect(decide(testCase.decision, testCase.target)).toBe(testCase.expect.transaction);
    });
  }
});

describe("the vocabulary", () => {
  it("gives every list its own d, so one curator can keep them all", () => {
    const ds = Object.keys(NAMED_LISTS).map(namedListIdentifier);
    expect(new Set(ds).size).toBe(ds.length);
  });

  it("refuses names it does not have", () => {
    expect(() => namedListIdentifier("everyone")).toThrow(TypeError);
    expect(() => contributionsForDecision("may-fly", [])).toThrow(TypeError);
    expect(readNamedList(vectors.events.sellers, /** @type {any} */ ({}))).toEqual({ ok: false, reason: "no_verifier" });
  });

  it("gives the list curator list powers and nothing else", () => {
    expect([...NAMED_LIST_ROLES["list-curator"]].sort()).toEqual(
      ["contribute-address-allow", "contribute-address-deny", "contribute-user-allow", "contribute-user-deny"],
    );
  });
});

describe("listing coordinates", () => {
  it("follow BitUnlock's rule exactly", () => {
    const seller = vectors.keys.people.alice;
    for (const name of ["a", "song:remix", "my song ", " leading space", "x".repeat(256), "tab\tinside"]) {
      expect(parseListingCoordinate(`30078:${seller}:${name}`)).toEqual({ type: "address", kind: "30078", pubkey: seller, identifier: name });
    }
    for (const value of [
      `30078:${seller}:`,
      `30078:${seller}::song`,
      `30078:${seller}:${"x".repeat(257)}`,
      `30078:${seller}:two\nlines`,
      `30078:${seller}:carriage\rreturn`,
      `30023:${seller}:song`,
      `30078:${seller.toUpperCase()}:song`,
      `030078:${seller}:song`,
      null,
    ]) {
      expect(parseListingCoordinate(value), String(value)).toBeNull();
    }
  });
});

describe("choosing the current copy", () => {
  it("checks signatures before choosing, so a forged newer copy cannot push out the genuine one", () => {
    const { lists, dropped } = resolveNamedLists(Object.values(vectors.events), { verify: verifyEvent });
    expect(dropped.unverified).toBe(1);
    const payees = lists.filter((list) => list.name === "payees");
    expect(payees).toHaveLength(1);
    expect(payees[0].contribution.targets.map((/** @type {any} */ t) => t.pubkey).sort()).toEqual(
      [vectors.keys.people.alice, vectors.keys.people.carol].sort(),
    );
  });

  it("keeps only the newest genuine copy per signer and d", () => {
    const { lists } = resolveNamedLists(Object.values(vectors.events), { verify: verifyEvent });
    const curatorSellers = lists.filter((list) => list.name === "sellers" && list.contribution.actor === vectors.keys.curator);
    expect(curatorSellers).toHaveLength(1);
    expect(curatorSellers[0].contribution.targets.map((/** @type {any} */ t) => t.pubkey)).not.toContain(vectors.keys.people.dave);
  });

  it("refuses to run without a signature check", () => {
    expect(() => resolveNamedLists([], /** @type {any} */ ({}))).toThrow(TypeError);
  });
});
