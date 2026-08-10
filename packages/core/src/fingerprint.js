// Snapshot fingerprints for Nostr Governance
//
// Fingerprints answer one question: "is this the same input as last time?"
// They drive cache invalidation and let a mismatch record point at which
// snapshot produced a decision. They are not a security primitive — a
// fingerprint collision misses a cache invalidation, it does not grant
// authority — so a fast pure-JS hash is used instead of WebCrypto, which would
// force the whole evaluation path to become async.

/**
 * Canonical JSON: object keys sorted at every depth, so two structurally equal
 * values always serialize to the same string.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen] - Internal, for cycle detection across recursion
 * @returns {string}
 */
export function canonicalStringify(value, seen) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  // Cycle guard: a caller could hand us a snapshot fragment that references
  // itself, and unguarded recursion is a stack-overflow DoS rather than a
  // wrong answer. A repeated object serializes as a sentinel — fingerprints
  // only need to be stable and collision-resistant, not reversible.
  const visited = seen ?? new WeakSet();
  if (visited.has(value)) {
    return '"[cycle]"';
  }
  visited.add(value);

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry, visited)).join(",")}]`;
  }

  if (value instanceof Set) {
    return `[${Array.from(value).map(String).sort().map((entry) => JSON.stringify(entry)).join(",")}]`;
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .map(([key, entry]) => [String(key), entry])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry, visited)}`).join(",")}}`;
  }

  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value)).sort();
  const parts = [];
  for (const key of keys) {
    const entry = /** @type {Record<string, unknown>} */ (value)[key];
    if (entry === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${canonicalStringify(entry, visited)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * FNV-1a over 32 bits, run twice with different offsets to widen the digest to
 * 64 bits and keep accidental collisions unlikely for realistic snapshot counts.
 * @param {string} input
 * @returns {string} 16-character lowercase hex digest
 */
export function hashString(input) {
  let high = 0x811c9dc5;
  let low = 0x01000193;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    high ^= code;
    high = Math.imul(high, 0x01000193) >>> 0;
    low ^= code + index;
    low = Math.imul(low, 0x85ebca6b) >>> 0;
  }

  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

/**
 * Fingerprint any value.
 * @param {unknown} value
 * @returns {string}
 */
export function fingerprint(value) {
  return hashString(canonicalStringify(value));
}

/**
 * Fingerprint the parts of a governance snapshot that can change a decision.
 *
 * Deliberately excludes evaluation time and viewer identity: those belong to
 * the evaluation, not the snapshot, and including them would defeat caching.
 *
 * @param {Object} snapshot
 * @param {unknown} [snapshot.authority]
 * @param {unknown} [snapshot.admin]
 * @param {unknown} [snapshot.reports]
 * @param {unknown} [snapshot.trustedMutes]
 * @param {unknown} [snapshot.overrides]
 * @param {unknown} [snapshot.policy]
 * @returns {string}
 */
export function snapshotFingerprint(snapshot) {
  return fingerprint({
    authority: snapshot.authority ?? null,
    admin: snapshot.admin ?? null,
    reports: snapshot.reports ?? null,
    trustedMutes: snapshot.trustedMutes ?? null,
    overrides: snapshot.overrides ?? null,
    policy: snapshot.policy ?? null,
  });
}
