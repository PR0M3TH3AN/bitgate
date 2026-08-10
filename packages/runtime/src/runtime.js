// GovernanceRuntime.
//
// Owns store lifecycle, transport orchestration, viewer and active-target
// changes, evaluation, and diagnostics. It is the only stateful object an
// application needs to hold.

import {
  NEUTRAL_POLICY,
  evaluateTarget,
  getActorCapabilities,
  getTargetKey,
  hasCapability,
  isValidTarget,
  normalizePolicyDefinition,
  normalizePubkey,
  serializeAdminState,
} from "@bitgate/core";
import {
  CANONICAL_KIND,
  CONTACT_LIST_KIND,
  LEGACY_KIND,
  MUTE_LIST_KIND,
  RELAY_LIST_KIND,
  REPORT_KIND,
  decodeContactList,
  decodeContribution,
  decodeLabels,
  decodeLegacyList,
  decodeMuteList,
  decodePolicy,
  decodePrivateMuteEntries,
  decodeRelayList,
  decodeReport,
  decodeRoles,
  groupAuthorsByWriteRelay,
  labelsToContributions,
  selectReplaceable,
  verifyEvents,
  LABEL_KIND,
} from "@bitgate/nostr";

import { snapshotFingerprint } from "@bitgate/core";

import { Emitter } from "./emitter.js";

/** Governance document scopes, used to build a bounded `#d` filter. */
const GOVERNANCE_SCOPES = [
  "roles",
  "policy",
  "user-allow",
  "user-deny",
  "event-deny",
  "address-deny",
  "trust-seed",
  "community-sources",
];

/** Legacy administrative list identifiers, read for migration compatibility. */
const LEGACY_IDENTIFIERS = [
  "bitvid:admin:whitelist",
  "bitvid:admin:blacklist",
  "bitvid:admin:event-blacklist",
  "bitvid:admin:editors",
  "bitvid:admin:community-sources",
];

/** Maximum administrative events accepted from one query. */
const DEFAULT_ADMIN_LIMIT = 500;
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
 * @typedef {import('@bitgate/nostr').NostrEvent} NostrEvent
 * @typedef {import('./interfaces.js').GovernanceTransport} GovernanceTransport
 * @typedef {import('./interfaces.js').GovernanceSigner} GovernanceSigner
 * @typedef {import('./interfaces.js').GovernanceStorage} GovernanceStorage
 * @typedef {import('@bitgate/core').PolicyDefinition} PolicyDefinition
 * @typedef {import('@bitgate/core').GovernanceTarget} GovernanceTarget
 * @typedef {import('@bitgate/core').GovernanceDecision} GovernanceDecision
 * @typedef {import('@bitgate/core').GovernanceSnapshot} GovernanceSnapshot
 * @typedef {import('@bitgate/core').ViewerState} ViewerState
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
   * @param {import('@bitgate/nostr').SignatureVerifier} [options.verifySignature]
   * @param {boolean} [options.trustUnsignedEvents] - Accept administrative events
   *   without a verifier. Development and tests only.
   * @param {string} [options.root] - Root administrator pubkey, from deployment config
   * @param {import('@bitgate/nostr').LabelMapping} [options.labelMapping] - Which NIP-32
   *   label namespace and values to treat as moderation
   * @param {number} [options.maxCachedDecisions] - Ceiling on cached decisions
   * @param {number} [options.maxReportTargets] - Ceiling on targets held by the report store
   * @param {number} [options.maxMuteLists] - Ceiling on mute lists held
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
    verifySignature,
    trustUnsignedEvents,
    root,
    labelMapping,
    maxCachedDecisions = 5_000,
    maxReportTargets = 20_000,
    maxMuteLists = 5_000,
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

    // Verification is injected: signature checking needs a crypto library, and
    // forcing one into this package would make it unusable where the host
    // already has its own. When absent, the runtime says so in diagnostics
    // rather than pretending state was verified.
    this.verifySignature = verifySignature;

    // Opt-in escape hatch for local development and tests, where events are
    // constructed in-process and there is no relay to lie.
    this.trustUnsignedEvents = trustUnsignedEvents === true;

    // The deployment's own relays, used as a fallback for authors who have
    // published no NIP-65 list.
    /** @type {string[]} */
    this.defaultRelays = Array.isArray(transport.relays) ? [...transport.relays] : [];

    // Which NIP-32 label namespace and vocabulary this deployment reads as
    // moderation. Defaults to the app namespace with a plain "deny"/"allow"
    // vocabulary, so BitGate reads its own emitted labels; an application
    // consuming a third-party labeller overrides it. A label only ever denies
    // when its author holds the capability, exactly like any contribution.
    /** @type {import('@bitgate/nostr').LabelMapping} */
    this.labelMapping = labelMapping ?? {
      namespace: namespace,
      denyValues: ["deny"],
      allowValues: ["allow"],
    };

    this.admin = new GovernanceAdminStore();
    this.trust = new TrustGraphStore();
    this.reports = new ReportStore({ maxTargets: maxReportTargets });
    this.mutes = new TrustedMuteStore({
      windowSeconds: muteWindowSeconds,
      now: this.now,
      maxLists: maxMuteLists,
    });
    /** @type {PolicyStore} */
    this.policies = new PolicyStore(policy ?? NEUTRAL_POLICY);
    this.overrides = new OverrideStore({ now: this.now });

    // The root administrator is deployment configuration, not discovered state.
    // Seeding it here keeps the storage key stable from construction; without
    // it, hydration could not find its own cache, because the key is derived
    // from the root fingerprint the cache would have to supply.
    // Kept separate from admin.authority.root on purpose. The authority state
    // can be rewritten by ingested documents; this is the deployment's own
    // configuration and is what every authorship check compares against, so a
    // bad ingest cannot move the goalposts for the next one.
    /** @type {string} */
    this.configuredRoot = root ? normalizePubkey(root) : "";

    if (this.configuredRoot) {
      this.admin.setRoles({ root: this.configuredRoot });
    }

    /** @type {string} */
    this.viewerPubkey = "";
    /** @type {Map<string, GovernanceTarget>} */
    this.activeTargets = new Map();
    /** @type {Set<{ close: () => void }>} */
    this.subscriptions = new Set();
    /** @type {boolean} */
    this.destroyed = false;

    // True when the last relay load failed and the runtime is serving the
    // previous state. Surfaced in diagnostics so an application can tell a
    // viewer that moderation data may be out of date.
    /** @type {boolean} */
    this.stale = false;
    /** @type {number} */
    this.lastLoadedAt = 0;

    // NIP-65 relay lists, keyed by pubkey. Populated by loadRelayLists() and
    // consulted when fetching anything authored by a specific person.
    /** @type {Map<string, import('@bitgate/nostr').RelayList>} */
    this.relayLists = new Map();

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
    // Without a ceiling this grows for the lifetime of the page: an
    // infinite-scroll feed evaluates new targets forever and never revisits
    // most of them. Insertion order gives a cheap approximation of LRU.
    this.maxCachedDecisions = maxCachedDecisions;

    // The snapshot and its fingerprint are rebuilt only when a store changes.
    // Deriving them per target walks every report and mute list, which turns a
    // large feed into quadratic work.
    /** @type {GovernanceSnapshot|null} */
    this.cachedSnapshot = null;
    /** @type {string} */
    this.cachedSnapshotFingerprint = "";

    this.diagnostics = {
      eventsIngested: 0,
      unknownEvents: 0,
      subscriptions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rejectedSignatures: 0,
      hydratedFromCache: false,
      privateMutesApplied: 0,
      rejectedUnauthorized: 0,
      rejectedUnverified: 0,
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
  ingestEvent(event, { verified = false } = {}) {
    if (!event || typeof event.kind !== "number") {
      return false;
    }

    // Verification here rather than only in the loaders: ingestEvent is public,
    // and an application feeding events from its own relay pool — a documented
    // use case — would otherwise get none. Internal callers that have already
    // verified pass `verified: true` to avoid checking twice.
    if (!verified && !this.#passesVerification(event)) {
      this.diagnostics.rejectedSignatures += 1;
      this.emit("rejected", { reason: "invalid-signature", id: event.id });
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
        // The viewer's own private entries are decrypted separately, since it
        // needs a signer and cannot be synchronous.
        if (list.hasEncryptedEntries && list.owner === this.viewerPubkey) {
          void this.#absorbPrivateMutes(event);
        }
        return true;
      }
      return false;
    }

    if (event.kind === RELAY_LIST_KIND) {
      const relayList = decodeRelayList(event);
      if (relayList) {
        this.relayLists.set(relayList.pubkey, relayList);
        return true;
      }
      return false;
    }

    if (event.kind === CONTACT_LIST_KIND) {
      const contactList = decodeContactList(event);
      if (contactList && contactList.owner === this.viewerPubkey) {
        this.trust.setContacts(contactList.contacts);
        return true;
      }
      return false;
    }

    if (event.kind === CANONICAL_KIND) {
      const roles = decodeRoles(event);
      if (roles) {
        // The roster is the root of the entire trust model: it decides who may
        // deny whom, and who is protected. Accepting one from an arbitrary
        // author lets anybody declare themselves root. Only the deployment's
        // configured root may publish it.
        if (!this.#isRootAuthored(event)) {
          this.diagnostics.rejectedUnauthorized += 1;
          this.emit("rejected", { reason: "roles-not-root", pubkey: event.pubkey });
          return false;
        }
        if (!this.#adminIngestAllowed()) {
          return false;
        }
        this.admin.setRoles(roles);
        return true;
      }

      const policyDocument = decodePolicy(event);
      if (policyDocument) {
        return this.applyRootPolicy(policyDocument, event.pubkey);
      }

      const contribution = decodeContribution(event);
      if (contribution) {
        if (!this.#adminIngestAllowed()) {
          return false;
        }
        this.admin.upsertContribution(contribution);
        return true;
      }
    }

    if (event.kind === LEGACY_KIND) {
      const contribution = decodeLegacyList(event);
      if (contribution) {
        if (!this.#adminIngestAllowed()) {
          return false;
        }
        this.admin.upsertContribution(contribution);
        return true;
      }
    }

    if (event.kind === LABEL_KIND) {
      // NIP-32 labels are a shared wire format for the same allow/deny model.
      // They map to contributions and are gated identically: a label denies
      // someone only if its author holds the capability at reduce time.
      const contributions = labelsToContributions(decodeLabels(event), this.labelMapping);
      if (!contributions.length) {
        return false;
      }
      if (!this.#adminIngestAllowed()) {
        return false;
      }
      for (const contribution of contributions) {
        this.admin.upsertContribution(contribution);
      }
      return true;
    }

    this.diagnostics.unknownEvents += 1;
    return false;
  }

  /**
   * Whether an event was authored by the deployment's configured root.
   *
   * Falls back to the current authority root only when no root was configured,
   * which is a development convenience — a deployment with no configured root
   * has no way to distinguish its administrator from anyone else.
   *
   * @param {NostrEvent} event
   * @returns {boolean}
   */
  #isRootAuthored(event) {
    const root = this.configuredRoot || this.admin.authority.root;
    if (!root) {
      return false;
    }
    return normalizePubkey(event?.pubkey ?? "") === root;
  }

  /**
   * Whether administrative state may be ingested at all.
   *
   * Without signature verification, `event.pubkey` is an unauthenticated claim:
   * a hostile relay can put the root's key on an event the root never wrote, so
   * an authorship check alone proves nothing. Administrative documents
   * therefore fail closed unless a verifier is configured, or the application
   * explicitly opts in for local and test use.
   *
   * Trust signals — reports, mutes — are not gated here: they are bounded by
   * the viewer's own trust graph rather than by authority.
   *
   * @returns {boolean}
   */
  /**
   * Run the configured verifier synchronously.
   *
   * A verifier that returns a promise cannot be awaited on this path, so it is
   * treated as unverified: callers with an async verifier must use the loaders
   * or `ingestVerified()`, both of which await properly. Failing closed is the
   * only safe reading of "I could not check this".
   *
   * @param {NostrEvent} event
   * @returns {boolean}
   */
  #passesVerification(event) {
    if (!this.verifySignature) {
      // No verifier configured: trust signals still flow, and administrative
      // documents are refused separately by #adminIngestAllowed().
      return true;
    }
    try {
      const result = this.verifySignature(event);
      if (typeof result === "boolean") {
        return result;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Ingest an event, awaiting an asynchronous verifier when one is configured.
   * @param {NostrEvent} event
   * @returns {Promise<boolean>}
   */
  async ingestVerified(event) {
    if (this.verifySignature) {
      const [ok] = await this.#verified([event]);
      if (!ok) {
        this.diagnostics.rejectedSignatures += 1;
        return false;
      }
    }
    return this.ingestEvent(event, { verified: true });
  }

  #adminIngestAllowed() {
    if (this.verifySignature || this.trustUnsignedEvents) {
      return true;
    }
    this.diagnostics.rejectedUnverified += 1;
    this.emit("rejected", { reason: "unverified-administrative-event" });
    return false;
  }

  /**
   * Apply a root-published policy document.
   *
   * Only the root administrator may set policy, and a malformed document is
   * rejected rather than replacing a working policy: a bad publish must not be
   * able to disable governance.
   *
   * @param {unknown} document
   * @param {string} publisher
   * @returns {boolean} Whether the policy was accepted
   */
  applyRootPolicy(document, publisher) {
    const root = this.configuredRoot || this.admin.authority.root;
    if (!root || normalizePubkey(publisher) !== root) {
      this.emit("policy-rejected", { reason: "not-root", publisher });
      return false;
    }

    try {
      const policy = normalizePolicyDefinition(/** @type {any} */ (document));
      this.policies.setRootPolicy(policy);
      this.emit("policy-document", { policy });
      return true;
    } catch (error) {
      this.emit("policy-rejected", { reason: "invalid", publisher, error: String(error) });
      return false;
    }
  }

  /**
   * Persist administrative and trust state.
   *
   * Keys are namespaced by root-authority fingerprint, so rotating the root
   * administrator cannot silently reuse the previous administration's cache.
   *
   * @returns {Promise<void>}
   */
  async persist() {
    await this.storage.write(this.storageKeyFor("admin"), {
      schemaVersion: this.schemaVersion,
      savedAt: this.now(),
      authority: {
        root: this.admin.authority.root ?? "",
        actors: this.admin.authority.actors,
        protectedActors: this.admin.authority.protectedActors,
      },
      contributions: this.admin.contributions,
    });

    if (this.viewerPubkey) {
      await this.storage.write(this.storageKeyFor("viewer", true), {
        schemaVersion: this.schemaVersion,
        savedAt: this.now(),
        contacts: Array.from(this.trust.contacts),
        blocks: Array.from(this.trust.blocks),
        mutes: Array.from(this.trust.mutes),
        overrides: Array.from(this.overrides.overrides.entries()),
      });
    }
  }

  /**
   * Restore state written by {@link persist}.
   *
   * This is what keeps administrative state effective when relays are
   * unreachable. A cache written under a different schema version is ignored
   * rather than migrated.
   *
   * @returns {Promise<boolean>} Whether anything was restored
   */
  async hydrate() {
    let restored = false;

    const admin = /** @type {any} */ (await this.storage.read(this.storageKeyFor("admin")));
    if (admin?.schemaVersion === this.schemaVersion) {
      // Cache is a performance tier, never an authority tier. Storage is
      // writable by anything running on this origin, so a cached roster naming
      // a different root would turn any same-origin XSS into a persistent
      // moderation takeover. A mismatch means the cache is not ours.
      const cachedRoot = normalizePubkey(admin.authority?.root ?? "");
      if (this.configuredRoot && cachedRoot && cachedRoot !== this.configuredRoot) {
        this.emit("rejected", { reason: "cached-root-mismatch", pubkey: cachedRoot });
        this.diagnostics.hydratedFromCache = false;
        return false;
      }

      if (admin.authority) {
        this.admin.setRoles({ ...admin.authority, root: this.configuredRoot || cachedRoot });
      }
      if (Array.isArray(admin.contributions)) {
        this.admin.setContributions(admin.contributions);
      }
      restored = true;
    }

    if (this.viewerPubkey) {
      const viewer = /** @type {any} */ (
        await this.storage.read(this.storageKeyFor("viewer", true))
      );
      if (viewer?.schemaVersion === this.schemaVersion) {
        this.trust.setContacts(viewer.contacts ?? []);
        this.trust.setBlocks(viewer.blocks ?? []);
        this.trust.setMutes(viewer.mutes ?? []);
        for (const [key, override] of viewer.overrides ?? []) {
          this.overrides.set(key, override);
        }
        restored = true;
      }
    }

    this.diagnostics.hydratedFromCache = restored;
    return restored;
  }

  /**
   * Ingest an event that arrived on a live subscription.
   *
   * Subscriptions previously called ingestEvent directly, so state fetched at
   * load was verified and the identical state arriving live was not — an
   * attacker only had to wait. Verification is async, so this wraps it.
   *
   * @param {NostrEvent} event
   * @returns {Promise<boolean>}
   */
  async #ingestFromSubscription(event) {
    if (this.verifySignature) {
      const [verified] = await this.#verified([event]);
      if (!verified) {
        return false;
      }
    }
    return this.ingestEvent(event, { verified: true });
  }

  /**
   * Verify a batch of events when a verifier is configured.
   * @param {NostrEvent[]} events
   * @returns {Promise<NostrEvent[]>}
   */
  async #verified(events) {
    if (!this.verifySignature) {
      return events;
    }
    const verified = await verifyEvents(events, this.verifySignature);
    this.diagnostics.rejectedSignatures += events.length - verified.length;
    return verified;
  }

  /**
   * Load administrative state from relays.
   *
   * Signatures are verified before anything authoritative is accepted, and
   * replaceable selection runs before ingestion so only the newest document per
   * coordinate reaches the stores.
   *
   * On relay failure the previous state is left intact and the runtime is
   * marked stale, rather than emptying moderation state because a relay blinked.
   *
   * @param {Object} [options]
   * @param {string[]} [options.authors] - Restrict to known contributor pubkeys
   * @param {boolean} [options.hydrateFirst] - Restore cached state before querying
   * @param {boolean} [options.persistAfter] - Persist state after a successful load
   * @returns {Promise<number>} Number of events ingested
   */
  async loadAdministrativeState({ authors, hydrateFirst = true, persistAfter = true } = {}) {
    if (hydrateFirst) {
      await this.hydrate();
    }

    // Narrowed to the exact documents governance uses. An unfiltered query for
    // kinds 30078 and 30000 asks a relay for every application-data and
    // people-list event in existence: a self-inflicted denial of service on
    // page load, and a privacy problem since it pulls unrelated app data.
    const identifiers = GOVERNANCE_SCOPES.map(
      (scope) => `${this.namespace}:governance:${scope}:v1`,
    );

    /** @type {any} */
    const canonicalFilter = {
      kinds: [CANONICAL_KIND],
      "#d": identifiers,
      limit: DEFAULT_ADMIN_LIMIT,
    };
    /** @type {any} */
    const legacyFilter = {
      kinds: [LEGACY_KIND],
      "#d": LEGACY_IDENTIFIERS,
      limit: DEFAULT_ADMIN_LIMIT,
    };

    if (authors?.length) {
      canonicalFilter.authors = authors;
      legacyFilter.authors = authors;
    }

    let events;
    try {
      events = await this.transport.list([canonicalFilter, legacyFilter]);
    } catch (error) {
      this.stale = true;
      this.emit("stale", { reason: "relay-unreachable", error: String(error) });
      throw error;
    }

    const effective = Array.from(selectReplaceable(await this.#verified(events)).values());
    for (const event of effective) {
      this.ingestEvent(event, { verified: true });
    }

    this.stale = false;
    this.lastLoadedAt = this.now();

    if (persistAfter) {
      await this.persist();
    }

    return effective.length;
  }

  /**
   * Decrypt and apply the viewer's own private mute entries.
   *
   * Requires a signer exposing NIP-44 decryption. Without one the entries stay
   * unread, which is a degradation rather than a failure — public mutes still
   * apply.
   *
   * @param {NostrEvent} event
   * @returns {Promise<number>} Number of private entries applied
   */
  async #absorbPrivateMutes(event) {
    const decrypt = this.signer?.nip44?.decrypt ?? this.signer?.decrypt;
    if (typeof decrypt !== "function") {
      return 0;
    }

    let entries;
    try {
      entries = await decodePrivateMuteEntries(event, {
        viewerPubkey: this.viewerPubkey,
        decrypt: (pubkey, ciphertext) => decrypt.call(this.signer, pubkey, ciphertext),
      });
    } catch {
      return 0;
    }

    if (!entries.length) {
      return 0;
    }

    // A viewer's own mutes are viewer state, not a trusted-mute signal: they
    // are a personal preference, not evidence about the target.
    const combined = new Set([...this.trust.mutes, ...entries.map((entry) => entry.pubkey)]);
    this.trust.setMutes(combined);
    this.diagnostics.privateMutesApplied = entries.length;
    return entries.length;
  }

  /**
   * Load NIP-65 relay lists for a set of authors.
   *
   * Fetched from the configured relays, since a relay list is the one thing
   * that cannot be fetched using itself.
   *
   * @param {string[]} authors
   * @returns {Promise<number>} Number of lists learned
   */
  async loadRelayLists(authors) {
    const pubkeys = Array.from(new Set((authors ?? []).map((key) => normalizePubkey(key)).filter(Boolean)));
    if (!pubkeys.length) {
      return 0;
    }

    let learned = 0;
    for (const chunkOfAuthors of chunk(pubkeys, this.chunkSize)) {
      let events;
      try {
        events = await this.transport.list([
          { kinds: [RELAY_LIST_KIND], authors: chunkOfAuthors },
        ]);
      } catch (error) {
        this.emit("stale", { reason: "relay-lists-unreachable", error: String(error) });
        continue;
      }

      for (const event of selectReplaceable(await this.#verified(events)).values()) {
        if (this.ingestEvent(event, { verified: true })) {
          learned += 1;
        }
      }
    }

    return learned;
  }

  /**
   * Load NIP-32 labels published by a set of labellers.
   *
   * Labels only take effect for labellers the roster grants a contribution
   * capability, so this is safe to point at any labeller: an untrusted one's
   * labels reduce to nothing. Fetched from the configured relays.
   *
   * @param {string[]} labellers - Pubkeys whose labels to read
   * @returns {Promise<number>} Number of label events ingested
   */
  async loadLabels(labellers) {
    const authors = Array.from(
      new Set((labellers ?? []).map((key) => normalizePubkey(key)).filter(Boolean)),
    );
    if (!authors.length) {
      return 0;
    }

    let ingested = 0;
    for (const chunkOfAuthors of chunk(authors, this.chunkSize)) {
      let events;
      try {
        events = await this.transport.list([{ kinds: [LABEL_KIND], authors: chunkOfAuthors }]);
      } catch (error) {
        this.emit("stale", { reason: "labels-unreachable", error: String(error) });
        continue;
      }

      for (const event of selectReplaceable(await this.#verified(events)).values()) {
        if (this.ingestEvent(event, { verified: true })) {
          ingested += 1;
        }
      }
    }

    return ingested;
  }

  /**
   * Load the viewer's follow list and adopt it as the trust graph.
   *
   * @returns {Promise<number>} Number of contacts adopted
   */
  async loadContacts() {
    if (!this.viewerPubkey) {
      return 0;
    }

    let events;
    try {
      events = await this.transport.list([
        { kinds: [CONTACT_LIST_KIND], authors: [this.viewerPubkey] },
      ]);
    } catch (error) {
      this.emit("stale", { reason: "contacts-unreachable", error: String(error) });
      return 0;
    }

    for (const event of selectReplaceable(await this.#verified(events)).values()) {
      this.ingestEvent(event, { verified: true });
    }

    return this.trust.contacts.size;
  }

  /**
   * Load trusted mute lists using the outbox model.
   *
   * Each contact publishes their mute list to their own write relays, so a
   * query against a fixed relay set finds only the subset who happen to write
   * where this deployment reads. Fetching per-author from their advertised
   * relays is the difference between a trust graph that works and one that
   * silently reports low counts.
   *
   * Falls back to the configured relays for anyone with no published relay
   * list — dropping them would be worse than querying the wrong place.
   *
   * @param {Object} [options]
   * @param {boolean} [options.discoverRelays] - Fetch relay lists first
   * @returns {Promise<number>} Number of mute lists ingested
   */
  async loadTrustedMuteLists({ discoverRelays = true } = {}) {
    const owners = Array.from(this.trust.trustSet);
    if (!owners.length) {
      return 0;
    }

    if (discoverRelays) {
      await this.loadRelayLists(owners);
    }

    const grouped = groupAuthorsByWriteRelay(owners, this.relayLists, {
      fallback: this.defaultRelays,
    });

    let ingested = 0;
    for (const [relay, authors] of grouped) {
      for (const authorChunk of chunk(authors, this.chunkSize)) {
        let events;
        try {
          events = await this.transport.list(
            [{ kinds: [MUTE_LIST_KIND], authors: authorChunk }],
            { relays: [relay] },
          );
        } catch (error) {
          this.emit("stale", { reason: "mute-lists-unreachable", relay, error: String(error) });
          continue;
        }

        for (const event of selectReplaceable(await this.#verified(events)).values()) {
          if (this.ingestEvent(event, { verified: true })) {
            ingested += 1;
          }
        }
      }
    }

    return ingested;
  }

  /**
   * Subscribe to the mute lists published by the viewer's trusted contacts.
   *
   * Without this the trusted-mute store never populates in a real deployment:
   * mute lists are published by each contact under their own key, so they have
   * to be fetched per author rather than per target.
   *
   * @returns {{ close: () => void }}
   */
  subscribeToTrustedMuteLists() {
    const owners = Array.from(this.trust.trustSet);

    /** @type {Array<{ close: () => void }>} */
    const opened = [];
    for (const authorChunk of chunk(owners, this.chunkSize)) {
      if (!authorChunk.length) continue;
      opened.push(
        this.transport.subscribe([{ kinds: [MUTE_LIST_KIND], authors: authorChunk }], {
          onEvent: (event) => void this.#ingestFromSubscription(event),
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
   * Resolve community-curated lists the root has pointed at.
   *
   * Curators publish under their own keys; the root only publishes references.
   * Each resolved list is merged with a source marker so a consumer can tell a
   * federated denial from a direct administrative one.
   *
   * @param {Array<{ curator: string, identifier: string, kind: number }>} sources
   * @returns {Promise<number>} Number of curator lists merged
   */
  async loadCommunitySources(sources) {
    let merged = 0;

    for (const source of sources ?? []) {
      let events;
      try {
        events = await this.transport.list([
          { kinds: [source.kind], authors: [source.curator], "#d": [source.identifier] },
        ]);
      } catch (error) {
        this.emit("stale", { reason: "community-source-unreachable", source, error: String(error) });
        continue;
      }

      const effective = Array.from(selectReplaceable(await this.#verified(events)).values());
      for (const event of effective) {
        const contribution = decodeContribution(event) ?? decodeLegacyList(event);
        if (!contribution) {
          continue;
        }
        this.admin.upsertContribution({
          ...contribution,
          source: `${source.curator}:${source.identifier}`,
        });
        merged += 1;
      }
    }

    return merged;
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
          onEvent: (event) => void this.#ingestFromSubscription(event),
        }),
      );
    }

    for (const keys of chunk(pubkeys, this.chunkSize)) {
      if (!keys.length) continue;
      opened.push(
        this.transport.subscribe([{ kinds: [REPORT_KIND], "#p": keys }], {
          onEvent: (event) => void this.#ingestFromSubscription(event),
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

    if (this.decisionCache.size > this.maxCachedDecisions) {
      // Maps iterate in insertion order, so the first key is the least
      // recently added — good enough eviction for a cache whose miss cost is
      // one pure evaluation.
      const oldest = this.decisionCache.keys().next().value;
      if (oldest !== undefined) {
        this.decisionCache.delete(oldest);
      }
    }

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

  /**
   * Export governance state as a portable, JSON-serializable snapshot.
   *
   * Contributions are exported as published rather than as reduced state, so an
   * import re-derives effective state against whatever roster is current. A
   * snapshot of *conclusions* would silently outlive the authority that
   * produced them.
   *
   * @returns {Object}
   */
  exportState() {
    return {
      schemaVersion: this.schemaVersion,
      applicationId: this.applicationId,
      namespace: this.namespace,
      exportedAt: this.now(),
      authority: {
        root: this.admin.authority.root ?? "",
        actors: this.admin.authority.actors,
        protectedActors: this.admin.authority.protectedActors,
      },
      contributions: this.admin.contributions,
      effectiveState: serializeAdminState(this.admin.state),
      policy: { id: this.policies.policy.id, version: this.policies.policy.version },
      fingerprints: {
        root: this.admin.rootFingerprint,
        admin: this.admin.fingerprint,
        trust: this.trust.fingerprint,
      },
    };
  }

  /**
   * Import a snapshot produced by {@link exportState}.
   *
   * Rejects a snapshot from a different schema version or namespace rather than
   * attempting a migration.
   *
   * @param {any} snapshot
   * @returns {boolean} Whether the snapshot was applied
   */
  importState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }
    if (snapshot.schemaVersion !== this.schemaVersion) {
      return false;
    }
    if (snapshot.namespace && snapshot.namespace !== this.namespace) {
      return false;
    }

    if (snapshot.authority) {
      this.admin.setRoles(snapshot.authority);
    }
    if (Array.isArray(snapshot.contributions)) {
      this.admin.setContributions(snapshot.contributions);
    }
    return true;
  }

  /**
   * Whether an actor holds a capability under the current roster.
   * @param {string} pubkey
   * @param {import('@bitgate/core').GovernanceCapability} capability
   * @returns {boolean}
   */
  can(pubkey, capability) {
    return hasCapability(pubkey, capability, this.admin.authority);
  }

  /**
   * Every capability an actor holds under the current roster.
   * @param {string} pubkey
   * @returns {import('@bitgate/core').GovernanceCapability[]}
   */
  capabilitiesOf(pubkey) {
    return getActorCapabilities(pubkey, this.admin.authority);
  }

  /**
   * What the current viewer is allowed to do.
   * @returns {import('@bitgate/core').GovernanceCapability[]}
   */
  viewerCapabilities() {
    return this.viewerPubkey ? this.capabilitiesOf(this.viewerPubkey) : [];
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
      stale: this.stale,
      lastLoadedAt: this.lastLoadedAt,
      signatureVerification: this.verifySignature ? "enabled" : "disabled",
      ...this.diagnostics,
      // Derived from live state, so it is computed after the counters rather
      // than stored alongside them where a stale copy could shadow it.
      relayListsKnown: this.relayLists.size,
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
export function createBitGate(options) {
  return new GovernanceRuntime(options);
}
