import { describe, expect, it } from "vitest";

import {
  canonicalStringify,
  fingerprint,
  hashString,
  snapshotFingerprint,
} from "../src/fingerprint.js";

describe("canonicalStringify", () => {
  it("sorts object keys at every depth", () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("preserves array order", () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });

  it("serializes Sets order-independently", () => {
    expect(canonicalStringify(new Set(["b", "a"]))).toBe(canonicalStringify(new Set(["a", "b"])));
  });

  it("serializes Maps order-independently", () => {
    const a = new Map([["x", 1], ["y", 2]]);
    const b = new Map([["y", 2], ["x", 1]]);
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("skips undefined values", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  it("handles primitives and null", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify(5)).toBe("5");
    expect(canonicalStringify("x")).toBe('"x"');
  });
});

describe("hashString", () => {
  it("returns a 16-character hex digest", () => {
    expect(hashString("anything")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable across calls", () => {
    expect(hashString("stable")).toBe(hashString("stable"));
  });

  it("separates similar inputs", () => {
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("ab")).not.toBe(hashString("ba"));
  });

  it("handles the empty string", () => {
    expect(hashString("")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("fingerprint", () => {
  it("matches for structurally equal values", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it("differs when a value changes", () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe("snapshotFingerprint", () => {
  it("ignores fields outside the snapshot", () => {
    const base = { authority: { root: "x" }, admin: { userDeny: new Set(["a"]) } };
    expect(snapshotFingerprint(base)).toBe(
      snapshotFingerprint(/** @type {any} */ ({ ...base, viewer: "someone" })),
    );
  });

  it("changes when administrative state changes", () => {
    const before = snapshotFingerprint({ admin: { userDeny: new Set() } });
    const after = snapshotFingerprint({ admin: { userDeny: new Set(["user:a"]) } });
    expect(before).not.toBe(after);
  });

  it("changes when the policy changes", () => {
    expect(snapshotFingerprint({ policy: { version: "1" } })).not.toBe(
      snapshotFingerprint({ policy: { version: "2" } }),
    );
  });

  it("tolerates a fully empty snapshot", () => {
    expect(snapshotFingerprint({})).toMatch(/^[0-9a-f]{16}$/);
  });
});
