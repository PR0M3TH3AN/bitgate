import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLE_CAPABILITIES,
  GOVERNANCE_CAPABILITIES,
  createAuthorityState,
  createRoleDefinition,
  getActorCapabilities,
  getActorRoles,
  hasCapability,
  hasRole,
  isGovernanceCapability,
  isProtectedActor,
} from "../src/authority.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CURATOR = "c3".repeat(32);
const STRANGER = "d4".repeat(32);

const baseState = () =>
  createAuthorityState({
    root: ROOT,
    actors: {
      [ROOT]: ["super_admin"],
      [MODERATOR]: ["moderator"],
      [CURATOR]: ["curator"],
    },
  });

describe("capabilities", () => {
  it("recognizes every documented capability", () => {
    for (const capability of GOVERNANCE_CAPABILITIES) {
      expect(isGovernanceCapability(capability)).toBe(true);
    }
  });

  it("rejects unknown capabilities", () => {
    expect(isGovernanceCapability("delete-everything")).toBe(false);
    expect(isGovernanceCapability("")).toBe(false);
    expect(isGovernanceCapability(null)).toBe(false);
  });

  it("gives super_admin every capability", () => {
    expect([...DEFAULT_ROLE_CAPABILITIES.super_admin].sort()).toEqual(
      [...GOVERNANCE_CAPABILITIES].sort(),
    );
  });

  it("keeps curators strictly weaker than moderators", () => {
    const curator = new Set(DEFAULT_ROLE_CAPABILITIES.curator);
    const moderator = new Set(DEFAULT_ROLE_CAPABILITIES.moderator);
    for (const capability of curator) {
      expect(moderator.has(capability)).toBe(true);
    }
    expect(moderator.size).toBeGreaterThan(curator.size);
  });

  it("does not let a curator deny events or addresses", () => {
    expect(DEFAULT_ROLE_CAPABILITIES.curator).not.toContain("contribute-event-deny");
    expect(DEFAULT_ROLE_CAPABILITIES.curator).not.toContain("contribute-address-deny");
  });

  it("does not let a moderator manage roles or policy", () => {
    expect(DEFAULT_ROLE_CAPABILITIES.moderator).not.toContain("manage-roles");
    expect(DEFAULT_ROLE_CAPABILITIES.moderator).not.toContain("manage-policy");
  });
});

describe("createAuthorityState", () => {
  it("normalizes actor pubkeys and drops invalid ones", () => {
    const state = createAuthorityState({
      actors: { [MODERATOR.toUpperCase()]: ["moderator"], "not-a-key": ["moderator"] },
    });
    expect(state.actors[MODERATOR]).toEqual(["moderator"]);
    expect(Object.keys(state.actors)).toHaveLength(1);
  });

  it("drops actors with no roles", () => {
    const state = createAuthorityState({ actors: { [MODERATOR]: [] } });
    expect(state.actors[MODERATOR]).toBeUndefined();
  });

  it("deduplicates repeated roles", () => {
    const state = createAuthorityState({ actors: { [MODERATOR]: ["moderator", "moderator"] } });
    expect(state.actors[MODERATOR]).toEqual(["moderator"]);
  });

  it("always protects the root administrator", () => {
    const state = createAuthorityState({ root: ROOT });
    expect(state.protectedActors).toContain(ROOT);
  });

  it("keeps explicitly protected actors alongside root", () => {
    const state = createAuthorityState({ root: ROOT, protectedActors: [MODERATOR] });
    expect(state.protectedActors).toContain(ROOT);
    expect(state.protectedActors).toContain(MODERATOR);
  });

  it("filters unknown capabilities out of custom roles", () => {
    const state = createAuthorityState({
      roles: { odd: /** @type {any} */ (["manage-policy", "not-a-capability"]) },
    });
    expect(state.roles.odd).toEqual(["manage-policy"]);
  });
});

describe("capability resolution", () => {
  it("resolves capabilities through roles", () => {
    const state = baseState();
    expect(hasCapability(MODERATOR, "contribute-event-deny", state)).toBe(true);
    expect(hasCapability(CURATOR, "contribute-user-deny", state)).toBe(true);
  });

  it("denies capabilities a role does not carry", () => {
    const state = baseState();
    expect(hasCapability(CURATOR, "contribute-event-deny", state)).toBe(false);
    expect(hasCapability(MODERATOR, "manage-roles", state)).toBe(false);
  });

  it("gives the root every capability even without a role entry", () => {
    const state = createAuthorityState({ root: ROOT });
    expect(hasCapability(ROOT, "manage-roles", state)).toBe(true);
    expect(getActorCapabilities(ROOT, state).sort()).toEqual([...GOVERNANCE_CAPABILITIES].sort());
  });

  it("returns nothing for unknown actors", () => {
    const state = baseState();
    expect(getActorCapabilities(STRANGER, state)).toEqual([]);
    expect(getActorRoles(STRANGER, state)).toEqual([]);
    expect(hasCapability(STRANGER, "contribute-user-deny", state)).toBe(false);
  });

  it("stops granting capabilities the moment a role is revoked", () => {
    const before = baseState();
    expect(hasCapability(MODERATOR, "contribute-user-deny", before)).toBe(true);

    const after = createAuthorityState({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(hasCapability(MODERATOR, "contribute-user-deny", after)).toBe(false);
  });

  it("normalizes pubkey case when resolving", () => {
    const state = baseState();
    expect(hasRole(MODERATOR.toUpperCase(), "moderator", state)).toBe(true);
  });

  it("rejects unknown capability names outright", () => {
    const state = baseState();
    expect(hasCapability(ROOT, /** @type {any} */ ("nope"), state)).toBe(false);
  });
});

describe("protected actors", () => {
  it("reports protection for the root", () => {
    expect(isProtectedActor(ROOT, baseState())).toBe(true);
  });

  it("does not protect ordinary actors", () => {
    expect(isProtectedActor(MODERATOR, baseState())).toBe(false);
  });

  it("handles invalid input", () => {
    expect(isProtectedActor("", baseState())).toBe(false);
  });
});

describe("createRoleDefinition", () => {
  it("creates a role from valid capabilities", () => {
    const role = createRoleDefinition("listing_moderator", ["contribute-address-deny"]);
    expect(role).toEqual({ name: "listing_moderator", capabilities: ["contribute-address-deny"] });
  });

  it("deduplicates capabilities", () => {
    const role = createRoleDefinition("r", ["review-evidence", "review-evidence"]);
    expect(role.capabilities).toEqual(["review-evidence"]);
  });

  it("rejects an unknown capability rather than silently dropping it", () => {
    expect(() => createRoleDefinition("r", [/** @type {any} */ ("invent-capability")])).toThrow(
      /Unknown governance capability/,
    );
  });

  it("rejects an empty name", () => {
    expect(() => createRoleDefinition("  ", [])).toThrow(/non-empty/);
  });
});
