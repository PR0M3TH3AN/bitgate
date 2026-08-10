import {
    createBitGate,
    createMemoryTransport,
    defineBitGateElements,
    COMMERCE_POLICY,
  } from "../vendor/bitgate/bitgate.js";

  defineBitGateElements();

  const key = (seed) => seed.repeat(64).slice(0, 64);
  const ROOT = key("a1");
  const LISTING_MOD = key("b2");
  const SELLER_MOD = key("c3");
  const SELLER = key("d4");
  const SHOPPER = key("e5");
  const NOW = Math.floor(Date.now() / 1000);
  const trusted = (index) => key(index.toString(16).padStart(2, "0"));

  const TARGET = { type: "address", kind: "30078", pubkey: SELLER, identifier: "sku-001" };
  const TARGET_KEY = `address:30078:${SELLER}:sku-001`;
  const PROFILES = ["browse", "detail", "checkout", "seller-dashboard"];
  const VIEWERS = { shopper: SHOPPER, listing: LISTING_MOD, seller: SELLER_MOD };

  // An in-memory transport keeps the demo deterministic: nothing is fetched and
  // nothing is published, so it works offline and cannot touch real relays.
  const runtime = createBitGate({
    applicationId: "bitgate-demo",
    namespace: "demo",
    root: ROOT,
    transport: createMemoryTransport(),
    policy: COMMERCE_POLICY,
    now: () => NOW,
  });

  const COMMERCE_ROLES = {
    listing_moderator: ["contribute-event-deny", "contribute-address-deny", "review-evidence"],
    seller_moderator: ["contribute-user-deny", "review-evidence"],
    super_admin: [
      "manage-roles", "manage-policy", "manage-community-sources",
      "contribute-user-allow", "contribute-user-deny", "contribute-event-deny",
      "contribute-address-deny", "contribute-trust-seed", "review-evidence",
    ],
  };

  let reportCount = 0;
  let muteCount = 0;

  function seedRoster() {
    runtime.admin.setRoles({
      root: ROOT,
      roles: COMMERCE_ROLES,
      actors: {
        [ROOT]: ["super_admin"],
        [LISTING_MOD]: ["listing_moderator"],
        [SELLER_MOD]: ["seller_moderator"],
      },
    });
  }

  function setViewer(name) {
    runtime.setViewer(VIEWERS[name]);
    // Viewer switching clears viewer-scoped state by design, so trust is
    // re-seeded afterwards — the same order a real integration must use.
    runtime.trust.setContacts(Array.from({ length: 24 }, (_, i) => trusted(i + 1)));
  }

  function reset() {
    reportCount = 0;
    muteCount = 0;
    runtime.reports.clearTarget(TARGET_KEY);
    runtime.mutes.lists.clear();
    runtime.admin.setContributions([]);
    seedRoster();
    setViewer("shopper");
    runtime.invalidateDecisions();
    render();
  }

  const veil = document.getElementById("veil");
  const caps = document.getElementById("caps");
  veil.runtime = runtime;
  veil.target = TARGET;
  caps.runtime = runtime;

  function render() {
    const body = document.querySelector("#surfaces tbody");
    body.innerHTML = PROFILES.map((profile) => {
      const decision = runtime.evaluate(TARGET, { profile });
      const transaction = decision.transaction?.effect ?? "allow";
      return `<tr>
        <td><code>${profile}</code></td>
        <td><span class="verdict ${decision.visibility.effect}">${decision.visibility.effect}</span></td>
        <td><span class="verdict ${transaction}">${transaction}</span></td>
        <td><span class="verdict ${decision.ranking.effect === "downrank" ? "downrank" : "allow"}">${decision.ranking.effect}</span></td>
      </tr>`;
    }).join("");

    const detail = runtime.evaluate(TARGET, { profile: "seller-dashboard" });
    const reasons = detail.reasons.map((reason) => reason.id);
    document.getElementById("reasons").innerHTML = reasons.length
      ? reasons.map((id) => `<li><code>${id}</code></li>`).join("")
      : "<li>No governance signals yet — add some evidence.</li>";
  }

  runtime.on("change", render);

  document.getElementById("add-scam").addEventListener("click", () => {
    reportCount += 1;
    runtime.reports.ingest(
      { reporter: trusted(reportCount), category: "scam", createdAt: NOW - 60 },
      TARGET_KEY,
    );
  });

  document.getElementById("add-malware").addEventListener("click", () => {
    reportCount += 1;
    runtime.reports.ingest(
      { reporter: trusted(reportCount), category: "malware", createdAt: NOW - 60 },
      TARGET_KEY,
    );
  });

  document.getElementById("add-mute").addEventListener("click", () => {
    muteCount += 1;
    runtime.mutes.replaceList({
      owner: trusted(muteCount),
      updatedAt: NOW - 60,
      entries: [{ pubkey: SELLER }],
      hasEncryptedEntries: false,
    });
  });

  document.getElementById("deny-seller").addEventListener("click", () => {
    runtime.admin.upsertContribution({
      actor: SELLER_MOD,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: SELLER }],
      createdAt: NOW + reportCount + muteCount,
    });
  });

  document.getElementById("block").addEventListener("click", () => {
    runtime.trust.setBlocks([SELLER]);
  });

  document.getElementById("reset").addEventListener("click", reset);

  for (const button of document.querySelectorAll("[data-viewer]")) {
    button.addEventListener("click", () => setViewer(button.dataset.viewer));
  }

  reset();
