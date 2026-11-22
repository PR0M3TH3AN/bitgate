// NIP-51 curation sets (kind 30004) as BitGate input.
//
// The NSWP kit and BitPortal already keep their lists of worlds as curation
// sets (NSWP-08, `protocol/08-lists.md`): a host's allow list under `d =
// "bitportal"`, a curator's starter set, any list a visitor follows. Reading
// them here, exactly as NSWP-08 defines them, lets those signed lists feed
// BitGate's `address-allow` (or `address-deny`) as they are — the curator
// does not publish the same worlds again in a second format.
//
// `parseCurationSet` is the structural reader and matches NSWP's own
// (`packages/core/src/list.ts`) issue for issue; it is held to NSWP's vectors,
// copied into `vectors/nswp/lists.json`. `readCurationSet` and
// `resolveCurationSet` add what governance needs on top: a required
// signature check, and choosing the current copy by its signer.

import { selectLatest } from "./replaceable.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').Contribution} Contribution
 * @typedef {import('@bitgate/core').AddressTarget} AddressTarget
 */

/** NIP-51 curation set kind. */
export const CURATION_SET_KIND = 30004;

/** NSWP's world announcement kind: the only addressable kind a world list holds. */
export const NSWP_WORLD_KIND = 37300;

/**
 * Ceilings, as NSWP-08 sets them. Lengths are JavaScript string lengths
 * (UTF-16 code units), as NSWP's own reader measures them.
 */
export const CURATION_SET_LIMITS = Object.freeze({
  entries: 200,
  titleChars: 200,
  descriptionChars: 1000,
  dChars: 128,
});

const HEX64 = /^[0-9a-f]{64}$/;
const COORDINATE = /^(\d+):([0-9a-f]{64}):(.*)$/s;

/**
 * @typedef {Object} CurationSet
 * @property {string} d - The list's name under its curator's key
 * @property {string} title - The curator's title, or `d` when it has none
 * @property {string} description
 * @property {string[]} coordinates - Entries as coordinates, in the curator's order, each once
 * @property {AddressTarget[]} targets - The same entries as address targets
 * @property {number} createdAt
 * @property {string} [pubkey] - The curator's key, when the event carries one
 * @property {string} [coordinate] - `30004:<pubkey>:<d>`: what a client follows
 */

/**
 * @typedef {Object} CurationSetParse
 * @property {boolean} valid - No errors
 * @property {string[]} errors - Issue codes, sorted
 * @property {string[]} warnings - Issue codes, sorted
 * @property {CurationSet|null} list - Present when valid
 */

/**
 * The value of the first tag with a name, as NSWP reads it.
 * @param {string[][]} tags
 * @param {string} name
 * @returns {string|undefined}
 */
function firstValue(tags, name) {
  return tags.find((tag) => tag[0] === name)?.[1];
}

/**
 * Whether a value has the shape of a signed Nostr event.
 * @param {any} event
 * @returns {boolean}
 */
function isSignedShape(event) {
  return (
    !!event &&
    typeof event === "object" &&
    Number.isInteger(event.kind) &&
    event.kind >= 0 &&
    Number.isInteger(event.created_at) &&
    typeof event.content === "string" &&
    Array.isArray(event.tags) &&
    HEX64.test(event.id ?? "") &&
    HEX64.test(event.pubkey ?? "") &&
    /^[0-9a-f]{128}$/.test(event.sig ?? "")
  );
}

/**
 * Read a curation set's structure, exactly as NSWP-08 defines it.
 *
 * Entries are the `a` tags naming an addressable event of `addressKind`
 * (37300, a world, by default) with a non-empty identifier; anything else on
 * the list is passed over without complaint. Each entry counts once, in the
 * curator's order, and at most 200 are read (a warning says the rest were
 * cut). A title or description over its ceiling is cut, with a warning. A list
 * with no entries is still a list.
 *
 * This checks no signature. Use {@link readCurationSet} for anything that
 * decides what is shown.
 *
 * @param {unknown} input
 * @param {Object} [options]
 * @param {boolean} [options.requireSigned] - Require `id`, `pubkey` and `sig`
 * @param {number} [options.addressKind] - Which addressable kind counts as an entry
 * @returns {CurationSetParse}
 */
export function parseCurationSet(input, { requireSigned = false, addressKind = NSWP_WORLD_KIND } = {}) {
  /** @type {Set<string>} */
  const errors = new Set();
  /** @type {Set<string>} */
  const warnings = new Set();
  const done = (/** @type {CurationSet|null} */ list) => ({
    valid: errors.size === 0,
    errors: Array.from(errors).sort(),
    warnings: Array.from(warnings).sort(),
    list: errors.size === 0 ? list : null,
  });

  if (typeof input !== "object" || input === null) {
    errors.add("not_an_event");
    return done(null);
  }
  const e = /** @type {any} */ (input);
  if (e.kind !== CURATION_SET_KIND) {
    errors.add("wrong_kind");
  }
  if (!Array.isArray(e.tags) || !e.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string"))) {
    errors.add("invalid_tags");
    return done(null);
  }
  if (!Number.isInteger(e.created_at)) {
    errors.add("invalid_created_at");
  }
  if (requireSigned && !isSignedShape(e)) {
    errors.add("not_signed");
  }
  const pubkey = typeof e.pubkey === "string" && HEX64.test(e.pubkey) ? e.pubkey : undefined;
  if (e.pubkey !== undefined && !pubkey) {
    errors.add("invalid_pubkey");
  }
  /** @type {string[][]} */
  const tags = e.tags;

  const d = firstValue(tags, "d");
  if (d === undefined) {
    errors.add("missing_tag");
  } else if (d.length > CURATION_SET_LIMITS.dChars) {
    errors.add("value_too_long");
  }

  let title = firstValue(tags, "title") ?? "";
  if (title.length > CURATION_SET_LIMITS.titleChars) {
    warnings.add("value_too_long");
    title = title.slice(0, CURATION_SET_LIMITS.titleChars);
  }
  let description = firstValue(tags, "description") ?? "";
  if (description.length > CURATION_SET_LIMITS.descriptionChars) {
    warnings.add("value_too_long");
    description = description.slice(0, CURATION_SET_LIMITS.descriptionChars);
  }

  /** @type {string[]} */
  const coordinates = [];
  /** @type {AddressTarget[]} */
  const targets = [];
  for (const tag of tags) {
    if (tag[0] !== "a") {
      continue;
    }
    const match = tag[1] ? COORDINATE.exec(tag[1]) : null;
    // Not an entry of this kind: not ours to judge.
    if (!match || Number(match[1]) !== addressKind || match[3] === "") {
      continue;
    }
    const kind = String(Number(match[1]));
    const coordinate = `${kind}:${match[2]}:${match[3]}`;
    if (coordinates.includes(coordinate)) {
      continue;
    }
    if (coordinates.length === CURATION_SET_LIMITS.entries) {
      warnings.add("too_many_worlds");
      break;
    }
    coordinates.push(coordinate);
    targets.push({ type: "address", kind, pubkey: match[2], identifier: match[3] });
  }

  /** @type {CurationSet} */
  const list = {
    d: d ?? "",
    title: title || (d ?? ""),
    description,
    coordinates,
    targets,
    createdAt: Number.isInteger(e.created_at) ? e.created_at : 0,
  };
  if (pubkey) {
    list.pubkey = pubkey;
    if (d !== undefined) {
      list.coordinate = `${CURATION_SET_KIND}:${pubkey}:${d}`;
    }
  }
  return done(list);
}

/**
 * @typedef {{ ok: true, list: CurationSet & { pubkey: string, coordinate: string }, warnings: string[] }} CurationSetRead
 * @typedef {{ ok: false, reason: "no_verifier" | "invalid" | "bad_signature" | "not_found", errors?: string[] }} CurationSetRefusal
 */

/**
 * Read a curation set for governance: structure as NSWP-08, plus a signature
 * check, which is required. A list is its curator's word and nobody else's.
 *
 * @param {unknown} event
 * @param {Object} options
 * @param {(event: NostrEvent) => boolean} options.verify - NIP-01 id and
 *   signature check; anything but `true` is a failed check
 * @param {number} [options.addressKind] - Defaults to 37300 (worlds)
 * @returns {CurationSetRead|CurationSetRefusal}
 */
export function readCurationSet(event, { verify, addressKind } = /** @type {any} */ ({})) {
  if (typeof verify !== "function") {
    return { ok: false, reason: "no_verifier" };
  }
  const parsed = parseCurationSet(event, { requireSigned: true, addressKind });
  if (!parsed.valid || !parsed.list) {
    return { ok: false, reason: "invalid", errors: parsed.errors };
  }
  let verified = false;
  try {
    verified = verify(/** @type {NostrEvent} */ (event)) === true;
  } catch {
    verified = false;
  }
  if (!verified) {
    return { ok: false, reason: "bad_signature" };
  }
  return {
    ok: true,
    list: /** @type {CurationSet & { pubkey: string, coordinate: string }} */ (parsed.list),
    warnings: parsed.warnings,
  };
}

/**
 * Pick and read the current copy of a followed list: the coordinate
 * `30004:<pubkey>:<d>` fixes the key.
 *
 * Candidates are kind-30004 events signed by that key, whose first `d` is
 * exactly `d`, with a valid signature. The newest wins (ties to the smallest
 * id), so a newer copy replaces an older one only when the same key signed it
 * and it is later, as NSWP-08 says. With no candidate the result is
 * `not_found`; a client that already holds a copy keeps it ("when relays are
 * silent, the last copy the client saw stands").
 *
 * @param {unknown[]} events
 * @param {Object} query
 * @param {string} query.pubkey - The curator's key (64 lowercase hex)
 * @param {string} query.d
 * @param {(event: NostrEvent) => boolean} query.verify
 * @param {number} [query.addressKind]
 * @returns {CurationSetRead|CurationSetRefusal}
 */
export function resolveCurationSet(events, { pubkey, d, verify, addressKind }) {
  if (typeof verify !== "function") {
    return { ok: false, reason: "no_verifier" };
  }
  if (typeof pubkey !== "string" || !HEX64.test(pubkey) || typeof d !== "string") {
    throw new TypeError("resolveCurationSet needs the curator's pubkey (64 lowercase hex) and the list's d");
  }
  const candidates = (Array.isArray(events) ? events : []).filter((event) => {
    if (!isSignedShape(event)) {
      return false;
    }
    const e = /** @type {NostrEvent} */ (event);
    if (e.kind !== CURATION_SET_KIND || e.pubkey !== pubkey || firstValue(e.tags, "d") !== d) {
      return false;
    }
    try {
      return verify(e) === true;
    } catch {
      return false;
    }
  });
  const latest = selectLatest(/** @type {NostrEvent[]} */ (candidates));
  if (!latest) {
    return { ok: false, reason: "not_found" };
  }
  return readCurationSet(latest, { verify, addressKind });
}

/**
 * Turn a read curation set into an engine contribution.
 *
 * The actor is the list's curator. Under an authority where that key holds
 * `contribute-address-allow` (the root does), a host's list becomes the
 * allowlist of what may be shown; evaluate with the `allowlist` preset.
 *
 * @param {CurationSet & { pubkey: string }} list
 * @param {Object} [options]
 * @param {"address-allow"|"address-deny"} [options.kind]
 * @returns {Contribution}
 */
export function curationSetToContribution(list, { kind = "address-allow" } = {}) {
  if (kind !== "address-allow" && kind !== "address-deny") {
    throw new TypeError(`A curation set contributes address-allow or address-deny, not ${JSON.stringify(kind)}`);
  }
  return {
    actor: list.pubkey,
    kind,
    targets: list.targets.map((target) => ({ ...target })),
    createdAt: list.createdAt,
  };
}
