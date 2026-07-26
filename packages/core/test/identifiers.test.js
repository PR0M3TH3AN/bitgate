import { describe, it, expect } from "vitest";
import {
  normalizePubkey,
  normalizeEventId,
  normalizeAddress,
  createUserTarget,
  createEventTarget,
  getTargetKey
} from "../src/identifiers.js";

describe("identifiers", () => {
  describe("normalizePubkey", () => {
    it("should normalize hex pubkeys to lowercase", () => {
      const hexPubkey = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
      const expected = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      expect(normalizePubkey(hexPubkey)).toBe(expected);
    });

    it("should return empty string for invalid pubkeys", () => {
      expect(normalizePubkey("")).toBe("");
      expect(normalizePubkey(/** @type {any} */ (null))).toBe("");
      expect(normalizePubkey(/** @type {any} */ (undefined))).toBe("");
      expect(normalizePubkey("invalid")).toBe("");
      expect(normalizePubkey("abc123")).toBe(""); // Too short
    });
  });

  describe("normalizeEventId", () => {
    it("should normalize hex event IDs to lowercase", () => {
      const hexId = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
      const expected = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      expect(normalizeEventId(hexId)).toBe(expected);
    });

    it("should return empty string for invalid event IDs", () => {
      expect(normalizeEventId("")).toBe("");
      expect(normalizeEventId(/** @type {any} */ (null))).toBe("");
      expect(normalizeEventId(/** @type {any} */ (undefined))).toBe("");
      expect(normalizeEventId("invalid")).toBe("");
      expect(normalizeEventId("abc123")).toBe(""); // Too short
    });
  });

  describe("normalizeAddress", () => {
    it("should create a valid address target", () => {
      const result = normalizeAddress(
        30023,
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "test-identifier"
      );
      
      expect(result).toEqual({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
    });

    it("should return null for invalid addresses", () => {
      expect(normalizeAddress("", "valid-pubkey", "identifier")).toBeNull();
      expect(normalizeAddress(30023, "", "identifier")).toBeNull();
      expect(normalizeAddress(30023, "invalid-pubkey", "identifier")).toBeNull();
      expect(normalizeAddress(30023, "valid-pubkey", "")).toBeNull();
    });
  });

  describe("createUserTarget", () => {
    it("should create a valid user target", () => {
      const result = createUserTarget(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      );
      
      expect(result).toEqual({
        type: "user",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
    });

    it("should return null for invalid pubkeys", () => {
      expect(createUserTarget("")).toBeNull();
      expect(createUserTarget("invalid")).toBeNull();
    });
  });

  describe("createEventTarget", () => {
    it("should create a valid event target", () => {
      const result = createEventTarget(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      );
      
      expect(result).toEqual({
        type: "event",
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
    });

    it("should return null for invalid event IDs", () => {
      expect(createEventTarget("")).toBeNull();
      expect(createEventTarget("invalid")).toBeNull();
    });
  });

  describe("getTargetKey", () => {
    it("should generate correct keys for user targets", () => {
      const target = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user",
        pubkey: "test-pubkey"
      });
      expect(getTargetKey(target)).toBe("user:test-pubkey");
    });

    it("should generate correct keys for event targets", () => {
      const target = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event",
        id: "test-id"
      });
      expect(getTargetKey(target)).toBe("event:test-id");
    });

    it("should generate correct keys for address targets", () => {
      const target = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "test-pubkey",
        identifier: "test-identifier"
      });
      expect(getTargetKey(target)).toBe("address:30023:test-pubkey:test-identifier");
    });
  });
});