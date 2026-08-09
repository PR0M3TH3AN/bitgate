// NIP-56 report codec.
//
// Reports name a target through `e` (event) or `p` (user) tags and carry a
// report type. The type may appear in several places depending on the client
// that published it, so resolution tries each in a fixed order.

import { normalizeEventIdInput, normalizePubkeyInput } from "./nip19.js";
import { getTags } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').GovernanceTarget} GovernanceTarget
 */

/** NIP-56 report kind. */
export const REPORT_KIND = 1984;

/**
 * Whether a value looks like a relay hint rather than a report type.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRelayHint(value) {
  if (typeof value !== "string") {
    return false;
  }
  const lower = value.trim().toLowerCase();
  return (
    lower.startsWith("wss://") ||
    lower.startsWith("ws://") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://")
  );
}

/**
 * Normalize a report category.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCategory(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

/**
 * Resolve the report type for an event.
 *
 * Order: an explicit `report`/`type` tag, then the third element of the
 * matching target tag, then a `t` hashtag. Relay hints occupy the same tag
 * position as the type in some clients, so they are excluded explicitly.
 *
 * @param {NostrEvent} event
 * @param {string} [targetValue] - The e/p value the type should describe
 * @returns {string}
 */
export function extractReportType(event, targetValue = "") {
  for (const tag of event.tags ?? []) {
    if (!Array.isArray(tag)) {
      continue;
    }
    if (tag[0] === "report" || tag[0] === "type") {
      const category = normalizeCategory(tag[1]);
      if (category) {
        return category;
      }
    }
  }

  if (targetValue) {
    for (const tag of event.tags ?? []) {
      if (!Array.isArray(tag) || (tag[0] !== "e" && tag[0] !== "p")) {
        continue;
      }
      if (tag[1] !== targetValue || isRelayHint(tag[2])) {
        continue;
      }
      const category = normalizeCategory(tag[2]);
      if (category) {
        return category;
      }
    }
  }

  for (const tag of getTags(event, "t")) {
    const category = normalizeCategory(tag[1]);
    if (category) {
      return category;
    }
  }

  return "";
}

/**
 * @typedef {Object} DecodedReport
 * @property {string} reporter
 * @property {GovernanceTarget} target
 * @property {string} category
 * @property {number} createdAt
 */

/**
 * Decode a NIP-56 report into zero or more report records.
 *
 * An event tag wins over a p tag when both are present: reporting a specific
 * note is more precise than reporting its author, and counting both would
 * double-count one reporter's single action.
 *
 * @param {NostrEvent} event
 * @returns {DecodedReport[]}
 */
export function decodeReport(event) {
  if (!event || event.kind !== REPORT_KIND) {
    return [];
  }

  const reporter = normalizePubkeyInput(event.pubkey);
  if (!reporter) {
    return [];
  }

  const createdAt = Number.isFinite(event.created_at) ? event.created_at : 0;

  /** @type {DecodedReport[]} */
  const reports = [];

  for (const tag of getTags(event, "e")) {
    const id = normalizeEventIdInput(tag[1]);
    if (!id) {
      continue;
    }
    const category = extractReportType(event, tag[1]);
    if (!category) {
      continue;
    }
    reports.push({ reporter, target: { type: "event", id }, category, createdAt });
  }

  if (reports.length > 0) {
    return reports;
  }

  for (const tag of getTags(event, "p")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    if (!pubkey) {
      continue;
    }
    const category = extractReportType(event, tag[1]);
    if (!category) {
      continue;
    }
    reports.push({ reporter, target: { type: "user", pubkey }, category, createdAt });
  }

  return reports;
}

/**
 * Encode a report as an unsigned NIP-56 event template.
 * @param {GovernanceTarget} target
 * @param {string} category
 * @param {string} [content]
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeReport(target, category, content = "") {
  const normalized = normalizeCategory(category);
  if (!normalized) {
    throw new Error("Report category must be a non-empty string");
  }

  /** @type {string[][]} */
  const tags = [["report", normalized]];

  if (target.type === "event") {
    tags.push(["e", target.id, normalized]);
    if (target.author) {
      tags.push(["p", target.author]);
    }
  } else if (target.type === "user") {
    tags.push(["p", target.pubkey, normalized]);
  } else {
    tags.push(["a", `${target.kind}:${target.pubkey}:${target.identifier}`, normalized]);
  }

  return { kind: REPORT_KIND, content, tags };
}
