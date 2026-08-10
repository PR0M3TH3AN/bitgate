import { describe, expect, it } from "vitest";

import {
  LABEL_KIND,
  contributionToLabel,
  decodeLabels,
  encodeLabel,
  labelTargets,
  labelsToContributions,
} from "../src/labels.js";

const LABELLER = "b2".repeat(32);
const USER = "d4".repeat(32);
const EVENT_ID = "1b".repeat(32);
const NOW = 1_750_000_000;

const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: LABELLER,
  kind: LABEL_KIND,
  created_at: NOW,
  tags: [],
  content: "",
  ...parts,
});

describe("decodeLabels", () => {
  it("decodes the NIP-32 example shape", () => {
    const labels = decodeLabels(
      event({
        tags: [
          ["L", "license"],
          ["l", "MIT", "license"],
          ["e", EVENT_ID, "wss://relay.example"],
        ],
        content: "explanation",
      }),
    );
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ namespace: "license", value: "MIT", content: "explanation" });
    expect(labels[0].targets).toEqual([{ type: "event", id: EVENT_ID }]);
  });

  it("splits several l values into separate labels", () => {
    const labels = decodeLabels(
      event({
        tags: [
          ["L", "com.app.mod"],
          ["l", "deny", "com.app.mod"],
          ["l", "nsfw"],
          ["p", USER],
        ],
      }),
    );
    expect(labels.map((label) => ({ ns: label.namespace, v: label.value }))).toEqual([
      { ns: "com.app.mod", v: "deny" },
      { ns: "", v: "nsfw" },
    ]);
  });

  it("treats an l mark that matches no L as unnamespaced", () => {
    const labels = decodeLabels(event({ tags: [["l", "deny", "unlisted"], ["p", USER]] }));
    expect(labels[0].namespace).toBe("");
  });

  it("reads all governed target types", () => {
    const targets = labelTargets(
      event({
        tags: [
          ["p", USER],
          ["e", EVENT_ID],
          ["a", `30023:${USER}:sku`],
        ],
      }),
    );
    expect(targets.map((t) => t.type)).toEqual(["user", "event", "address"]);
  });

  it("skips relay and topic targets, which have no allow/deny meaning", () => {
    const targets = labelTargets(event({ tags: [["r", "wss://x"], ["t", "politics"], ["p", USER]] }));
    expect(targets).toEqual([{ type: "user", pubkey: USER }]);
  });

  it("rejects the wrong kind and a malformed author", () => {
    expect(decodeLabels(event({ kind: 1 }))).toEqual([]);
    expect(decodeLabels(event({ pubkey: "nope", tags: [["l", "deny"]] }))).toEqual([]);
  });

  it("ignores empty label values", () => {
    expect(decodeLabels(event({ tags: [["l", "  "], ["p", USER]] }))).toEqual([]);
  });
});

describe("labelsToContributions", () => {
  const labels = () =>
    decodeLabels(
      event({
        tags: [
          ["L", "com.app.mod"],
          ["l", "deny", "com.app.mod"],
          ["l", "nsfw", "com.app.mod"],
          ["p", USER],
          ["e", EVENT_ID],
        ],
      }),
    );

  it("maps a deny label to a deny contribution per target", () => {
    const contributions = labelsToContributions(labels(), {
      namespace: "com.app.mod",
      denyValues: ["deny"],
    });
    expect(contributions.map((c) => c.kind).sort()).toEqual(["event-deny", "user-deny"]);
    expect(contributions.every((c) => c.actor === LABELLER)).toBe(true);
  });

  it("records the labeller as the source", () => {
    const [contribution] = labelsToContributions(labels(), {
      namespace: "com.app.mod",
      denyValues: ["deny"],
    });
    expect(contribution.source).toBe(`label:com.app.mod:${LABELLER}`);
  });

  it("ignores labels outside the configured namespace", () => {
    expect(labelsToContributions(labels(), { namespace: "other", denyValues: ["deny"] })).toEqual([]);
  });

  it("ignores label values not in the vocabulary", () => {
    // "nsfw" is a categorisation label, not a denial, unless the app says so.
    const contributions = labelsToContributions(labels(), {
      namespace: "com.app.mod",
      denyValues: ["deny"],
    });
    expect(contributions).toHaveLength(2);
  });

  it("lets an application define its own deny vocabulary", () => {
    const contributions = labelsToContributions(labels(), {
      namespace: "com.app.mod",
      denyValues: ["nsfw"],
    });
    expect(contributions).toHaveLength(2);
    expect(contributions.every((c) => c.kind.endsWith("-deny"))).toBe(true);
  });

  it("maps allow only for users", () => {
    const allowLabels = decodeLabels(
      event({
        tags: [["L", "ns"], ["l", "allow", "ns"], ["p", USER], ["e", EVENT_ID]],
      }),
    );
    const contributions = labelsToContributions(allowLabels, {
      namespace: "ns",
      allowValues: ["allow"],
    });
    expect(contributions).toEqual([
      expect.objectContaining({ kind: "user-allow", targets: [{ type: "user", pubkey: USER }] }),
    ]);
  });

  it("is case-insensitive on the value", () => {
    const upper = decodeLabels(event({ tags: [["L", "ns"], ["l", "DENY", "ns"], ["p", USER]] }));
    expect(labelsToContributions(upper, { namespace: "ns", denyValues: ["deny"] })).toHaveLength(1);
  });
});

describe("encodeLabel and round-trip", () => {
  it("encodes a namespaced label", () => {
    const template = encodeLabel({ value: "deny", namespace: "ns", targets: [{ type: "user", pubkey: USER }] });
    expect(template.tags).toEqual([["L", "ns"], ["l", "deny", "ns"], ["p", USER]]);
  });

  it("encodes an unnamespaced label without an L tag", () => {
    const template = encodeLabel({ value: "spam", targets: [{ type: "user", pubkey: USER }] });
    expect(template.tags).toEqual([["l", "spam"], ["p", USER]]);
  });

  it("includes relay hints when given", () => {
    const template = encodeLabel({
      value: "deny",
      namespace: "ns",
      targets: [{ type: "user", pubkey: USER }],
      relayHints: { [`user:${USER}`]: "wss://r.example" },
    });
    expect(template.tags).toContainEqual(["p", USER, "wss://r.example"]);
  });

  it("encodes an address target", () => {
    const template = encodeLabel({
      value: "deny",
      namespace: "ns",
      targets: [{ type: "address", kind: "30023", pubkey: USER, identifier: "sku" }],
    });
    expect(template.tags).toContainEqual(["a", `30023:${USER}:sku`]);
  });

  it("rejects an empty value", () => {
    expect(() => encodeLabel({ value: "  ", targets: [] })).toThrow(/non-empty/);
  });

  it("round-trips a deny back to a contribution", () => {
    const template = encodeLabel({ value: "deny", namespace: "ns", targets: [{ type: "user", pubkey: USER }] });
    const contributions = labelsToContributions(decodeLabels(event(template)), {
      namespace: "ns",
      denyValues: ["deny"],
    });
    expect(contributions).toEqual([
      expect.objectContaining({ kind: "user-deny", targets: [{ type: "user", pubkey: USER }] }),
    ]);
  });

  it("encodes a contribution as a label", () => {
    const template = contributionToLabel(
      { actor: LABELLER, kind: "user-deny", targets: [{ type: "user", pubkey: USER }] },
      { namespace: "ns" },
    );
    expect(template.tags).toEqual([["L", "ns"], ["l", "deny", "ns"], ["p", USER]]);
  });

  it("encodes an allow contribution with the allow value", () => {
    const template = contributionToLabel(
      { actor: LABELLER, kind: "user-allow", targets: [{ type: "user", pubkey: USER }] },
      { namespace: "ns", allowValue: "trusted" },
    );
    expect(template.tags).toContainEqual(["l", "trusted", "ns"]);
  });
});
