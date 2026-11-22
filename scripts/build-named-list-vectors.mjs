#!/usr/bin/env node
// Build vectors/governance-lists/named-lists.json: the named-lists vocabulary
// (packages/nostr/src/namedLists.js, docs/governance-lists.md).
//
//   node scripts/build-named-list-vectors.mjs          write the file
//   node scripts/build-named-list-vectors.mjs --check  exit 1 if it is stale
//
// One curator, authorized by the root's role document, keeps several lists;
// each decision reads the lists the vocabulary names for it. The vectors give
// every event, what a reader makes of each, and the answer to each question.
// Events are really signed, deterministically, with secret keys 1, 2 and 3:
// public test keys.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { schnorr } from "@noble/curves/secp256k1";

import { computeEventId } from "../packages/verify/src/index.js";
import { encodeRoles } from "../packages/nostr/src/canonical.js";
import { encodeNamedList } from "../packages/nostr/src/namedLists.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const NAMED_VECTORS_PATH = join(ROOT_DIR, "vectors", "governance-lists", "named-lists.json");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const secret = (n) => n.toString(16).padStart(64, "0");
const AUX = new Uint8Array(32);
const ROOT_SK = secret(1);
const CURATOR_SK = secret(2);
const STRANGER_SK = secret(3);
const ROOT = hex(schnorr.getPublicKey(ROOT_SK));
const CURATOR = hex(schnorr.getPublicKey(CURATOR_SK));
const STRANGER = hex(schnorr.getPublicKey(STRANGER_SK));
const person = (n) => `${n.toString(16).padStart(2, "0")}cd`.repeat(16);
const ALICE = person(1);
const BOB = person(2);
const CAROL = person(3);
const DAVE = person(4);
const listing = (/** @type {string} */ seller, /** @type {string} */ name) => `30078:${seller}:${name}`;
/** A template with tags added as written, valid or not. */
const withRawTags = (/** @type {{ kind: number, content: string, tags: string[][] }} */ template, /** @type {string[][]} */ tags) => ({
  ...template,
  tags: [...template.tags, ...tags],
});
const CREATED_AT = 1_763_700_000;

function sign(template, sk, createdAt = CREATED_AT) {
  const event = { pubkey: hex(schnorr.getPublicKey(sk)), created_at: createdAt, kind: template.kind, tags: template.tags, content: template.content };
  const id = computeEventId(event);
  return { id, ...event, sig: hex(schnorr.sign(id, sk, AUX)) };
}
/** @returns {import('../packages/core/src/identifiers.js').GovernanceTarget[]} */
const users = (/** @type {string[]} */ ...keys) => keys.map((pubkey) => ({ type: /** @type {const} */ ("user"), pubkey }));
/** @returns {import('../packages/core/src/identifiers.js').GovernanceTarget} */
const address = (/** @type {string} */ coordinate) => {
  const [kind, pubkey, ...rest] = coordinate.split(":");
  return { type: "address", kind, pubkey, identifier: rest.join(":") };
};

export function buildNamedVectors() {
  const events = {
    roles: sign(encodeRoles({ actors: { [CURATOR]: ["list-curator"] } }, "bitunlock"), ROOT_SK),
    sellers: sign(encodeNamedList("sellers", users(ALICE, BOB)), CURATOR_SK),
    // An older genuine copy of the same list, since replaced: it no longer counts.
    sellersReplaced: sign(encodeNamedList("sellers", users(ALICE, DAVE)), CURATOR_SK, CREATED_AT - 60),
    payees: sign(encodeNamedList("payees", users(ALICE, CAROL)), CURATOR_SK),
    peopleBlocked: sign(encodeNamedList("people-blocked", users(BOB)), CURATOR_SK),
    listingsAllowed: sign(encodeNamedList("listings-allowed", [address(listing(ALICE, "song-1"))]), CURATOR_SK),
    listingsBlocked: sign(withRawTags(encodeNamedList("listings-blocked", [address(listing(ALICE, "song-2"))]), [
      // Kept: BitUnlock's rule allows colons after the first character, and spaces.
      ["a", listing(ALICE, "song:remix")],
      ["a", listing(ALICE, "my song ")],
      ["a", listing(ALICE, "x".repeat(256))],
      // Skipped, each counted: a leading colon, 257 characters, two lines,
      // another kind, an uppercase key.
      ["a", listing(ALICE, ":song")],
      ["a", listing(ALICE, "x".repeat(257))],
      ["a", listing(ALICE, "two\nlines")],
      ["a", `30023:${ALICE}:an-article`],
      ["a", listing(ALICE.toUpperCase(), "song-9")],
    ]), CURATOR_SK),
    strangerSellers: sign(encodeNamedList("sellers", users(DAVE)), STRANGER_SK),
    notNamed: sign({ kind: 30078, content: "", tags: [["d", "bitunlock:governance:user-allow:v1"], ["p", DAVE]] }, CURATOR_SK),
  };
  // Relays can return anything; a reader drops what fails its signature check.
  events.tamperedPayees = { ...events.payees, created_at: CREATED_AT + 60, tags: [...events.payees.tags, ["p", DAVE]] };

  const read = [
    { name: "sellers", event: "sellers", expect: { ok: true, list: "sellers", scope: "user-allow", entries: [ALICE, BOB].sort() } },
    { name: "payees", event: "payees", expect: { ok: true, list: "payees", scope: "user-allow", entries: [ALICE, CAROL].sort() } },
    { name: "people-blocked", event: "peopleBlocked", expect: { ok: true, list: "people-blocked", scope: "user-deny", entries: [BOB] } },
    { name: "listings-allowed", event: "listingsAllowed", expect: { ok: true, list: "listings-allowed", scope: "address-allow", entries: [listing(ALICE, "song-1")] } },
    { name: "listings-blocked", note: "Entries are read by BitUnlock's listing rule exactly; anything else is skipped and counted.",
      event: "listingsBlocked", expect: { ok: true, list: "listings-blocked", scope: "address-deny",
        entries: [listing(ALICE, "song-2"), listing(ALICE, "song:remix"), listing(ALICE, "my song "), listing(ALICE, "x".repeat(256))].sort(), skipped: 5 } },
    { name: "a-stranger-can-publish-a-named-list", note: "It reads; it just counts for nothing without the capability (see decisions).",
      event: "strangerSellers", expect: { ok: true, list: "sellers", scope: "user-allow", entries: [DAVE] } },
    { name: "not-in-the-vocabulary", note: "An application-wide list whose d is not a named list's.",
      event: "notNamed", expect: { ok: false, reason: "not_a_named_list" } },
  ];
  for (const testCase of read) {
    if (testCase.expect.ok && !("skipped" in testCase.expect)) /** @type {any} */ (testCase.expect).skipped = 0;
  }
  read.push({ name: "a-replaced-copy-still-reads", note: "Read on its own it is a valid list; choosing among copies (decisions) is what retires it.",
    event: "sellersReplaced", expect: { ok: true, list: "sellers", scope: "user-allow", entries: [ALICE, DAVE].sort(), skipped: 0 } });
  read.push({ name: "tampered", note: "A key added, and the date moved, after signing.", event: "tamperedPayees", expect: { ok: false, reason: "bad_signature" } });

  const ask = (decision, target, transaction, note) => ({ decision, target, expect: { transaction }, ...(note ? { note } : {}) });
  const decisions = [
    ask("may-sell", ALICE, "allow"),
    ask("may-sell", BOB, "deny", "On the sellers list and blocked: blocked wins."),
    ask("may-sell", CAROL, "deny", "Payable is not the same as able to sell."),
    ask("may-sell", DAVE, "deny", "Listed by a key with no capability, and in a copy of the curator's list that has since been replaced."),
    ask("may-sell", ROOT, "allow", "The root is never gated."),
    ask("may-be-paid", ALICE, "allow"),
    ask("may-be-paid", CAROL, "allow"),
    ask("may-be-paid", BOB, "deny", "Blocked, and not on the payees list."),
    ask("may-be-paid", DAVE, "deny", "Named only in a copy that fails its signature check."),
    ask("may-sell-listing", listing(ALICE, "song-1"), "allow"),
    ask("may-sell-listing", listing(ALICE, "song-2"), "deny", "On the blocked-listings list."),
    ask("may-sell-listing", listing(BOB, "song-3"), "deny", "Its seller is blocked."),
    ask("may-sell-listing", listing(CAROL, "song-4"), "allow", "Not curated: anything not blocked may be sold."),
    ask("may-sell-listing", listing(ALICE, "song:remix"), "deny", "A colon inside the name is part of the name."),
    ask("may-sell-listing", listing(ALICE, "my song "), "deny", "The name is compared exactly, trailing space included."),
    ask("may-sell-listing", listing(ALICE, "my song"), "allow", "A different listing: no trimming."),
    ask("may-sell-listing-curated", listing(ALICE, "song-1"), "allow"),
    ask("may-sell-listing-curated", listing(CAROL, "song-4"), "deny", "Curated: only listed listings."),
    ask("may-sell-listing-curated", listing(ALICE, "song-2"), "deny"),
  ];

  return {
    description:
      "The named-lists vocabulary (docs/governance-lists.md, \"Named lists\"). `events` are everything relays returned. A reader checks every signature FIRST, then keeps the newest passing copy per signer and d (a forged copy may keep the genuine id and claim to be newer), builds the authority from the root's role document (root = keys.root, roles from NAMED_LIST_ROLES), and answers each decision from the lists the vocabulary names for it; the answer is the transaction dimension. Secret keys 1, 2 and 3 are public test keys.",
    format: "bitgate-named-lists-vectors/1",
    keys: { root: ROOT, curator: CURATOR, stranger: STRANGER, people: { alice: ALICE, bob: BOB, carol: CAROL, dave: DAVE } },
    events,
    read,
    decisions,
  };
}

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

export function serializeNamedVectors(vectors = buildNamedVectors()) {
  return `${pretty(vectors)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serializeNamedVectors();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(NAMED_VECTORS_PATH, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`✗ ${NAMED_VECTORS_PATH} is stale: run node scripts/build-named-list-vectors.mjs`);
      process.exit(1);
    }
    console.log("✓ named-list vectors are current");
  } else {
    writeFileSync(NAMED_VECTORS_PATH, text);
    console.log(`✓ wrote ${NAMED_VECTORS_PATH}`);
  }
}
