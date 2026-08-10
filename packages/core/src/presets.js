// Starter policies.
//
// The engine carries no thresholds of its own, and that stays true: these are
// application policies that happen to ship in the box. They exist so the first
// run does not require authoring a threshold table, not because the engine has
// an opinion.
//
// Every number here is a starting point. Read `docs/integration-guide.md` and
// replace them once you know your own community — a preset that fits everyone
// fits nobody especially well.

import { createPolicyDefinition } from "./policy.js";

const DAY = 24 * 60 * 60;

/**
 * Report thresholds for a social feed.
 *
 * Categories are the NIP-56 vocabulary exactly — `nudity`, `malware`,
 * `profanity`, `illegal`, `spam`, `impersonation`, `other`. Inventing a
 * category here would be dead configuration: no standard client emits it, so
 * the threshold could never fire.
 *
 * Malware and impersonation escalate fastest because their harm is immediate
 * and specific. Broad categories like `spam` need more agreement before doing
 * anything visible, since they are the easiest to weaponize against someone
 * unpopular.
 *
 * @type {Record<string, import('./policy.js').CategoryThresholds>}
 */
const SOCIAL_REPORTS = {
  malware: { warn: 1, restrict: 1, hide: 2, interactionDeny: 1 },
  impersonation: { warn: 1, restrict: 2, hide: 4 },
  illegal: { warn: 1, restrict: 2, hide: 3 },
  nudity: { restrict: 2, requireExplicitAction: 2 },
  profanity: { downrank: 1, warn: 2, restrict: 3, hide: 6 },
  spam: { downrank: 2, restrict: 4, hide: 8 },
  default: { downrank: 2, warn: 4, restrict: 6 },
};

/**
 * Trusted mutes downrank from the first muter and hide only at scale.
 *
 * A mute is a personal preference, not an accusation. One person you follow
 * muting someone should nudge the ordering, nothing more.
 */
const SOCIAL_MUTES = {
  default: { downrank: 1, hide: 12 },
};

/**
 * A social-feed policy: timelines, profiles, and playback.
 *
 * Discovery surfaces decline to hard-hide, so one stale list cannot empty a
 * feed; the item is restricted and downranked instead. Playback enforces the
 * full decision, because that is where someone has deliberately chosen to
 * engage with a specific thing.
 *
 * @type {import('./policy.js').PolicyDefinition}
 */
export const SOCIAL_POLICY = createPolicyDefinition({
  id: "bitgate-social",
  name: "Social (starter)",
  description: "Starting thresholds for feeds, profiles, and playback. Tune before relying on them.",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      bypassHide: true,
      bypassHideCeiling: "restrict",
      muteWindowSeconds: 60 * DAY,
      reports: SOCIAL_REPORTS,
      mutes: SOCIAL_MUTES,
    },

    profile: {
      name: "profile",
      administrativeDeny: { visibility: "warn", interaction: "require-explicit-action" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      muteWindowSeconds: 60 * DAY,
      reports: SOCIAL_REPORTS,
      mutes: SOCIAL_MUTES,
    },

    playback: {
      name: "playback",
      administrativeDeny: { visibility: "deny", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      exposeEvidence: true,
      muteWindowSeconds: 60 * DAY,
      reports: SOCIAL_REPORTS,
      mutes: SOCIAL_MUTES,
    },
  },
});

/**
 * Report thresholds for a marketplace.
 *
 * `malware`, `illegal`, and `spam` are NIP-56 categories. `scam`,
 * `counterfeit`, and `not-as-described` are **not**: they are marketplace
 * vocabulary that only a commerce client will emit. That is a deliberate
 * trade — commerce harms have no NIP-56 equivalent — but it means reports from
 * generic Nostr clients arrive as `other` and fall through to the default
 * thresholds. Publish them as NIP-32 labels if you need cross-client meaning.
 *
 * Money changes the calculus: one credible malware report should stop a sale,
 * because the cost of being wrong runs one way. Visibility stays more generous
 * than transaction throughout — a listing can remain readable while being
 * unbuyable.
 *
 * @type {Record<string, import('./policy.js').CategoryThresholds>}
 */
const COMMERCE_REPORTS = {
  malware: { warn: 1, restrict: 1, hide: 2, transactionDeny: 1 },
  scam: { downrank: 1, warn: 2, restrict: 3, hide: 5, transactionReview: 2, transactionDeny: 3 },
  counterfeit: { downrank: 1, warn: 2, restrict: 4, transactionReview: 3 },
  "not-as-described": { downrank: 2, warn: 4, transactionReview: 5 },
  misleading: { downrank: 2, warn: 3, restrict: 5, hide: 8 },
  illegal: { warn: 1, restrict: 2, hide: 3, transactionDeny: 2 },
  spam: { downrank: 2, restrict: 5 },
  default: { downrank: 2, warn: 4 },
};

const COMMERCE_MUTES = {
  default: { downrank: 1 },
};

/**
 * Checkout cares about one question only: may this sale proceed?
 *
 * A visibility verdict here would be meaningless — checkout is not rendering
 * the listing — and actively confusing, since it would suggest the buyer is
 * being shown something they are not. Only transaction gates are declared.
 *
 * @type {Record<string, import('./policy.js').CategoryThresholds>}
 */
const CHECKOUT_REPORTS = {
  malware: { transactionDeny: 1 },
  illegal: { transactionDeny: 2 },
  scam: { transactionReview: 2, transactionDeny: 3 },
  counterfeit: { transactionReview: 3 },
  "not-as-described": { transactionReview: 5 },
  // Reports whose category we cannot interpret — `other`, or a vocabulary from
  // some client we have never seen — should not silently do nothing at the one
  // place money changes hands. They do not auto-deny either: an unclassified
  // complaint is not evidence of fraud. Enough of them earns a human look.
  default: { transactionReview: 4 },
};

/**
 * A commerce policy: discovery, detail, checkout, and a seller's own view.
 *
 * The four surfaces exist because one product legitimately has four different
 * answers at once — hidden from discovery, inspectable on its detail page,
 * unbuyable at checkout, and fully visible with evidence to its own seller.
 *
 * @type {import('./policy.js').PolicyDefinition}
 */
export const COMMERCE_POLICY = createPolicyDefinition({
  id: "bitgate-commerce",
  name: "Commerce (starter)",
  description: "Starting thresholds for marketplaces. Tune before relying on them.",
  version: "1.0.0",
  defaultProfile: "browse",
  profiles: {
    browse: {
      name: "browse",
      administrativeDeny: { visibility: "hide", interaction: "deny", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: false,
      muteWindowSeconds: 60 * DAY,
      reports: COMMERCE_REPORTS,
      mutes: COMMERCE_MUTES,
    },

    detail: {
      name: "detail",
      administrativeDeny: {
        visibility: "restrict",
        interaction: "require-explicit-action",
        transaction: "deny",
      },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      muteWindowSeconds: 60 * DAY,
      reports: COMMERCE_REPORTS,
      mutes: COMMERCE_MUTES,
    },

    checkout: {
      name: "checkout",
      administrativeDeny: { visibility: "allow", transaction: "deny" },
      allowViewerOverride: false,
      reports: CHECKOUT_REPORTS,
      mutes: {},
    },

    // A seller must always be able to see their own listing and read why it is
    // restricted. Hiding it from them would leave no route to appeal, so this
    // surface caps visibility at a warning no matter how strong the evidence.
    "seller-dashboard": {
      name: "seller-dashboard",
      administrativeDeny: { visibility: "warn", interaction: "allow", transaction: "deny" },
      allowViewerOverride: false,
      exposeEvidence: true,
      bypassHide: true,
      bypassHideCeiling: "warn",
      muteWindowSeconds: 60 * DAY,
      reports: COMMERCE_REPORTS,
      mutes: COMMERCE_MUTES,
    },
  },
});

/**
 * Administrative denial only — no trust thresholds at all.
 *
 * For an application that wants an operator deny list and nothing else: no
 * report counting, no mute aggregation, no trust graph. Useful as a first step,
 * and as an honest option for a community that does not want crowd signals
 * affecting what anyone sees.
 *
 * @type {import('./policy.js').PolicyDefinition}
 */
export const ADMIN_ONLY_POLICY = createPolicyDefinition({
  id: "bitgate-admin-only",
  name: "Administrative only",
  description: "Operator deny lists, with no trust-graph signals.",
  version: "1.0.0",
  defaultProfile: "default",
  profiles: {
    default: {
      name: "default",
      administrativeDeny: { visibility: "hide", interaction: "deny", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      reports: {},
      mutes: {},
    },
  },
});

/**
 * Presets addressable by name, for attribute-driven setup.
 * @type {Record<string, import('./policy.js').PolicyDefinition>}
 */
export const POLICY_PRESETS = {
  social: SOCIAL_POLICY,
  commerce: COMMERCE_POLICY,
  "admin-only": ADMIN_ONLY_POLICY,
};

/**
 * Resolve a preset by name.
 * @param {string} name
 * @returns {import('./policy.js').PolicyDefinition|null}
 */
export function getPolicyPreset(name) {
  if (typeof name !== "string") {
    return null;
  }
  return POLICY_PRESETS[name.trim().toLowerCase()] ?? null;
}
