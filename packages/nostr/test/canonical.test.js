import { describe, expect, it } from "vitest";

import {
  CANONICAL_KIND,
  MAX_POLICY_BYTES,
  canonicalIdentifier,
  decodeAddressCoordinate,
  decodeContribution,
  decodePolicy,
  decodeRoles,
  encodeAddressCoordinate,
  encodeContribution,
  encodeRoles,
  isCanonicalGovernanceEvent,
  parseIdentifier,
} from "../src/canonical.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const EVENT_ID = "1b".repeat(32);

/**
 * @param {Partial<import('../src/replaceable.js').NostrEvent>} parts
 * @returns {import('../src/replaceable.js').NostrEvent}
 */
const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: MODERATOR,
  kind: CANONICAL_KIND,
  created_at: 1000,
  tags: [],
  content: "",
  ...parts,
});

describe("canonical identifiers", () => {
  it("builds a namespaced identifier", () => {
    expect(canonicalIdentifier("bitroad", "address-deny")).toBe(
      "bitroad:governance:address-deny:v1",
    );
  });

  it("round-trips through the parser", () => {
    expect(parseIdentifier(canonicalIdentifier("app", "user-deny"))).toEqual({
      namespace: "app",
      scope: "user-deny",
      version: "1",
    });
  });

  it("rejects a non-governance identifier", () => {
    expect(parseIdentifier("bitvid:admin:blacklist")).toBeNull();
    expect(parseIdentifier("")).toBeNull();
  });
});

describe("isCanonicalGovernanceEvent", () => {
  it("accepts a well-formed document", () => {
    expect(
      isCanonicalGovernanceEvent(event({ tags: [["d", canonicalIdentifier("app", "user-deny")]] })),
    ).toBe(true);
  });

  it("rejects the wrong kind", () => {
    expect(
      isCanonicalGovernanceEvent(
        event({ kind: 30000, tags: [["d", canonicalIdentifier("app", "user-deny")]] }),
      ),
    ).toBe(false);
  });

  it("can be restricted to one namespace", () => {
    const candidate = event({ tags: [["d", canonicalIdentifier("app", "user-deny")]] });
    expect(isCanonicalGovernanceEvent(candidate, "app")).toBe(true);
    expect(isCanonicalGovernanceEvent(candidate, "other")).toBe(false);
  });
});

describe("decodeContribution", () => {
  it("decodes a user denial list", () => {
    const contribution = decodeContribution(
      event({
        tags: [
          ["d", canonicalIdentifier("app", "user-deny")],
          ["p", CREATOR],
        ],
      }),
    );
    expect(contribution).toMatchObject({
      actor: MODERATOR,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: CREATOR }],
    });
  });

  it("decodes an event denial list", () => {
    const contribution = decodeContribution(
      event({
        tags: [
          ["d", canonicalIdentifier("app", "event-deny")],
          ["e", EVENT_ID],
        ],
      }),
    );
    expect(contribution?.targets).toEqual([{ type: "event", id: EVENT_ID }]);
  });

  it("decodes an address denial list", () => {
    const contribution = decodeContribution(
      event({
        tags: [
          ["d", canonicalIdentifier("app", "address-deny")],
          ["a", `30078:${CREATOR}:sku-001`],
        ],
      }),
    );
    expect(contribution?.targets).toEqual([
      { type: "address", kind: "30078", pubkey: CREATOR, identifier: "sku-001" },
    ]);
  });

  it("carries a community source marker", () => {
    const contribution = decodeContribution(
      event({
        tags: [
          ["d", canonicalIdentifier("app", "user-deny")],
          ["source", "list-a"],
          ["p", CREATOR],
        ],
      }),
    );
    expect(contribution?.source).toBe("list-a");
  });

  it("skips malformed entries but keeps the rest", () => {
    const contribution = decodeContribution(
      event({
        tags: [
          ["d", canonicalIdentifier("app", "user-deny")],
          ["p", "not-a-pubkey"],
          ["p", CREATOR],
        ],
      }),
    );
    expect(contribution?.targets).toHaveLength(1);
  });

  it("returns null for an unknown scope", () => {
    expect(
      decodeContribution(event({ tags: [["d", canonicalIdentifier("app", "nonsense")]] })),
    ).toBeNull();
  });

  it("prefers an explicit scope tag over the identifier", () => {
    const contribution = decodeContribution(
      event({
        tags: [
          ["d", canonicalIdentifier("app", "user-deny")],
          ["scope", "user-allow"],
          ["p", CREATOR],
        ],
      }),
    );
    expect(contribution?.kind).toBe("user-allow");
  });
});

describe("address coordinates", () => {
  it("decodes a coordinate", () => {
    expect(decodeAddressCoordinate(`30078:${CREATOR}:sku-001`)).toEqual({
      type: "address",
      kind: "30078",
      pubkey: CREATOR,
      identifier: "sku-001",
    });
  });

  it("keeps colons inside the d-tag", () => {
    expect(decodeAddressCoordinate(`30078:${CREATOR}:bitroad:product:sku-001`)?.identifier).toBe(
      "bitroad:product:sku-001",
    );
  });

  it("rejects a non-numeric kind", () => {
    expect(decodeAddressCoordinate(`abc:${CREATOR}:sku`)).toBeNull();
  });

  it("rejects a missing identifier", () => {
    expect(decodeAddressCoordinate(`30078:${CREATOR}:`)).toBeNull();
  });

  it("round-trips", () => {
    const coordinate = `30078:${CREATOR}:sku-001`;
    const target = decodeAddressCoordinate(coordinate);
    expect(encodeAddressCoordinate(/** @type {any} */ (target))).toBe(coordinate);
  });
});

describe("decodeRoles", () => {
  const rolesEvent = event({
    pubkey: ROOT,
    tags: [
      ["d", canonicalIdentifier("app", "roles")],
      ["p", MODERATOR, "moderator"],
      ["cap", MODERATOR, "contribute-address-deny"],
      ["protected", CREATOR],
    ],
  });

  it("treats the publisher as root", () => {
    expect(decodeRoles(rolesEvent)?.root).toBe(ROOT);
  });

  it("reads role assignments", () => {
    expect(decodeRoles(rolesEvent)?.actors[MODERATOR]).toEqual(["moderator"]);
  });

  it("reads explicit capabilities", () => {
    expect(decodeRoles(rolesEvent)?.capabilities[MODERATOR]).toEqual(["contribute-address-deny"]);
  });

  it("always protects the root and reads extra protected actors", () => {
    const roles = decodeRoles(rolesEvent);
    expect(roles?.protectedActors).toContain(ROOT);
    expect(roles?.protectedActors).toContain(CREATOR);
  });

  it("returns null for a non-roles document", () => {
    expect(decodeRoles(event({ tags: [["d", canonicalIdentifier("app", "user-deny")]] }))).toBeNull();
  });
});

describe("decodePolicy", () => {
  const policyEvent = (content) =>
    event({ tags: [["d", canonicalIdentifier("app", "policy")]], content });

  it("parses valid JSON content", () => {
    expect(decodePolicy(policyEvent('{"version":"1"}'))).toEqual({ version: "1" });
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(decodePolicy(policyEvent("{not json"))).toBeNull();
  });

  it("rejects non-object content", () => {
    expect(decodePolicy(policyEvent("[1,2]"))).toBeNull();
    expect(decodePolicy(policyEvent('"a string"'))).toBeNull();
  });

  it("rejects oversized content before parsing", () => {
    expect(decodePolicy(policyEvent("x".repeat(MAX_POLICY_BYTES + 1)))).toBeNull();
  });

  it("rejects empty content", () => {
    expect(decodePolicy(policyEvent(""))).toBeNull();
  });
});

describe("encoders", () => {
  it("encodes a contribution round-trip", () => {
    const template = encodeContribution(
      { actor: MODERATOR, kind: "user-deny", targets: [{ type: "user", pubkey: CREATOR }] },
      "app",
    );
    const decoded = decodeContribution(event({ ...template, pubkey: MODERATOR }));
    expect(decoded?.kind).toBe("user-deny");
    expect(decoded?.targets).toEqual([{ type: "user", pubkey: CREATOR }]);
  });

  it("encodes an address contribution", () => {
    const template = encodeContribution(
      {
        actor: MODERATOR,
        kind: "address-deny",
        targets: [{ type: "address", kind: "30078", pubkey: CREATOR, identifier: "sku" }],
      },
      "app",
    );
    expect(template.tags).toContainEqual(["a", `30078:${CREATOR}:sku`]);
  });

  it("encodes roles round-trip", () => {
    const template = encodeRoles(
      { actors: { [MODERATOR]: ["moderator"] }, capabilities: {}, protectedActors: [] },
      "app",
    );
    const decoded = decodeRoles(event({ ...template, pubkey: ROOT }));
    expect(decoded?.actors[MODERATOR]).toEqual(["moderator"]);
  });

  it("stamps the client and version tags", () => {
    const template = encodeContribution({ actor: MODERATOR, kind: "user-deny", targets: [] }, "app");
    expect(template.tags).toContainEqual(["v", "1"]);
    expect(template.tags).toContainEqual(["client", "bitgate"]);
  });
});
