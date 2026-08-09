// bech32 decoding for Nostr identifiers.
//
// Implemented here rather than pulled from a dependency so that @bitgate/core
// can stay dependency-free and hex-only: decoding happens at the edge, in the
// codecs, and the core only ever sees normalized hex.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/** @type {Map<string, number>} */
const CHARSET_MAP = new Map();
for (let index = 0; index < CHARSET.length; index += 1) {
  CHARSET_MAP.set(CHARSET[index], index);
}

const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/**
 * @param {number[]} values
 * @returns {number}
 */
function polymod(values) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < GENERATORS.length; bit += 1) {
      if ((top >>> bit) & 1) {
        checksum ^= GENERATORS[bit];
      }
    }
  }
  return checksum;
}

/**
 * @param {string} hrp
 * @returns {number[]}
 */
function hrpExpand(hrp) {
  /** @type {number[]} */
  const expanded = [];
  for (let index = 0; index < hrp.length; index += 1) {
    expanded.push(hrp.charCodeAt(index) >>> 5);
  }
  expanded.push(0);
  for (let index = 0; index < hrp.length; index += 1) {
    expanded.push(hrp.charCodeAt(index) & 31);
  }
  return expanded;
}

/**
 * Decode a bech32 string into its human-readable part and data words.
 * @param {string} value
 * @returns {{ hrp: string, words: number[] } | null}
 */
export function bech32Decode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Mixed case is invalid per BIP-173.
  const lower = trimmed.toLowerCase();
  if (trimmed !== lower && trimmed !== trimmed.toUpperCase()) {
    return null;
  }

  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length) {
    return null;
  }

  const hrp = lower.slice(0, separator);
  /** @type {number[]} */
  const words = [];
  for (let index = separator + 1; index < lower.length; index += 1) {
    const word = CHARSET_MAP.get(lower[index]);
    if (word === undefined) {
      return null;
    }
    words.push(word);
  }

  if (polymod(hrpExpand(hrp).concat(words)) !== 1) {
    return null;
  }

  return { hrp, words: words.slice(0, -6) };
}

/**
 * Regroup bit-packed data, used to turn 5-bit bech32 words into bytes.
 * @param {number[]} data
 * @param {number} fromBits
 * @param {number} toBits
 * @param {boolean} [pad]
 * @returns {number[] | null}
 */
export function convertBits(data, fromBits, toBits, pad = true) {
  /** @type {number[]} */
  const result = [];
  let accumulator = 0;
  let bits = 0;
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits) {
      return null;
    }
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & maxValue);
    }
  }

  if (pad) {
    if (bits) {
      result.push((accumulator << (toBits - bits)) & maxValue);
    }
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue)) {
    return null;
  }

  return result;
}

/**
 * Decode an `npub` into a 64-character hex pubkey.
 * @param {string} npub
 * @returns {string} Empty string when the input is not a valid npub
 */
export function decodeNpub(npub) {
  const decoded = bech32Decode(npub);
  if (!decoded || decoded.hrp !== "npub") {
    return "";
  }

  const bytes = convertBits(decoded.words, 5, 8, false);
  if (!bytes || bytes.length !== 32) {
    return "";
  }

  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Decode a `note` into a 64-character hex event id.
 * @param {string} note
 * @returns {string} Empty string when the input is not a valid note
 */
export function decodeNote(note) {
  const decoded = bech32Decode(note);
  if (!decoded || decoded.hrp !== "note") {
    return "";
  }

  const bytes = convertBits(decoded.words, 5, 8, false);
  if (!bytes || bytes.length !== 32) {
    return "";
  }

  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalize a pubkey given as hex or npub.
 * @param {string} value
 * @returns {string} Lowercase hex, or empty string when invalid
 */
export function normalizePubkeyInput(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return decodeNpub(trimmed);
}

/**
 * Normalize an event id given as hex or note.
 * @param {string} value
 * @returns {string} Lowercase hex, or empty string when invalid
 */
export function normalizeEventIdInput(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return decodeNote(trimmed);
}
