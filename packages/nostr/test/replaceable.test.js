import { describe, expect, it } from "vitest";

import {
  coordinateOf,
  getTagValue,
  getTags,
  selectLatest,
  selectReplaceable,
  verifyEvents,
} from "../src/replaceable.js";

const PUBKEY = "a1".repeat(32);

/**
 * @param {Partial<import('../src/replaceable.js').NostrEvent>} parts
 * @returns {import('../src/replaceable.js').NostrEvent}
 */
const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: PUBKEY,
  kind: 30078,
  created_at: 1000,
  tags: [],
  content: "",
  ...parts,
});

describe("tag helpers", () => {
  it("reads the first value of a tag", () => {
    expect(getTagValue(event({ tags: [["d", "x"], ["d", "y"]] }), "d")).toBe("x");
  });

  it("returns empty for a missing tag", () => {
    expect(getTagValue(event({}), "d")).toBe("");
  });

  it("ignores malformed tags", () => {
    expect(getTagValue(event({ tags: [/** @type {any} */ ("d"), ["d", "ok"]] }), "d")).toBe("ok");
  });

  it("collects repeated tags", () => {
    expect(getTags(event({ tags: [["p", "a"], ["p", "b"], ["e", "c"]] }), "p")).toHaveLength(2);
  });
});

describe("coordinateOf", () => {
  it("builds kind:pubkey:d", () => {
    expect(coordinateOf(event({ tags: [["d", "list"]] }))).toBe(`30078:${PUBKEY}:list`);
  });

  it("handles a missing d tag", () => {
    expect(coordinateOf(event({}))).toBe(`30078:${PUBKEY}:`);
  });
});

describe("selectReplaceable", () => {
  it("keeps the newest event per coordinate", () => {
    const older = event({ id: "aa".repeat(32), created_at: 100, tags: [["d", "list"]] });
    const newer = event({ id: "bb".repeat(32), created_at: 200, tags: [["d", "list"]] });
    const winners = selectReplaceable([older, newer]);
    expect(winners.get(`30078:${PUBKEY}:list`)?.id).toBe(newer.id);
  });

  it("is order-independent", () => {
    const older = event({ id: "aa".repeat(32), created_at: 100, tags: [["d", "list"]] });
    const newer = event({ id: "bb".repeat(32), created_at: 200, tags: [["d", "list"]] });
    expect(selectReplaceable([older, newer]).get(`30078:${PUBKEY}:list`)?.id).toBe(
      selectReplaceable([newer, older]).get(`30078:${PUBKEY}:list`)?.id,
    );
  });

  it("breaks same-timestamp ties deterministically", () => {
    const a = event({ id: "aa".repeat(32), created_at: 100, tags: [["d", "list"]] });
    const b = event({ id: "bb".repeat(32), created_at: 100, tags: [["d", "list"]] });
    expect(selectReplaceable([a, b]).get(`30078:${PUBKEY}:list`)?.id).toBe(a.id);
    expect(selectReplaceable([b, a]).get(`30078:${PUBKEY}:list`)?.id).toBe(a.id);
  });

  it("keeps distinct coordinates apart", () => {
    const first = event({ tags: [["d", "one"]] });
    const second = event({ tags: [["d", "two"]] });
    expect(selectReplaceable([first, second]).size).toBe(2);
  });

  it("ignores malformed events", () => {
    expect(selectReplaceable([/** @type {any} */ (null), /** @type {any} */ ({})]).size).toBe(0);
  });
});

describe("selectLatest", () => {
  it("returns the newest event", () => {
    const older = event({ id: "aa".repeat(32), created_at: 1 });
    const newer = event({ id: "bb".repeat(32), created_at: 2 });
    expect(selectLatest([older, newer])?.id).toBe(newer.id);
  });

  it("returns null for an empty list", () => {
    expect(selectLatest([])).toBeNull();
  });
});

describe("verifyEvents", () => {
  it("passes everything through when no verifier is supplied", async () => {
    const events = [event({}), event({})];
    expect(await verifyEvents(events)).toHaveLength(2);
  });

  it("drops events the verifier rejects", async () => {
    const keep = event({ id: "aa".repeat(32) });
    const drop = event({ id: "bb".repeat(32) });
    const verified = await verifyEvents([keep, drop], (candidate) => candidate.id === keep.id);
    expect(verified).toEqual([keep]);
  });

  it("treats a throwing verifier as a rejection", async () => {
    const verified = await verifyEvents([event({})], () => {
      throw new Error("boom");
    });
    expect(verified).toEqual([]);
  });

  it("supports async verifiers", async () => {
    const verified = await verifyEvents([event({})], async () => true);
    expect(verified).toHaveLength(1);
  });
});
