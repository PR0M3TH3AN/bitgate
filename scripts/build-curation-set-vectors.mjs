#!/usr/bin/env node
// Build vectors/governance-lists/curation-sets.json: NIP-51 curation sets
// (kind 30004, NSWP-08) read as governance input.
//
//   node scripts/build-curation-set-vectors.mjs          write the file
//   node scripts/build-curation-set-vectors.mjs --check  exit 1 if it is stale
//
// NSWP's own vectors (vectors/nswp/lists.json) pin the structure. These pin
// what BitGate adds: the required signature check, and choosing the current
// copy by its curator's key. Built from NSWP-08's shape, never from a live
// list. Events are really signed, deterministically (BIP-340, zero
// auxiliary randomness), with secret keys 1, 2 and 3: public test keys.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { schnorr } from "@noble/curves/secp256k1";

import { computeEventId } from "../packages/verify/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CURATION_VECTORS_PATH = join(ROOT, "vectors", "governance-lists", "curation-sets.json");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const secret = (n) => n.toString(16).padStart(64, "0");
const AUX = new Uint8Array(32);
const HOST_SK = secret(1);
const OTHER_SK = secret(2);
const MAKER_SK = secret(3);
const HOST = hex(schnorr.getPublicKey(HOST_SK));
const OTHER = hex(schnorr.getPublicKey(OTHER_SK));
const MAKER = hex(schnorr.getPublicKey(MAKER_SK));
const CREATED_AT = 1_763_700_000;

const world = (name, pubkey = MAKER) => `37300:${pubkey}:${name}`;
const GROVE = world("grove");
const MUSEUM = world("example museum");
const ARCADE = world("arcade:night", OTHER);

/**
 * @param {{ d?: string, title?: string, entries?: string[], extra?: string[][], created_at?: number, content?: string }} list
 * @param {string} [sk]
 */
function sign({ d = "bitportal", title, entries = [], extra = [], created_at = CREATED_AT, content = "" }, sk = HOST_SK) {
  const tags = [["d", d], ...(title ? [["title", title]] : []), ...entries.map((c) => ["a", c]), ...extra];
  const event = { pubkey: hex(schnorr.getPublicKey(sk)), created_at, kind: 30004, tags, content };
  const id = computeEventId(event);
  return { id, ...event, sig: hex(schnorr.sign(id, sk, AUX)) };
}

const ok = (list) => ({ ok: true, ...list });
const refused = (reason, errors) => ({ ok: false, reason, ...(errors ? { errors } : {}) });

export function buildCurationVectors() {
  const read = [];
  const add = (name, note, event, expect) => read.push({ name, note, event, expect });

  add("host-allow-list", "A host's list under d=bitportal: its worlds, in order. Anything that is not a world is passed over.",
    sign({ title: "Shown here", entries: [GROVE, MUSEUM, `30023:${MAKER}:an-article`, ARCADE], extra: [["e", "00".repeat(32)]] }),
    ok({ curator: HOST, d: "bitportal", title: "Shown here", worlds: [GROVE, MUSEUM, ARCADE], warnings: [] }));
  add("starter-set", "A curator's starter set: any d. Without a title the title is the d.",
    sign({ d: "bitportal-starter", entries: [MUSEUM] }),
    ok({ curator: HOST, d: "bitportal-starter", title: "bitportal-starter", worlds: [MUSEUM], warnings: [] }));
  add("empty-list", "A list with no worlds is still a list: as an allowlist it shows nothing.",
    sign({}), ok({ curator: HOST, d: "bitportal", title: "bitportal", worlds: [], warnings: [] }));
  add("leading-zero-kind", "NSWP reads the kind as a number, so 037300 is a world, written back as 37300.",
    sign({ entries: [`037300:${MAKER}:grove`] }), ok({ curator: HOST, d: "bitportal", title: "bitportal", worlds: [GROVE], warnings: [] }));
  const unsigned = (({ sig, ...rest }) => rest)(sign({ entries: [GROVE] }));
  add("unsigned", "Governance needs a signature: an unsigned list is not read.", unsigned, refused("invalid", ["not_signed"]));
  const tampered = sign({ entries: [GROVE] });
  tampered.tags = [...tampered.tags, ["a", ARCADE]];
  add("tampered", "A world added after signing.", tampered, refused("bad_signature"));
  add("d-too-long", "A d over 128 characters is an error, as in NSWP.",
    sign({ d: "x".repeat(129), entries: [GROVE] }), refused("invalid", ["value_too_long"]));
  add("wrong-kind", "Only kind 30004.", { ...sign({ entries: [GROVE] }), kind: 30000 }, refused("invalid", ["wrong_kind"]));

  const query = { pubkey: HOST, d: "bitportal" };
  const older = sign({ entries: [GROVE] });
  const newer = sign({ created_at: CREATED_AT + 60, entries: [GROVE, MUSEUM] });
  const otherCurator = sign({ created_at: CREATED_AT + 120, entries: [ARCADE] }, OTHER_SK);
  const forged = { ...sign({ created_at: CREATED_AT + 180, entries: [ARCADE] }), sig: older.sig };
  const otherList = sign({ d: "bitportal-starter", created_at: CREATED_AT + 240, entries: [ARCADE] });
  const twoDs = sign({ created_at: CREATED_AT + 300, entries: [ARCADE], extra: [["d", "another"]] });
  const resolve = [
    { name: "newest-copy-from-the-same-key", note: "A newer copy replaces an older one when the same key signed it.",
      query, events: [older, newer], expect: ok({ curator: HOST, d: "bitportal", title: "bitportal", worlds: [GROVE, MUSEUM], warnings: [] }) },
    { name: "another-key-is-not-a-candidate", note: "The coordinate fixes the key: another curator's list under the same d is not this list.",
      query, events: [older, otherCurator], expect: ok({ curator: HOST, d: "bitportal", title: "bitportal", worlds: [GROVE], warnings: [] }) },
    { name: "forged-newer-is-not-a-candidate", note: "A newer copy under the host's key without the host's signature changes nothing.",
      query, events: [older, forged], expect: ok({ curator: HOST, d: "bitportal", title: "bitportal", worlds: [GROVE], warnings: [] }) },
    { name: "two-d-tags-is-not-a-candidate", note: "A copy must carry exactly one d, equal to the list's; a newer copy with two is passed over.",
      query, events: [older, twoDs], expect: ok({ curator: HOST, d: "bitportal", title: "bitportal", worlds: [GROVE], warnings: [] }) },
    { name: "another-d-is-not-found", note: "The host's other list does not answer for this one.",
      query, events: [otherList], expect: refused("not_found") },
  ];

  return {
    description:
      "NIP-51 curation sets (kind 30004, NSWP-08) read as governance input (docs/governance-lists.md). `read` cases are one event; `resolve` cases are what relays returned for a list's coordinate. Structure is pinned by NSWP's own vectors in vectors/nswp/lists.json. Secret keys 1, 2 and 3 are public test keys.",
    format: "bitgate-curation-set-vectors/1",
    keys: { host: HOST, otherCurator: OTHER, maker: MAKER },
    read,
    resolve,
  };
}

/** JSON with two-space indentation; arrays of strings (tags) stay on one line. */
function pretty(value, indent = "") {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return JSON.stringify(value);
    if (value.length === 0) return "[]";
    const inner = indent + "  ";
    return `[\n${value.map((item) => inner + pretty(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const inner = indent + "  ";
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function serializeCurationVectors(vectors = buildCurationVectors()) {
  return `${pretty(vectors)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serializeCurationVectors();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(CURATION_VECTORS_PATH, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`✗ ${CURATION_VECTORS_PATH} is stale: run node scripts/build-curation-set-vectors.mjs`);
      process.exit(1);
    }
    console.log("✓ curation-set vectors are current");
  } else {
    writeFileSync(CURATION_VECTORS_PATH, text);
    console.log(`✓ wrote ${CURATION_VECTORS_PATH}`);
  }
}
