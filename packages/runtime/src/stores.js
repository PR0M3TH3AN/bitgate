// Governance stores.
//
// Each store owns one slice of state, emits only on real changes, and exposes a
// plain snapshot the pure evaluator can consume. Stores never reach for a relay
// themselves: the runtime feeds them decoded events.

import {
  createAuthorityState,
  createEmptyAdminState,
  fingerprint,
  normalizePubkey,
  reduceAdminState,
  serializeAdminState,
} from "@bitgate/core";
import { selectReplaceable, toMuteRecords } from "@bitgate/nostr";

import { Emitter } from "./emitter.js";

/**
 * @typedef {import('@bitgate/core').PolicyDefinition} PolicyDefinition
 * @typedef {import('@bitgate/core').Contribution} Contribution
 * @typedef {import('@bitgate/core').AuthorityState} AuthorityState
 * @typedef {import('@bitgate/core').AdminState} AdminState
 * @typedef {import('@bitgate/nostr').NostrEvent} NostrEvent
 */

/**
 * Roles, capabilities, contributions, and the effective merged admin state.
 */
export class GovernanceAdminStore extends Emitter {
  constructor() {
    super();
    /** @type {AuthorityState} */
    this.authority = createAuthorityState({});
    /** @type {Contribution[]} */
    this.contributions = [];
    /** @type {AdminState} */
    this.state = createEmptyAdminState();
    /** @type {string} */
    this.fingerprint = fingerprint(serializeAdminState(this.state));
    /** @type {string} */
    this.authorityFingerprint = this.#computeAuthorityFingerprint();
  }

  /**
   * Replace the role roster.
   * @param {Object} roster
   * @param {string} [roster.root]
   * @param {Record<string, string[]>} [roster.actors]
   * @param {Record<string, readonly any[]>} [roster.roles]
   * @param {string[]} [roster.protectedActors]
   */
  setRoles(roster) {
    this.authority = createAuthorityState(roster ?? {});
    this.#recompute();
  }

  #computeAuthorityFingerprint() {
    return fingerprint({
      root: this.authority.root ?? "",
      actors: this.authority.actors,
      roles: this.authority.roles,
      protectedActors: this.authority.protectedActors,
    });
  }

  /**
   * Replace every contribution.
   * @param {Contribution[]} contributions
   */
  setContributions(contributions) {
    this.contributions = Array.isArray(contributions) ? [...contributions] : [];
    this.#recompute();
  }

  /**
   * Add or replace one actor's contribution of a given kind.
   *
   * Replacement is by (actor, kind) because a contribution list is itself a
   * replaceable document: a moderator's newest deny list supersedes their
   * previous one rather than accumulating with it.
   *
   * @param {Contribution} contribution
   */
  upsertContribution(contribution) {
    if (!contribution?.actor || !contribution?.kind) {
      return;
    }
    const index = this.contributions.findIndex(
      (entry) => entry.actor === contribution.actor && entry.kind === contribution.kind,
    );
    if (index >= 0) {
      const existing = this.contributions[index];
      if ((existing.createdAt ?? 0) > (contribution.createdAt ?? 0)) {
        return;
      }
      this.contributions[index] = contribution;
    } else {
      this.contributions.push(contribution);
    }
    this.#recompute();
  }

  /**
   * The root-authority fingerprint, used to namespace cached state.
   *
   * Derived from the root identity alone, not the full roster: rotating the
   * root administrator must invalidate the cache, but adding a moderator must
   * not, or the cache would be discarded on every roster change.
   */
  get rootFingerprint() {
    return fingerprint({ root: this.authority.root ?? "" });
  }

  #recompute() {
    const next = reduceAdminState(this.contributions, this.authority);
    const nextFingerprint = fingerprint(serializeAdminState(next));
    const nextAuthority = this.#computeAuthorityFingerprint();

    this.state = next;

    // A roster change can alter capabilities and protected actors without
    // changing a single denial entry. Emitting only on reduced state would
    // leave capability-gated UI and the decision cache stale after a
    // revocation that happened to deny nobody.
    const changed =
      nextFingerprint !== this.fingerprint || nextAuthority !== this.authorityFingerprint;

    this.fingerprint = nextFingerprint;
    this.authorityFingerprint = nextAuthority;

    if (changed) {
      this.emit("change", { fingerprint: nextFingerprint, authorityFingerprint: nextAuthority });
    }
  }
}

/**
 * Viewer follows, trust seeds, blocks, and mutes.
 */
export class TrustGraphStore extends Emitter {
  constructor() {
    super();
    /** @type {Set<string>} */
    this.contacts = new Set();
    /** @type {Set<string>} */
    this.seeds = new Set();
    /** @type {Set<string>} */
    this.blocks = new Set();
    /** @type {Set<string>} */
    this.mutes = new Set();
    this.fingerprint = this.#computeFingerprint();
  }

  /** @param {Iterable<string>} pubkeys */
  setContacts(pubkeys) {
    this.contacts = this.#normalizeSet(pubkeys);
    this.#emitIfChanged();
  }

  /** @param {Iterable<string>} pubkeys */
  setSeeds(pubkeys) {
    this.seeds = this.#normalizeSet(pubkeys);
    this.#emitIfChanged();
  }

  /** @param {Iterable<string>} pubkeys */
  setBlocks(pubkeys) {
    this.blocks = this.#normalizeSet(pubkeys);
    this.#emitIfChanged();
  }

  /** @param {Iterable<string>} pubkeys */
  setMutes(pubkeys) {
    this.mutes = this.#normalizeSet(pubkeys);
    this.#emitIfChanged();
  }

  /**
   * Clear viewer-specific state when the viewer changes.
   *
   * Seeds survive: they are operator configuration, not viewer data.
   */
  clearViewerState() {
    this.contacts = new Set();
    this.blocks = new Set();
    this.mutes = new Set();
    this.#emitIfChanged();
  }

  /** The effective trust set: real contacts when present, seeds otherwise. */
  get trustSet() {
    return this.contacts.size > 0 ? this.contacts : this.seeds;
  }

  /**
   * @param {Iterable<string>} pubkeys
   * @returns {Set<string>}
   */
  #normalizeSet(pubkeys) {
    /** @type {Set<string>} */
    const normalized = new Set();
    for (const pubkey of pubkeys ?? []) {
      const hex = normalizePubkey(pubkey);
      if (hex) {
        normalized.add(hex);
      }
    }
    return normalized;
  }

  #computeFingerprint() {
    return fingerprint({
      contacts: this.contacts,
      seeds: this.seeds,
      blocks: this.blocks,
      mutes: this.mutes,
    });
  }

  #emitIfChanged() {
    const next = this.#computeFingerprint();
    if (next !== this.fingerprint) {
      this.fingerprint = next;
      this.emit("change", { fingerprint: next });
    }
  }
}

/**
 * NIP-56 reports, aggregated per target.
 */
export class ReportStore extends Emitter {
  constructor() {
    super();
    /** @type {Map<string, Map<string, Map<string, number>>>} reports[targetKey][reporter][category] = createdAt */
    this.reports = new Map();
    this.fingerprint = fingerprint({});
  }

  /**
   * Ingest a decoded report.
   *
   * Storage is keyed by target → reporter → category, so deduplication is
   * structural: re-ingesting the same report cannot inflate a count, which
   * matters because relays routinely deliver duplicates.
   *
   * The target is identified by `targetKey`; a decoded report's own `target`
   * field is accepted but not required, since it would be redundant.
   *
   * @param {{ reporter: string, category: string, createdAt?: number, target?: import('@bitgate/core').GovernanceTarget }} report
   * @param {string} targetKey
   */
  ingest(report, targetKey) {
    if (!report?.reporter || !report?.category || !targetKey) {
      return;
    }

    let byReporter = this.reports.get(targetKey);
    if (!byReporter) {
      byReporter = new Map();
      this.reports.set(targetKey, byReporter);
    }

    let byCategory = byReporter.get(report.reporter);
    if (!byCategory) {
      byCategory = new Map();
      byReporter.set(report.reporter, byCategory);
    }

    const existing = byCategory.get(report.category);
    const createdAt = report.createdAt ?? 0;
    if (existing !== undefined && existing >= createdAt) {
      return;
    }

    byCategory.set(report.category, createdAt);
    this.#emitChange(targetKey);
  }

  /**
   * Report records for a target, in the shape the evaluator consumes.
   * @param {string} targetKey
   * @returns {Array<{ reporter: string, category: string, createdAt: number }>}
   */
  recordsFor(targetKey) {
    const byReporter = this.reports.get(targetKey);
    if (!byReporter) {
      return [];
    }

    /** @type {Array<{ reporter: string, category: string, createdAt: number }>} */
    const records = [];
    for (const [reporter, byCategory] of byReporter.entries()) {
      for (const [category, createdAt] of byCategory.entries()) {
        records.push({ reporter, category, createdAt });
      }
    }
    return records;
  }

  /** @returns {Map<string, Array<{ reporter: string, category: string, createdAt: number }>>} */
  toRecordMap() {
    /** @type {Map<string, Array<{ reporter: string, category: string, createdAt: number }>>} */
    const map = new Map();
    for (const targetKey of this.reports.keys()) {
      map.set(targetKey, this.recordsFor(targetKey));
    }
    return map;
  }

  /** @param {string} targetKey */
  clearTarget(targetKey) {
    if (this.reports.delete(targetKey)) {
      this.#emitChange(targetKey);
    }
  }

  /** @param {string} targetKey */
  #emitChange(targetKey) {
    this.fingerprint = fingerprint(
      Array.from(this.reports.keys()).sort().map((key) => [key, this.recordsFor(key).length]),
    );
    this.emit("change", { targetKey, fingerprint: this.fingerprint });
  }
}

/**
 * NIP-51 trusted mute lists.
 */
export class TrustedMuteStore extends Emitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowSeconds] - Mutes older than this are pruned
   * @param {() => number} [options.now] - Injected clock, unix seconds
   */
  constructor({ windowSeconds = 0, now = () => 0 } = {}) {
    super();
    this.windowSeconds = windowSeconds;
    this.now = now;
    /** @type {Map<string, { owner: string, updatedAt: number, entries: Array<{ pubkey: string, category?: string }> }>} */
    this.lists = new Map();
    this.fingerprint = fingerprint({});
  }

  /**
   * Replace an owner's mute list.
   *
   * A newer list fully replaces the older one; an out-of-order delivery of an
   * older list is ignored rather than resurrecting removed entries.
   *
   * @param {import('@bitgate/nostr').DecodedMuteList} list
   */
  replaceList(list) {
    if (!list?.owner) {
      return;
    }
    const existing = this.lists.get(list.owner);
    if (existing && existing.updatedAt > list.updatedAt) {
      return;
    }
    const affected = new Set();
    for (const entry of existing?.entries ?? []) {
      affected.add(`user:${entry.pubkey}`);
    }
    for (const entry of list.entries) {
      affected.add(`user:${entry.pubkey}`);
    }

    this.lists.set(list.owner, {
      owner: list.owner,
      updatedAt: list.updatedAt,
      entries: list.entries,
    });
    this.#emitChange(Array.from(affected));
  }

  /**
   * Drop lists that have fallen outside the validity window.
   * @returns {number} Number of lists pruned
   */
  prune() {
    if (!this.windowSeconds) {
      return 0;
    }
    const cutoff = this.now() - this.windowSeconds;
    const affected = new Set();
    let pruned = 0;

    for (const [owner, list] of this.lists.entries()) {
      if (list.updatedAt < cutoff) {
        for (const entry of list.entries) {
          affected.add(`user:${entry.pubkey}`);
        }
        this.lists.delete(owner);
        pruned += 1;
      }
    }

    if (pruned) {
      this.#emitChange(Array.from(affected));
    }
    return pruned;
  }

  /** @returns {Map<string, Array<{ muter: string, category?: string, updatedAt: number }>>} */
  toRecordMap() {
    return toMuteRecords(
      Array.from(this.lists.values()).map((list) => ({
        owner: list.owner,
        updatedAt: list.updatedAt,
        entries: list.entries,
        hasEncryptedEntries: false,
      })),
    );
  }

  /**
   * Mute counts for many authors in one pass.
   *
   * Batched deliberately: per-item store lookups across a large feed were the
   * regression the extraction has to avoid.
   *
   * @param {string[]} pubkeys
   * @returns {Map<string, number>}
   */
  countsForAuthors(pubkeys) {
    const records = this.toRecordMap();
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const pubkey of pubkeys) {
      counts.set(pubkey, (records.get(`user:${pubkey}`) ?? []).length);
    }
    return counts;
  }

  /** @param {string[]} [targetKeys] - Targets whose decisions this change affects */
  #emitChange(targetKeys) {
    this.fingerprint = fingerprint(
      Array.from(this.lists.values())
        .map((list) => [list.owner, list.updatedAt, list.entries.length])
        .sort(),
    );
    this.emit("change", { fingerprint: this.fingerprint, targetKeys });
  }
}

/**
 * Policy definitions, layered default → root-published → local override.
 */
export class PolicyStore extends Emitter {
  /**
   * @param {PolicyDefinition} defaultPolicy
   */
  constructor(defaultPolicy) {
    super();
    /** @type {PolicyDefinition} */
    this.defaultPolicy = defaultPolicy;
    /** @type {PolicyDefinition|null} */
    this.rootPolicy = null;
    /** @type {PolicyDefinition|null} */
    this.localPolicy = null;
  }

  /**
   * The effective policy.
   *
   * A local application policy wins over a root-published one so an application
   * can pin behavior it depends on; the root policy wins over the built-in
   * default.
   * @returns {PolicyDefinition}
   */
  get policy() {
    return this.localPolicy ?? this.rootPolicy ?? this.defaultPolicy;
  }

  /** @param {PolicyDefinition|null} policy */
  setRootPolicy(policy) {
    const before = this.policy;
    this.rootPolicy = policy;
    if (this.policy !== before) {
      this.emit("change", { policy: this.policy });
    }
  }

  /** @param {PolicyDefinition|null} policy */
  setLocalPolicy(policy) {
    const before = this.policy;
    this.localPolicy = policy;
    if (this.policy !== before) {
      this.emit("change", { policy: this.policy });
    }
  }
}

/**
 * Viewer-scoped overrides.
 */
export class OverrideStore extends Emitter {
  /**
   * @param {Object} [options]
   * @param {() => number} [options.now] - Injected clock, unix seconds
   */
  constructor({ now = () => 0 } = {}) {
    super();
    this.now = now;
    /** @type {Map<string, { visibility: string, reason?: string, expiresAt?: number }>} */
    this.overrides = new Map();
  }

  /**
   * @param {string} targetKey
   * @param {{ visibility: string, reason?: string, expiresAt?: number }} override
   */
  set(targetKey, override) {
    this.overrides.set(targetKey, override);
    this.emit("change", { targetKey });
  }

  /** @param {string} targetKey */
  remove(targetKey) {
    if (this.overrides.delete(targetKey)) {
      this.emit("change", { targetKey });
    }
  }

  /**
   * Drop every override, e.g. when the viewer changes.
   *
   * Named distinctly from the inherited listener `clear()` so that tearing down
   * overrides and tearing down subscribers stay separate operations.
   */
  clearOverrides() {
    if (this.overrides.size) {
      this.overrides.clear();
      this.emit("change", {});
    }
  }

  /**
   * Live overrides, with expired entries filtered out.
   * @returns {Map<string, { visibility: string, reason?: string }>}
   */
  toMap() {
    const now = this.now();
    /** @type {Map<string, { visibility: string, reason?: string }>} */
    const live = new Map();
    for (const [key, override] of this.overrides.entries()) {
      if (override.expiresAt !== undefined && override.expiresAt <= now) {
        continue;
      }
      live.set(key, { visibility: override.visibility, reason: override.reason });
    }
    return live;
  }
}
