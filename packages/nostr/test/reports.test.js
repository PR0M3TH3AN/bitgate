import { describe, expect, it } from "vitest";

import {
  REPORT_KIND,
  decodeReport,
  encodeReport,
  extractReportType,
  isRelayHint,
  normalizeCategory,
} from "../src/reports.js";

const REPORTER = "a1".repeat(32);
const CREATOR = "d4".repeat(32);
const EVENT_ID = "1b".repeat(32);

/**
 * @param {Partial<import('../src/replaceable.js').NostrEvent>} parts
 * @returns {import('../src/replaceable.js').NostrEvent}
 */
const event = (parts) => ({
  id: "00".repeat(32),
  pubkey: REPORTER,
  kind: REPORT_KIND,
  created_at: 1000,
  tags: [],
  content: "",
  ...parts,
});

describe("isRelayHint", () => {
  it("detects relay URLs", () => {
    expect(isRelayHint("wss://relay.example")).toBe(true);
    expect(isRelayHint("https://relay.example")).toBe(true);
  });

  it("does not treat a category as a relay", () => {
    expect(isRelayHint("spam")).toBe(false);
    expect(isRelayHint(undefined)).toBe(false);
  });
});

describe("normalizeCategory", () => {
  it("lowercases and trims", () => {
    expect(normalizeCategory("  SPAM ")).toBe("spam");
  });

  it("returns empty for non-strings", () => {
    expect(normalizeCategory(null)).toBe("");
  });
});

describe("extractReportType", () => {
  it("prefers an explicit report tag", () => {
    expect(extractReportType(event({ tags: [["report", "nudity"], ["t", "spam"]] }))).toBe("nudity");
  });

  it("accepts a type tag", () => {
    expect(extractReportType(event({ tags: [["type", "malware"]] }))).toBe("malware");
  });

  it("falls back to the matching target tag", () => {
    expect(extractReportType(event({ tags: [["e", EVENT_ID, "spam"]] }), EVENT_ID)).toBe("spam");
  });

  it("ignores a relay hint in the type position", () => {
    expect(extractReportType(event({ tags: [["e", EVENT_ID, "wss://relay.example"]] }), EVENT_ID)).toBe(
      "",
    );
  });

  it("falls back to a t hashtag", () => {
    expect(extractReportType(event({ tags: [["t", "impersonation"]] }))).toBe("impersonation");
  });

  it("returns empty when nothing names a type", () => {
    expect(extractReportType(event({ tags: [["e", EVENT_ID]] }), EVENT_ID)).toBe("");
  });
});

describe("decodeReport", () => {
  it("decodes an event report", () => {
    const [report] = decodeReport(event({ tags: [["e", EVENT_ID, "spam"]] }));
    expect(report).toEqual({
      reporter: REPORTER,
      target: { type: "event", id: EVENT_ID },
      category: "spam",
      createdAt: 1000,
    });
  });

  it("decodes a user report", () => {
    const [report] = decodeReport(event({ tags: [["p", CREATOR, "impersonation"]] }));
    expect(report.target).toEqual({ type: "user", pubkey: CREATOR });
  });

  it("prefers the event target when both are present", () => {
    const reports = decodeReport(
      event({ tags: [["report", "spam"], ["e", EVENT_ID], ["p", CREATOR]] }),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].target.type).toBe("event");
  });

  it("decodes multiple event targets", () => {
    const other = "2c".repeat(32);
    const reports = decodeReport(
      event({ tags: [["report", "spam"], ["e", EVENT_ID], ["e", other]] }),
    );
    expect(reports).toHaveLength(2);
  });

  it("rejects the wrong kind", () => {
    expect(decodeReport(event({ kind: 1 }))).toEqual([]);
  });

  it("skips a report with no resolvable category", () => {
    expect(decodeReport(event({ tags: [["e", EVENT_ID]] }))).toEqual([]);
  });

  it("skips malformed target identifiers", () => {
    expect(decodeReport(event({ tags: [["report", "spam"], ["e", "short"]] }))).toEqual([]);
  });

  it("rejects a malformed reporter", () => {
    expect(decodeReport(event({ pubkey: "nope", tags: [["e", EVENT_ID, "spam"]] }))).toEqual([]);
  });
});

describe("encodeReport", () => {
  it("encodes an event report round-trip", () => {
    const template = encodeReport({ type: "event", id: EVENT_ID, author: CREATOR }, "spam");
    const [decoded] = decodeReport(event(template));
    expect(decoded.category).toBe("spam");
    expect(decoded.target).toEqual({ type: "event", id: EVENT_ID });
  });

  it("includes the author as a p tag for event reports", () => {
    const template = encodeReport({ type: "event", id: EVENT_ID, author: CREATOR }, "spam");
    expect(template.tags).toContainEqual(["p", CREATOR]);
  });

  it("encodes a user report", () => {
    const template = encodeReport({ type: "user", pubkey: CREATOR }, "impersonation");
    expect(template.tags).toContainEqual(["p", CREATOR, "impersonation"]);
  });

  it("encodes an address report", () => {
    const template = encodeReport(
      { type: "address", kind: "30078", pubkey: CREATOR, identifier: "sku" },
      "scam",
    );
    expect(template.tags).toContainEqual(["a", `30078:${CREATOR}:sku`, "scam"]);
  });

  it("rejects an empty category", () => {
    expect(() => encodeReport({ type: "user", pubkey: CREATOR }, "  ")).toThrow(/non-empty/);
  });
});
