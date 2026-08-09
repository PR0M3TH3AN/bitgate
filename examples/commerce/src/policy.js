// Commerce policy profiles.
//
// This example exists to prove the engine is not video-specific. Nothing here
// touches @bitgate/core internals: it is built entirely from the
// public API, and the core carries none of these numbers.
//
// The interesting property is that one product can simultaneously be visible to
// its seller, downranked in discovery, inspectable on its detail page, and
// blocked from checkout — four different answers from one decision, which a
// single `hidden` boolean could not express.

import { createPolicyDefinition, createRoleDefinition } from "@bitgate/core";

/**
 * Category thresholds for a marketplace.
 *
 * Malware is treated far more harshly than misleading copy: one trusted report
 * blocks checkout, because the cost of a false negative is a compromised buyer,
 * while an over-eager `misleading` threshold would just suppress lawful listings.
 *
 * @type {Record<string, import('@bitgate/core').CategoryThresholds>}
 */
export const MARKETPLACE_REPORT_THRESHOLDS = {
  scam: {
    downrank: 1,
    warn: 2,
    restrict: 3,
    hide: 5,
    transactionReview: 2,
    transactionDeny: 3,
  },
  malware: {
    warn: 1,
    restrict: 1,
    hide: 2,
    transactionDeny: 1,
  },
  misleading: {
    downrank: 2,
    warn: 3,
    restrict: 5,
    hide: 8,
  },
  "not-as-described": {
    downrank: 2,
    warn: 4,
    transactionReview: 5,
  },
  default: {
    downrank: 2,
    warn: 4,
  },
};

/** Trusted mutes downrank a seller but never block a sale on their own. */
const MARKETPLACE_MUTE_THRESHOLDS = {
  default: { downrank: 1 },
};

/**
 * The marketplace policy.
 *
 * Every surface reads the same evidence and reaches a different conclusion,
 * which is the whole point of profiles.
 */
export const COMMERCE_POLICY = createPolicyDefinition({
  id: "commerce-example",
  name: "Commerce example",
  description: "Marketplace policy demonstrating the engine outside a video application.",
  version: "1.0.0",
  defaultProfile: "public-marketplace",
  profiles: {
    // Discovery: denied sellers disappear entirely and cannot transact.
    "public-marketplace": {
      name: "public-marketplace",
      administrativeDeny: { visibility: "hide", interaction: "deny", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: false,
      requireAllowlist: true,
      allowlistMiss: { visibility: "hide", interaction: "deny", transaction: "deny" },
      reports: MARKETPLACE_REPORT_THRESHOLDS,
      mutes: MARKETPLACE_MUTE_THRESHOLDS,
    },

    // Detail page: a shopper who followed a direct link may still inspect the
    // listing behind a warning, but cannot buy it.
    "product-detail": {
      name: "product-detail",
      administrativeDeny: { visibility: "restrict", interaction: "require-explicit-action", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      reports: MARKETPLACE_REPORT_THRESHOLDS,
      mutes: MARKETPLACE_MUTE_THRESHOLDS,
    },

    // Checkout: visibility is irrelevant; only the transaction verdict matters,
    // and it is re-checked here rather than trusted from the listing page.
    checkout: {
      name: "checkout",
      administrativeDeny: { visibility: "allow", transaction: "deny" },
      allowViewerOverride: false,
      reports: MARKETPLACE_REPORT_THRESHOLDS,
      mutes: {},
    },

    // Seller dashboard: the seller can always see their own listing and is told
    // why it is restricted. An appeals screen that hides the evidence is useless.
    "seller-dashboard": {
      name: "seller-dashboard",
      administrativeDeny: { visibility: "warn", interaction: "allow", transaction: "deny" },
      allowViewerOverride: false,
      exposeEvidence: true,
      reports: MARKETPLACE_REPORT_THRESHOLDS,
      mutes: MARKETPLACE_MUTE_THRESHOLDS,
    },
  },
});

/**
 * Marketplace-specific roles, built from the generic capability vocabulary.
 *
 * These roles do not exist in the core; an application invents the roles it
 * needs and the engine enforces them.
 */
export const COMMERCE_ROLES = {
  listing_moderator: createRoleDefinition("listing_moderator", [
    "contribute-event-deny",
    "contribute-address-deny",
    "review-evidence",
  ]),
  seller_moderator: createRoleDefinition("seller_moderator", [
    "contribute-user-deny",
    "review-evidence",
  ]),
  community_curator: createRoleDefinition("community_curator", ["contribute-user-deny"]),
};

/**
 * Role capability map in the shape createAuthorityState expects.
 * @type {Record<string, import('@bitgate/core').GovernanceCapability[]>}
 */
export const COMMERCE_ROLE_CAPABILITIES = Object.fromEntries(
  Object.values(COMMERCE_ROLES).map((role) => [role.name, role.capabilities]),
);
