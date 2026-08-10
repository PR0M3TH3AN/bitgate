import { describe, expect, it } from "vitest";

import { schnorr } from "@noble/curves/secp256k1";

import { computeEventId, createVerifier, isVerifiable, verifyEvent } from "../src/index.js";

const NOW = 1_750_000_000;

// A fixed key so every run signs the same events.
const SECRET = new Uint8Array(32).fill(7);
const PUBKEY = Buffer.from(schnorr.getPublicKey(SECRET)).toString("hex");

/** Build a properly signed event. */
function signEvent(overrides = {}) {
  const unsigned = {
    pubkey: PUBKEY,
    created_at: NOW,
    kind: 1,
    tags: [["p", "a1".repeat(32)]],
    content: "hello",
    ...overrides,
  };
  const id = computeEventId(unsigned);
  const sig = Buffer.from(schnorr.sign(id, SECRET)).toString("hex");
  return { ...unsigned, id, sig };
}

describe("computeEventId", () => {
  it("produces a 64-character hex digest", () => {
    expect(computeEventId(signEvent())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const event = signEvent();
    expect(computeEventId(event)).toBe(computeEventId(event));
  });

  it("changes when any serialized field changes", () => {
    const base = signEvent();
    const fields = [
      { content: "different" },
      { created_at: NOW + 1 },
      { kind: 2 },
      { tags: [["p", "b2".repeat(32)]] },
    ];
    for (const change of fields) {
      expect(computeEventId({ ...base, ...change }), JSON.stringify(change)).not.toBe(base.id);
    }
  });

  it("treats missing tags and content as empty rather than throwing", () => {
    expect(() =>
      computeEventId(/** @type {any} */ ({ pubkey: PUBKEY, created_at: NOW, kind: 1 })),
    ).not.toThrow();
  });
});

describe("isVerifiable", () => {
  it("accepts a well-formed signed event", () => {
    expect(isVerifiable(signEvent())).toBe(true);
  });

  it("rejects structurally invalid input without touching crypto", () => {
    const event = signEvent();
    const cases = [
      null,
      undefined,
      "a string",
      { ...event, id: "short" },
      { ...event, pubkey: "not-hex" },
      { ...event, sig: undefined },
      { ...event, sig: "abcd" },
      { ...event, kind: "1" },
      { ...event, created_at: "now" },
      { ...event, tags: "none" },
      { ...event, content: 42 },
    ];
    for (const candidate of cases) {
      expect(isVerifiable(/** @type {any} */ (candidate)), JSON.stringify(candidate)).toBe(false);
    }
  });

  it("rejects uppercase hex, since ids are canonically lowercase", () => {
    const event = signEvent();
    expect(isVerifiable({ ...event, id: event.id.toUpperCase() })).toBe(false);
  });
});

describe("verifyEvent", () => {
  it("accepts a correctly signed event", () => {
    expect(verifyEvent(signEvent())).toBe(true);
  });

  it("rejects tampered content even though the signature is genuine", () => {
    // The heart of it: reusing a real signature over altered content must fail,
    // which is why the id is recomputed rather than trusted.
    const event = signEvent();
    expect(verifyEvent({ ...event, content: "tampered" })).toBe(false);
  });

  it("rejects an event whose id does not match its contents", () => {
    const event = signEvent();
    expect(verifyEvent({ ...event, id: "ff".repeat(32) })).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const event = signEvent();
    const otherSecret = new Uint8Array(32).fill(9);
    const forged = Buffer.from(schnorr.sign(event.id, otherSecret)).toString("hex");
    expect(verifyEvent({ ...event, sig: forged })).toBe(false);
  });

  it("rejects a signature lifted from another event", () => {
    const first = signEvent({ content: "one" });
    const second = signEvent({ content: "two" });
    expect(verifyEvent({ ...second, sig: first.sig })).toBe(false);
  });

  it("rejects a claimed pubkey the signature does not belong to", () => {
    const event = signEvent();
    expect(verifyEvent({ ...event, pubkey: "a1".repeat(32) })).toBe(false);
  });

  it("never throws on hostile input", () => {
    const cases = [null, {}, { id: "zz".repeat(32), pubkey: PUBKEY, sig: "0".repeat(128) }];
    for (const candidate of cases) {
      expect(() => verifyEvent(/** @type {any} */ (candidate))).not.toThrow();
      expect(verifyEvent(/** @type {any} */ (candidate))).toBe(false);
    }
  });
});

describe("createVerifier", () => {
  it("accepts a valid current event", () => {
    const verify = createVerifier({ now: () => NOW });
    expect(verify(signEvent())).toBe(true);
  });

  it("rejects an event dated far in the future", () => {
    // A far-future created_at wins replaceable selection indefinitely, pinning
    // stale state in place. The signature is perfectly valid, so only a clock
    // check catches it.
    const verify = createVerifier({ now: () => NOW, maxFutureSeconds: 60 });
    expect(verify(signEvent({ created_at: NOW + 3600 }))).toBe(false);
  });

  it("allows modest clock skew", () => {
    const verify = createVerifier({ now: () => NOW, maxFutureSeconds: 900 });
    expect(verify(signEvent({ created_at: NOW + 120 }))).toBe(true);
  });

  it("accepts old events, which are legitimate", () => {
    const verify = createVerifier({ now: () => NOW });
    expect(verify(signEvent({ created_at: NOW - 86_400 * 365 }))).toBe(true);
  });

  it("can disable the clock check", () => {
    const verify = createVerifier({ now: () => NOW, maxFutureSeconds: 0 });
    expect(verify(signEvent({ created_at: NOW + 86_400 }))).toBe(true);
  });

  it("still rejects an invalid signature regardless of timing", () => {
    const verify = createVerifier({ now: () => NOW });
    expect(verify(signEvent({ content: "x" }) && { ...signEvent(), content: "tampered" })).toBe(false);
  });
});
