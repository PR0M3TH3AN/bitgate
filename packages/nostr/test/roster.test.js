import { describe, expect, it } from "vitest";

import { createAuthorityState, getActorRoles } from "@bitgate/core";

import { ROLE_SET_KIND, resolveAuthorityRoster } from "../src/roster.js";

const ROOT = "a1".repeat(32);
const MOD_A = "b2".repeat(32);
const MOD_B = "c3".repeat(32);
const COUNCIL = "d4".repeat(32);
const CURATOR = "e5".repeat(32);
const OUTSIDER = "f6".repeat(32);

const setEvent = (pubkey, identifier, members, createdAt = 1000, id = "0".repeat(64)) => ({
  kind: ROLE_SET_KIND,
  pubkey,
  created_at: createdAt,
  id,
  content: "",
  tags: [["d", identifier], ...members.map((m) => ["p", m])],
});

describe("resolveAuthorityRoster", () => {
  it("grants the root its role and members from a root-signed set", () => {
    const { root, actors } = resolveAuthorityRoster([setEvent(ROOT, "bitgate:moderators", [MOD_A, MOD_B])], {
      root: ROOT,
      rosters: [{ identifier: "bitgate:moderators", role: "moderator" }],
    });
    expect(root).toBe(ROOT);
    expect(actors[ROOT]).toEqual(["super_admin"]);
    expect(actors[MOD_A]).toEqual(["moderator"]);
    expect(actors[MOD_B]).toEqual(["moderator"]);
  });

  it("ignores a set signed by anyone but the root (the whole security property)", () => {
    const { actors } = resolveAuthorityRoster([setEvent(OUTSIDER, "bitgate:moderators", [MOD_A])], {
      root: ROOT,
      rosters: [{ identifier: "bitgate:moderators", role: "moderator" }],
    });
    expect(actors[MOD_A]).toBeUndefined();
  });

  it("supports delegation: a granted role may publish a further set", () => {
    const events = [
      setEvent(ROOT, "bitgate:council", [COUNCIL]), // root names the council
      setEvent(COUNCIL, "bitgate:curators", [CURATOR]), // a council member names curators
      setEvent(OUTSIDER, "bitgate:curators", [OUTSIDER]), // outsider's set ignored
    ];
    const { actors } = resolveAuthorityRoster(events, {
      root: ROOT,
      rosters: [
        { identifier: "bitgate:council", role: "council" },
        { identifier: "bitgate:curators", role: "curator", signer: "council" },
      ],
    });
    expect(actors[COUNCIL]).toEqual(["council"]);
    expect(actors[CURATOR]).toEqual(["curator"]);
    expect(actors[OUTSIDER]).toBeUndefined();
  });

  it("keeps the latest set per publisher (kind 30000 is replaceable)", () => {
    const events = [
      setEvent(ROOT, "bitgate:moderators", [MOD_A], 1000, "1".repeat(64)),
      setEvent(ROOT, "bitgate:moderators", [MOD_B], 2000, "2".repeat(64)), // newer: replaces
    ];
    const { actors } = resolveAuthorityRoster(events, {
      root: ROOT,
      rosters: [{ identifier: "bitgate:moderators", role: "moderator" }],
    });
    expect(actors[MOD_B]).toEqual(["moderator"]);
    expect(actors[MOD_A]).toBeUndefined();
  });

  it("output feeds createAuthorityState directly", () => {
    const roster = resolveAuthorityRoster([setEvent(ROOT, "bitgate:moderators", [MOD_A])], {
      root: ROOT,
      rosters: [{ identifier: "bitgate:moderators", role: "moderator" }],
    });
    const authority = createAuthorityState(roster);
    expect(getActorRoles(MOD_A, authority)).toContain("moderator");
    expect(getActorRoles(ROOT, authority)).toContain("super_admin");
  });
});
