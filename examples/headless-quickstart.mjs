/**
 * BitGate, headless — the whole round-trip in one file, no DOM, no widget.
 *
 *   moderators publish signed NIP-32 label events (kind 1985)   <- the wire format
 *        -> check every signature, drop what fails               <- required, no unverified mode
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
import { schnorr } from "@noble/curves/secp256k1";

import {
  createAuthorityState,
  createEventTarget,
  createPolicyDefinition,
  createSnapshot,
  evaluateTarget,
  reduceAdminState,
} from "@bitgate/core";
import { encodeLabel, readLabelContributions } from "@bitgate/nostr";
import { computeEventId, verifyEvent } from "@bitgate/verify";

// --- identities ---------------------------------------------------------------
// Secret keys 1, 2 and 3 are public TEST keys, known to everyone, so this file
// can really sign. In production each moderator signs with their own signer
// (BitLogin, a NIP-07 extension); no secret key ever sits in your app.
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const testKey = (n) => n.toString(16).padStart(64, "0");
const ROOT = hex(schnorr.getPublicKey(testKey(1)));
const MOD_A_KEY = testKey(2);
const MOD_B_KEY = testKey(3);
const MOD_A = hex(schnorr.getPublicKey(MOD_A_KEY));
const MOD_B = hex(schnorr.getPublicKey(MOD_B_KEY));
const CLEAN_PLUGIN = "d4".repeat(32); // a well-behaved plugin release (event id)
const MALWARE_PLUGIN = "e5".repeat(32); // ships a keylogger
const NOW = 1_750_000_000;
const NAMESPACE = "org.bitblocks.plugins";

// --- 1. Moderators publish signed NIP-32 labels denying the bad plugin ---------
// encodeLabel returns the event TEMPLATE; the moderator's signer fills in
// pubkey, id and sig.
function sign(secretKey, template) {
  const event = { ...template, pubkey: hex(schnorr.getPublicKey(secretKey)), created_at: NOW };
  const id = computeEventId(event);
  return { ...event, id, sig: hex(schnorr.sign(id, secretKey, new Uint8Array(32))) };
}
const denyMalware = (content) =>
  encodeLabel({ value: "deny", namespace: NAMESPACE, targets: [createEventTarget(MALWARE_PLUGIN)], content });

const relayEvents = [
  sign(MOD_A_KEY, denyMalware("ships an undisclosed keylogger")),
  // MOD_B independently agrees: labels compose.
  sign(MOD_B_KEY, denyMalware("confirmed: exfiltrates clipboard")),
  // A relay hands over a label claiming MOD_A's key that MOD_A never signed —
  // it would deny the clean plugin. Its signature does not match, so it is dropped.
  {
    ...sign(MOD_A_KEY, denyMalware("")),
    tags: [["L", NAMESPACE], ["l", "deny", NAMESPACE], ["e", CLEAN_PLUGIN]],
  },
];

// --- 2. The honored moderator set, resolved as data (not hard-coded UI) ------
// In production resolve it with resolveVerifiedRoster from the root's signed
// kind-30000 set — adding a moderator needs no redeploy.
const authority = createAuthorityState({
  root: ROOT,
  actors: { [MOD_A]: ["moderator"], [MOD_B]: ["moderator"] },
});

// --- 3. Verify -> labels -> contributions -> admin state ----------------------
// readLabelContributions checks every signature (verifyEvent here, or your own
// NIP-01 check) and throws without one: there is no unverified mode.
const { contributions, dropped } = readLabelContributions(relayEvents, {
  verify: verifyEvent,
  namespace: NAMESPACE,
  denyValues: ["deny"],
  allowValues: ["allow"],
});
// reduceAdminState only honors contributions from actors the authority permits,
// so an unauthorized "labeller" publishing a deny changes nothing either.
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
console.log(`  dropped ${dropped.unverified} label that failed its signature check\n`);
report("clean plugin", CLEAN_PLUGIN);
report("malware plugin", MALWARE_PLUGIN);
console.log(`
The malware plugin is still VISIBLE (visible=warn) but installable=false: the
transaction dimension gated the install without hiding the listing. A single
"hidden" boolean can't say "show it, but don't let anyone install it." Swap the
fake relay events for a real subscription to kind-1985 labels from your honored
moderators and this same code is your production enforcement.`);
