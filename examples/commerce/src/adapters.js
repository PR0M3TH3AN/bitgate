// Commerce application adapters.
//
// Each adapter answers two questions: which governance targets stand behind
// this object, and what does a decision mean for it. Note what is absent —
// no thresholds, no precedence rules, no policy logic. Those live in the
// policy definition and the engine respectively.

import { createApplicationAdapter } from "@bitgate/core";

/** Parameterized-replaceable kind used for commerce documents in this example. */
export const PRODUCT_KIND = 30078;

/**
 * @typedef {Object} Product
 * @property {string} id - Event id of the current revision
 * @property {string} sellerPubkey
 * @property {string} identifier - d-tag, stable across revisions
 * @property {string} title
 * @property {number} priceSats
 */

/**
 * @typedef {Object} Storefront
 * @property {string} id
 * @property {string} sellerPubkey
 * @property {string} identifier
 * @property {string} name
 */

/**
 * @typedef {Object} Review
 * @property {string} id
 * @property {string} reviewerPubkey
 * @property {string} productIdentifier
 * @property {number} rating
 */

/**
 * Products answer to three targets.
 *
 * The address is what persists across revisions: denying it survives the seller
 * republishing the listing under a new event id, which denying the exact event
 * would not. Both are kept, because an exact-event denial must also stay
 * possible for the case where only one revision was bad.
 *
 * @type {import('@bitgate/core').GovernanceApplicationAdapter<Product>}
 */
export const productAdapter = createApplicationAdapter({
  applicationId: "commerce-example",

  toTargets(product) {
    return [
      { type: "user", pubkey: product.sellerPubkey },
      { type: "event", id: product.id, author: product.sellerPubkey, kind: PRODUCT_KIND },
      {
        type: "address",
        kind: String(PRODUCT_KIND),
        pubkey: product.sellerPubkey,
        identifier: product.identifier,
      },
    ];
  },

  getPrimaryTargetKey(product) {
    return `address:${PRODUCT_KIND}:${product.sellerPubkey}:${product.identifier}`;
  },

  applyDecision(product, decision) {
    return {
      ...product,
      moderation: {
        visible: decision.visibility.effect !== "hide" && decision.visibility.effect !== "deny",
        warn: decision.visibility.effect === "warn",
        blurred: decision.visibility.effect === "restrict",
        downranked: decision.ranking.effect === "downrank",
        rankPenalty: decision.ranking.weight,
        checkoutAllowed: (decision.transaction?.effect ?? "allow") === "allow",
        checkoutNeedsReview: decision.transaction?.effect === "require-review",
        reasons: decision.reasons.map((reason) => reason.id),
      },
    };
  },
});

/**
 * Storefronts answer to the seller, the storefront address, and the exact event.
 * @type {import('@bitgate/core').GovernanceApplicationAdapter<Storefront>}
 */
export const storefrontAdapter = createApplicationAdapter({
  applicationId: "commerce-example",

  toTargets(storefront) {
    return [
      { type: "user", pubkey: storefront.sellerPubkey },
      { type: "event", id: storefront.id, author: storefront.sellerPubkey, kind: PRODUCT_KIND },
      {
        type: "address",
        kind: String(PRODUCT_KIND),
        pubkey: storefront.sellerPubkey,
        identifier: storefront.identifier,
      },
    ];
  },

  getPrimaryTargetKey(storefront) {
    return `address:${PRODUCT_KIND}:${storefront.sellerPubkey}:${storefront.identifier}`;
  },
});

/**
 * Reviews answer to the reviewer and the exact review event.
 *
 * Deliberately not to the reviewed product: a bad product should not silence
 * honest reviews of it, which is exactly the outcome an over-broad target list
 * would produce.
 *
 * @type {import('@bitgate/core').GovernanceApplicationAdapter<Review>}
 */
export const reviewAdapter = createApplicationAdapter({
  applicationId: "commerce-example",

  toTargets(review) {
    return [
      { type: "user", pubkey: review.reviewerPubkey },
      { type: "event", id: review.id, author: review.reviewerPubkey, kind: PRODUCT_KIND },
    ];
  },

  getPrimaryTargetKey(review) {
    return `event:${review.id}`;
  },

  applyDecision(review, decision) {
    return {
      ...review,
      suppressed: decision.visibility.effect === "hide" || decision.visibility.effect === "deny",
      downranked: decision.ranking.effect === "downrank",
    };
  },
});

/**
 * Sellers answer only to their own user target.
 * @type {import('@bitgate/core').GovernanceApplicationAdapter<{ pubkey: string }>}
 */
export const sellerAdapter = createApplicationAdapter({
  applicationId: "commerce-example",

  toTargets(seller) {
    return [{ type: "user", pubkey: seller.pubkey }];
  },

  getPrimaryTargetKey(seller) {
    return `user:${seller.pubkey}`;
  },
});
