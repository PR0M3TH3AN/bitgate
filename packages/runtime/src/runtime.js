// GovernanceRuntime.
//
// Owns store lifecycle, transport orchestration, viewer and active-target
// changes, evaluation, and diagnostics. It is the only stateful object an
// application needs to hold.

import {
  NEUTRAL_POLICY,
  evaluateTarget,
  getTargetKey,
  isValidTarget,
  normalizePubkey,
} from "@nostr-governance/core";
import {
  CANONICAL_KIND,
  LEGACY_KIND,
  MUTE_LIST_KIND,
  REPORT_KIND,
  decodeContribution,
  decodeLegacyList,
  decodeMuteList,
  decodePolicy,
  decodeReport,
  decodeRoles,
  selectReplaceable,
} from "@nostr-governance/nostr";

import { snapshotFingerprint } from "@nostr-governance/core";

import { Emitter } from "./emitter.js";
import { createMemoryStorage, createNullSigner, storageKey } from "./interfaces.js";
import {
  GovernanceAdminStore,
  OverrideStore,
  PolicyStore,
  ReportStore,
  TrustGraphStore,
  TrustedMuteStore,
} from "./stores.js";

/**
 * @typedef {import('@nostr-governance/nostr').NostrEvent} NostrEvent
 * @typedef {import('./interfaces.js').GovernanceTransport} GovernanceTransport
 * @typedef {import('./interfaces.js').GovernanceSigner} GovernanceSigner
 * @typedef {import('./interfaces.js').GovernanceStorage} GovernanceStorage
 * @typedef {import('@nostr-governance/core').PolicyDefinition} PolicyDefinition
 * @typedef {import('@nostr-governance/core').GovernanceTarget} GovernanceTarget
 * @typedef {import('@nostr-governance/core').GovernanceDecision} GovernanceDecision
 * @typedef {import('@nostr-governance/core').GovernanceSnapshot} GovernanceSnapshot
 * @typedef {import('@nostr-governance/core').ViewerState} ViewerState
 */

/** How many targets go into one relay filter chunk. */
export const DEFAULT_CHUNK_SIZE = 200;

/**
 * Split a list into bounded chunks.
 *
 * Report subscriptions are chunked rather than opened per target: one
 * subscription per feed item is what the extraction must not regress to.
 *
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  if (size <= 0) {
    return [items];
  }
  /** @type {T[][]} */
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Recursively freeze a decision so cached instances cannot be mutated.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
  }
  return value;
}

export class GovernanceRuntime extends Emitter {
  /**
   * @param {Object} options
   * @param {string} options.applicationId
   * @param {string} options.namespace
   * @param {GovernanceTransport} options.transport
   * @param {GovernanceSigner} [options.signer]
   * @param {GovernanceStorage} [options.storage]
   * @param {PolicyDefinition} [options.policy]
   * @param {() => number} [options.now] - Injected clock, unix seconds
   * @param {number} [options.chunkSize]
   * @param {number} [options.muteWindowSeconds]
   */
  constructor({
    applicationId,
    namespace,
    transport,
    signer,
    storage,
    policy,
    now,
    chunkSize = DEFAULT_CHUNK_SIZE,
    muteWindowSeconds = 0,
  }) {
    super();

    if (!applicationId || !namespace) {
      throw new Error("GovernanceRuntime requires applicationId and namespace");
    }
    if (!transport) {
      throw new Error("GovernanceRuntime requires a transport adapter");
    }

    this.applicationId = applicationId;
    this.namespace = namespace;
    this.transport = transport;
    this.signer = signer ?? createNullSigner();
    this.storage = storage ?? createMemoryStorage();
    this.now = now ?? (() => 0);
    this.chunkSize = chunkSize;
    this.schemaVersion = "v1";

    this.admin = new GovernanceAdminStore();
    this.trust = new TrustGraphStore();
    this.reports = new ReportStore();
    this.mutes = new TrustedMuteStore({ windowSeconds: muteWindowSeconds, now: this.now });
    /** @type {PolicyStore} */
    this.policies = new PolicyStore(policy ?? NEUTRAL_POLICY);
    this.overrides = new OverrideStore({ now: this.now });

    /** @type {string} */
    this.viewerPubkey = "";
    /** @type {Map<string, GovernanceTarget>} */
    this.activeTargets = new Map();
    /** @type {Set<{ close: () => void }>} */
    this.subscriptions = new Set();
    /** @type {boolean} */
    this.destroyed = false;

    /** @type {Array<() => void>} */
    this.storeUnsubscribes = [
      // Administrative, trust, and policy changes can alter any decision, so
      // they drop the whole cache. Report and mute changes name the targets
      // they touch, so only those entries are invalidated.
      this.admin.on("change", () => {
        this.invalidateDecisions();
        this.emit("change", { source: "admin" });
      }),
      this.trust.on("change", () => {
        this.invalidateDecisions();
        this.emit("change", { source: "trust" });
      }),
      this.reports.on("change", (detail) => {
        this.invalidateDecisions(detail?.targetKey ? [detail.targetKey] : undefined);
        this.emit("change", { source: "reports", ...detail });
      }),
      this.mutes.on("change", (detail) => {
        this.invalidateDecisions(detail?.targetKeys);
        this.emit("change", { source: "mutes" });
      }),
      this.policies.on("change", () => {
        this.invalidateDecisions();
        this.emit("change", { source: "policy" });
      }),
      this.overrides.on("change", (detail) => {
        this.invalidateDecisions(detail?.targetKey ? [detail.targetKey] : undefined);
        this.emit("change", { source: "overrides" });
      }),
    ];

    // Decisions are cached per (profile, target). A feed re-renders far more
    // often than governance state changes, and re-deriving an unchanged verdict
    // for every card is the cost the extraction is supposed to remove.
    /** @type {Map<string, GovernanceDecision>} */
    this.decisionCache = new Map();

    // The snapshot and its fingerprint are rebuilt only when a store changes.
    // Deriving them per target walks every report and mute list, which turns a
    // large feed into quadratic work.
    /** @type {GovernanceSnapshot|null} */
    this.cachedSnapshot = null;
    /** @type {string} */
    this.cachedSnapshotFingerprint = "";

    /** @type {{ eventsIngested: number, unknownEvents: number, subscriptions: number, cacheHits: number, cacheMisses: number }} */
    this.diagnostics = {
      eventsIngested: 0,
      unknownEvents: 0,
      subscriptions: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Build a namespaced storage key for this deployment.
   * @param {string} scope
   * @param {boolean} [viewerScoped]
   * @returns {string}
   */
  storageKeyFor(scope, viewerScoped = false) {
    return storageKey({
      applicationId: this.applicationId,
      namespace: this.namespace,
      rootFingerprint: this.admin.rootFingerprint,
      schemaVersion: this.schemaVersion,
      scope,
      viewerPubkey: viewerScoped ? this.viewerPubkey : undefined,
    });
  }

  /**
   * Route a raw event to the right store.
   *
   * Unrecognized events are counted rather than thrown on: relays return what
   * they like, and an unknown kind is not an error condition.
   *
   * @param {NostrEvent} event
   * @returns {boolean} Whether the event was recognized
   */
  ingestEvent(event) {
    if (!event || typeof event.kind !== "number") {
      return false;
    }

    this.diagnostics.eventsIngested += 1;

    if (event.kind === REPORT_KIND) {
      const reports = decodeReport(event);
      for (const report of reports) {
        this.reports.ingest(report, getTargetKey(report.target));
      }
      return reports.length > 0;
    }

    if (event.kind === MUTE_LIST_KIND) {
      const list = decodeMuteList(event);
      if (list) {
        this.mutes.replaceList(list);
        return true;
      }
      return false;
    }

    if (event.kind === CANONICAL_KIND) {
      const roles = decodeRoles(event);
      if (roles) {
        this.admin.setRoles(roles);
        return true;
      }

      const policy = decodePolicy(event);
      if (policy) {
        this.emit("policy-document", { policy });
        return true;
      }

      const contribution = decodeContribution(event);
      if (contribution) {
        this.admin.upsertContribution(contribution);
        return true;
      }
    }

    if (event.kind === LEGACY_KIND) {
      const contribution = decodeLegacyList(event);
      if (contribution) {
        this.admin.upsertContribution(contribution);
        return true;
      }
    }

    this.diagnostics.unknownEvents += 1;
    return false;
  }

  /**
   * Load administrative state from relays.
   *
   * Replaceable selection runs before ingestion so that only the newest
   * document per coordinate reaches the stores.
   *
   * @param {Object} [options]
   * @param {string[]} [options.authors] - Restrict to known contributor pubkeys
   * @returns {Promise<number>} Number of events ingested
   */
  async loadAdministrativeState({ authors } = {}) {
    /** @type {any} */
    const filter = { kinds: [CANONICAL_KIND, LEGACY_KIND] };
    if (authors?.length) {
      filter.authors = authors;
    }

    const events = await this.transport.list([filter]);
    const effective = Array.from(selectReplaceable(events).values());

    for (const event of effective) {
      this.ingestEvent(event);
    }
    return effective.length;
  }

  /**
   * Subscribe to reports for the currently active targets.
   *
   * Targets are chunked into bounded filters rather than one subscription per
   * target.
   *
   * @returns {{ close: () => void }}
   */
  subscribeToActiveTargetReports() {
    const eventIds = [];
    const pubkeys = [];

    for (const target of this.activeTargets.values()) {
      if (target.type === "event") {
        eventIds.push(target.id);
      } else if (target.type === "user") {
        pubkeys.push(target.pubkey);
      }
    }

    /** @type {Array<{ close: () => void }>} */
    const opened = [];

    for (const ids of chunk(eventIds, this.chunkSize)) {
      if (!ids.length) continue;
      opened.push(
        this.transport.subscribe([{ kinds: [REPORT_KIND], "#e": ids }], {
          onEvent: (event) => this.ingestEvent(event),
        }),
      );
    }

    for (const keys of chunk(pubkeys, this.chunkSize)) {
      if (!keys.length) continue;
      opened.push(
        this.transport.subscribe([{ kinds: [REPORT_KIND], "#p": keys }], {
          onEvent: (event) => this.ingestEvent(event),
        }),
      );
    }

    const handle = {
      close: () => {
        for (const subscription of opened) {
          subscription.close();
        }
        this.subscriptions.delete(handle);
        this.diagnostics.subscriptions = this.subscriptions.size;
      },
    };

    this.subscriptions.add(handle);
    this.diagnostics.subscriptions = this.subscriptions.size;
    return handle;
  }

  /**
   * Set the active targets whose evidence should be kept fresh.
   * @param {GovernanceTarget[]} targets
   */
  setActiveTargets(targets) {
    this.activeTargets.clear();
    for (const target of targets ?? []) {
      if (isValidTarget(target)) {
        this.activeTargets.set(getTargetKey(target), target);
      }
    }
    this.emit("active-targets", { count: this.activeTargets.size });
  }

  /**
   * Switch the viewer.
   *
   * Viewer-specific state is cleared so one account's blocks, mutes, and
   * overrides can never leak into another's session.
   *
   * @param {string} pubkey
   */
  setViewer(pubkey) {
    const normalized = normalizePubkey(pubkey ?? "");
    if (normalized === this.viewerPubkey) {
      return;
    }
    this.viewerPubkey = normalized;
    this.decisionCache.clear();
    this.trust.clearViewerState();
    this.overrides.clearOverrides();
    this.emit("viewer", { pubkey: normalized });
  }

  /**
   * Build a snapshot for the pure evaluator.
   *
   * Memoized until a store reports a change, so repeated evaluation over one
   * feed reuses a single materialized view of state.
   *
   * @returns {GovernanceSnapshot}
   */
  snapshot() {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    this.cachedSnapshot = {
      authority: this.admin.authority,
      admin: this.admin.state,
      trust: { contacts: this.trust.contacts, seeds: this.trust.seeds },
      reports: this.reports.toRecordMap(),
      trustedMutes: this.mutes.toRecordMap(),
    };
    return this.cachedSnapshot;
  }

  /**
   * The current snapshot fingerprint, computed once per snapshot.
   * @returns {string}
   */
  snapshotFingerprint() {
    if (!this.cachedSnapshotFingerprint) {
      const snapshot = this.snapshot();
      const policy = this.policies.policy;
      this.cachedSnapshotFingerprint = snapshotFingerprint({
        authority: snapshot.authority,
        admin: snapshot.admin,
        reports: snapshot.reports,
        trustedMutes: snapshot.trustedMutes,
        policy: { id: policy.id, version: policy.version },
      });
    }
    return this.cachedSnapshotFingerprint;
  }

  /** @returns {ViewerState} */
  viewerState() {
    return {
      blocks: this.trust.blocks,
      mutes: this.trust.mutes,
      overrides: this.overrides.toMap(),
    };
  }

  /**
   * Drop cached decisions.
   *
   * With no argument every entry is dropped; with target keys, only decisions
   * for those targets across all profiles.
   *
   * @param {string[]} [targetKeys]
   */
  invalidateDecisions(targetKeys) {
    // Any change that reaches a decision also invalidates the materialized
    // snapshot it was derived from.
    this.cachedSnapshot = null;
    this.cachedSnapshotFingerprint = "";

    if (!targetKeys) {
      this.decisionCache.clear();
      return;
    }
    const affected = new Set(targetKeys);
    for (const cacheKey of Array.from(this.decisionCache.keys())) {
      // Cache keys are `${profile}|${targetKey}`.
      const targetKey = cacheKey.slice(cacheKey.indexOf("|") + 1);
      if (affected.has(targetKey)) {
        this.decisionCache.delete(cacheKey);
      }
    }
  }

  /**
   * Evaluate one target.
   * @param {GovernanceTarget} target
   * @param {Object} [options]
   * @param {string} [options.profile]
   * @param {string} [options.surface]
   * @returns {GovernanceDecision}
   */
  evaluate(target, { profile, surface } = {}) {
    const cacheKey = `${profile ?? ""}|${getTargetKey(target)}`;
    const cached = this.decisionCache.get(cacheKey);
    if (cached) {
      this.diagnostics.cacheHits += 1;
      return cached;
    }

    const decision = evaluateTarget(
      target,
      this.snapshot(),
      {
        surface: surface ?? profile ?? "default",
        policyProfile: profile,
        policy: this.policies.policy,
        now: this.now(),
        snapshotFingerprint: this.snapshotFingerprint(),
      },
      this.viewerState(),
    );

    this.diagnostics.cacheMisses += 1;
    // Frozen because the cache hands out the same object to every caller; a
    // consumer mutating a decision would otherwise corrupt later reads.
    this.decisionCache.set(cacheKey, deepFreeze(decision));
    return decision;
  }

  /**
   * Evaluate many targets against one snapshot.
   * @param {GovernanceTarget[]} targets
   * @param {Object} [options]
   * @param {string} [options.profile]
   * @param {string} [options.surface]
   * @returns {Map<string, GovernanceDecision>}
   */
  evaluateMany(targets, { profile, surface } = {}) {
    /** @type {Map<string, GovernanceDecision>} */
    const results = new Map();
    for (const target of targets ?? []) {
      if (!isValidTarget(target)) {
        continue;
      }
      const key = getTargetKey(target);
      if (!results.has(key)) {
        results.set(key, this.evaluate(target, { profile, surface }));
      }
    }
    return results;
  }

  /** Diagnostic summary for support and debugging. */
  describe() {
    return {
      applicationId: this.applicationId,
      namespace: this.namespace,
      viewerPubkey: this.viewerPubkey,
      policyId: this.policies.policy.id,
      policyVersion: this.policies.policy.version,
      rootFingerprint: this.admin.rootFingerprint,
      adminFingerprint: this.admin.fingerprint,
      trustFingerprint: this.trust.fingerprint,
      activeTargets: this.activeTargets.size,
      ...this.diagnostics,
    };
  }

  /**
   * Close every subscription and drop every listener.
   *
   * Idempotent: calling destroy twice is safe, because applications tear down
   * from more than one place.
   */
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    for (const subscription of Array.from(this.subscriptions)) {
      subscription.close();
    }
    this.subscriptions.clear();

    for (const unsubscribe of this.storeUnsubscribes) {
      unsubscribe();
    }

    this.decisionCache.clear();
    this.cachedSnapshot = null;
    this.cachedSnapshotFingerprint = "";
    this.admin.clear();
    this.trust.clear();
    this.reports.clear();
    this.mutes.clear();
    this.policies.clear();
    this.overrides.clearOverrides();
    this.overrides.clear();
    this.clear();
  }
}

/**
 * Create a runtime.
 * @param {ConstructorParameters<typeof GovernanceRuntime>[0]} options
 * @returns {GovernanceRuntime}
 */
export function createGovernanceRuntime(options) {
  return new GovernanceRuntime(options);
}
