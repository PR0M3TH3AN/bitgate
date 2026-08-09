// Marketplace pipeline.
//
// The application's job is reduced to: collect targets, ask the engine, apply
// the answer. It computes no thresholds and reimplements no precedence — which
// is the property the extraction is meant to guarantee.

import { collectTargets, evaluateObject } from "@bitgate/core";

import { productAdapter } from "./adapters.js";

/**
 * @typedef {import('./adapters.js').Product} Product
 */

/**
 * Govern a product feed for a surface.
 *
 * Targets are collected first and handed to the runtime in one call, so a
 * hundred-item page opens a bounded number of subscriptions rather than one per
 * listing.
 *
 * @param {Product[]} products
 * @param {import('@bitgate/runtime').GovernanceRuntime} runtime
 * @param {string} profile
 * @returns {Array<Product & { moderation: any }>}
 */
export function governProductFeed(products, runtime, profile) {
  runtime.setActiveTargets(collectTargets(products, productAdapter));

  return products.map((product) => {
    const decision = evaluateObject(product, productAdapter, (target) =>
      runtime.evaluate(target, { profile }),
    );
    return /** @type {any} */ (productAdapter.applyDecision?.(product, decision) ?? product);
  });
}

/**
 * Render a marketplace grid: drop hidden listings, order downranked ones last.
 *
 * Downranking is a sort input, not a filter. A downranked listing still appears
 * and can still be bought — conflating the two is what makes moderation feel
 * like censorship to sellers.
 *
 * @param {Product[]} products
 * @param {import('@bitgate/runtime').GovernanceRuntime} runtime
 * @returns {Array<Product & { moderation: any }>}
 */
export function buildMarketplaceGrid(products, runtime) {
  return governProductFeed(products, runtime, "public-marketplace")
    .filter((product) => product.moderation.visible)
    .sort((a, b) => a.moderation.rankPenalty - b.moderation.rankPenalty);
}

/**
 * @typedef {Object} CheckoutVerdict
 * @property {boolean} allowed
 * @property {boolean} needsReview
 * @property {string[]} reasons
 */

/**
 * Check a product at checkout.
 *
 * Evaluated freshly against the checkout profile rather than reusing the
 * listing page's decision: state may have changed since the page rendered, and
 * checkout is the point where being wrong actually costs someone money.
 *
 * @param {Product} product
 * @param {import('@bitgate/runtime').GovernanceRuntime} runtime
 * @returns {CheckoutVerdict}
 */
export function checkoutVerdict(product, runtime) {
  const decision = evaluateObject(product, productAdapter, (target) =>
    runtime.evaluate(target, { profile: "checkout" }),
  );

  const effect = decision.transaction?.effect ?? "allow";
  return {
    allowed: effect === "allow",
    needsReview: effect === "require-review",
    reasons: decision.reasons.map((reason) => reason.id),
  };
}

/**
 * Explain a product's status to its seller.
 *
 * The seller-dashboard profile exposes evidence, so this is the one surface
 * that can answer "how many people reported me, and for what".
 *
 * @param {Product} product
 * @param {import('@bitgate/runtime').GovernanceRuntime} runtime
 * @returns {{ visible: boolean, sellable: boolean, reasons: string[], evidence: any }}
 */
export function explainToSeller(product, runtime) {
  const decision = evaluateObject(product, productAdapter, (target) =>
    runtime.evaluate(target, { profile: "seller-dashboard" }),
  );

  return {
    visible: decision.visibility.effect !== "hide" && decision.visibility.effect !== "deny",
    sellable: (decision.transaction?.effect ?? "allow") === "allow",
    reasons: decision.reasons.map((reason) => reason.id),
    evidence: decision.evidence,
  };
}
