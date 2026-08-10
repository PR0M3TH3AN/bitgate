// @bitgate/nostr
//
// Codecs translating Nostr events into the core's vocabulary. Event formats
// live here so the core never learns which kind stores roles, which `d`
// identifier is used, or how a legacy list is shaped.

export {
  bech32Decode,
  convertBits,
  decodeNpub,
  decodeNote,
  normalizePubkeyInput,
  normalizeEventIdInput,
} from "./nip19.js";

export {
  getTagValue,
  getTags,
  coordinateOf,
  selectReplaceable,
  selectLatest,
  verifyEvents,
} from "./replaceable.js";

export {
  CANONICAL_KIND,
  CANONICAL_VERSION,
  MAX_POLICY_BYTES,
  canonicalIdentifier,
  parseIdentifier,
  isCanonicalGovernanceEvent,
  decodeContribution,
  decodeAddressCoordinate,
  encodeAddressCoordinate,
  decodeRoles,
  decodePolicy,
  encodeContribution,
  encodeRoles,
} from "./canonical.js";

export {
  REPORT_KIND,
  isRelayHint,
  normalizeCategory,
  extractReportType,
  decodeReport,
  encodeReport,
} from "./reports.js";

export {
  MUTE_LIST_KIND,
  extractMuteCategory,
  decodeMuteList,
  decodePrivateMuteEntries,
  toMuteRecords,
  encodeMuteList,
} from "./mutes.js";

export {
  RELAY_LIST_KIND,
  normalizeRelayUrl,
  decodeRelayList,
  groupAuthorsByWriteRelay,
  encodeRelayList,
} from "./relayList.js";

export {
  CONTACT_LIST_KIND,
  decodeContactList,
  encodeContactList,
} from "./contacts.js";

export {
  LEGACY_KIND,
  LEGACY_IDENTIFIERS,
  LEGACY_EDITORS_IDENTIFIER,
  LEGACY_COMMUNITY_SOURCES_IDENTIFIER,
  isLegacyAdminEvent,
  decodeLegacyList,
  decodeLegacyEditors,
  decodeLegacyCommunitySources,
  decodeMixedContributions,
} from "./legacy.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('./replaceable.js').SignatureVerifier} SignatureVerifier
 * @typedef {import('./reports.js').DecodedReport} DecodedReport
 * @typedef {import('./mutes.js').DecodedMuteList} DecodedMuteList
 * @typedef {import('./relayList.js').RelayList} RelayList
 * @typedef {import('./contacts.js').ContactList} ContactList
 */
