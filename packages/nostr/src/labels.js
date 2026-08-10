// NIP-32 labelling (kind 1985).
//
// This is BitGate's interop surface. Contribution lists are a private
// vocabulary; NIP-32 is the shared one. Emitting labels lets other clients
// honour this deployment's moderators, and consuming them lets BitGate treat a
// third-party labeller as a moderation source.
//
// The codec is deliberately general. A label is (namespace, value, target) and
// says nothing about denial on its own — "MIT", "nsfw", and "spam" are all
// labels. What a given label *means* to an application is a policy decision, so
// the mapping to BitGate's allow/deny model is data-driven and lives in the
// caller's configuration, not baked in here.

import { normalizeEventIdInput, normalizePubkeyInput } from "./nip19.js";
import { getTags } from "./replaceable.js";
import { decodeAddressCoordinate } from "./canonical.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').GovernanceTarget} GovernanceTarget
 * @typedef {import('@bitgate/core').Contribution} Contribution
 */

/** NIP-32 label kind. */
export const LABEL_KIND = 1985;

/**
 * @typedef {Object} Label
 * @property {string} namespace - The `L` value, or "" for an unnamespaced label
 * @property {string} value - The `l` value
 * @property {GovernanceTarget[]} targets - Everything the label points at
 * @property {string} labeller - Pubkey that published the label
 * @property {string} content - Free-text explanation, per NIP-32
 * @property {number} createdAt
 */

/**
 * Read the governance targets a label event points at.
 *
 * Supports `e`, `p`, and `a` — the target types BitGate governs. `r` (relays)
 * and `t` (topics) are valid NIP-32 targets but have no place in an allow/deny
 * model, so they are skipped rather than misrepresented as something they are
 * not.
 *
 * @param {NostrEvent} event
 * @returns {GovernanceTarget[]}
 */
export function labelTargets(event) {
  /** @type {GovernanceTarget[]} */
  const targets = [];

  for (const tag of getTags(event, "p")) {
    const pubkey = normalizePubkeyInput(tag[1]);
    if (pubkey) {
      targets.push({ type: "user", pubkey });
    }
  }
  for (const tag of getTags(event, "e")) {
    const id = normalizeEventIdInput(tag[1]);
    if (id) {
      targets.push({ type: "event", id });
    }
  }
  for (const tag of getTags(event, "a")) {
    const target = decodeAddressCoordinate(tag[1]);
    if (target) {
      targets.push(target);
    }
  }

  return targets;
}

/**
 * Decode a kind 1985 label event into its individual labels.
 *
 * One event can carry several `l` values across namespaces; each becomes its
 * own {@link Label} so a consumer can filter by namespace and value
 * independently. A label with no matching `L` mark keeps namespace "".
 *
 * @param {NostrEvent} event
 * @returns {Label[]}
 */
export function decodeLabels(event) {
  if (!event || event.kind !== LABEL_KIND) {
    return [];
  }

  const labeller = normalizePubkeyInput(event.pubkey);
  if (!labeller) {
    return [];
  }

  const namespaces = new Set(getTags(event, "L").map((tag) => (typeof tag[1] === "string" ? tag[1] : "")));
  const targets = labelTargets(event);
  const createdAt = Number.isFinite(event.created_at) ? event.created_at : 0;
  const content = typeof event.content === "string" ? event.content : "";

  /** @type {Label[]} */
  const labels = [];

  for (const tag of getTags(event, "l")) {
    const value = typeof tag[1] === "string" ? tag[1].trim() : "";
    if (!value) {
      continue;
    }
    // Per NIP-32 the mark is the third element and references an `L` value.
    // Honour it only when it matches a declared namespace; an unmatched mark is
    // treated as unnamespaced rather than silently trusted.
    const mark = typeof tag[2] === "string" ? tag[2].trim() : "";
    const namespace = mark && namespaces.has(mark) ? mark : "";

    labels.push({ namespace, value, targets, labeller, content, createdAt });
  }

  return labels;
}

/**
 * @typedef {Object} LabelMapping
 * @property {string} [namespace] - Only labels in this namespace map; "" matches unnamespaced
 * @property {string[]} [denyValues] - Label values that mean "deny the target"
 * @property {string[]} [allowValues] - Label values that mean "allow the target"
 */

/**
 * Turn decoded labels into BitGate contributions.
 *
 * This is where an application's vocabulary is applied. Only labels in the
 * configured namespace whose value is in `denyValues`/`allowValues` produce a
 * contribution; everything else is ignored, because most labels are
 * categorisation rather than moderation.
 *
 * The resulting contributions are *not* privileged by being labels. They still
 * pass through the same capability gate as any contribution when reduced, so a
 * label only denies someone if its author holds the capability — exactly like a
 * community source. The `source` marker records which labeller it came from.
 *
 * @param {Label[]} labels
 * @param {LabelMapping} [mapping]
 * @returns {Contribution[]}
 */
export function labelsToContributions(labels, mapping = {}) {
  const namespace = mapping.namespace ?? "";
  const denyValues = new Set((mapping.denyValues ?? ["deny"]).map((value) => value.toLowerCase()));
  const allowValues = new Set((mapping.allowValues ?? []).map((value) => value.toLowerCase()));

  /** @type {Contribution[]} */
  const contributions = [];

  for (const label of labels ?? []) {
    if (label.namespace !== namespace) {
      continue;
    }

    const value = label.value.toLowerCase();
    const isDeny = denyValues.has(value);
    const isAllow = allowValues.has(value);
    if (!isDeny && !isAllow) {
      continue;
    }

    // A label points at mixed target types; each maps to the contribution kind
    // that fits it. Allow is only meaningful for users, matching the allowlist
    // model, so non-user allow targets are dropped.
    for (const target of label.targets) {
      /** @type {Contribution["kind"]|null} */
      let kind = null;
      if (isAllow) {
        kind = target.type === "user" ? "user-allow" : null;
      } else if (target.type === "user") {
        kind = "user-deny";
      } else if (target.type === "event") {
        kind = "event-deny";
      } else if (target.type === "address") {
        kind = "address-deny";
      }
      if (!kind) {
        continue;
      }

      contributions.push({
        actor: label.labeller,
        kind,
        targets: [target],
        createdAt: label.createdAt,
        source: `label:${namespace || "-"}:${label.labeller}`,
      });
    }
  }

  return contributions;
}

/**
 * Encode a label event template.
 *
 * @param {Object} label
 * @param {string} label.value - The `l` value
 * @param {string} [label.namespace] - The `L` namespace; omitted for an unnamespaced label
 * @param {GovernanceTarget[]} label.targets
 * @param {string} [label.content] - Explanation
 * @param {Record<string, string>} [label.relayHints] - Target key to relay hint
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function encodeLabel({ value, namespace, targets, content = "", relayHints = {} }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A label requires a non-empty value");
  }

  /** @type {string[][]} */
  const tags = [];

  if (namespace && namespace.trim()) {
    tags.push(["L", namespace.trim()]);
    tags.push(["l", value.trim(), namespace.trim()]);
  } else {
    tags.push(["l", value.trim()]);
  }

  for (const target of targets ?? []) {
    if (target.type === "user") {
      const hint = relayHints[`user:${target.pubkey}`];
      tags.push(hint ? ["p", target.pubkey, hint] : ["p", target.pubkey]);
    } else if (target.type === "event") {
      const hint = relayHints[`event:${target.id}`];
      tags.push(hint ? ["e", target.id, hint] : ["e", target.id]);
    } else if (target.type === "address") {
      tags.push(["a", `${target.kind}:${target.pubkey}:${target.identifier}`]);
    }
  }

  return { kind: LABEL_KIND, content, tags };
}

/**
 * Encode a BitGate contribution as a NIP-32 label, for publishing.
 *
 * The inverse of {@link labelsToContributions}: a deny/allow contribution
 * becomes a label other clients can read. The label value defaults to the
 * verb, so a plain consumer sees a `deny`/`allow` label in the given namespace.
 *
 * @param {Contribution} contribution
 * @param {Object} options
 * @param {string} options.namespace
 * @param {string} [options.denyValue] - Label value used for denials
 * @param {string} [options.allowValue] - Label value used for allowances
 * @param {string} [options.content]
 * @returns {{ kind: number, content: string, tags: string[][] }}
 */
export function contributionToLabel(contribution, { namespace, denyValue = "deny", allowValue = "allow", content = "" }) {
  const value = contribution.kind === "user-allow" ? allowValue : denyValue;
  return encodeLabel({
    value,
    namespace,
    targets: contribution.targets ?? [],
    content,
  });
}
