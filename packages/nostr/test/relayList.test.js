import { describe, expect, it } from "vitest";

import {
  RELAY_LIST_KIND,
  decodeRelayList,
  encodeRelayList,
  groupAuthorsByWriteRelay,
  normalizeRelayUrl,
} from "../src/relayList.js";

const ALICE = "a1".repeat(32);
const BOB = "b2".repeat(32);
const CAROL = "c3".repeat(32);
const NOW = 1_750_000_000;

const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: ALICE,
  kind: RELAY_LIST_KIND,
  created_at: NOW,
  tags: [],
  content: "",
  ...parts,
});

describe("normalizeRelayUrl", () => {
  it("strips trailing slashes and lowercases", () => {
    expect(normalizeRelayUrl("WSS://Relay.Example/")).toBe("wss://relay.example");
  });

  it("accepts ws and wss only", () => {
    expect(normalizeRelayUrl("ws://relay.example")).toBe("ws://relay.example");
    expect(normalizeRelayUrl("https://relay.example")).toBe("");
    expect(normalizeRelayUrl("relay.example")).toBe("");
  });

  it("returns empty for non-strings", () => {
    expect(normalizeRelayUrl(null)).toBe("");
  });
});

describe("decodeRelayList", () => {
  it("treats an unmarked relay as both read and write", () => {
    const list = decodeRelayList(event({ tags: [["r", "wss://both.example"]] }));
    expect(list?.read).toEqual(["wss://both.example"]);
    expect(list?.write).toEqual(["wss://both.example"]);
  });

  it("honours read and write markers", () => {
    const list = decodeRelayList(
      event({
        tags: [
          ["r", "wss://out.example", "write"],
          ["r", "wss://in.example", "read"],
        ],
      }),
    );
    expect(list?.write).toEqual(["wss://out.example"]);
    expect(list?.read).toEqual(["wss://in.example"]);
  });

  it("decodes the NIP-65 example event", () => {
    const list = decodeRelayList(
      event({
        tags: [
          ["r", "wss://alicerelay.example.com"],
          ["r", "wss://brando-relay.com"],
          ["r", "wss://expensive-relay.example2.com", "write"],
          ["r", "wss://nostr-relay.example.com", "read"],
        ],
      }),
    );
    expect(list?.write).toEqual([
      "wss://alicerelay.example.com",
      "wss://brando-relay.com",
      "wss://expensive-relay.example2.com",
    ]);
    expect(list?.read).toEqual([
      "wss://alicerelay.example.com",
      "wss://brando-relay.com",
      "wss://nostr-relay.example.com",
    ]);
  });

  it("skips malformed relay URLs", () => {
    const list = decodeRelayList(
      event({ tags: [["r", "not-a-relay"], ["r", "wss://good.example"]] }),
    );
    expect(list?.write).toEqual(["wss://good.example"]);
  });

  it("rejects the wrong kind and malformed authors", () => {
    expect(decodeRelayList(event({ kind: 10000 }))).toBeNull();
    expect(decodeRelayList(event({ pubkey: "nope" }))).toBeNull();
  });

  it("round-trips through the encoder", () => {
    const template = encodeRelayList({
      both: ["wss://both.example"],
      write: ["wss://out.example"],
      read: ["wss://in.example"],
    });
    const list = decodeRelayList(event(template));
    expect(list?.write).toEqual(["wss://both.example", "wss://out.example"]);
    expect(list?.read).toEqual(["wss://both.example", "wss://in.example"]);
  });
});

describe("groupAuthorsByWriteRelay", () => {
  const lists = new Map([
    [ALICE, { pubkey: ALICE, updatedAt: NOW, read: [], write: ["wss://one.example"] }],
    [BOB, { pubkey: BOB, updatedAt: NOW, read: [], write: ["wss://one.example", "wss://two.example"] }],
  ]);

  it("groups authors by the relays they write to", () => {
    const grouped = groupAuthorsByWriteRelay([ALICE, BOB], lists);
    expect(grouped.get("wss://one.example")?.sort()).toEqual([ALICE, BOB].sort());
    expect(grouped.get("wss://two.example")).toEqual([BOB]);
  });

  it("falls back for authors with no published list", () => {
    // Dropping them would silently exclude everyone who has not published a
    // kind:10002, which is a large share of accounts.
    const grouped = groupAuthorsByWriteRelay([CAROL], lists, {
      fallback: ["wss://default.example"],
    });
    expect(grouped.get("wss://default.example")).toEqual([CAROL]);
  });

  it("caps how many relays are queried per author", () => {
    const many = new Map([
      [
        ALICE,
        {
          pubkey: ALICE,
          updatedAt: NOW,
          read: [],
          write: ["wss://a.example", "wss://b.example", "wss://c.example", "wss://d.example"],
        },
      ],
    ]);
    const grouped = groupAuthorsByWriteRelay([ALICE], many, { maxRelaysPerAuthor: 2 });
    expect(grouped.size).toBe(2);
  });

  it("deduplicates an author repeated in the input", () => {
    const grouped = groupAuthorsByWriteRelay([ALICE, ALICE], lists);
    expect(grouped.get("wss://one.example")).toEqual([ALICE]);
  });

  it("skips malformed pubkeys", () => {
    expect(groupAuthorsByWriteRelay(["junk"], lists).size).toBe(0);
  });

  it("returns nothing when there is nowhere to look", () => {
    expect(groupAuthorsByWriteRelay([CAROL], lists).size).toBe(0);
  });
});
