// Reference application profile for the extraction's characterization corpus.
//
// These values are one application's configuration, not governance defaults.
// They live outside @nostr-governance/core on purpose: the core engine must
// carry no application thresholds, and this file is what proves the generic
// engine can reproduce a real deployment's behavior.
//
// Values characterized from the pinned reference commit (see
// docs/reference-map.md). Changing a number here should break a conformance
// fixture — that is the point.

import { createPolicyDefinition } from "@nostr-governance/core";

/** Trusted reports needed before a thumbnail is blurred. */
export const BLUR_THRESHOLD = 3;

/** Trusted reports needed before automatic playback is withheld. */
export const AUTOPLAY_BLOCK_THRESHOLD = 3;

/** Unique trusted muters needed before a target is hidden. */
export const TRUSTED_MUTE_HIDE_THRESHOLD = 20;

/** Trusted spam reports needed before a target is hidden. */
export const TRUSTED_SPAM_HIDE_THRESHOLD = 5;

/** Trusted mutes older than this are ignored. */
export const TRUSTED_MUTE_WINDOW_DAYS = 60;
export const TRUSTED_MUTE_WINDOW_SECONDS = TRUSTED_MUTE_WINDOW_DAYS * 24 * 60 * 60;

/**
 * Report thresholds shared by every surface.
 *
 * `restrict` at the blur threshold is the blur; `requireExplicitAction` at the
 * autoplay threshold is the withheld autoplay. Spam escalates to a hide at its
 * own higher threshold, while other categories never hide on reports alone.
 *
 * @type {Record<string, import('@nostr-governance/core').CategoryThresholds>}
 */
const REPORT_THRESHOLDS = {
  default: {
    restrict: BLUR_THRESHOLD,
    requireExplicitAction: AUTOPLAY_BLOCK_THRESHOLD,
  },
  spam: {
    restrict: BLUR_THRESHOLD,
    requireExplicitAction: AUTOPLAY_BLOCK_THRESHOLD,
    hide: TRUSTED_SPAM_HIDE_THRESHOLD,
  },
};

/**
 * Trusted mutes downrank from the first muter and only hide at the threshold.
 *
 * Below the hide threshold a trusted mute is a ranking signal only: it must not
 * blur, must not block playback, and must not read as an administrative denial.
 *
 * @type {Record<string, import('@nostr-governance/core').CategoryThresholds>}
 */
const MUTE_THRESHOLDS = {
  default: {
    downrank: 1,
    hide: TRUSTED_MUTE_HIDE_THRESHOLD,
  },
};

/**
 * The reference application's policy definition.
 *
 * Surfaces differ only in how they treat a hide and whether a viewer may
 * override: discovery feeds decline to hard-hide so that a single stale list
 * cannot empty a feed, while playback enforces the full decision.
 *
 * @type {import('@nostr-governance/core').PolicyDefinition}
 */
export const REFERENCE_POLICY = createPolicyDefinition({
  id: "reference-video-app",
  name: "Reference video application",
  description: "Characterized from the pinned reference commit. Illustrative, not a default.",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      muteWindowSeconds: TRUSTED_MUTE_WINDOW_SECONDS,
      reports: REPORT_THRESHOLDS,
      mutes: MUTE_THRESHOLDS,
    },

    // Home and Recent decline to hide: a target that would be hidden is
    // downranked and restricted instead, preserving the surface exception.
    home: {
      name: "home",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      bypassHide: true,
      bypassHideCeiling: "restrict",
      muteWindowSeconds: TRUSTED_MUTE_WINDOW_SECONDS,
      reports: REPORT_THRESHOLDS,
      mutes: MUTE_THRESHOLDS,
    },

    recent: {
      name: "recent",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      bypassHide: true,
      bypassHideCeiling: "restrict",
      muteWindowSeconds: TRUSTED_MUTE_WINDOW_SECONDS,
      reports: REPORT_THRESHOLDS,
      mutes: MUTE_THRESHOLDS,
    },

    playback: {
      name: "playback",
      administrativeDeny: { visibility: "deny", interaction: "deny" },
      viewerBlock: { visibility: "hide", interaction: "deny" },
      allowViewerOverride: true,
      exposeEvidence: true,
      muteWindowSeconds: TRUSTED_MUTE_WINDOW_SECONDS,
      reports: REPORT_THRESHOLDS,
      mutes: MUTE_THRESHOLDS,
    },
  },
});
