#!/usr/bin/env node
// Build the scoped-list vectors: vectors/governance-lists/scoped-lists.json.
//
//   node scripts/build-list-vectors.mjs          write the file
//   node scripts/build-list-vectors.mjs --check  exit 1 if the file is stale
//
// The vectors are the agreement between implementations (docs/governance-lists.md):
// a second reader, such as the NSWP kit's, is held to them, not to BitGate's
// code. Every event is really signed, deterministically (BIP-340 with all-zero
// auxiliary randomness), so the file is byte-identical on every run.
//
// The secret keys below are the numbers 1, 2 and 3. They are public test keys,
// known to everyone; nothing real is ever signed with them.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { schnorr } from "@noble/curves/secp256k1";

import { computeEventId } from "../packages/verify/src/index.js";
import { MAX_SCOPED_LIST_ENTRIES } from "../packages/nostr/src/scopedLists.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VECTORS_PATH = join(ROOT, "vectors", "governance-lists", "scoped-lists.json");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const secret = (n) => n.toString(16).padStart(64, "0");
const AUX = new Uint8Array(32);

const OWNER_SK = secret(1);
const IMPOSTOR_SK = secret(2);
const OWNER = hex(schnorr.getPublicKey(OWNER_SK));
const IMPOSTOR = hex(schnorr.getPublicKey(IMPOSTOR_SK));

// Guests need no secret keys: they are only named in lists.
const guest = (n) => `${n.toString(16).padStart(2, "0")}ab`.repeat(16);
const ALICE = guest(1);
const BOB = guest(2);
const CAROL = guest(3);

const NAMESPACE = "nswp";
const HOME = `37300:${OWNER}:home`;
const CREATED_AT = 1_763_700_000;

function sign(template, sk = OWNER_SK) {
  const event = {
    pubkey: hex(schnorr.getPublicKey(sk)),
    created_at: template.created_at ?? CREATED_AT,
    kind: template.kind ?? 30078,
    tags: template.tags,
    content: template.content ?? "",
  };
  const id = computeEventId(event);
  return { id, ...event, sig: hex(schnorr.sign(id, sk, AUX)) };
}

/**
 * The tags of a well-formed list, with named tags dropped or extra ones added.
 * @param {{ scope?: string, subject?: string, d?: string, entries?: string[], extra?: string[][], drop?: string[] }} [options]
 * @returns {string[][]}
 */
function listTags({ scope = "user-allow", subject = HOME, d, entries = [], extra = [], drop = [] } = {}) {
  const tags = [
    ["d", d ?? `${NAMESPACE}:governance:${scope}:v1:${subject}`],
    ["v", "1"],
    ["scope", scope],
    ["subject", subject],
    ["client", "bitgate"],
  ].filter((tag) => !drop.includes(tag[0]));
  return [...tags, ...extra, ...entries.map((pubkey) => ["p", pubkey])];
}

const many = (count) => Array.from({ length: count }, (_, i) => (i + 1).toString(16).padStart(64, "0"));

function ok(scope, subject, entries, skipped = 0) {
  return { ok: true, scope, subject, signer: subject.split(":")[1], entries: [...new Set(entries)].sort(), skipped };
}
const refused = (reason) => ({ ok: false, reason });

export function buildVectors() {
  const decode = [];
  const add = (name, note, event, expect) => decode.push({ name, note, event, expect });

  // ---- Read ----
  add("allow-list", "An owner's guest list for one world.",
    sign({ tags: listTags({ entries: [BOB, ALICE] }) }), ok("user-allow", HOME, [ALICE, BOB]));
  add("block-list", "An owner's block list for the same world: a separate event.",
    sign({ tags: listTags({ scope: "user-deny", entries: [CAROL] }) }), ok("user-deny", HOME, [CAROL]));
  add("empty-list", "No entries is a list that names nobody, not an unreadable one.",
    sign({ tags: listTags({}) }), ok("user-allow", HOME, []));
  const odd = `37300:${OWNER}:home:garden/🌱 café`;
  add("identifier-with-colons-and-unicode",
    "A world's d may contain colons and any printable text; only the first two colons of the coordinate separate fields.",
    sign({ tags: listTags({ subject: odd, entries: [ALICE] }) }), ok("user-allow", odd, [ALICE]));
  add("other-kinds-of-subject", "The subject may be any addressable thing, not only kind 37300.",
    sign({ tags: listTags({ subject: `30078:${OWNER}:sku-1`, entries: [ALICE] }) }), ok("user-allow", `30078:${OWNER}:sku-1`, [ALICE]));
  add("malformed-entries-skipped",
    "A p tag whose value is not 64 lowercase hex is skipped and counted; the rest of the list stands.",
    sign({ tags: listTags({ entries: [ALICE, ALICE.toUpperCase(), "npub1notonthewire", "abc"] }) }),
    ok("user-allow", HOME, [ALICE], 3));
  add("duplicates-collapsed", "The same key twice is one entry.",
    sign({ tags: listTags({ entries: [ALICE, ALICE, BOB] }) }), ok("user-allow", HOME, [ALICE, BOB]));
  add("unknown-tags-ignored", "Tags outside the format are ignored, including p tags' extra fields.",
    sign({ tags: [...listTags({}), ["p", ALICE, "wss://relay.example", "alice"], ["t", "home"]] }),
    ok("user-allow", HOME, [ALICE]));
  add("exactly-the-cap", `${MAX_SCOPED_LIST_ENTRIES} entries is allowed.`,
    sign({ tags: listTags({ entries: many(MAX_SCOPED_LIST_ENTRIES) }) }),
    // The expectation gives the count, not 2,000 keys again; the keys are the event's own p tags.
    (({ entries, ...rest }) => ({ ...rest, entryCount: MAX_SCOPED_LIST_ENTRIES }))(ok("user-allow", HOME, [])));

  // ---- Refused ----
  add("unsigned", "An event without a signature is not an event.",
    (({ sig, ...rest }) => rest)(sign({ tags: listTags({ entries: [ALICE] }) })), refused("not_an_event"));
  add("wrong-kind", "Only kind 30078.",
    sign({ kind: 30000, tags: listTags({ entries: [ALICE] }) }), refused("wrong_kind"));
  add("application-wide-d", "An application-wide list's d has no subject; a scoped reader refuses it.",
    sign({ tags: listTags({ d: `${NAMESPACE}:governance:user-allow:v1`, entries: [ALICE] }) }), refused("bad_d"));
  add("two-d-tags", "Exactly one d.",
    sign({ tags: [...listTags({ entries: [ALICE] }), ["d", "another"]] }), refused("bad_d"));
  add("uppercase-namespace", "Namespaces are lowercase [a-z0-9._-], 1 to 64 characters, starting alphanumeric.",
    sign({ tags: listTags({ d: `NSWP:governance:user-allow:v1:${HOME}`, entries: [ALICE] }) }), refused("bad_d"));
  add("version-2", "Only v1 exists; a newer version is refused, never read as v1.",
    sign({ tags: [["d", `${NAMESPACE}:governance:user-allow:v2:${HOME}`], ["v", "2"], ["scope", "user-allow"], ["subject", HOME], ["p", ALICE]] }),
    refused("unsupported_version"));
  add("event-scope", "Only user-allow and user-deny.",
    sign({ tags: listTags({ scope: "event-deny", entries: [ALICE] }) }), refused("unsupported_scope"));
  add("kind-with-leading-zero", "The kind is decimal without leading zeros.",
    sign({ tags: listTags({ subject: `037300:${OWNER}:home`, entries: [ALICE] }) }), refused("bad_subject"));
  add("kind-too-large", "A kind is at most 65535.",
    sign({ tags: listTags({ subject: `70000:${OWNER}:home`, entries: [ALICE] }) }), refused("bad_subject"));
  add("uppercase-subject-pubkey", "The subject's pubkey is lowercase hex.",
    sign({ tags: listTags({ subject: `37300:${OWNER.toUpperCase()}:home`, entries: [ALICE] }) }), refused("bad_subject"));
  add("control-character-in-identifier", "No control characters in the subject's identifier.",
    sign({ tags: listTags({ subject: `37300:${OWNER}:home\nbase`, entries: [ALICE] }) }), refused("bad_subject"));
  add("identifier-too-long", "The subject's identifier is at most 512 bytes of UTF-8.",
    sign({ tags: listTags({ subject: `37300:${OWNER}:${"é".repeat(257)}`, entries: [ALICE] }) }), refused("bad_subject"));
  add("empty-identifier", "The subject's identifier is not empty.",
    sign({ tags: listTags({ subject: `37300:${OWNER}:`, entries: [ALICE] }) }), refused("bad_subject"));
  add("subject-tag-differs", "The subject tag must equal the coordinate in d exactly.",
    sign({ tags: [...listTags({ drop: ["subject"], entries: [ALICE] }), ["subject", `37300:${OWNER}:other`]] }), refused("tag_mismatch"));
  add("scope-tag-missing", "The scope tag is required and must equal the scope in d.",
    sign({ tags: listTags({ drop: ["scope"], entries: [ALICE] }) }), refused("tag_mismatch"));
  add("scope-tag-differs", "A d saying allow with a scope tag saying deny is refused, not read either way.",
    sign({ tags: [...listTags({ drop: ["scope"], entries: [ALICE] }), ["scope", "user-deny"]] }), refused("tag_mismatch"));
  add("version-tag-missing", "The v tag is required.",
    sign({ tags: listTags({ drop: ["v"], entries: [ALICE] }) }), refused("tag_mismatch"));
  add("two-scope-tags", "Exactly one of each of v, scope and subject.",
    sign({ tags: [...listTags({ entries: [ALICE] }), ["scope", "user-allow"]] }), refused("tag_mismatch"));
  add("signed-by-someone-else", "Only the subject's own pubkey may sign its lists.",
    sign({ tags: listTags({ entries: [IMPOSTOR] }) }, IMPOSTOR_SK), refused("wrong_signer"));
  add("content-not-empty", "v1 content is empty. Hidden entries would be a new version, never read by a v1 reader.",
    sign({ content: "encrypted-looking", tags: listTags({ entries: [ALICE] }) }), refused("content_not_empty"));
  add("over-the-cap", `More than ${MAX_SCOPED_LIST_ENTRIES} p tags refuses the event; the first ${MAX_SCOPED_LIST_ENTRIES} are not read.`,
    sign({ tags: listTags({ entries: many(MAX_SCOPED_LIST_ENTRIES + 1) }) }), refused("too_many_entries"));
  const tampered = sign({ tags: listTags({ entries: [ALICE] }) });
  tampered.tags = [...tampered.tags, ["p", BOB]];
  add("tampered-after-signing", "An entry added after signing: the id no longer matches.", tampered, refused("bad_signature"));
  const borrowed = sign({ tags: listTags({ entries: [ALICE] }) });
  borrowed.sig = sign({ tags: listTags({ entries: [BOB] }) }).sig;
  add("signature-from-another-event", "A real signature over a different id.", borrowed, refused("bad_signature"));

  // ---- Choosing the current list from what relays returned ----
  const query = { namespace: NAMESPACE, scope: "user-allow", subject: HOME };
  const older = sign({ created_at: CREATED_AT, tags: listTags({ entries: [ALICE] }) });
  const newer = sign({ created_at: CREATED_AT + 100, tags: listTags({ entries: [BOB] }) });
  const tieA = sign({ created_at: CREATED_AT + 200, tags: listTags({ entries: [ALICE] }) });
  const tieB = sign({ created_at: CREATED_AT + 200, tags: listTags({ entries: [BOB] }) });
  const [tieWinner] = [tieA, tieB].sort((a, b) => (a.id < b.id ? -1 : 1));
  const forgedNewer = { ...sign({ created_at: CREATED_AT + 500, tags: listTags({ entries: [CAROL] }) }) };
  forgedNewer.sig = older.sig;
  const refusedNewest = sign({ created_at: CREATED_AT + 300, content: "x", tags: listTags({ entries: [CAROL] }) });
  const impostorNewer = sign({ created_at: CREATED_AT + 400, tags: listTags({ entries: [IMPOSTOR] }) }, IMPOSTOR_SK);
  const otherWorld = sign({ created_at: CREATED_AT + 400, tags: listTags({ subject: `37300:${OWNER}:other`, entries: [CAROL] }) });

  const resolve = [
    { name: "newest-wins", note: "The newest valid copy is the list.",
      query, events: [older, newer], expect: ok("user-allow", HOME, [BOB]) },
    { name: "tie-goes-to-smallest-id", note: "Same created_at: the lexicographically smallest id wins.",
      query, events: [tieA, tieB], expect: ok("user-allow", HOME, tieWinner === tieA ? [ALICE] : [BOB]) },
    { name: "forged-newer-is-not-a-candidate",
      note: "A newer event under the owner's key without the owner's signature cannot replace the list.",
      query, events: [older, forgedNewer], expect: ok("user-allow", HOME, [ALICE]) },
    { name: "impostor-is-not-a-candidate", note: "Someone else's list for the owner's world is not a candidate.",
      query, events: [older, impostorNewer], expect: ok("user-allow", HOME, [ALICE]) },
    { name: "refused-newest-is-unreadable",
      note: "If the owner's newest copy is refused, the list is unreadable; an older copy is not used instead.",
      query, events: [older, refusedNewest], expect: refused("content_not_empty") },
    { name: "other-world-not-found", note: "A list for another world does not answer for this one.",
      query, events: [otherWorld], expect: refused("not_found") },
    { name: "nothing-returned", note: "No events: not found. A reader says so; it is not an empty list.",
      query, events: [], expect: refused("not_found") },
  ];

  return {
    description:
      "Scoped allow and block lists (docs/governance-lists.md). Each `decode` case is one event and what a reader must make of it; each `resolve` case is what relays returned and which list is current. Secret keys 1 and 2 are public test keys.",
    format: "bitgate-scoped-lists-vectors/1",
    keys: { owner: OWNER, impostor: IMPOSTOR, guests: { alice: ALICE, bob: BOB, carol: CAROL } },
    decode,
    resolve,
  };
}

/** JSON with two-space indentation, except that an array of strings (a tag) stays on one line. */
function pretty(value, indent = "") {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return JSON.stringify(value);
    }
    if (value.length === 0) {
      return "[]";
    }
    const inner = indent + "  ";
    return `[\n${value.map((item) => inner + pretty(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "{}";
    }
    const inner = indent + "  ";
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function serializeVectors(vectors = buildVectors()) {
  return `${pretty(vectors)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serializeVectors();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(VECTORS_PATH, "utf8");
    } catch {}
    if (current !== text) {
      console.error(`✗ ${VECTORS_PATH} is stale: run node scripts/build-list-vectors.mjs`);
      process.exit(1);
    }
    console.log("✓ scoped-list vectors are current");
  } else {
    writeFileSync(VECTORS_PATH, text);
    console.log(`✓ wrote ${VECTORS_PATH}`);
  }
}
