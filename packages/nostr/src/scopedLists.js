// Scoped lists: an allow or block list about one addressable thing.
//
// The application-wide lists in canonical.js answer "who is allowed in this
// application". A scoped list answers "who is allowed in this one world" (or
// any other addressable thing), and it is signed by that thing's own author —
// no roster, no curator, no service. A world's owner keeps their own guest
// list and their own block list, and any reader checks them with nothing but
// the event and a signature check.
//
// The wire format is specified in docs/governance-lists.md and pinned by the
// vectors in vectors/governance-lists/. This file is the reference reader; a
// second implementation is held to the vectors, not to this code.
//
// Every rule here is strict on purpose. A scoped list gates entry to someone's
// space, so two readers that disagree about one event would let a person in on
// one client and keep them out on another. Anything outside the grammar is
// refused whole, with a stable reason code, rather than read in part.

import { createAuthorityState } from "@bitgate/core";

import { CANONICAL_KIND, isWireHex64 } from "./canonical.js";
import { getTags, selectLatest } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').Contribution} Contribution
 * @typedef {import('@bitgate/core').AddressTarget} AddressTarget
 */

/** The only version of the scoped-list format. */
export const SCOPED_LIST_VERSION = "1";

/** Scopes a scoped list may carry: who is allowed in, and who is kept out. */
export const SCOPED_LIST_SCOPES = Object.freeze(["user-allow", "user-deny"]);

/** Most `p` tags a scoped list may carry. One more and the event is refused. */
export const MAX_SCOPED_LIST_ENTRIES = 2000;

/** Most bytes (UTF-8) the subject's own identifier may take. */
export const MAX_SUBJECT_IDENTIFIER_BYTES = 512;

/** Stable refusal codes, in the order the checks run. */
export const SCOPED_LIST_REFUSALS = Object.freeze([
  "no_verifier",
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
  "from_the_future",
  "bad_signature",
]);

/**
 * How far ahead of the reader's clock a list may be dated, in seconds.
 *
 * The newest list wins and a reader never goes back to an older one, so a
 * list signed with a clock a year fast would otherwise pin itself in place
 * for a year. Ten minutes covers ordinary clock drift.
 */
export const MAX_FUTURE_SECONDS = 600;

const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KIND = /^(0|[1-9][0-9]{0,4})$/;

/**
 * UTF-8 length of a string, counted without TextEncoder so the codec needs no
 * host globals. Lone surrogates count as the three bytes their replacement
 * character would take.
 * @param {string} value
 * @returns {number}
 */
function utf8Length(value) {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Whether a string is acceptable as a subject's own identifier (its `d`).
 *
 * Any text a world's announcement may use is accepted, colons included, with
 * two exceptions: nothing empty or over {@link MAX_SUBJECT_IDENTIFIER_BYTES},
 * and no control characters (U+0000–U+001F, U+007F), which no relay or person
 * can be relied on to carry or show faithfully. No trimming and no Unicode
 * normalization: the identifier is compared exactly, as relays compare `d`.
 *
 * @param {unknown} identifier
 * @returns {identifier is string}
 */
export function isSubjectIdentifier(identifier) {
  if (typeof identifier !== "string" || identifier.length === 0) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(identifier)) {
    return false;
  }
  return utf8Length(identifier) <= MAX_SUBJECT_IDENTIFIER_BYTES;
}

/**
 * Parse a subject coordinate (`<kind>:<pubkey>:<identifier>`), strictly.
 *
 * Only the first two colons separate fields; the identifier is everything
 * after them and may itself contain colons.
 *
 * @param {unknown} coordinate
 * @returns {AddressTarget|null}
 */
export function parseSubjectCoordinate(coordinate) {
  if (typeof coordinate !== "string") {
    return null;
  }
  const first = coordinate.indexOf(":");
  const second = first < 0 ? -1 : coordinate.indexOf(":", first + 1);
  if (first < 1 || second < 0) {
    return null;
  }
  const kind = coordinate.slice(0, first);
  const pubkey = coordinate.slice(first + 1, second);
  const identifier = coordinate.slice(second + 1);
  if (!KIND.test(kind) || Number(kind) > 65535) {
    return null;
  }
  if (!isWireHex64(pubkey) || !isSubjectIdentifier(identifier)) {
    return null;
  }
  return { type: "address", kind, pubkey, identifier };
}

/**
 * Format a subject as its coordinate string.
 * @param {AddressTarget} subject
 * @returns {string}
 */
export function formatSubjectCoordinate(subject) {
  return `${subject.kind}:${subject.pubkey}:${subject.identifier}`;
}

/**
 * Build the `d` of a scoped list.
 *
 * `<namespace>:governance:<scope>:v1:<kind>:<pubkey>:<identifier>`. Readers
 * that only know application-wide lists reject this shape outright (their
 * grammar ends at `v<digits>`), so an old reader ignores a scoped list rather
 * than applying it to the whole application.
 *
 * @param {string} namespace - Lowercase `[a-z0-9._-]`, 1–64 characters, starting alphanumeric
 * @param {string} scope - One of {@link SCOPED_LIST_SCOPES}
 * @param {AddressTarget|string} subject - The thing the list is about
 * @returns {string}
 * @throws {TypeError} When any part is outside the grammar
 */
export function scopedListIdentifier(namespace, scope, subject) {
  if (!NAMESPACE.test(namespace)) {
    throw new TypeError(`Invalid scoped-list namespace: ${JSON.stringify(namespace)}`);
  }
  if (!SCOPED_LIST_SCOPES.includes(scope)) {
    throw new TypeError(`Invalid scoped-list scope: ${JSON.stringify(scope)}`);
  }
  const coordinate = typeof subject === "string" ? subject : formatSubjectCoordinate(subject);
  if (!parseSubjectCoordinate(coordinate)) {
    throw new TypeError(`Invalid scoped-list subject: ${JSON.stringify(coordinate)}`);
  }
  return `${namespace}:governance:${scope}:v${SCOPED_LIST_VERSION}:${coordinate}`;
}

/**
 * Parse the `d` of a scoped list.
 *
 * @param {unknown} identifier
 * @returns {{ ok: true, namespace: string, scope: string, version: string, coordinate: string, subject: AddressTarget }
 *   | { ok: false, reason: "bad_d" | "unsupported_version" | "unsupported_scope" | "bad_subject" }}
 */
export function parseScopedListIdentifier(identifier) {
  if (typeof identifier !== "string") {
    return { ok: false, reason: "bad_d" };
  }
  const match = /^([^:]*):governance:([^:]*):v([^:]*):([\s\S]*)$/.exec(identifier);
  if (!match || !NAMESPACE.test(match[1])) {
    return { ok: false, reason: "bad_d" };
  }
  const [, namespace, scope, version, coordinate] = match;
  if (version !== SCOPED_LIST_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }
  if (!SCOPED_LIST_SCOPES.includes(scope)) {
    return { ok: false, reason: "unsupported_scope" };
  }
  const subject = parseSubjectCoordinate(coordinate);
  if (!subject) {
    return { ok: false, reason: "bad_subject" };
  }
  return { ok: true, namespace, scope, version, coordinate, subject };
}

/**
 * Encode a scoped list as an unsigned event template.
 *
 * Entries are deduplicated and sorted, so the same list always produces the
 * same tags. Signing belongs to the subject's owner.
 *
 * @param {Object} list
 * @param {string} list.namespace
 * @param {"user-allow"|"user-deny"} list.scope
 * @param {AddressTarget|string} list.subject
 * @param {string[]} list.entries - Pubkeys, 64 lowercase hex characters each
 * @returns {{ kind: number, content: string, tags: string[][] }}
 * @throws {TypeError|RangeError} On an invalid part or too many entries
 */
export function encodeScopedList({ namespace, scope, subject, entries }) {
  const d = scopedListIdentifier(namespace, scope, subject);
  const coordinate = typeof subject === "string" ? subject : formatSubjectCoordinate(subject);
  const unique = Array.from(new Set(entries ?? []));
  for (const entry of unique) {
    if (!isWireHex64(entry)) {
      throw new TypeError(`Scoped-list entries must be 64 lowercase hex characters: ${JSON.stringify(entry)}`);
    }
  }
  if (unique.length > MAX_SCOPED_LIST_ENTRIES) {
    throw new RangeError(`A scoped list carries at most ${MAX_SCOPED_LIST_ENTRIES} entries, got ${unique.length}`);
  }
  unique.sort();
  return {
    kind: CANONICAL_KIND,
    content: "",
    tags: [
      ["d", d],
      ["v", SCOPED_LIST_VERSION],
      ["scope", scope],
      ["subject", coordinate],
      ["client", "bitgate"],
      ...unique.map((pubkey) => ["p", pubkey]),
    ],
  };
}

/**
 * The values of every tag with a given name.
 * @param {NostrEvent} event
 * @param {string} name
 * @returns {unknown[]}
 */
function tagValues(event, name) {
  return getTags(event, name).map((tag) => tag[1]);
}

/**
 * Whether a value has the shape of a signed Nostr event.
 * @param {any} event
 * @returns {boolean}
 */
function isEventShape(event) {
  return (
    !!event &&
    typeof event === "object" &&
    isWireHex64(event.id) &&
    isWireHex64(event.pubkey) &&
    typeof event.sig === "string" &&
    /^[0-9a-f]{128}$/.test(event.sig) &&
    Number.isInteger(event.kind) &&
    Number.isInteger(event.created_at) &&
    typeof event.content === "string" &&
    Array.isArray(event.tags) &&
    event.tags.every((tag) => Array.isArray(tag) && tag.length > 0 && tag.every((part) => typeof part === "string"))
  );
}

/**
 * @typedef {Object} ScopedList
 * @property {true} ok
 * @property {string} namespace
 * @property {"user-allow"|"user-deny"} scope
 * @property {AddressTarget} subject
 * @property {string} signer - One of the subject's root keys (by default the subject's own key)
 * @property {string} eventId
 * @property {number} createdAt
 * @property {string[]} entries - Distinct pubkeys, sorted
 * @property {number} skipped - `p` tags whose value was not 64 lowercase hex
 */

/**
 * @typedef {Object} ScopedListRefusal
 * @property {false} ok
 * @property {string} reason - One of {@link SCOPED_LIST_REFUSALS}, or "not_found" from {@link resolveScopedList}
 */

/** Most keys a reader may be given as a subject's root. */
export const MAX_ROOT_KEYS = 4;

/**
 * The keys a reader accepts as signers of a subject's lists: its root.
 *
 * By default the root is the subject's own key — the key that announced the
 * world. A reader may be given a root instead: one key, or up to
 * {@link MAX_ROOT_KEYS} (for a world announced by a deploy key, the keys its
 * manifest names, so the owner can change the list from their everyday key).
 * A given root replaces the default; it does not add to it. Where the root
 * comes from is the reader's decision, never the event's.
 *
 * @param {AddressTarget} subject
 * @param {string|string[]} [root]
 * @returns {string[]}
 * @throws {TypeError} When a given root is empty, too long, or not 64 lowercase hex
 */
function rootKeys(subject, root) {
  if (root === undefined) {
    return [subject.pubkey];
  }
  const keys = typeof root === "string" ? [root] : root;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_ROOT_KEYS || !keys.every(isWireHex64)) {
    throw new TypeError(
      `root must be one 64-character lowercase hex pubkey, or a list of 1 to ${MAX_ROOT_KEYS} of them`,
    );
  }
  return Array.from(new Set(keys));
}

/**
 * The reader's clock, in unix seconds.
 * @param {number} [now]
 * @returns {number}
 */
function clock(now) {
  if (now === undefined) {
    return Math.floor(Date.now() / 1000);
  }
  if (!Number.isInteger(now)) {
    throw new TypeError("now must be an integer number of unix seconds");
  }
  return now;
}

/**
 * Read one scoped-list event.
 *
 * Checks run in the order of {@link SCOPED_LIST_REFUSALS} and the first that
 * fails is the reason given. The signature is checked last, being the most
 * expensive, but nothing is returned as a list until it has passed.
 *
 * A malformed `p` tag (not 64 lowercase hex) is skipped and counted, so one
 * bad entry never discards the owner's whole list; everything else outside
 * the grammar refuses the event. The `client` tag, like every tag outside the
 * format, is ignored: what it says, or its absence, never refuses a list.
 *
 * @param {unknown} event
 * @param {Object} options
 * @param {(event: NostrEvent) => boolean} options.verify - NIP-01 id and
 *   signature check, e.g. `verifyEvent` from `@bitgate/verify`. Required:
 *   there is no unverified mode. Anything but `true` is a failed check.
 * @param {string|string[]} [options.root] - The subject's root: the key, or
 *   up to four keys, accepted as signers. Defaults to the subject's own key
 * @param {number} [options.now] - Reader's clock in unix seconds; defaults to
 *   the system clock. A list dated more than {@link MAX_FUTURE_SECONDS} ahead
 *   is refused.
 * @returns {ScopedList|ScopedListRefusal}
 */
export function decodeScopedList(event, { verify, root, now } = /** @type {any} */ ({})) {
  if (typeof verify !== "function") {
    return { ok: false, reason: "no_verifier" };
  }
  const at = clock(now);
  if (!isEventShape(event)) {
    return { ok: false, reason: "not_an_event" };
  }
  const e = /** @type {NostrEvent} */ (event);
  if (e.kind !== CANONICAL_KIND) {
    return { ok: false, reason: "wrong_kind" };
  }

  const ds = tagValues(e, "d");
  if (ds.length !== 1) {
    return { ok: false, reason: "bad_d" };
  }
  const parsed = parseScopedListIdentifier(ds[0]);
  if (!parsed.ok) {
    return parsed;
  }

  const versions = tagValues(e, "v");
  const scopes = tagValues(e, "scope");
  const subjects = tagValues(e, "subject");
  if (
    versions.length !== 1 ||
    versions[0] !== parsed.version ||
    scopes.length !== 1 ||
    scopes[0] !== parsed.scope ||
    subjects.length !== 1 ||
    subjects[0] !== parsed.coordinate
  ) {
    return { ok: false, reason: "tag_mismatch" };
  }

  if (!rootKeys(parsed.subject, root).includes(e.pubkey)) {
    return { ok: false, reason: "wrong_signer" };
  }
  if (e.content !== "") {
    return { ok: false, reason: "content_not_empty" };
  }

  const values = tagValues(e, "p");
  if (values.length > MAX_SCOPED_LIST_ENTRIES) {
    return { ok: false, reason: "too_many_entries" };
  }
  if (e.created_at > at + MAX_FUTURE_SECONDS) {
    return { ok: false, reason: "from_the_future" };
  }

  let verified = false;
  try {
    verified = verify(e) === true;
  } catch {
    verified = false;
  }
  if (!verified) {
    return { ok: false, reason: "bad_signature" };
  }

  const entries = new Set();
  let skipped = 0;
  for (const value of values) {
    if (isWireHex64(value)) {
      entries.add(value);
    } else {
      skipped += 1;
    }
  }

  return {
    ok: true,
    namespace: parsed.namespace,
    scope: /** @type {"user-allow"|"user-deny"} */ (parsed.scope),
    subject: parsed.subject,
    signer: e.pubkey,
    eventId: e.id,
    createdAt: e.created_at,
    entries: Array.from(entries).sort(),
    skipped,
  };
}

/**
 * @typedef {Object} ResolvedNote
 * @property {string[]} futureDated - Ids of events that would have been
 *   candidates but are dated more than {@link MAX_FUTURE_SECONDS} ahead of the
 *   reader's clock, sorted. Dropped before choosing, and reported so the reader
 *   can say it saw them.
 */

/**
 * Pick and read the current scoped list from whatever relays returned.
 *
 * Candidates are the events that could be the list: kind 30078, signed by a
 * root key, with exactly the expected `d`, and a valid signature — so nobody
 * can suppress the list with a newer event that lacks a root key's signature.
 * A candidate dated more than {@link MAX_FUTURE_SECONDS} ahead of the reader's
 * clock is dropped before choosing (not refused as the newest), so a fast
 * clock can neither pin a list nor make it unreadable; such events are listed
 * in `futureDated`. Across all root keys the newest remaining candidate wins
 * (ties to the smallest id, as for every replaceable event), and then it is
 * read in full. If that newest one is refused, the list is unreadable: an
 * older copy is not used in its place, because it was replaced.
 *
 * @param {unknown[]} events
 * @param {Object} query
 * @param {string} query.namespace
 * @param {"user-allow"|"user-deny"} query.scope
 * @param {AddressTarget|string} query.subject
 * @param {(event: NostrEvent) => boolean} query.verify
 * @param {string|string[]} [query.root] - The subject's root: one key or up to
 *   four; defaults to the subject's own key
 * @param {number} [query.now] - Reader's clock in unix seconds; defaults to the system clock
 * @returns {(ScopedList|ScopedListRefusal) & ResolvedNote}
 */
export function resolveScopedList(events, { namespace, scope, subject, verify, root, now }) {
  if (typeof verify !== "function") {
    return { ok: false, reason: "no_verifier", futureDated: [] };
  }
  const at = clock(now);
  const d = scopedListIdentifier(namespace, scope, subject);
  const parsed = parseScopedListIdentifier(d);
  if (!parsed.ok) {
    return { ...parsed, futureDated: [] };
  }
  const keys = rootKeys(parsed.subject, root);

  /** @type {NostrEvent[]} */
  const candidates = [];
  /** @type {Set<string>} */
  const futureDated = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    if (!isEventShape(event)) {
      continue;
    }
    const e = /** @type {NostrEvent} */ (event);
    if (e.kind !== CANONICAL_KIND || !keys.includes(e.pubkey)) {
      continue;
    }
    const ds = tagValues(e, "d");
    if (ds.length !== 1 || ds[0] !== d) {
      continue;
    }
    let verified = false;
    try {
      verified = verify(e) === true;
    } catch {
      verified = false;
    }
    if (!verified) {
      continue;
    }
    if (e.created_at > at + MAX_FUTURE_SECONDS) {
      futureDated.add(e.id);
      continue;
    }
    candidates.push(e);
  }

  const note = { futureDated: Array.from(futureDated).sort() };
  const latest = selectLatest(candidates);
  if (!latest) {
    return { ok: false, reason: "not_found", ...note };
  }
  return { ...decodeScopedList(latest, { verify, root: keys, now: at }), ...note };
}

/**
 * The authority to evaluate one subject's lists against.
 *
 * The root keys are the subject's governors: the first is the engine's root,
 * every one may allow and block, and none of them can be blocked from their
 * own subject. Pass the same root the lists were read with.
 *
 * @param {AddressTarget|string} subject
 * @param {string|string[]} [root] - Defaults to the subject's own key
 * @returns {import('@bitgate/core').AuthorityState}
 */
export function scopedListAuthority(subject, root) {
  const target = typeof subject === "string" ? parseSubjectCoordinate(subject) : subject;
  if (!target || !parseSubjectCoordinate(formatSubjectCoordinate(target))) {
    throw new TypeError(`Invalid scoped-list subject: ${JSON.stringify(subject)}`);
  }
  const keys = rootKeys(target, root);
  return createAuthorityState({
    root: keys[0],
    actors: Object.fromEntries(keys.map((key) => [key, ["super_admin"]])),
    protectedActors: keys,
  });
}

/**
 * Turn a read scoped list into an engine contribution.
 *
 * The contribution's actor is the list's signer. Evaluate it against
 * {@link scopedListAuthority} for the same subject and root, one snapshot
 * per subject: a scoped list must never be merged into an application-wide
 * snapshot, where it would apply everywhere.
 *
 * @param {ScopedList} list
 * @returns {Contribution}
 */
export function scopedListToContribution(list) {
  return {
    actor: list.signer,
    kind: list.scope,
    targets: list.entries.map((pubkey) => ({ type: "user", pubkey })),
    createdAt: list.createdAt,
  };
}
