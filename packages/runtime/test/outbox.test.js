// Outbox-model fetching, contact discovery, and private mutes.
//
// The behaviour under test is the one that decides whether the trust graph is
// fed at all: mute lists live on their authors' own write relays, not on
// whichever relays this deployment happens to use.

import { describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";
import { CONTACT_LIST_KIND, MUTE_LIST_KIND, RELAY_LIST_KIND } from "@bitgate/nostr";

import { createBitGate } from "../src/runtime.js";
import { createMemoryTransport } from "../src/interfaces.js";

const ROOT = "a1".repeat(32);
const VIEWER = "e5".repeat(32);
const CREATOR = "d4".repeat(32);
const ALICE = "01".repeat(32);
const BOB = "02".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "outbox",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: { name: "feed", reports: {}, mutes: { default: { hide: 1 } } },
  },
});

const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: ALICE,
  kind: MUTE_LIST_KIND,
  created_at: NOW,
  tags: [],
  content: "",
  ...parts,
});

/** A transport that records which relays each query targeted. */
function recordingTransport(eventsByRelay = {}) {
  const base = createMemoryTransport(Object.values(eventsByRelay).flat());
  /** @type {Array<{ relays: string[]|undefined, kinds: number[] }>} */
  const calls = [];

  return {
    ...base,
    relays: ["wss://default.example"],
    calls,
    async list(filters, options = {}) {
      calls.push({ relays: options.relays, kinds: filters[0]?.kinds ?? [] });

      // Answer only with events the targeted relays actually hold, which is
      // what makes an outbox failure visible rather than invisible.
      const targets = options.relays ?? ["wss://default.example"];
      const available = targets.flatMap((relay) => eventsByRelay[relay] ?? []);
      const source = options.relays ? available : (eventsByRelay["wss://default.example"] ?? []);

      return source.filter((candidate) =>
        filters.some(
          (filter) =>
            (!filter.kinds || filter.kinds.includes(candidate.kind)) &&
            (!filter.authors || filter.authors.includes(candidate.pubkey)),
        ),
      );
    },
  };
}

function makeRuntime(transport) {
  const runtime = createBitGate({
    applicationId: "outbox-test",
    namespace: "test",
    root: ROOT,
    transport,
    policy: POLICY,
    now: () => NOW,
  });
  runtime.setViewer(VIEWER);
  return runtime;
}

describe("relay list discovery", () => {
  it("learns where each contact writes", async () => {
    const transport = recordingTransport({
      "wss://default.example": [
        event({
          pubkey: ALICE,
          kind: RELAY_LIST_KIND,
          tags: [["r", "wss://alice.example", "write"]],
        }),
      ],
    });
    const runtime = makeRuntime(transport);

    expect(await runtime.loadRelayLists([ALICE])).toBe(1);
    expect(runtime.relayLists.get(ALICE)?.write).toEqual(["wss://alice.example"]);
    expect(runtime.describe().relayListsKnown).toBe(1);
  });

  it("survives an unreachable relay", async () => {
    const transport = recordingTransport();
    transport.list = async () => {
      throw new Error("down");
    };
    const runtime = makeRuntime(transport);
    const stale = vi.fn();
    runtime.on("stale", stale);

    expect(await runtime.loadRelayLists([ALICE])).toBe(0);
    expect(stale).toHaveBeenCalledWith(expect.objectContaining({ reason: "relay-lists-unreachable" }));
  });

  it("does nothing for an empty author list", async () => {
    expect(await makeRuntime(recordingTransport()).loadRelayLists([])).toBe(0);
  });
});

describe("outbox mute fetching", () => {
  it("finds a mute list that only exists on its author's own relay", async () => {
    // The whole point: this list is not on the deployment's relay, so a naive
    // fetch would miss it and report zero trusted mutes.
    const transport = recordingTransport({
      "wss://default.example": [
        event({
          pubkey: ALICE,
          kind: RELAY_LIST_KIND,
          tags: [["r", "wss://alice.example", "write"]],
        }),
      ],
      "wss://alice.example": [event({ pubkey: ALICE, tags: [["p", CREATOR]] })],
    });

    const runtime = makeRuntime(transport);
    runtime.trust.setContacts([ALICE]);

    expect(await runtime.loadTrustedMuteLists()).toBe(1);
    expect(runtime.mutes.toRecordMap().get(`user:${CREATOR}`)).toHaveLength(1);
  });

  it("targets each author's relays rather than querying everything", async () => {
    const transport = recordingTransport({
      "wss://default.example": [
        event({ pubkey: ALICE, kind: RELAY_LIST_KIND, tags: [["r", "wss://alice.example", "write"]] }),
        event({ pubkey: BOB, kind: RELAY_LIST_KIND, tags: [["r", "wss://bob.example", "write"]] }),
      ],
      "wss://alice.example": [event({ pubkey: ALICE, tags: [["p", CREATOR]] })],
      "wss://bob.example": [event({ pubkey: BOB, tags: [["p", CREATOR]] })],
    });

    const runtime = makeRuntime(transport);
    runtime.trust.setContacts([ALICE, BOB]);
    await runtime.loadTrustedMuteLists();

    const muteQueries = transport.calls.filter((call) => call.kinds.includes(MUTE_LIST_KIND));
    const targeted = muteQueries.flatMap((call) => call.relays ?? []);
    expect(targeted).toContain("wss://alice.example");
    expect(targeted).toContain("wss://bob.example");

    // Two distinct muters, found only because each was queried where they write.
    expect(runtime.mutes.toRecordMap().get(`user:${CREATOR}`)).toHaveLength(2);
  });

  it("falls back to the configured relays for authors with no relay list", async () => {
    const transport = recordingTransport({
      "wss://default.example": [event({ pubkey: ALICE, tags: [["p", CREATOR]] })],
    });
    const runtime = makeRuntime(transport);
    runtime.trust.setContacts([ALICE]);

    expect(await runtime.loadTrustedMuteLists()).toBe(1);
  });

  it("feeds evaluation, not just the store", async () => {
    const transport = recordingTransport({
      "wss://default.example": [event({ pubkey: ALICE, tags: [["p", CREATOR]] })],
    });
    const runtime = makeRuntime(transport);
    runtime.trust.setContacts([ALICE]);
    await runtime.loadTrustedMuteLists();

    expect(
      runtime.evaluate({ type: "user", pubkey: CREATOR }, { profile: "feed" }).visibility.effect,
    ).toBe("hide");
  });

  it("does nothing when the viewer trusts nobody", async () => {
    expect(await makeRuntime(recordingTransport()).loadTrustedMuteLists()).toBe(0);
  });

  it("can skip relay discovery", async () => {
    const transport = recordingTransport({
      "wss://default.example": [event({ pubkey: ALICE, tags: [["p", CREATOR]] })],
    });
    const runtime = makeRuntime(transport);
    runtime.trust.setContacts([ALICE]);

    await runtime.loadTrustedMuteLists({ discoverRelays: false });
    expect(transport.calls.some((call) => call.kinds.includes(RELAY_LIST_KIND))).toBe(false);
  });
});

describe("contact list loading", () => {
  it("builds the trust graph from the viewer's own follow list", async () => {
    const transport = recordingTransport({
      "wss://default.example": [
        event({
          pubkey: VIEWER,
          kind: CONTACT_LIST_KIND,
          tags: [["p", ALICE], ["p", BOB]],
        }),
      ],
    });
    const runtime = makeRuntime(transport);

    expect(await runtime.loadContacts()).toBe(2);
    expect(runtime.trust.contacts.has(ALICE)).toBe(true);
  });

  it("ignores someone else's follow list", async () => {
    const transport = recordingTransport({
      "wss://default.example": [
        event({ pubkey: ALICE, kind: CONTACT_LIST_KIND, tags: [["p", BOB]] }),
      ],
    });
    const runtime = makeRuntime(transport);

    await runtime.loadContacts();
    expect(runtime.trust.contacts.size).toBe(0);
  });

  it("does nothing with no viewer", async () => {
    const transport = recordingTransport();
    const runtime = createBitGate({
      applicationId: "t",
      namespace: "t",
      transport,
      policy: POLICY,
      now: () => NOW,
    });
    expect(await runtime.loadContacts()).toBe(0);
  });
});

describe("the viewer's own private mutes", () => {
  const PRIVATE = JSON.stringify([["p", CREATOR]]);

  function signerWithNip44() {
    return {
      async getPublicKey() {
        return VIEWER;
      },
      async signEvent(template) {
        return { ...template, id: "ff".repeat(32), pubkey: VIEWER, sig: "00".repeat(64) };
      },
      nip44: {
        async decrypt(pubkey, ciphertext) {
          if (pubkey !== VIEWER || ciphertext !== "cipher") {
            throw new Error("cannot decrypt");
          }
          return PRIVATE;
        },
      },
    };
  }

  it("applies them as viewer mutes", async () => {
    const transport = recordingTransport();
    const runtime = createBitGate({
      applicationId: "t",
      namespace: "t",
      root: ROOT,
      transport,
      signer: signerWithNip44(),
      policy: POLICY,
      now: () => NOW,
    });
    runtime.setViewer(VIEWER);

    runtime.ingestEvent(event({ pubkey: VIEWER, content: "cipher" }));
    await vi.waitFor(() => expect(runtime.trust.mutes.has(CREATOR)).toBe(true));
  });

  it("leaves another account's private entries alone", async () => {
    const transport = recordingTransport();
    const runtime = createBitGate({
      applicationId: "t",
      namespace: "t",
      root: ROOT,
      transport,
      signer: signerWithNip44(),
      policy: POLICY,
      now: () => NOW,
    });
    runtime.setViewer(VIEWER);

    runtime.ingestEvent(event({ pubkey: ALICE, content: "cipher" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.trust.mutes.size).toBe(0);
  });

  it("degrades quietly without a NIP-44 capable signer", async () => {
    const transport = recordingTransport();
    const runtime = makeRuntime(transport);

    expect(() => runtime.ingestEvent(event({ pubkey: VIEWER, content: "cipher" }))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.trust.mutes.size).toBe(0);
  });
});
