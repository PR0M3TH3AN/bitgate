import { describe, expect, it } from "vitest";

import {
  bech32Decode,
  convertBits,
  decodeNote,
  decodeNpub,
  normalizeEventIdInput,
  normalizePubkeyInput,
} from "../src/nip19.js";

// Known-good vector from NIP-19.
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
const NPUB_HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

describe("bech32Decode", () => {
  it("decodes a valid npub", () => {
    const decoded = bech32Decode(NPUB);
    expect(decoded?.hrp).toBe("npub");
    expect(decoded?.words.length).toBeGreaterThan(0);
  });

  it("rejects a bad checksum", () => {
    expect(bech32Decode(`${NPUB.slice(0, -1)}q`)).toBeNull();
  });

  it("rejects mixed case", () => {
    expect(bech32Decode("npub1ABC")).toBeNull();
  });

  it("rejects characters outside the charset", () => {
    expect(bech32Decode("npub1bbbbbbbbbbbb")).toBeNull();
  });

  it("rejects empty and non-string input", () => {
    expect(bech32Decode("")).toBeNull();
    expect(bech32Decode(/** @type {any} */ (null))).toBeNull();
  });

  it("rejects a string with no separator", () => {
    expect(bech32Decode("npubqqqqqq")).toBeNull();
  });
});

describe("convertBits", () => {
  it("regroups 5-bit words into bytes", () => {
    expect(convertBits([31, 31], 5, 8, true)).toEqual([255, 192]);
  });

  it("rejects values wider than fromBits", () => {
    expect(convertBits([32], 5, 8, true)).toBeNull();
  });

  it("rejects padding when padding is disallowed", () => {
    expect(convertBits([1], 5, 8, false)).toBeNull();
  });
});

describe("decodeNpub", () => {
  it("decodes to the expected hex", () => {
    expect(decodeNpub(NPUB)).toBe(NPUB_HEX);
  });

  it("returns empty for a note", () => {
    expect(decodeNpub("note1qqqqq")).toBe("");
  });

  it("returns empty for garbage", () => {
    expect(decodeNpub("not-an-npub")).toBe("");
    expect(decodeNpub(/** @type {any} */ (undefined))).toBe("");
  });
});

describe("decodeNote", () => {
  it("returns empty for an npub", () => {
    expect(decodeNote(NPUB)).toBe("");
  });
});

describe("normalizePubkeyInput", () => {
  it("passes hex through, lowercased", () => {
    expect(normalizePubkeyInput(NPUB_HEX.toUpperCase())).toBe(NPUB_HEX);
  });

  it("decodes npub", () => {
    expect(normalizePubkeyInput(NPUB)).toBe(NPUB_HEX);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePubkeyInput(`  ${NPUB_HEX}  `)).toBe(NPUB_HEX);
  });

  it("rejects a short hex string", () => {
    expect(normalizePubkeyInput("abc")).toBe("");
  });

  it("normalizes hex and npub to the same value", () => {
    expect(normalizePubkeyInput(NPUB)).toBe(normalizePubkeyInput(NPUB_HEX));
  });
});

describe("normalizeEventIdInput", () => {
  it("passes hex through", () => {
    const id = "1b".repeat(32);
    expect(normalizeEventIdInput(id.toUpperCase())).toBe(id);
  });

  it("rejects an npub", () => {
    expect(normalizeEventIdInput(NPUB)).toBe("");
  });
});
