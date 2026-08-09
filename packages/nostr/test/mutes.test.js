import { describe, expect, it } from "vitest";

import {
  MUTE_LIST_KIND,
  decodeMuteList,
  encodeMuteList,
  extractMuteCategory,
  toMuteRecords,
} from "../src/mutes.js";

const OWNER = "a1".repeat(32);
const OTHER_OWNER = "b2".repeat(32);
const CREATOR = "d4".repeat(32);

/**
 * @param {Partial<import('../src/replaceable.js').NostrEvent>} parts
 * @returns {import('../src/replaceable.js').NostrEvent}
 */
const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: OWNER,
  kind: MUTE_LIST_KIND,
  created_at: 1000,
  tags: [],
  content: "",
  ...parts,
});

describe("extractMuteCategory", () => {
  it("reads index 3", () => {
    expect(extractMuteCategory(["p", CREATOR, "wss://relay.example", "Spam"])).toBe("spam");
  });

  it("falls back to index 2 when it is not a relay", () => {
    expect(extractMuteCategory(["p", CREATOR, "harassment"])).toBe("harassment");
  });

  it("ignores a relay hint at index 2", () => {
    expect(extractMuteCategory(["p", CREATOR, "wss://relay.example"])).toBe("");
  });

  it("returns empty for a bare tag", () => {
    expect(extractMuteCategory(["p", CREATOR])).toBe("");
    expect(extractMuteCategory(/** @type {any} */ (null))).toBe("");
  });
});

describe("decodeMuteList", () => {
  it("decodes public entries", () => {
    const list = decodeMuteList(event({ tags: [["p", CREATOR]] }));
    expect(list?.owner).toBe(OWNER);
    expect(list?.entries).toEqual([{ pubkey: CREATOR }]);
  });

  it("carries the list timestamp for window expiry", () => {
    expect(decodeMuteList(event({ created_at: 555, tags: [["p", CREATOR]] }))?.updatedAt).toBe(555);
  });

  it("attaches categories", () => {
    const list = decodeMuteList(event({ tags: [["p", CREATOR, "", "spam"]] }));
    expect(list?.entries[0]).toEqual({ pubkey: CREATOR, category: "spam" });
  });

  it("deduplicates repeated pubkeys", () => {
    const list = decodeMuteList(event({ tags: [["p", CREATOR], ["p", CREATOR]] }));
    expect(list?.entries).toHaveLength(1);
  });

  it("skips malformed pubkeys", () => {
    const list = decodeMuteList(event({ tags: [["p", "short"], ["p", CREATOR]] }));
    expect(list?.entries).toHaveLength(1);
  });

  it("flags encrypted entries without decoding them", () => {
    const list = decodeMuteList(event({ content: "encrypted-blob", tags: [["p", CREATOR]] }));
    expect(list?.hasEncryptedEntries).toBe(true);
    expect(list?.entries).toHaveLength(1);
  });

  it("rejects the wrong kind", () => {
    expect(decodeMuteList(event({ kind: 30000 }))).toBeNull();
  });

  it("rejects a malformed owner", () => {
    expect(decodeMuteList(event({ pubkey: "nope" }))).toBeNull();
  });
});

describe("toMuteRecords", () => {
  it("keys records by governance target", () => {
    const lists = [decodeMuteList(event({ tags: [["p", CREATOR]] }))];
    const records = toMuteRecords(/** @type {any} */ (lists));
    expect(records.get(`user:${CREATOR}`)).toEqual([{ muter: OWNER, updatedAt: 1000 }]);
  });

  it("collects distinct muters for one target", () => {
    const lists = [
      decodeMuteList(event({ tags: [["p", CREATOR]] })),
      decodeMuteList(event({ pubkey: OTHER_OWNER, tags: [["p", CREATOR]] })),
    ];
    expect(toMuteRecords(/** @type {any} */ (lists)).get(`user:${CREATOR}`)).toHaveLength(2);
  });

  it("preserves categories", () => {
    const lists = [decodeMuteList(event({ tags: [["p", CREATOR, "", "spam"]] }))];
    expect(toMuteRecords(/** @type {any} */ (lists)).get(`user:${CREATOR}`)?.[0].category).toBe("spam");
  });

  it("tolerates an empty input", () => {
    expect(toMuteRecords([]).size).toBe(0);
  });
});

describe("encodeMuteList", () => {
  it("round-trips entries", () => {
    const template = encodeMuteList([{ pubkey: CREATOR, category: "spam" }]);
    const list = decodeMuteList(event(template));
    expect(list?.entries[0]).toEqual({ pubkey: CREATOR, category: "spam" });
  });

  it("encodes a bare entry without a category slot", () => {
    expect(encodeMuteList([{ pubkey: CREATOR }]).tags).toEqual([["p", CREATOR]]);
  });
});
