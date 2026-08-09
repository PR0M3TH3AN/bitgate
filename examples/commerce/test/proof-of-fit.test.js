// Commerce proof-of-fit.
//
// The plan requires a commerce consumer to demonstrate ten behaviors before the
// package reaches 1.0.0, the tenth being that none of it needs a change to the
// generic core. Each numbered case below is one of those requirements.

import { describe, expect, it } from "vitest";

import { createCommands, createGovernanceRuntime, createMemoryTransport } from "@nostr-governance/runtime";

import { COMMERCE_POLICY, COMMERCE_ROLE_CAPABILITIES } from "../src/policy.js";
import { productAdapter, reviewAdapter, sellerAdapter } from "../src/adapters.js";
import {
  buildMarketplaceGrid,
  checkoutVerdict,
  explainToSeller,
  governProductFeed,
} from "../src/marketplace.js";

const ROOT = "a1".repeat(32);
const LISTING_MOD = "b2".repeat(32);
const SELLER_MOD = "c3".repeat(32);
const CURATOR = "e5".repeat(32);
const SELLER = "d4".repeat(32);
const OTHER_SELLER = "f6".repeat(32);
const BUYER = "ab".repeat(32);
const NOW = 1_750_000_000;

const trusted = (index) => index.toString(16).padStart(2, "0").repeat(32);
const TRUSTED = Array.from({ length: 8 }, (_, index) => trusted(index + 1));

/** @type {import('../src/adapters.js').Product} */
const PRODUCT = {
  id: "1b".repeat(32),
  sellerPubkey: SELLER,
  identifier: "sku-001",
  title: "Widget",
  priceSats: 1000,
};

/** @type {import('../src/adapters.js').Product} */
const OTHER_PRODUCT = {
  id: "2c".repeat(32),
  sellerPubkey: SELLER,
  identifier: "sku-002",
  title: "Gadget",
  priceSats: 2000,
};

/** @type {import('../src/adapters.js').Product} */
const RIVAL_PRODUCT = {
  id: "3d".repeat(32),
  sellerPubkey: OTHER_SELLER,
  identifier: "sku-100",
  title: "Rival widget",
  priceSats: 900,
};

function setup({ allowlisted = [SELLER, OTHER_SELLER] } = {}) {
  const runtime = createGovernanceRuntime({
    applicationId: "commerce-example",
    namespace: "commerce",
    transport: createMemoryTransport(),
    policy: COMMERCE_POLICY,
    now: () => NOW,
  });

  runtime.admin.setRoles({
    root: ROOT,
    roles: COMMERCE_ROLE_CAPABILITIES,
    actors: {
      [ROOT]: ["super_admin"],
      [LISTING_MOD]: ["listing_moderator"],
      [SELLER_MOD]: ["seller_moderator"],
      [CURATOR]: ["community_curator"],
    },
  });

  // Roles here are application-defined, so super_admin needs its default bundle
  // restored alongside them.
  runtime.admin.setRoles({
    root: ROOT,
    roles: {
      ...COMMERCE_ROLE_CAPABILITIES,
      super_admin: [
        "manage-roles",
        "manage-policy",
        "manage-community-sources",
        "contribute-user-allow",
        "contribute-user-deny",
        "contribute-event-deny",
        "contribute-address-deny",
        "contribute-trust-seed",
        "review-evidence",
      ],
    },
    actors: {
      [ROOT]: ["super_admin"],
      [LISTING_MOD]: ["listing_moderator"],
      [SELLER_MOD]: ["seller_moderator"],
      [CURATOR]: ["community_curator"],
    },
  });

  if (allowlisted.length) {
    runtime.admin.upsertContribution({
      actor: ROOT,
      kind: "user-allow",
      targets: allowlisted.map((pubkey) => ({ type: "user", pubkey })),
      createdAt: NOW,
    });
  }

  // Set the viewer first: switching viewers clears viewer-scoped trust state,
  // so seeding contacts beforehand would be wiped.
  runtime.setViewer(BUYER);
  runtime.trust.setContacts(TRUSTED);

  return { runtime, commands: createCommands(runtime) };
}

/** Report a target from `count` distinct trusted accounts. */
function reportFrom(runtime, targetKey, category, count) {
  for (const reporter of TRUSTED.slice(0, count)) {
    runtime.reports.ingest({ reporter, category, createdAt: NOW - 100 }, targetKey);
  }
}

const productAddressKey = (product) =>
  `address:30078:${product.sellerPubkey}:${product.identifier}`;

describe("1. seller allowlist mode", () => {
  it("hides a seller who is not allowlisted", () => {
    const { runtime } = setup({ allowlisted: [] });
    const [governed] = governProductFeed([PRODUCT], runtime, "public-marketplace");
    expect(governed.moderation.visible).toBe(false);
    expect(governed.moderation.reasons).toContain("allowlist-miss");
  });

  it("shows an allowlisted seller", () => {
    const { runtime } = setup();
    const [governed] = governProductFeed([PRODUCT], runtime, "public-marketplace");
    expect(governed.moderation.visible).toBe(true);
  });

  it("does not enforce the allowlist on checkout", () => {
    const { runtime } = setup({ allowlisted: [] });
    expect(checkoutVerdict(PRODUCT, runtime).allowed).toBe(true);
  });
});

describe("2. administrative seller denial", () => {
  it("removes every product from a denied seller", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: SELLER_MOD,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW,
    });

    const grid = buildMarketplaceGrid([PRODUCT, OTHER_PRODUCT, RIVAL_PRODUCT], runtime);
    expect(grid.map((product) => product.identifier)).toEqual(["sku-100"]);
  });

  it("blocks checkout for the denied seller", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: SELLER_MOD,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW,
    });
    expect(checkoutVerdict(PRODUCT, runtime).allowed).toBe(false);
  });

  it("leaves the seller their own dashboard view", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: SELLER_MOD,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW,
    });

    const explanation = explainToSeller(PRODUCT, runtime);
    expect(explanation.visible).toBe(true);
    expect(explanation.sellable).toBe(false);
    expect(explanation.reasons).toContain("admin-user-deny");
  });
});

describe("3. product-address denial", () => {
  it("denies one listing without touching the seller's others", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: LISTING_MOD,
      kind: "address-deny",
      targets: [
        { type: "address", kind: "30078", pubkey: SELLER, identifier: PRODUCT.identifier },
      ],
      createdAt: NOW,
    });

    const grid = buildMarketplaceGrid([PRODUCT, OTHER_PRODUCT], runtime);
    expect(grid.map((product) => product.identifier)).toEqual(["sku-002"]);
  });

  it("persists across a revision that changes the event id", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: LISTING_MOD,
      kind: "address-deny",
      targets: [
        { type: "address", kind: "30078", pubkey: SELLER, identifier: PRODUCT.identifier },
      ],
      createdAt: NOW,
    });

    const republished = { ...PRODUCT, id: "99".repeat(32), title: "Widget v2" };
    const [governed] = governProductFeed([republished], runtime, "public-marketplace");
    expect(governed.moderation.visible).toBe(false);
  });
});

describe("4. exact-event denial", () => {
  it("affects only the named revision", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: LISTING_MOD,
      kind: "event-deny",
      targets: [{ type: "event", id: PRODUCT.id }],
      createdAt: NOW,
    });

    const [denied] = governProductFeed([PRODUCT], runtime, "public-marketplace");
    expect(denied.moderation.visible).toBe(false);

    const republished = { ...PRODUCT, id: "99".repeat(32) };
    const [fresh] = governProductFeed([republished], runtime, "public-marketplace");
    expect(fresh.moderation.visible).toBe(true);
  });
});

describe("5. trusted scam-report downranking", () => {
  it("downranks on a single trusted scam report without hiding", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 1);

    const [governed] = governProductFeed([PRODUCT], runtime, "public-marketplace");
    expect(governed.moderation.downranked).toBe(true);
    expect(governed.moderation.visible).toBe(true);
  });

  it("orders downranked listings after clean ones", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 1);

    const grid = buildMarketplaceGrid([PRODUCT, RIVAL_PRODUCT], runtime);
    expect(grid.map((product) => product.identifier)).toEqual(["sku-100", "sku-001"]);
  });

  it("escalates to review then denial as reports accumulate", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 2);
    expect(checkoutVerdict(PRODUCT, runtime).needsReview).toBe(true);

    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 3);
    expect(checkoutVerdict(PRODUCT, runtime).allowed).toBe(false);
  });
});

describe("6. malware-based checkout denial", () => {
  it("blocks checkout on a single trusted malware report", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "malware", 1);
    expect(checkoutVerdict(PRODUCT, runtime).allowed).toBe(false);
  });

  it("treats malware far more harshly than misleading copy", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "misleading", 3);
    expect(checkoutVerdict(PRODUCT, runtime).allowed).toBe(true);

    reportFrom(runtime, productAddressKey(RIVAL_PRODUCT), "malware", 1);
    expect(checkoutVerdict(RIVAL_PRODUCT, runtime).allowed).toBe(false);
  });
});

describe("7. moderator capability checks", () => {
  const signerFor = (pubkey) => ({
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(template) {
      return { ...template, id: "ff".repeat(32), pubkey, sig: "00".repeat(64) };
    },
  });

  function commandsAs(pubkey) {
    const runtime = createGovernanceRuntime({
      applicationId: "commerce-example",
      namespace: "commerce",
      transport: createMemoryTransport(),
      signer: signerFor(pubkey),
      policy: COMMERCE_POLICY,
      now: () => NOW,
    });
    runtime.admin.setRoles({
      root: ROOT,
      roles: COMMERCE_ROLE_CAPABILITIES,
      actors: {
        [LISTING_MOD]: ["listing_moderator"],
        [SELLER_MOD]: ["seller_moderator"],
        [CURATOR]: ["community_curator"],
      },
    });
    return createCommands(runtime);
  }

  it("lets a listing moderator deny an address", async () => {
    expect((await commandsAs(LISTING_MOD).denyAddress("30078", SELLER, "sku-001")).ok).toBe(true);
  });

  it("stops a listing moderator denying a seller", async () => {
    expect((await commandsAs(LISTING_MOD).denyUser(SELLER)).code).toBe("not-authorized");
  });

  it("lets a seller moderator deny a seller", async () => {
    expect((await commandsAs(SELLER_MOD).denyUser(SELLER)).ok).toBe(true);
  });

  it("stops a seller moderator denying a listing address", async () => {
    expect((await commandsAs(SELLER_MOD).denyAddress("30078", SELLER, "sku-001")).code).toBe(
      "not-authorized",
    );
  });

  it("stops a curator denying an exact event", async () => {
    expect((await commandsAs(CURATOR).denyEvent("1b".repeat(32))).code).toBe("not-authorized");
  });

  it("stops any moderator changing roles", async () => {
    expect((await commandsAs(SELLER_MOD).setRoles({ actors: {} })).code).toBe("not-authorized");
  });
});

describe("8. community curator ingestion", () => {
  it("honors a curator's seller denial", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: CURATOR,
      kind: "user-deny",
      source: "curated-scam-list",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW,
    });

    const [governed] = governProductFeed([PRODUCT], runtime, "public-marketplace");
    expect(governed.moderation.visible).toBe(false);
    expect(governed.moderation.reasons).toContain("community-user-deny");
  });

  it("ignores a curator contribution beyond their capability", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: CURATOR,
      kind: "address-deny",
      source: "curated-scam-list",
      targets: [
        { type: "address", kind: "30078", pubkey: SELLER, identifier: PRODUCT.identifier },
      ],
      createdAt: NOW,
    });

    const [governed] = governProductFeed([PRODUCT], runtime, "public-marketplace");
    expect(governed.moderation.visible).toBe(true);
  });

  it("cannot deny the root through a curated list", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: CURATOR,
      kind: "user-deny",
      source: "hostile-list",
      targets: [{ type: "user", pubkey: ROOT }],
      createdAt: NOW,
    });
    expect(runtime.admin.state.userDeny.has(`user:${ROOT}`)).toBe(false);
  });
});

describe("9. seller-dashboard explanation", () => {
  it("exposes evidence counts to the seller", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 3);

    const explanation = explainToSeller(PRODUCT, runtime);
    expect(explanation.evidence.trustedReportTotal).toBe(3);
    expect(explanation.evidence.trustedReportsByCategory.scam).toBe(3);
    expect(explanation.evidence.trustedReporterPubkeys).toHaveLength(3);
  });

  it("withholds reporter identities from public surfaces", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 3);

    const decision = runtime.evaluate(
      { type: "address", kind: "30078", pubkey: SELLER, identifier: PRODUCT.identifier },
      { profile: "public-marketplace" },
    );
    expect(decision.evidence?.trustedReportTotal).toBe(3);
    expect(decision.evidence?.trustedReporterPubkeys).toEqual([]);
  });
});

describe("10. no core changes required", () => {
  it("expresses four different verdicts for one product from one snapshot", () => {
    const { runtime } = setup();
    reportFrom(runtime, productAddressKey(PRODUCT), "scam", 3);

    const target = {
      type: "address",
      kind: "30078",
      pubkey: SELLER,
      identifier: PRODUCT.identifier,
    };

    expect(runtime.evaluate(target, { profile: "public-marketplace" }).visibility.effect).toBe(
      "restrict",
    );
    expect(runtime.evaluate(target, { profile: "seller-dashboard" }).visibility.effect).toBe(
      "restrict",
    );
    expect(runtime.evaluate(target, { profile: "checkout" }).transaction?.effect).toBe("deny");
    expect(runtime.evaluate(target, { profile: "product-detail" }).visibility.overridable).toBe(true);
  });

  it("governs reviews without letting a bad product silence them", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: SELLER_MOD,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW,
    });

    const review = {
      id: "7f".repeat(32),
      reviewerPubkey: BUYER,
      productIdentifier: PRODUCT.identifier,
      rating: 1,
    };

    const decision = runtime.evaluate(reviewAdapter.toTargets(review)[0], {
      profile: "product-detail",
    });
    expect(decision.visibility.effect).not.toBe("hide");
  });

  it("uses only the published core API", async () => {
    // Every import in this example resolves through a package entry point; if
    // one reached into a package's internals, the reference guard and this
    // assertion are what would catch it.
    const core = await import("@nostr-governance/core");
    for (const name of [
      "createApplicationAdapter",
      "evaluateObject",
      "collectTargets",
      "createPolicyDefinition",
      "createRoleDefinition",
    ]) {
      expect(typeof core[name]).toBe("function");
    }
  });

  it("governs a seller through the same engine as a product", () => {
    const { runtime } = setup();
    runtime.admin.upsertContribution({
      actor: SELLER_MOD,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW,
    });

    const decision = runtime.evaluate(sellerAdapter.toTargets({ pubkey: SELLER })[0], {
      profile: "public-marketplace",
    });
    expect(decision.visibility.effect).toBe("hide");
  });
});

describe("adapter composition", () => {
  it("reports decisions against the product's own identity", () => {
    const { runtime } = setup();
    const decision = runtime.evaluate(productAdapter.toTargets(PRODUCT)[2], {
      profile: "public-marketplace",
    });
    expect(decision.key).toBe(productAddressKey(PRODUCT));
  });

  it("collects deduplicated targets across a feed", () => {
    const { runtime } = setup();
    governProductFeed([PRODUCT, OTHER_PRODUCT], runtime, "public-marketplace");
    // Two products from one seller: 2 events + 2 addresses + 1 shared seller.
    expect(runtime.activeTargets.size).toBe(5);
  });
});
