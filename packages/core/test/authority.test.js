import { describe, it, expect } from "vitest";
import {
  BUILTIN_ROLES,
  getRoleCapabilities,
  hasRole,
  getActorRoles,
  hasCapability,
  getActorCapabilities,
  createRoleDefinition,
  createActor,
  createAuthorityState
} from "../src/authority.js";

describe("authority", () => {
  describe("BUILTIN_ROLES", () => {
    it("should define built-in roles with capabilities", () => {
      expect(BUILTIN_ROLES).toHaveProperty("root");
      expect(BUILTIN_ROLES).toHaveProperty("administrator");
      expect(BUILTIN_ROLES).toHaveProperty("moderator");
      expect(BUILTIN_ROLES).toHaveProperty("trusted-user");
      expect(BUILTIN_ROLES).toHaveProperty("user");
      
      // Check that each role has a name and capabilities
      for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
        expect(role.name).toBe(name);
        expect(Array.isArray(role.capabilities)).toBe(true);
        expect(role.capabilities.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getRoleCapabilities", () => {
    it("should return capabilities for built-in roles", () => {
      const capabilities = getRoleCapabilities("root");
      expect(capabilities).toEqual(BUILTIN_ROLES.root.capabilities);
    });

    it("should return capabilities for custom roles", () => {
      const authorityState = createAuthorityState({
        "custom-role": {
          name: "custom-role",
          capabilities: ["custom-capability"]
        }
      });
      
      const capabilities = getRoleCapabilities("custom-role", authorityState);
      expect(capabilities).toEqual(["custom-capability"]);
    });

    it("should prefer custom roles over built-in roles", () => {
      const authorityState = createAuthorityState({
        "root": {
          name: "root",
          capabilities: ["custom-root-capability"]
        }
      });
      
      const capabilities = getRoleCapabilities("root", authorityState);
      expect(capabilities).toEqual(["custom-root-capability"]);
    });

    it("should return empty array for unknown roles", () => {
      const capabilities = getRoleCapabilities("unknown-role");
      expect(capabilities).toEqual([]);
    });
  });

  describe("hasRole", () => {
    it("should return true for actors with the specified role", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["moderator"]
        }
      });
      
      const result = hasRole(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "moderator",
        authorityState
      );
      expect(result).toBe(true);
    });

    it("should return false for actors without the specified role", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["user"]
        }
      });
      
      const result = hasRole(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "moderator",
        authorityState
      );
      expect(result).toBe(false);
    });

    it("should return false for unknown actors", () => {
      const authorityState = createAuthorityState();
      const result = hasRole(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "moderator",
        authorityState
      );
      expect(result).toBe(false);
    });

    it("should normalize pubkeys to lowercase", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["moderator"]
        }
      });
      
      const result = hasRole(
        "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
        "moderator",
        authorityState
      );
      expect(result).toBe(true);
    });
  });

  describe("getActorRoles", () => {
    it("should return roles for known actors", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["user", "trusted-user"]
        }
      });
      
      const roles = getActorRoles(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        authorityState
      );
      expect(roles).toEqual(["user", "trusted-user"]);
    });

    it("should return empty array for unknown actors", () => {
      const authorityState = createAuthorityState();
      const roles = getActorRoles(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        authorityState
      );
      expect(roles).toEqual([]);
    });
  });

  describe("hasCapability", () => {
    it("should return true for actors with the specified capability", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["moderator"]
        }
      });
      
      const result = hasCapability(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "submit-reports",
        authorityState
      );
      expect(result).toBe(true);
    });

    it("should return false for actors without the specified capability", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["user"]
        }
      });
      
      const result = hasCapability(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "manage-admin-lists",
        authorityState
      );
      expect(result).toBe(false);
    });

    it("should return false for unknown actors", () => {
      const authorityState = createAuthorityState();
      const result = hasCapability(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "submit-reports",
        authorityState
      );
      expect(result).toBe(false);
    });
  });

  describe("getActorCapabilities", () => {
    it("should return all capabilities for an actor's roles", () => {
      const authorityState = createAuthorityState({}, {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["moderator", "trusted-user"]
        }
      });
      
      const capabilities = getActorCapabilities(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        authorityState
      );
      
      // Should have capabilities from both roles, with duplicates removed
      expect(capabilities).toContain("submit-reports");
      expect(capabilities).toContain("view-reports");
      expect(capabilities).toContain("submit-trust-endorsements");
    });

    it("should return empty array for unknown actors", () => {
      const authorityState = createAuthorityState();
      const capabilities = getActorCapabilities(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        authorityState
      );
      expect(capabilities).toEqual([]);
    });
  });

  describe("createRoleDefinition", () => {
    it("should create a valid role definition", () => {
      const role = createRoleDefinition("test-role", ["capability1", "capability2"]);
      expect(role).toEqual({
        name: "test-role",
        capabilities: ["capability1", "capability2"]
      });
    });

    it("should trim whitespace from role name and capabilities", () => {
      const role = createRoleDefinition(" test-role ", [" capability1 ", " capability2 "]);
      expect(role).toEqual({
        name: "test-role",
        capabilities: ["capability1", "capability2"]
      });
    });

    it("should throw error for invalid role name", () => {
      expect(() => createRoleDefinition("", ["capability"])).toThrow();
      expect(() => createRoleDefinition(/** @type {any} */ (123), ["capability"])).toThrow();
    });

    it("should throw error for invalid capabilities", () => {
      expect(() => createRoleDefinition("test-role", /** @type {any} */ ("not-an-array"))).toThrow();
      expect(() => createRoleDefinition("test-role", [/** @type {any} */ (123)])).toThrow();
      expect(() => createRoleDefinition("test-role", [""])).toThrow();
    });
  });

  describe("createActor", () => {
    it("should create a valid actor", () => {
      const actor = createActor(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ["role1", "role2"]
      );
      expect(actor).toEqual({
        pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        roles: ["role1", "role2"]
      });
    });

    it("should normalize pubkey to lowercase", () => {
      const actor = createActor(
        "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
        ["role1"]
      );
      expect(actor.pubkey).toBe("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    });

    it("should trim whitespace from roles", () => {
      const actor = createActor(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        [" role1 ", " role2 "]
      );
      expect(actor.roles).toEqual(["role1", "role2"]);
    });

    it("should throw error for invalid pubkey", () => {
      expect(() => createActor("invalid-pubkey", ["role"])).toThrow();
      expect(() => createActor(/** @type {any} */ (123), ["role"])).toThrow();
      expect(() => createActor("", ["role"])).toThrow();
    });

    it("should throw error for invalid roles", () => {
      expect(() => createActor(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        /** @type {any} */ ("not-an-array")
      )).toThrow();
      expect(() => createActor(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        [/** @type {any} */ (123)]
      )).toThrow();
      expect(() => createActor(
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        [""]
      )).toThrow();
    });
  });

  describe("createAuthorityState", () => {
    it("should create a valid authority state", () => {
      const roles = {
        "test-role": {
          name: "test-role",
          capabilities: ["test-capability"]
        }
      };
      
      const actors = {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          roles: ["test-role"]
        }
      };
      
      const state = createAuthorityState(roles, actors);
      expect(state).toEqual({ roles, actors });
    });

    it("should create empty authority state with no arguments", () => {
      const state = createAuthorityState();
      expect(state).toEqual({ roles: {}, actors: {} });
    });

    it("should validate role names", () => {
      const roles = {
        "": {
          name: "",
          capabilities: ["test-capability"]
        }
      };
      
      expect(() => createAuthorityState(roles)).toThrow();
    });

    it("should validate role definitions", () => {
      const roles = {
        "test-role": /** @type {any} */ (null)
      };
      
      expect(() => createAuthorityState(roles)).toThrow();
    });

    it("should validate role name consistency", () => {
      const roles = {
        "test-role": {
          name: "different-name",
          capabilities: ["test-capability"]
        }
      };
      
      expect(() => createAuthorityState(roles)).toThrow();
    });

    it("should validate actor pubkeys", () => {
      const actors = {
        "invalid-pubkey": {
          pubkey: "invalid-pubkey",
          roles: ["test-role"]
        }
      };
      
      expect(() => createAuthorityState({}, actors)).toThrow();
    });

    it("should validate actors", () => {
      const actors = {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": /** @type {any} */ (null)
      };
      
      expect(() => createAuthorityState({}, actors)).toThrow();
    });

    it("should validate actor pubkey consistency", () => {
      const actors = {
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789": {
          pubkey: "different-pubkey",
          roles: ["test-role"]
        }
      };
      
      expect(() => createAuthorityState({}, actors)).toThrow();
    });
  });
});