import { describe, expect, it } from "vitest";

import { decodeContribution } from "../src/canonical.js";
import {
  LEGACY_COMMUNITY_SOURCES_IDENTIFIER,
  LEGACY_EDITORS_IDENTIFIER,
  LEGACY_KIND,
  decodeLegacyCommunitySources,
  decodeLegacyEditors,
  decodeLegacyList,
  decodeMixedContributions,
  isLegacyAdminEvent,
} from "../src/legacy.js";

const ROOT = "a1".repeat(32);
const CURATOR = "c3".repeat(32);
const CREATOR = "d4".repeat(32);
const EVENT_ID = "1b".repeat(32);
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
const NPUB_HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

/**
 * @param {Partial<import('../src/replaceable.js').NostrEvent>} parts
 * @returns {import('../src/replaceable.js').NostrEvent}
 */
const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: ROOT,
  kind: LEGACY_KIND,
  created_at: 1000,
  tags: [],
  content: "",
  ...parts,
});

describe("isLegacyAdminEvent", () => {
  it("recognizes the known legacy lists", () => {
    for (const identifier of [
      "bitvid:admin:whitelist",
      "bitvid:admin:blacklist",
      "bitvid:admin:event-blacklist",
      LEGACY_EDITORS_IDENTIFIER,
      LEGACY_COMMUNITY_SOURCES_IDENTIFIER,
    ]) {
      expect(isLegacyAdminEvent(event({ tags: [["d", identifier]] }))).toBe(true);
    }
  });

  it("rejects unrelated lists", () => {
    expect(isLegacyAdminEvent(event({ tags: [["d", "bitvid:playlist"]] }))).toBe(false);
  });

  it("rejects the wrong kind", () => {
    expect(isLegacyAdminEvent(event({ kind: 30078, tags: [["d", "bitvid:admin:blacklist"]] }))).toBe(
      false,
    );
  });
});

describe("decodeLegacyList", () => {
  it("maps the blacklist onto a user denial", () => {
    const contribution = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:blacklist"], ["p", CREATOR]] }),
    );
    expect(contribution).toMatchObject({
      actor: ROOT,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: CREATOR }],
    });
  });

  it("maps the whitelist onto a user allowance", () => {
    const contribution = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:whitelist"], ["p", CREATOR]] }),
    );
    expect(contribution?.kind).toBe("user-allow");
  });

  it("maps the event blacklist onto an event denial", () => {
    const contribution = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:event-blacklist"], ["e", EVENT_ID]] }),
    );
    expect(contribution?.targets).toEqual([{ type: "event", id: EVENT_ID }]);
  });

  it("normalizes npub entries to hex", () => {
    const contribution = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:blacklist"], ["p", NPUB]] }),
    );
    expect(contribution?.targets).toEqual([{ type: "user", pubkey: NPUB_HEX }]);
  });

  it("treats hex and npub entries as the same target", () => {
    const fromNpub = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:blacklist"], ["p", NPUB]] }),
    );
    const fromHex = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:blacklist"], ["p", NPUB_HEX]] }),
    );
    expect(fromNpub?.targets).toEqual(fromHex?.targets);
  });

  it("returns null for the editor roster", () => {
    expect(decodeLegacyList(event({ tags: [["d", LEGACY_EDITORS_IDENTIFIER]] }))).toBeNull();
  });

  it("returns null for an unknown identifier", () => {
    expect(decodeLegacyList(event({ tags: [["d", "bitvid:other"]] }))).toBeNull();
  });

  it("skips malformed entries", () => {
    const contribution = decodeLegacyList(
      event({ tags: [["d", "bitvid:admin:blacklist"], ["p", "junk"], ["p", CREATOR]] }),
    );
    expect(contribution?.targets).toHaveLength(1);
  });
});

describe("decodeLegacyEditors", () => {
  it("returns editors as plain pubkeys", () => {
    expect(
      decodeLegacyEditors(event({ tags: [["d", LEGACY_EDITORS_IDENTIFIER], ["p", CREATOR]] })),
    ).toEqual([CREATOR]);
  });

  it("deduplicates", () => {
    expect(
      decodeLegacyEditors(
        event({ tags: [["d", LEGACY_EDITORS_IDENTIFIER], ["p", CREATOR], ["p", CREATOR]] }),
      ),
    ).toHaveLength(1);
  });

  it("returns nothing for other lists", () => {
    expect(decodeLegacyEditors(event({ tags: [["d", "bitvid:admin:blacklist"]] }))).toEqual([]);
  });
});

describe("decodeLegacyCommunitySources", () => {
  it("decodes curator list references", () => {
    const sources = decodeLegacyCommunitySources(
      event({
        tags: [
          ["d", LEGACY_COMMUNITY_SOURCES_IDENTIFIER],
          ["a", `30000:${CURATOR}:bitvid:admin:blacklist`],
        ],
      }),
    );
    expect(sources).toEqual([
      { curator: CURATOR, identifier: "bitvid:admin:blacklist", kind: 30000 },
    ]);
  });

  it("skips malformed coordinates", () => {
    const sources = decodeLegacyCommunitySources(
      event({ tags: [["d", LEGACY_COMMUNITY_SOURCES_IDENTIFIER], ["a", "garbage"]] }),
    );
    expect(sources).toEqual([]);
  });

  it("returns nothing for other lists", () => {
    expect(decodeLegacyCommunitySources(event({ tags: [["d", "bitvid:admin:blacklist"]] }))).toEqual(
      [],
    );
  });
});

describe("decodeMixedContributions", () => {
  it("reads legacy and canonical events side by side", () => {
    const legacy = event({ tags: [["d", "bitvid:admin:blacklist"], ["p", CREATOR]] });
    const canonical = event({
      kind: 30078,
      tags: [["d", "app:bitgate:user-deny:v1"], ["p", CREATOR]],
    });

    const contributions = decodeMixedContributions([legacy, canonical], decodeContribution);
    expect(contributions).toHaveLength(2);
    expect(contributions.every((entry) => entry.kind === "user-deny")).toBe(true);
  });

  it("ignores events neither codec recognizes", () => {
    expect(decodeMixedContributions([event({ tags: [["d", "unknown"]] })], decodeContribution)).toEqual(
      [],
    );
  });
});
