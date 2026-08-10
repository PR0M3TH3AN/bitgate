import { describe, expect, it } from "vitest";

import {
  CONTACT_LIST_KIND,
  decodeContactList,
  encodeContactList,
} from "../src/contacts.js";

const OWNER = "a1".repeat(32);
const ALICE = "b2".repeat(32);
const BOB = "c3".repeat(32);
const NOW = 1_750_000_000;

const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: OWNER,
  kind: CONTACT_LIST_KIND,
  created_at: NOW,
  tags: [],
  content: "",
  ...parts,
});

describe("decodeContactList", () => {
  it("reads followed pubkeys", () => {
    const list = decodeContactList(event({ tags: [["p", ALICE], ["p", BOB]] }));
    expect(list?.owner).toBe(OWNER);
    expect(list?.contacts).toEqual([ALICE, BOB]);
  });

  it("captures relay hints from the third tag position", () => {
    const list = decodeContactList(
      event({ tags: [["p", ALICE, "wss://alicerelay.com/", "alice"]] }),
    );
    expect(list?.relayHints.get(ALICE)).toBe("wss://alicerelay.com/");
  });

  it("tolerates missing relay and petname", () => {
    const list = decodeContactList(event({ tags: [["p", ALICE, "", ""]] }));
    expect(list?.contacts).toEqual([ALICE]);
    expect(list?.relayHints.size).toBe(0);
  });

  it("deduplicates repeated follows", () => {
    const list = decodeContactList(event({ tags: [["p", ALICE], ["p", ALICE]] }));
    expect(list?.contacts).toEqual([ALICE]);
  });

  it("skips malformed pubkeys", () => {
    const list = decodeContactList(event({ tags: [["p", "junk"], ["p", ALICE]] }));
    expect(list?.contacts).toEqual([ALICE]);
  });

  it("ignores content, which NIP-02 does not use", () => {
    const list = decodeContactList(
      event({ tags: [["p", ALICE]], content: '{"wss://legacy.example":{"read":true}}' }),
    );
    expect(list?.contacts).toEqual([ALICE]);
  });

  it("rejects the wrong kind and a malformed owner", () => {
    expect(decodeContactList(event({ kind: 10000 }))).toBeNull();
    expect(decodeContactList(event({ pubkey: "nope" }))).toBeNull();
  });

  it("returns an empty list for someone following nobody", () => {
    expect(decodeContactList(event({}))?.contacts).toEqual([]);
  });
});

describe("encodeContactList", () => {
  it("accepts bare pubkeys", () => {
    expect(encodeContactList([ALICE]).tags).toEqual([["p", ALICE]]);
  });

  it("includes relay and petname when given", () => {
    const template = encodeContactList([{ pubkey: ALICE, relay: "wss://r.example", petname: "alice" }]);
    expect(template.tags).toEqual([["p", ALICE, "wss://r.example", "alice"]]);
  });

  it("round-trips", () => {
    const template = encodeContactList([ALICE, BOB]);
    expect(decodeContactList(event(template))?.contacts).toEqual([ALICE, BOB]);
  });

  it("skips malformed entries", () => {
    expect(encodeContactList(["junk", ALICE]).tags).toEqual([["p", ALICE]]);
  });
});
