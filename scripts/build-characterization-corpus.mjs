#!/usr/bin/env node
/**
 * Generate the characterization corpus.
 *
 * Each case encodes one behavior read from the pinned reference commit (see
 * docs/reference-map.md) as a snapshot, a target, and an expected decision.
 * The corpus is generated rather than hand-written so that pubkeys stay
 * consistent across cases and a behavior change shows up as a reviewable diff.
 *
 * Provenance: these fixtures are authored from the reference source and its
 * documented configuration, not captured from a live relay. They pin the
 * behavior the extraction must reproduce; they are not a recording of
 * production traffic.
 *
 * Usage: node scripts/build-characterization-corpus.mjs
 */
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CASES_DIR = join(ROOT, "fixtures", "bitvid", "cases");

/** @param {string} seed */
const key = (seed) => seed.repeat(64).slice(0, 64);

const PUBKEYS = {
  root: key("a1"),
  moderator: key("b2"),
  curator: key("c3"),
  creator: key("d4"),
  viewer: key("e5"),
  stranger: key("f6"),
};

/**
 * Trusted accounts used to reach report and mute thresholds.
 * Each index gets its own two-hex-digit seed so that counting cases which need
 * twenty distinct muters actually get twenty distinct pubkeys.
 */
const trusted = (index) => key(index.toString(16).padStart(2, "0"));
const TRUSTED = Array.from({ length: 24 }, (_, index) => trusted(index + 1));

const EVENT_ID = key("1b");
const OTHER_EVENT_ID = key("2c");

const DAY = 24 * 60 * 60;
const NOW = 1_750_000_000;

const userTarget = (pubkey) => ({ type: "user", pubkey });
const eventTarget = (id, author) => ({ type: "event", id, author });
const addressTarget = (kind, pubkey, identifier) => ({ type: "address", kind, pubkey, identifier });

/** Authority roster shared by every case. */
const AUTHORITY = {
  root: PUBKEYS.root,
  actors: {
    [PUBKEYS.root]: ["super_admin"],
    [PUBKEYS.moderator]: ["moderator"],
    [PUBKEYS.curator]: ["curator"],
  },
  protectedActors: [PUBKEYS.root],
};

/** Reports from N distinct trusted accounts in one category. */
const reportsFrom = (count, category, createdAt = NOW - DAY) =>
  TRUSTED.slice(0, count).map((reporter) => ({ reporter, category, createdAt }));

/** Mutes from N distinct trusted accounts. */
const mutesFrom = (count, updatedAt = NOW - DAY) =>
  TRUSTED.slice(0, count).map((muter) => ({ muter, updatedAt }));

/** Every trusted account follows the creator's critics. */
const trustAll = { contacts: TRUSTED };

/**
 * @typedef {Object} FixtureCase
 * @property {string} name
 * @property {string} description
 * @property {string} behavior - What the reference implementation does
 * @property {string} profile
 * @property {number} now
 * @property {Object} authority
 * @property {Array} [contributions]
 * @property {Object} [trust]
 * @property {Object} [viewer]
 * @property {Object} [reports]
 * @property {Object} [trustedMutes]
 * @property {Object} target
 * @property {Object} expect
 */

/** @type {FixtureCase[]} */
const CASES = [
  {
    name: "trusted-report-threshold-reached",
    description: "Three trusted reports restrict visibility and withhold autoplay.",
    behavior: "Blur threshold and autoplay-block threshold are both 3 trusted reports.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "require-explicit-action" },
      reasons: ["trusted-report", "trusted-report-threshold"],
    },
  },

  {
    name: "trusted-report-below-threshold",
    description: "Two trusted reports are not enough to restrict.",
    behavior: "Counts below the blur threshold leave the target fully visible.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: { [`event:${EVENT_ID}`]: reportsFrom(2, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: ["trusted-report"],
    },
  },

  {
    name: "duplicate-reporter-dedupe",
    description: "One account reporting the same category repeatedly counts once.",
    behavior: "Reports are deduplicated per reporter and category before counting.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: {
      [`event:${EVENT_ID}`]: [
        { reporter: TRUSTED[0], category: "spam", createdAt: NOW - DAY },
        { reporter: TRUSTED[0], category: "spam", createdAt: NOW - 2 * DAY },
        { reporter: TRUSTED[0], category: "spam", createdAt: NOW - 3 * DAY },
        { reporter: TRUSTED[1], category: "spam", createdAt: NOW - DAY },
      ],
    },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: ["trusted-report"],
      evidence: { trustedReportTotal: 2 },
    },
  },

  {
    name: "blocked-reporter-ignored",
    description: "Reports from accounts the viewer blocks do not count.",
    behavior: "Blocked reporters are skipped before aggregation.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    viewer: { blocks: [TRUSTED[0], TRUSTED[1]] },
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedReportTotal: 1 },
    },
  },

  {
    name: "denied-reporter-ignored",
    description: "Reports from administratively denied accounts do not count.",
    behavior: "Denied accounts are excluded from aggregation, so a denied account cannot manufacture reports.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(TRUSTED[0]), userTarget(TRUSTED[1])] },
    ],
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedReportTotal: 1 },
    },
  },

  {
    name: "untrusted-reporter-ignored",
    description: "Reports from outside the trust graph do not count.",
    behavior: "Only reports from the viewer's trusted graph are counted.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: { contacts: [TRUSTED[0]] },
    reports: {
      [`event:${EVENT_ID}`]: [
        { reporter: TRUSTED[0], category: "nudity", createdAt: NOW - DAY },
        { reporter: PUBKEYS.stranger, category: "nudity", createdAt: NOW - DAY },
      ],
    },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedReportTotal: 1 },
    },
  },

  {
    name: "spam-report-hide-threshold",
    description: "Five trusted spam reports escalate to a hide.",
    behavior: "Spam carries its own higher hide threshold; other categories do not hide on reports alone.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: { [`event:${EVENT_ID}`]: reportsFrom(5, "spam") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "require-explicit-action" },
      reasons: ["trusted-report", "trusted-report-threshold"],
    },
  },

  {
    name: "non-spam-reports-never-hide",
    description: "Eight trusted reports in a non-spam category restrict but never hide.",
    behavior: "Only spam has a report-driven hide threshold.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: { [`event:${EVENT_ID}`]: reportsFrom(8, "misleading") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "require-explicit-action" },
    },
  },

  {
    name: "trusted-mute-below-threshold",
    description: "Nineteen trusted mutes downrank only.",
    behavior: "Below the hide threshold a trusted mute is a ranking signal: no blur, no playback block, no denial.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    trustedMutes: { [`user:${PUBKEYS.creator}`]: mutesFrom(19) },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "downrank", weight: 1 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: ["trusted-mute", "trusted-mute-threshold"],
      evidence: { trustedMuteTotal: 19 },
    },
  },

  {
    name: "trusted-mute-at-threshold",
    description: "Twenty trusted mutes escalate to a reversible hide.",
    behavior: "The hide threshold is 20 unique trusted muters.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    trustedMutes: { [`user:${PUBKEYS.creator}`]: mutesFrom(20) },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "downrank", weight: 1 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedMuteTotal: 20 },
    },
  },

  {
    name: "expired-trusted-mute",
    description: "Mutes older than the 60-day window are ignored.",
    behavior: "Stale mute lists must not hold a target down indefinitely.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    trustedMutes: {
      [`user:${PUBKEYS.creator}`]: [
        ...mutesFrom(20, NOW - 61 * DAY),
        ...mutesFrom(2, NOW - DAY).map((entry, index) => ({ ...entry, muter: TRUSTED[20 + index] })),
      ],
    },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "downrank", weight: 1 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedMuteTotal: 2 },
    },
  },

  {
    name: "duplicate-muter-dedupe",
    description: "The same account muting repeatedly counts once.",
    behavior: "Muters are counted uniquely.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    trustedMutes: {
      [`user:${PUBKEYS.creator}`]: [
        { muter: TRUSTED[0], updatedAt: NOW - DAY },
        { muter: TRUSTED[0], updatedAt: NOW - 2 * DAY },
        { muter: TRUSTED[1], updatedAt: NOW - DAY },
      ],
    },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "downrank", weight: 1 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedMuteTotal: 2 },
    },
  },

  {
    name: "personal-block-precedence",
    description: "A viewer's own block hides the target regardless of other state.",
    behavior: "Viewer blocks are viewer-local and always enforced.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    viewer: { blocks: [PUBKEYS.creator] },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["viewer-block"],
      evidence: { personalBlock: true },
    },
  },

  {
    name: "admin-user-deny",
    description: "A moderator's user denial hides the creator.",
    behavior: "Administrative denial applies the profile's administrativeDeny effects.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny"],
      evidence: { userDenied: true },
    },
  },

  {
    name: "admin-event-deny",
    description: "An exact event denial hides only that event.",
    behavior: "Event denial applies to the named event and does not travel to the author.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "event-deny", targets: [eventTarget(EVENT_ID, PUBKEYS.creator)] },
    ],
    target: eventTarget(OTHER_EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: [],
    },
  },

  {
    name: "admin-event-deny-applies",
    description: "The denied event itself is hidden.",
    behavior: "Exact-event denial hides the named event.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "event-deny", targets: [eventTarget(EVENT_ID, PUBKEYS.creator)] },
    ],
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-event-deny"],
      evidence: { eventDenied: true },
    },
  },

  {
    name: "author-deny-reaches-events",
    description: "Denying a creator hides that creator's events.",
    behavior: "Author-level denial reaches the author's content.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny"],
      evidence: { userDenied: true },
    },
  },

  {
    name: "admin-address-deny",
    description: "Denying an address hides it across revisions.",
    behavior: "Address denial is keyed by coordinate, so republishing does not clear it.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      {
        actor: PUBKEYS.moderator,
        kind: "address-deny",
        targets: [addressTarget("30023", PUBKEYS.creator, "listing-1")],
      },
    ],
    target: addressTarget("30023", PUBKEYS.creator, "listing-1"),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-address-deny"],
      evidence: { addressDenied: true },
    },
  },

  {
    name: "community-blacklist-merge",
    description: "A curator's denial is honored without moderator authority.",
    behavior: "Curators hold contribute-user-deny only; their entries merge as a union.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      {
        actor: PUBKEYS.curator,
        kind: "user-deny",
        source: "community-list-1",
        targets: [userTarget(PUBKEYS.creator)],
      },
    ],
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny", "community-user-deny"],
    },
  },

  {
    name: "curator-cannot-deny-events",
    description: "A curator's event denial is ignored.",
    behavior: "Contributions beyond an actor's capabilities are dropped at merge time.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.curator, kind: "event-deny", targets: [eventTarget(EVENT_ID, PUBKEYS.creator)] },
    ],
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: [],
    },
  },

  {
    name: "revoked-actor-contribution-dropped",
    description: "An actor with no roles cannot deny anyone.",
    behavior: "Revocation takes effect immediately because capabilities resolve at merge time.",
    profile: "feed",
    now: NOW,
    authority: { root: PUBKEYS.root, actors: { [PUBKEYS.root]: ["super_admin"] }, protectedActors: [PUBKEYS.root] },
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: [],
    },
  },

  {
    name: "protected-target",
    description: "The root administrator cannot be denied by contributor lists.",
    behavior: "Protected actors are stripped from every denial set.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.root)] },
    ],
    target: userTarget(PUBKEYS.root),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { protectedTarget: true },
    },
  },

  {
    name: "moderator-trust-seed",
    description: "An anonymous viewer inherits trust seeds.",
    behavior: "Seeds are the fallback trust graph when the viewer follows nobody.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: { contacts: [], seeds: TRUSTED.slice(0, 3) },
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "require-explicit-action" },
      evidence: { trustedReportTotal: 3 },
    },
  },

  {
    name: "seeds-yield-to-real-contacts",
    description: "Once the viewer has contacts, seeds stop contributing.",
    behavior: "Following nobody must not be equivalent to following the seed set.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: { contacts: [TRUSTED[0]], seeds: TRUSTED.slice(0, 3) },
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      evidence: { trustedReportTotal: 1 },
    },
  },

  {
    name: "viewer-override-softens-hide",
    description: "A viewer override reveals hidden content behind an explicit action.",
    behavior: "Overrides may soften a decision and force explicit interaction; they never escalate.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    viewer: { overrides: [{ key: `user:${PUBKEYS.creator}`, visibility: "allow" }] },
    trustedMutes: { [`user:${PUBKEYS.creator}`]: mutesFrom(20) },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "downrank", weight: 1 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "require-explicit-action" },
      reasons: ["trusted-mute", "trusted-mute-threshold", "viewer-override"],
    },
  },

  {
    name: "viewer-override-cannot-escalate",
    description: "An override asking for a harsher effect is ignored.",
    behavior: "Overrides only soften.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    viewer: { overrides: [{ key: `user:${PUBKEYS.creator}`, visibility: "deny" }] },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: [],
    },
  },

  {
    name: "author-override",
    description: "An override on the author does not leak to the author's events.",
    behavior: "Overrides are keyed by exact target.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    viewer: { overrides: [{ key: `user:${PUBKEYS.creator}`, visibility: "allow" }] },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny"],
    },
  },

  {
    name: "home-hide-bypass",
    description: "The home surface downranks instead of hiding.",
    behavior: "Home and Recent decline to hard-hide so one stale list cannot empty the feed.",
    profile: "home",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    trustedMutes: { [`user:${PUBKEYS.creator}`]: mutesFrom(20) },
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "downrank", weight: 1 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "allow" },
      reasons: ["trusted-mute", "trusted-mute-threshold", "surface-policy-bypass"],
    },
  },

  {
    name: "recent-hide-bypass",
    description: "The recent surface applies the same exception as home.",
    behavior: "Recent shares the home surface exception.",
    profile: "recent",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny", "surface-policy-bypass"],
    },
  },

  {
    name: "playback-enforces-hide",
    description: "Playback enforces the full decision with no surface exception.",
    behavior: "The hide bypass is a discovery-surface concession, not a global one.",
    profile: "playback",
    now: NOW,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "deny", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny"],
    },
  },

  {
    name: "playback-exposes-evidence",
    description: "The playback surface exposes reporter pubkeys; discovery surfaces do not.",
    behavior: "exposeEvidence controls whether contributor pubkeys reach the consumer.",
    profile: "playback",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "require-explicit-action" },
      evidence: { trustedReportTotal: 3, trustedReporterPubkeysCount: 3 },
    },
  },

  {
    name: "evidence-redacted-by-default",
    description: "Feed surfaces report counts but not who produced them.",
    behavior: "Reporter pubkeys are withheld unless the profile opts in.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    reports: { [`event:${EVENT_ID}`]: reportsFrom(3, "nudity") },
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "restrict", overridable: true },
      interaction: { effect: "require-explicit-action" },
      evidence: { trustedReportTotal: 3, trustedReporterPubkeysCount: 0 },
    },
  },

  {
    name: "cache-fallback-effective",
    description: "State reduced from a cached snapshot decides identically to live state.",
    behavior: "Administrative state stays effective when relays are unreachable.",
    profile: "feed",
    now: NOW,
    fromCache: true,
    authority: AUTHORITY,
    contributions: [
      { actor: PUBKEYS.moderator, kind: "user-deny", targets: [userTarget(PUBKEYS.creator)] },
    ],
    target: userTarget(PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "hide", overridable: true },
      interaction: { effect: "deny" },
      reasons: ["admin-user-deny"],
    },
  },

  {
    name: "clean-target-allowed",
    description: "A target with no signals against it is fully allowed.",
    behavior: "Governance is opt-in per signal; absence of evidence is not suspicion.",
    profile: "feed",
    now: NOW,
    authority: AUTHORITY,
    trust: trustAll,
    target: eventTarget(EVENT_ID, PUBKEYS.creator),
    expect: {
      ranking: { effect: "normal", weight: 0 },
      visibility: { effect: "allow", overridable: true },
      interaction: { effect: "allow" },
      reasons: [],
    },
  },
];

async function main() {
  await mkdir(CASES_DIR, { recursive: true });

  // Drop stale cases so a renamed fixture cannot linger and pass silently.
  for (const entry of await readdir(CASES_DIR).catch(() => [])) {
    if (entry.endsWith(".json")) {
      await unlink(join(CASES_DIR, entry));
    }
  }

  const names = new Set();
  for (const testCase of CASES) {
    if (names.has(testCase.name)) {
      throw new Error(`Duplicate fixture name: ${testCase.name}`);
    }
    names.add(testCase.name);
    await writeFile(
      join(CASES_DIR, `${testCase.name}.json`),
      `${JSON.stringify(testCase, null, 2)}\n`,
      "utf8",
    );
  }

  await writeFile(
    join(ROOT, "fixtures", "bitvid", "characterization-cases.json"),
    `${JSON.stringify(CASES.map((entry) => entry.name), null, 2)}\n`,
    "utf8",
  );

  console.log(`✓ Wrote ${CASES.length} characterization cases to fixtures/bitvid/cases`);
}

main().catch((error) => {
  console.error("build-characterization-corpus failed:", error);
  process.exit(1);
});
