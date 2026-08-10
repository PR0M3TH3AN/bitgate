// NIP-01 event signature verification.
//
// Optional by design. The rest of BitGate carries no crypto dependency so it
// can run anywhere and be audited without one; this package exists so that
// "supply your own verifier" is not the only path to a secure deployment.
//
// Verification here means two things, and both matter:
//
//   1. The event id is the hash of the event's own contents. Without this an
//      attacker could sign one id and attach it to different content.
//   2. The signature is valid for that id under the claimed pubkey.
//
// Checking only the signature would let a forged event pass by reusing a real
// signature over an unrelated id.

import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2";

/**
 * @typedef {Object} NostrEvent
 * @property {string} id
 * @property {string} pubkey
 * @property {number} kind
 * @property {number} created_at
 * @property {string[][]} tags
 * @property {string} content
 * @property {string} [sig]
 */

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;

const encoder = new TextEncoder();

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute an event id per NIP-01.
 *
 * The id is the SHA-256 of the compact JSON serialization of
 * `[0, pubkey, created_at, kind, tags, content]`. `JSON.stringify` already
 * produces the required form: no whitespace, and the same escaping rules the
 * spec lists.
 *
 * @param {Pick<NostrEvent, "pubkey"|"created_at"|"kind"> & Partial<Pick<NostrEvent, "tags"|"content">>} event
 * @returns {string} Lowercase hex digest
 */
export function computeEventId(event) {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags ?? [],
    event.content ?? "",
  ]);
  return toHex(sha256(encoder.encode(serialized)));
}

/**
 * Whether an event is structurally capable of being verified.
 *
 * Checked before any crypto so that malformed input is a cheap `false` rather
 * than an exception from deep inside a curve implementation.
 *
 * @param {unknown} event
 * @returns {event is NostrEvent}
 */
export function isVerifiable(event) {
  if (!event || typeof event !== "object") {
    return false;
  }
  const candidate = /** @type {any} */ (event);
  return (
    typeof candidate.id === "string" &&
    HEX_64.test(candidate.id) &&
    typeof candidate.pubkey === "string" &&
    HEX_64.test(candidate.pubkey) &&
    typeof candidate.sig === "string" &&
    HEX_128.test(candidate.sig) &&
    typeof candidate.kind === "number" &&
    typeof candidate.created_at === "number" &&
    typeof candidate.content === "string" &&
    Array.isArray(candidate.tags)
  );
}

/**
 * Verify one event.
 *
 * Never throws: a malformed event, a bad hex string, or a curve error are all
 * "not verified". A verifier that throws would be a denial-of-service vector,
 * since a single hostile event would break the whole ingestion batch.
 *
 * @param {NostrEvent} event
 * @returns {boolean}
 */
export function verifyEvent(event) {
  if (!isVerifiable(event)) {
    return false;
  }

  try {
    // Bind the signature to the content, not merely to the claimed id.
    if (computeEventId(event) !== event.id) {
      return false;
    }
    return schnorr.verify(/** @type {string} */ (event.sig), event.id, event.pubkey);
  } catch {
    return false;
  }
}

/**
 * Build a verifier for `createBitGate({ verifySignature })`.
 *
 * @param {Object} [options]
 * @param {number} [options.maxFutureSeconds] - Reject events dated further ahead
 *   than this. A far-future `created_at` wins replaceable-event selection
 *   forever, pinning stale state in place; the signature is valid, so only a
 *   clock check catches it. Set 0 to disable.
 * @param {() => number} [options.now] - Injected clock, unix seconds
 * @returns {(event: NostrEvent) => boolean}
 */
export function createVerifier({ maxFutureSeconds = 900, now } = {}) {
  const clock = now ?? (() => Math.floor(Date.now() / 1000));

  return (event) => {
    if (!verifyEvent(event)) {
      return false;
    }
    if (maxFutureSeconds > 0 && event.created_at > clock() + maxFutureSeconds) {
      return false;
    }
    return true;
  };
}
