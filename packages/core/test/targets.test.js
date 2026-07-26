import { describe, it, expect } from "vitest";
import {
  areTargetsEqual,
  isValidTarget,
  createTarget,
  getParentTarget,
  isDescendantOf
} from "../src/targets.js";

describe("targets", () => {
  describe("areTargetsEqual", () => {
    it("should return true for identical user targets", () => {
      const target1 = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const target2 = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(areTargetsEqual(target1, target2)).toBe(true);
    });

    it("should return false for different user targets", () => {
      const target1 = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const target2 = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "1234567890123456789012345678901234567890123456789012345678901234"
      });
      expect(areTargetsEqual(target1, target2)).toBe(false);
    });

    it("should return true for identical event targets", () => {
      const target1 = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const target2 = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(areTargetsEqual(target1, target2)).toBe(true);
    });

    it("should return false for different event targets", () => {
      const target1 = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const target2 = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "1234567890123456789012345678901234567890123456789012345678901234"
      });
      expect(areTargetsEqual(target1, target2)).toBe(false);
    });

    it("should return true for identical address targets", () => {
      const target1 = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
      const target2 = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
      expect(areTargetsEqual(target1, target2)).toBe(true);
    });

    it("should return false for different address targets", () => {
      const target1 = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
      const target2 = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "different-identifier"
      });
      expect(areTargetsEqual(target1, target2)).toBe(false);
    });
  });

  describe("isValidTarget", () => {
    it("should return true for valid user targets", () => {
      const target = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(isValidTarget(target)).toBe(true);
    });

    it("should return false for invalid user targets", () => {
      expect(isValidTarget(/** @type {any} */({ type: "user", pubkey: "invalid" }))).toBe(false);
      expect(isValidTarget(/** @type {any} */({ type: "user" }))).toBe(false);
      expect(isValidTarget(/** @type {any} */({ 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" 
      }))).toBe(false);
    });

    it("should return true for valid event targets", () => {
      const target = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(isValidTarget(target)).toBe(true);
    });

    it("should return false for invalid event targets", () => {
      expect(isValidTarget(/** @type {any} */({ type: "event", id: "invalid" }))).toBe(false);
      expect(isValidTarget(/** @type {any} */({ type: "event" }))).toBe(false);
      expect(isValidTarget(/** @type {any} */({ 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" 
      }))).toBe(false);
    });

    it("should return true for valid address targets", () => {
      const target = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
      expect(isValidTarget(target)).toBe(true);
    });

    it("should return false for invalid address targets", () => {
      expect(isValidTarget(/** @type {any} */({
        type: "address",
        kind: "30023",
        pubkey: "invalid",
        identifier: "test-identifier"
      }))).toBe(false);
      expect(isValidTarget(/** @type {any} */({
        type: "address",
        kind: "30023",
        identifier: "test-identifier"
      }))).toBe(false);
    });

    it("should return false for unknown target types", () => {
      expect(isValidTarget(/** @type {any} */({ type: "unknown" }))).toBe(false);
    });

    it("should return false for non-objects", () => {
      expect(isValidTarget(null)).toBe(false);
      expect(isValidTarget(undefined)).toBe(false);
      expect(isValidTarget("string")).toBe(false);
      expect(isValidTarget(123)).toBe(false);
    });
  });

  describe("createTarget", () => {
    it("should return the same target if already valid", () => {
      const target = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(createTarget(target)).toBe(target);
    });

    it("should create user target from hex pubkey", () => {
      const result = createTarget("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
      expect(result).toEqual(/** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      }));
    });

    it("should create event target from hex event ID", () => {
      // For now, hex strings are treated as user targets first
      // In a real implementation, we might need additional context
      const result = createTarget("1234567890123456789012345678901234567890123456789012345678901234");
      expect(result).toEqual(/** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user",
        pubkey: "1234567890123456789012345678901234567890123456789012345678901234"
      }));
    });

    it("should create user target from object", () => {
      const result = createTarget(/** @type {{type: string, pubkey: string}} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      }));
      expect(result).toEqual(/** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      }));
    });

    it("should create event target from object", () => {
      const result = createTarget(/** @type {{type: string, id: string}} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      }));
      expect(result).toEqual(/** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event",
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      }));
    });

    it("should create address target from object", () => {
      const result = createTarget(/** @type {{type: string, kind: number, pubkey: string, identifier: string}} */ ({
        type: "address",
        kind: 30023,
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      }));
      expect(result).toEqual(/** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      }));
    });

    it("should return null for invalid inputs", () => {
      expect(createTarget("")).toBeNull();
      expect(createTarget("invalid")).toBeNull();
      expect(createTarget(/** @type {any} */ ({}))).toBeNull();
      expect(createTarget(null)).toBeNull();
      expect(createTarget(undefined)).toBeNull();
    });
  });

  describe("getParentTarget", () => {
    it("should return null for user targets", () => {
      const target = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(getParentTarget(target)).toBeNull();
    });

    it("should create user target from event target author", () => {
      const target = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const authorPubkey = "1234567890123456789012345678901234567890123456789012345678901234";
      const result = getParentTarget(target, authorPubkey);
      expect(result).toEqual(/** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user",
        pubkey: "1234567890123456789012345678901234567890123456789012345678901234"
      }));
    });

    it("should create user target from address target", () => {
      const target = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
      const result = getParentTarget(target);
      expect(result).toEqual(/** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      }));
    });

    it("should throw error for event targets without author pubkey", () => {
      const target = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(() => getParentTarget(target)).toThrow("authorPubkey is required for event targets");
    });
  });

  describe("isDescendantOf", () => {
    it("should return false for identical targets", () => {
      const target = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(isDescendantOf(target, target)).toBe(false);
    });

    it("should return true for event target descendant of its author", () => {
      const eventTarget = /** @type {import('../src/identifiers.js').EventTarget} */ ({
        type: "event", 
        id: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const userTarget = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "1234567890123456789012345678901234567890123456789012345678901234"
      });
      expect(isDescendantOf(
        eventTarget, 
        userTarget, 
        "1234567890123456789012345678901234567890123456789012345678901234"
      )).toBe(true);
    });

    it("should return true for address target descendant of its author", () => {
      const addressTarget = /** @type {import('../src/identifiers.js').AddressTarget} */ ({
        type: "address",
        kind: "30023",
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        identifier: "test-identifier"
      });
      const userTarget = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      expect(isDescendantOf(addressTarget, userTarget)).toBe(true);
    });

    it("should return false for user target with no parent", () => {
      const target1 = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
      });
      const target2 = /** @type {import('../src/identifiers.js').UserTarget} */ ({
        type: "user", 
        pubkey: "1234567890123456789012345678901234567890123456789012345678901234"
      });
      expect(isDescendantOf(target1, target2)).toBe(false);
    });
  });
});