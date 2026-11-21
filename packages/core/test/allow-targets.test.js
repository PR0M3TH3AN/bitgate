// Allow lists for events and addresses, not only people.
//
// A curated surface lists worlds and listings, not just the people behind
// them: a starter set names worlds, a marketplace's early catalogue names
// listings. These pin how an event or address allow entry combines with the
// rest of the decision.

import { describe, expect, it } from "vitest";

import { createAuthorityState, hasCapability } from "../src/authority.js";
import { createEmptyAdminState, isAllowed, reduceAdminState, serializeAdminState } from "../src/adminState.js";
import { createSnapshot, evaluateTarget } from "../src/evaluator.js";
import { ALLOWLIST_POLICY } from "../src/presets.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const PUBLISHER = "c3".repeat(32);
const OTHER = "d4".repeat(32);
const EVENT_ID = "e5".repeat(32);

/** @returns {import('../src/identifiers.js').AddressTarget} */
const world = (/** @type {string} */ pubkey, /** @type {string} */ identifier) => ({
  type: "address",
  kind: "37300",
  pubkey,
  identifier,
});
const authority = () =>
  createAuthorityState({ root: ROOT, actors: { [MODERATOR]: ["moderator"] } });

function decide(target, contributions) {
  const auth = authority();
  const snapshot = createSnapshot({ authority: auth, admin: reduceAdminState(contributions, auth) });
  return evaluateTarget(target, snapshot, { surface: "default", policy: ALLOWLIST_POLICY, now: 0 });
}

describe("event and address allow entries", () => {
  it("lets an allowed world through an allowlist whose publisher is not listed", () => {
    const home = world(PUBLISHER, "home");
    const allowed = decide(home, [{ actor: ROOT, kind: "address-allow", targets: [home] }]);
    expect(allowed.visibility.effect).toBe("allow");
    expect(allowed.transaction?.effect ?? "allow").toBe("allow");

    // The same publisher's other world is not on the list.
    const other = decide(world(PUBLISHER, "other"), [{ actor: ROOT, kind: "address-allow", targets: [home] }]);
    expect(other.visibility.effect).toBe("hide");
    expect(other.reasons.map((reason) => reason.id)).toContain("allowlist-miss");
  });

  it("lets an allowed event through", () => {
    const target = { type: "event", id: EVENT_ID, author: PUBLISHER };
    const decision = decide(target, [{ actor: ROOT, kind: "event-allow", targets: [{ type: "event", id: EVENT_ID }] }]);
    expect(decision.visibility.effect).toBe("allow");
  });

  it("still lets an allowed publisher's worlds through", () => {
    const decision = decide(world(PUBLISHER, "anything"), [
      { actor: ROOT, kind: "user-allow", targets: [{ type: "user", pubkey: PUBLISHER }] },
    ]);
    expect(decision.visibility.effect).toBe("allow");
  });

  it("never lifts a denial: blocked beats allowed", () => {
    const home = world(PUBLISHER, "home");
    const onBoth = decide(home, [
      { actor: ROOT, kind: "address-allow", targets: [home] },
      { actor: ROOT, kind: "address-deny", targets: [home] },
    ]);
    expect(onBoth.visibility.effect).toBe("hide");

    const publisherBlocked = decide(home, [
      { actor: ROOT, kind: "address-allow", targets: [home] },
      { actor: ROOT, kind: "user-deny", targets: [{ type: "user", pubkey: PUBLISHER }] },
    ]);
    expect(publisherBlocked.visibility.effect).toBe("hide");
  });

  it("counts an allow entry only from an actor holding the capability", () => {
    const auth = authority();
    expect(hasCapability(ROOT, "contribute-address-allow", auth)).toBe(true);
    expect(hasCapability(MODERATOR, "contribute-address-allow", auth)).toBe(false);
    expect(hasCapability(MODERATOR, "contribute-event-allow", auth)).toBe(false);

    const home = world(PUBLISHER, "home");
    const fromModerator = decide(home, [{ actor: MODERATOR, kind: "address-allow", targets: [home] }]);
    expect(fromModerator.visibility.effect).toBe("hide");
  });

  it("drops an allow entry whose target is of the wrong type", () => {
    const state = reduceAdminState(
      [{ actor: ROOT, kind: "address-allow", targets: [{ type: "user", pubkey: OTHER }] }],
      authority(),
    );
    expect(state.addressAllow?.size).toBe(0);
  });

  it("reads a snapshot built before the new sets existed as allowing nothing extra", () => {
    const legacy = createEmptyAdminState();
    delete legacy.eventAllow;
    delete legacy.addressAllow;
    expect(isAllowed(world(PUBLISHER, "home"), legacy)).toBe(false);
    expect(serializeAdminState(legacy)).toMatchObject({ eventAllow: [], addressAllow: [] });

    const auth = authority();
    const decision = evaluateTarget(world(PUBLISHER, "home"), createSnapshot({ authority: auth, admin: legacy }), {
      surface: "default",
      policy: ALLOWLIST_POLICY,
      now: 0,
    });
    expect(decision.visibility.effect).toBe("hide");
  });
});
