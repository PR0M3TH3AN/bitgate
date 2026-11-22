// Verified readers for the headless path.
//
// The codecs (decodeLabels, labelsToContributions, decodeContribution,
// resolveAuthorityRoster) read events they assume are already trusted: an
// event's `pubkey` is only a claim until its signature is checked, and a
// relay can fabricate anything. The runtime and the widget check signatures
// themselves and fail closed. An application on the headless path — events
// in hand, the engine and nothing else — had to remember to do it.
//
// These readers make it the only way in: each takes a `verify` function and
// throws without one. There is no unverified mode. Pass `verifyEvent` from
// `@bitgate/verify`, or your own NIP-01 check (BitUnlock's nostr-tools
// `verifyEvent`, the NSWP kit's own) so no second copy of the curve library
// ships. Anything but `true` is a failed check, including a promise: an
// asynchronous verifier must be awaited before calling, on the events, by
// the caller.
//
// The old codec functions stay as they are, for callers that verify upstream.

import { decodeContribution, isCanonicalGovernanceEvent } from "./canonical.js";
import { decodeLabels, labelsToContributions } from "./labels.js";
import { selectReplaceable } from "./replaceable.js";
import { resolveAuthorityRoster } from "./roster.js";

/**
 * @typedef {import('./replaceable.js').NostrEvent} NostrEvent
 * @typedef {import('@bitgate/core').Contribution} Contribution
 * @typedef {(event: NostrEvent) => boolean} Verifier
 */

/**
 * @typedef {Object} Dropped
 * @property {number} unverified - Events whose signature check did not return `true`
 */

/**
 * @param {unknown} verify
 * @param {string} reader
 * @returns {asserts verify is Verifier}
 */
function requireVerifier(verify, reader) {
  if (typeof verify !== "function") {
    throw new TypeError(
      `${reader} needs a signature check: pass { verify } (verifyEvent from @bitgate/verify, or your own NIP-01 check). There is no unverified mode.`,
    );
  }
}

/**
 * Keep only the events whose signature checks.
 *
 * @param {unknown[]} events
 * @param {Verifier} verify
 * @returns {{ events: NostrEvent[], dropped: Dropped }}
 */
export function keepVerified(events, verify) {
  requireVerifier(verify, "keepVerified");
  /** @type {NostrEvent[]} */
  const kept = [];
  let unverified = 0;
  for (const event of Array.isArray(events) ? events : []) {
    let ok = false;
    try {
      ok = verify(/** @type {NostrEvent} */ (event)) === true;
    } catch {
      ok = false;
    }
    if (ok) {
      kept.push(/** @type {NostrEvent} */ (event));
    } else {
      unverified += 1;
    }
  }
  return { events: kept, dropped: { unverified } };
}

/**
 * NIP-32 label events (kind 1985) to contributions, verified.
 *
 * @param {unknown[]} events - Label events as relays returned them
 * @param {Object} options
 * @param {Verifier} options.verify
 * @param {string} [options.namespace]
 * @param {string[]} [options.denyValues]
 * @param {string[]} [options.allowValues]
 * @returns {{ contributions: Contribution[], dropped: Dropped }}
 */
export function readLabelContributions(events, { verify, ...mapping } = /** @type {any} */ ({})) {
  requireVerifier(verify, "readLabelContributions");
  const { events: trusted, dropped } = keepVerified(events, verify);
  const labels = trusted.flatMap((event) => decodeLabels(event));
  return { contributions: labelsToContributions(labels, mapping), dropped };
}

/**
 * Application-wide governance lists (kind 30078) to contributions, verified.
 *
 * Only signed copies are candidates, so an unsigned event cannot replace a
 * list; the newest signed copy per signer and `d` wins.
 *
 * @param {unknown[]} events
 * @param {Object} options
 * @param {Verifier} options.verify
 * @param {string} [options.namespace] - Read only this application's lists
 * @returns {{ contributions: Contribution[], dropped: Dropped }}
 */
export function readContributionLists(events, { verify, namespace } = /** @type {any} */ ({})) {
  requireVerifier(verify, "readContributionLists");
  const { events: trusted, dropped } = keepVerified(events, verify);
  const lists = trusted.filter((event) => isCanonicalGovernanceEvent(event, namespace));
  /** @type {Contribution[]} */
  const contributions = [];
  for (const event of selectReplaceable(lists).values()) {
    const contribution = decodeContribution(event);
    if (contribution) {
      contributions.push(contribution);
    }
  }
  return { contributions, dropped };
}

/**
 * Resolve the honored moderator set from kind-30000 role sets, verified.
 *
 * Same as `resolveAuthorityRoster`, but an unsigned or forged role set never
 * reaches it, so nobody can name themselves a moderator by claiming the
 * root's pubkey.
 *
 * @param {unknown[]} events
 * @param {Object} options
 * @param {Verifier} options.verify
 * @param {string} [options.root]
 * @param {string} [options.rootRole]
 * @param {import('./roster.js').RosterSpec[]} [options.rosters]
 * @returns {{ root: string, actors: Record<string, string[]>, dropped: Dropped }}
 */
export function resolveVerifiedRoster(events, { verify, ...options } = /** @type {any} */ ({})) {
  requireVerifier(verify, "resolveVerifiedRoster");
  const { events: trusted, dropped } = keepVerified(events, verify);
  return { ...resolveAuthorityRoster(trusted, options), dropped };
}
