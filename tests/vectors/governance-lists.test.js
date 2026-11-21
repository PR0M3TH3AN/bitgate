// The scoped-list vectors are the agreement between readers. This holds
// BitGate's own reader to them, and keeps the file from drifting away from
// the generator that produced it.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  decodeScopedList,
  encodeScopedList,
  formatSubjectCoordinate,
  resolveScopedList,
  scopedListToContribution,
} from "@bitgate/nostr";
import { createAuthorityState, createSnapshot, evaluateTarget, reduceAdminState, ALLOWLIST_POLICY } from "@bitgate/core";
import { verifyEvent } from "@bitgate/verify";

import { VECTORS_PATH, serializeVectors } from "../../scripts/build-list-vectors.mjs";

const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

/** What a reader made of an event, in the vectors' own terms. */
function observed(result, expect) {
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  const view = {
    ok: true,
    scope: result.scope,
    subject: formatSubjectCoordinate(result.subject),
    signer: result.signer,
    skipped: result.skipped,
  };
  if ("entryCount" in expect) {
    view.entryCount = result.entries.length;
  } else {
    view.entries = result.entries;
  }
  return view;
}

describe("scoped-list vectors", () => {
  it("are current with their generator", () => {
    expect(readFileSync(VECTORS_PATH, "utf8")).toBe(serializeVectors());
  });

  it("cover every refusal code a single event can earn", () => {
    const reasons = new Set(vectors.decode.filter((c) => !c.expect.ok).map((c) => c.expect.reason));
    for (const reason of [
      "not_an_event",
      "wrong_kind",
      "bad_d",
      "unsupported_version",
      "unsupported_scope",
      "bad_subject",
      "tag_mismatch",
      "wrong_signer",
      "content_not_empty",
      "too_many_entries",
      "bad_signature",
    ]) {
      expect(reasons, reason).toContain(reason);
    }
  });

  for (const testCase of vectors.decode) {
    it(`decode: ${testCase.name}`, () => {
      const result = decodeScopedList(testCase.event, { verify: verifyEvent });
      expect(observed(result, testCase.expect)).toEqual(testCase.expect);
    });
  }

  for (const testCase of vectors.resolve) {
    it(`resolve: ${testCase.name}`, () => {
      const result = resolveScopedList(testCase.events, { ...testCase.query, verify: verifyEvent });
      expect(observed(result, testCase.expect)).toEqual(testCase.expect);
    });
  }
});

describe("scoped lists without a verifier", () => {
  it("refuse to read anything", () => {
    const event = vectors.decode.find((c) => c.name === "allow-list").event;
    expect(decodeScopedList(event, /** @type {any} */ ({}))).toEqual({ ok: false, reason: "no_verifier" });
    expect(decodeScopedList(event, { verify: () => /** @type {any} */ (Promise.resolve(true)) })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(
      resolveScopedList([event], /** @type {any} */ ({ namespace: "nswp", scope: "user-allow", subject: event.tags[3][1] })),
    ).toEqual({ ok: false, reason: "no_verifier" });
  });

  it("treat a verifier that throws as a failed check", () => {
    const event = vectors.decode.find((c) => c.name === "allow-list").event;
    const result = decodeScopedList(event, {
      verify: () => {
        throw new Error("curve exploded");
      },
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("encodeScopedList", () => {
  const owner = vectors.keys.owner;
  const { alice, bob } = vectors.keys.guests;
  const subject = `37300:${owner}:home`;

  it("produces exactly the tags of the vectors' allow list", () => {
    const template = encodeScopedList({ namespace: "nswp", scope: "user-allow", subject, entries: [bob, alice, bob] });
    const vector = vectors.decode.find((c) => c.name === "allow-list").event;
    expect(template.kind).toBe(30078);
    expect(template.content).toBe("");
    expect(template.tags.slice(0, 5)).toEqual(vector.tags.slice(0, 5));
    expect(template.tags.slice(5)).toEqual([
      ["p", alice],
      ["p", bob],
    ]);
  });

  it("refuses what a reader would refuse", () => {
    expect(() => encodeScopedList({ namespace: "NSWP", scope: "user-allow", subject, entries: [] })).toThrow(TypeError);
    expect(() => encodeScopedList({ namespace: "nswp", scope: /** @type {any} */ ("event-deny"), subject, entries: [] })).toThrow(TypeError);
    expect(() => encodeScopedList({ namespace: "nswp", scope: "user-allow", subject: `37300:${owner}:`, entries: [] })).toThrow(
      TypeError,
    );
    expect(() =>
      encodeScopedList({ namespace: "nswp", scope: "user-allow", subject, entries: [alice.toUpperCase()] }),
    ).toThrow(TypeError);
    const tooMany = Array.from({ length: 2001 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
    expect(() => encodeScopedList({ namespace: "nswp", scope: "user-allow", subject, entries: tooMany })).toThrow(RangeError);
  });
});

describe("a world's own lists, end to end", () => {
  it("let an invited guest in, keep everyone else out, and let a block beat an invitation", () => {
    const allowList = decodeScopedList(vectors.decode.find((c) => c.name === "allow-list").event, { verify: verifyEvent });
    const blockList = decodeScopedList(vectors.decode.find((c) => c.name === "block-list").event, { verify: verifyEvent });
    expect(allowList.ok && blockList.ok).toBe(true);
    if (!allowList.ok || !blockList.ok) return;

    // One snapshot per world, with the world's owner as root. No roster, no curator.
    const authority = createAuthorityState({ root: allowList.subject.pubkey });
    const carolInvitedToo = { ...scopedListToContribution(allowList) };
    carolInvitedToo.targets = [...carolInvitedToo.targets, { type: "user", pubkey: vectors.keys.guests.carol }];
    const admin = reduceAdminState([carolInvitedToo, scopedListToContribution(blockList)], authority);
    const snapshot = createSnapshot({ authority, admin });
    const decide = (pubkey) =>
      evaluateTarget({ type: "user", pubkey }, snapshot, { surface: "default", policy: ALLOWLIST_POLICY, now: 0 }).interaction.effect;

    const { alice, bob, carol } = vectors.keys.guests;
    expect(decide(alice)).toBe("allow");
    expect(decide(bob)).toBe("allow");
    expect(decide(carol)).toBe("deny"); // invited and blocked: blocked wins
    expect(decide(vectors.keys.impostor)).toBe("deny"); // never invited
    expect(decide(allowList.subject.pubkey)).toBe("allow"); // the owner is always let into their own world
  });
});
