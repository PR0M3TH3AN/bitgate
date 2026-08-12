/**
 * BitGate, headless — the whole round-trip in one file, no DOM, no widget.
 *
 *   moderators publish signed NIP-32 label events (kind 1985)   <- the wire format
 *        -> decode them on the client
 *        -> map labels to governance contributions
 *        -> reduce to admin state under an honored moderator set  <- moderator set as data
 *        -> evaluate a target against a policy
 *        -> apply the decision                                    <- your UI / app logic
 *
 * The point the widget on-ramp hides: a decision has four dimensions, and the
 * `transaction` one gates a NON-visual action. A plugin can be visible (you see
 * the listing, with a warning) yet not installable — something a single `hidden`
 * boolean can't express. NIP-32 labels are the canonical, interoperable decision
 * event; see docs/labels.md.
 *
 *   node examples/headless-quickstart.mjs
 */
import {
  createAuthorityState,
  createEventTarget,
  createPolicyDefinition,
  createSnapshot,
  evaluateTarget,
  reduceAdminState,
} from "@bitgate/core";
import { decodeLabels, encodeLabel, labelsToContributions } from "@bitgate/nostr";

// --- identities (64-hex, as on the wire) -----------------------------------
const ROOT = "a1".repeat(32);
const MOD_A = "b2".repeat(32);
const MOD_B = "c3".repeat(32);
const CLEAN_PLUGIN = "d4".repeat(32); // a well-behaved plugin release (event id)
const MALWARE_PLUGIN = "e5".repeat(32); // ships a keylogger
const NOW = 1_750_000_000;
const NAMESPACE = "org.bitblocks.plugins";

// --- 1. A moderator publishes a signed NIP-32 label denying the bad plugin ---
// encodeLabel returns the event TEMPLATE; in production your signer fills in
// pubkey/id/sig. Here we simulate a signed event by attaching the labeller.
function signedLabelEvent(labellerPubkey, template) {
  return { ...template, pubkey: labellerPubkey, created_at: NOW, id: "0".repeat(64), sig: "" };
}

const relayEvents = [
  signedLabelEvent(
    MOD_A,
    encodeLabel({
      value: "deny",
      namespace: NAMESPACE,
      targets: [createEventTarget(MALWARE_PLUGIN)],
      content: "ships an undisclosed keylogger",
    }),
  ),
  // MOD_B independently agrees — labels compose; one honored labeller is enough
  // here, but real deployments want more than one before a deny sticks.
  signedLabelEvent(
    MOD_B,
    encodeLabel({
      value: "deny",
      namespace: NAMESPACE,
      targets: [createEventTarget(MALWARE_PLUGIN)],
      content: "confirmed: exfiltrates clipboard",
    }),
  ),
];

// --- 2. The honored moderator set, resolved as data (not hard-coded UI) ------
// In production you resolve this from a signed, root-controlled Nostr set and
// pass the pubkeys here — adding a moderator needs no redeploy.
const authority = createAuthorityState({
  root: ROOT,
  actors: { [MOD_A]: ["moderator"], [MOD_B]: ["moderator"] },
});

// --- 3. Decode labels -> contributions -> admin state ------------------------
const labels = relayEvents.flatMap((event) => decodeLabels(event));
const contributions = labelsToContributions(labels, {
  namespace: NAMESPACE,
  denyValues: ["deny"],
  allowValues: ["allow"],
});
// reduceAdminState only honors contributions from actors the authority permits,
// so an unauthorized "labeller" publishing a deny changes nothing.
const admin = reduceAdminState(contributions, authority);
const snapshot = createSnapshot({ authority, admin });

// --- 4. A plugin-registry policy. A denied plugin stays VISIBLE with a warning
//        but is NOT installable — the four-dimension model's whole point. ------
const registryPolicy = createPolicyDefinition({
  id: "plugin-registry",
  name: "Plugin registry",
  version: "1.0.0",
  defaultProfile: "registry",
  profiles: {
    registry: {
      name: "registry",
      administrativeDeny: { visibility: "warn", interaction: "allow", transaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: false,
      reports: {},
      mutes: {},
    },
  },
});

// --- 5. Evaluate, and apply the decision to a NON-visual action --------------
function report(name, eventId) {
  const decision = evaluateTarget(createEventTarget(eventId), snapshot, {
    surface: "registry",
    policyProfile: "registry",
    policy: registryPolicy,
    now: NOW,
  });
  const installable = (decision.transaction?.effect ?? "allow") === "allow";
  console.log(
    `  ${name.padEnd(16)} visible=${decision.visibility.effect.padEnd(6)} installable=${installable}` +
      (decision.reasons.length ? `   (${decision.reasons.map((r) => r.id).join(", ")})` : ""),
  );
}

console.log("Plugin registry decisions (headless, from NIP-32 labels over relays):\n");
report("clean plugin", CLEAN_PLUGIN);
report("malware plugin", MALWARE_PLUGIN);
console.log(`
The malware plugin is still VISIBLE (visible=warn) but installable=false: the
transaction dimension gated the install without hiding the listing. A single
"hidden" boolean can't say "show it, but don't let anyone install it." Swap the
fake relay events for a real subscription to kind-1985 labels from your honored
moderators and this same code is your production enforcement.`);
