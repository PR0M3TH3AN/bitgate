import { describe, expect, it } from "vitest";

import { createAuthorityState } from "../src/authority.js";
import {
  createEmptyAdminState,
  isDenied,
  mergeCommunitySource,
  reduceAdminState,
  serializeAdminState,
} from "../src/adminState.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CURATOR = "c3".repeat(32);
const CREATOR = "d4".repeat(32);
const STRANGER = "e5".repeat(32);
const EVENT_ID = "1b".repeat(32);

const authority = () =>
  createAuthorityState({
    root: ROOT,
    actors: {
      [ROOT]: ["super_admin"],
      [MODERATOR]: ["moderator"],
      [CURATOR]: ["curator"],
    },
  });

/** @param {string} pubkey @returns {import("../src/identifiers.js").UserTarget} */
const user = (pubkey) => ({ type: "user", pubkey });
/** @param {string} id @returns {import("../src/identifiers.js").EventTarget} */
const event = (id) => ({ type: "event", id });
/**
 * @param {string} kind
 * @param {string} pubkey
 * @param {string} identifier
 * @returns {import("../src/identifiers.js").AddressTarget}
 */
const address = (kind, pubkey, identifier) => ({ type: "address", kind, pubkey, identifier });

describe("reduceAdminState", () => {
  it("accepts a contribution the actor is authorized to make", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
      authority(),
    );
    expect(state.userDeny.has(`user:${CREATOR}`)).toBe(true);
  });

  it("drops a contribution beyond the actor's capabilities", () => {
    const state = reduceAdminState(
      [{ actor: CURATOR, kind: "event-deny", targets: [event(EVENT_ID)] }],
      authority(),
    );
    expect(state.eventDeny.size).toBe(0);
  });

  it("drops contributions from actors with no roles", () => {
    const state = reduceAdminState(
      [{ actor: STRANGER, kind: "user-deny", targets: [user(CREATOR)] }],
      authority(),
    );
    expect(state.userDeny.size).toBe(0);
  });

  it("drops an actor's entries as soon as the role is revoked", () => {
    /** @type {import("../src/adminState.js").Contribution[]} */
    const contributions = [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }];
    const withRole = reduceAdminState(contributions, authority());
    expect(withRole.userDeny.size).toBe(1);

    const revoked = createAuthorityState({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(reduceAdminState(contributions, revoked).userDeny.size).toBe(0);
  });

  it("unions denials from several contributors", () => {
    const state = reduceAdminState(
      [
        { actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] },
        { actor: CURATOR, kind: "user-deny", targets: [user(CREATOR)] },
      ],
      authority(),
    );
    expect(state.contributors.get(`user:${CREATOR}`)).toEqual([MODERATOR, CURATOR]);
  });

  it("ignores targets of the wrong type for the contribution kind", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "event-deny", targets: [user(CREATOR)] }],
      authority(),
    );
    expect(state.eventDeny.size).toBe(0);
  });

  it("ignores malformed contributions and targets", () => {
    const state = reduceAdminState(
      /** @type {any[]} */ ([
        null,
        { actor: MODERATOR, kind: "not-a-kind", targets: [user(CREATOR)] },
        { actor: MODERATOR, kind: "user-deny", targets: [/** @type {any} */ ({ type: "user", pubkey: "short" })] },
        { actor: MODERATOR, kind: "user-deny" },
      ]),
      authority(),
    );
    expect(state.userDeny.size).toBe(0);
  });

  it("collects trust seeds as pubkeys", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "trust-seed", targets: [user(CREATOR)] }],
      authority(),
    );
    expect(state.trustSeeds.has(CREATOR)).toBe(true);
    expect(state.contributors.size).toBe(0);
  });

  it("records address denials by coordinate", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "address-deny", targets: [address("30023", CREATOR, "listing")] }],
      authority(),
    );
    expect(state.addressDeny.has(`address:30023:${CREATOR}:listing`)).toBe(true);
  });

  it("returns empty state for non-array input", () => {
    expect(reduceAdminState(/** @type {any} */ (null), authority()).userDeny.size).toBe(0);
  });
});

describe("protected actors", () => {
  it("cannot be denied through a contributor list", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "user-deny", targets: [user(ROOT)] }],
      authority(),
    );
    expect(state.userDeny.has(`user:${ROOT}`)).toBe(false);
  });

  it("cannot be denied even by many contributors", () => {
    const state = reduceAdminState(
      [
        { actor: MODERATOR, kind: "user-deny", targets: [user(ROOT)] },
        { actor: CURATOR, kind: "user-deny", targets: [user(ROOT)] },
      ],
      authority(),
    );
    expect(state.userDeny.has(`user:${ROOT}`)).toBe(false);
    expect(state.contributors.has(`user:${ROOT}`)).toBe(false);
  });
});

describe("community sources", () => {
  it("marks only contributions carrying a source", () => {
    const state = reduceAdminState(
      [
        { actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] },
        { actor: CURATOR, kind: "user-deny", source: "list-a", targets: [user(STRANGER)] },
      ],
      authority(),
    );
    expect(state.communitySources.has(`user:${CREATOR}`)).toBe(false);
    expect(state.communitySources.get(`user:${STRANGER}`)).toEqual(["list-a"]);
  });

  it("merges a community list into existing state", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] }],
      authority(),
    );
    mergeCommunitySource(
      state,
      { actor: CURATOR, kind: "user-deny", source: "list-b", targets: [user(STRANGER)] },
      authority(),
    );
    expect(state.userDeny.has(`user:${CREATOR}`)).toBe(true);
    expect(state.userDeny.has(`user:${STRANGER}`)).toBe(true);
    expect(state.communitySources.get(`user:${STRANGER}`)).toEqual(["list-b"]);
  });

  it("still protects the root when merging a community list", () => {
    const state = createEmptyAdminState();
    mergeCommunitySource(
      state,
      { actor: CURATOR, kind: "user-deny", source: "hostile", targets: [user(ROOT)] },
      authority(),
    );
    expect(state.userDeny.has(`user:${ROOT}`)).toBe(false);
  });

  it("ignores a community list from an unauthorized curator", () => {
    const state = createEmptyAdminState();
    mergeCommunitySource(
      state,
      { actor: STRANGER, kind: "user-deny", source: "list-c", targets: [user(CREATOR)] },
      authority(),
    );
    expect(state.userDeny.size).toBe(0);
  });
});

describe("isDenied", () => {
  const state = reduceAdminState(
    [
      { actor: MODERATOR, kind: "user-deny", targets: [user(CREATOR)] },
      { actor: MODERATOR, kind: "event-deny", targets: [event(EVENT_ID)] },
      { actor: MODERATOR, kind: "address-deny", targets: [address("30023", CREATOR, "listing")] },
    ],
    authority(),
  );

  it("detects denial per target type", () => {
    expect(isDenied(user(CREATOR), state)).toBe(true);
    expect(isDenied(event(EVENT_ID), state)).toBe(true);
    expect(isDenied(address("30023", CREATOR, "listing"), state)).toBe(true);
  });

  it("does not leak denial across target types", () => {
    expect(isDenied(user(STRANGER), state)).toBe(false);
    expect(isDenied(address("30023", CREATOR, "other"), state)).toBe(false);
  });
});

describe("serializeAdminState", () => {
  it("produces sorted, stable output", () => {
    const state = reduceAdminState(
      [{ actor: MODERATOR, kind: "user-deny", targets: [user(STRANGER), user(CREATOR)] }],
      authority(),
    );
    const serialized = serializeAdminState(state);
    expect(serialized.userDeny).toEqual([...serialized.userDeny].sort());
    expect(serializeAdminState(state)).toEqual(serialized);
  });
});
