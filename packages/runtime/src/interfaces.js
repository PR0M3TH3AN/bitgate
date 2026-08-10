// Injected dependency contracts and their in-memory test doubles.
//
// The package depends on no relay pool, signer, or storage implementation.
// Consumers supply adapters; these doubles exist so the runtime can be tested
// and so an application can boot a working runtime before wiring real relays.

/**
 * @typedef {import('@bitgate/nostr').NostrEvent} NostrEvent
 */

/**
 * @typedef {Object} GovernanceSubscription
 * @property {() => void} close
 */

/**
 * @typedef {Object} SubscriptionHandlers
 * @property {(event: NostrEvent) => void} [onEvent]
 * @property {() => void} [onEose]
 * @property {(error: unknown) => void} [onError]
 */

/**
 * @typedef {Object} ListOptions
 * @property {number} [timeout]
 * @property {number} [maxSeen] - Ceiling on the per-subscription dedupe window
 * @property {string[]} [relays] - Query only these relays, connecting if needed.
 *   This is what makes outbox-model fetching possible: a contact's mute list
 *   lives on their write relays, not on this deployment's.
 */

/**
 * @typedef {Object} GovernanceTransport
 * @property {(filters: object[], options?: ListOptions) => Promise<NostrEvent[]>} list
 * @property {(filters: object[], handlers: SubscriptionHandlers, options?: ListOptions) => GovernanceSubscription} subscribe
 * @property {(event: NostrEvent, options?: object) => Promise<PublishResult>} publish
 * @property {string[]} [relays] - The transport's configured relays, used as an
 *   outbox fallback for authors who have published no NIP-65 list
 */

/**
 * @typedef {Object} PublishResult
 * @property {boolean} ok - Whether at least one relay accepted the event
 * @property {string[]} accepted - Relay URLs that accepted
 * @property {Array<{ relay: string, error: string }>} failed
 */

/**
 * @typedef {Object} Nip44
 * @property {(pubkey: string, ciphertext: string) => Promise<string>} decrypt
 * @property {(pubkey: string, plaintext: string) => Promise<string>} [encrypt]
 */

/**
 * @typedef {Object} GovernanceSigner
 * @property {() => Promise<string>} getPublicKey
 * @property {(event: object) => Promise<NostrEvent>} signEvent
 * @property {Nip44} [nip44] - NIP-44 encryption, as NIP-07 providers expose it.
 *   Optional: without it the viewer's private mute entries stay unread, which
 *   degrades the feature rather than breaking anything.
 * @property {(pubkey: string, ciphertext: string) => Promise<string>} [decrypt] -
 *   Flat fallback for signers that expose decryption without the nip44 namespace
 */

/**
 * @typedef {Object} GovernanceStorage
 * @property {(key: string) => Promise<unknown>} read
 * @property {(key: string, value: unknown) => Promise<void>} write
 * @property {(key: string) => Promise<void>} remove
 */

/**
 * Build a namespaced storage key.
 *
 * Keys carry the application, namespace, root-authority fingerprint, schema
 * version, and — when the data is viewer-specific — the viewer. Without the
 * root fingerprint, switching a deployment's root administrator would silently
 * reuse the previous administration's cached state.
 *
 * @param {Object} parts
 * @param {string} parts.applicationId
 * @param {string} parts.namespace
 * @param {string} parts.rootFingerprint
 * @param {string} parts.schemaVersion
 * @param {string} parts.scope
 * @param {string} [parts.viewerPubkey]
 * @returns {string}
 */
export function storageKey({
  applicationId,
  namespace,
  rootFingerprint,
  schemaVersion,
  scope,
  viewerPubkey,
}) {
  const segments = [
    "bitgate",
    applicationId,
    namespace,
    rootFingerprint,
    schemaVersion,
    scope,
  ];
  if (viewerPubkey) {
    segments.push(viewerPubkey);
  }
  return segments.join(":");
}

/**
 * In-memory storage, used for tests and as a no-persistence default.
 * @returns {GovernanceStorage}
 */
export function createMemoryStorage() {
  /** @type {Map<string, unknown>} */
  const store = new Map();

  return {
    async read(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async write(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    },
  };
}

/**
 * In-memory transport backed by a fixed event list.
 *
 * Filters support the subset the stores actually use: kinds, authors, #d, #e,
 * #p, and #a.
 *
 * @param {NostrEvent[]} [events]
 * @returns {GovernanceTransport & { events: NostrEvent[], published: NostrEvent[], deliver: (event: NostrEvent) => void }}
 */
export function createMemoryTransport(events = []) {
  /** @type {NostrEvent[]} */
  const all = [...events];
  /** @type {NostrEvent[]} */
  const published = [];
  /** @type {Set<{ filters: object[], handlers: SubscriptionHandlers }>} */
  const subscriptions = new Set();

  /**
   * @param {NostrEvent} event
   * @param {any} filter
   * @returns {boolean}
   */
  function matches(event, filter) {
    if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) {
      return false;
    }
    if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) {
      return false;
    }
    for (const [key, values] of Object.entries(filter)) {
      if (!key.startsWith("#") || !Array.isArray(values)) {
        continue;
      }
      const tagName = key.slice(1);
      const present = (event.tags ?? []).some(
        (tag) => tag[0] === tagName && values.includes(tag[1]),
      );
      if (!present) {
        return false;
      }
    }
    return true;
  }

  return {
    events: all,
    published,

    async list(filters) {
      return all.filter((event) => filters.some((filter) => matches(event, filter)));
    },

    subscribe(filters, handlers) {
      const entry = { filters, handlers };
      subscriptions.add(entry);

      for (const event of all) {
        if (filters.some((filter) => matches(event, filter))) {
          handlers.onEvent?.(event);
        }
      }
      handlers.onEose?.();

      return {
        close() {
          subscriptions.delete(entry);
        },
      };
    },

    async publish(event) {
      published.push(event);
      return { ok: true, accepted: ["memory://"], failed: [] };
    },

    /**
     * Push an event to live subscriptions, simulating a relay delivery.
     * @param {NostrEvent} event
     */
    deliver(event) {
      all.push(event);
      for (const { filters, handlers } of subscriptions) {
        if (filters.some((filter) => matches(event, filter))) {
          handlers.onEvent?.(event);
        }
      }
    },
  };
}

/**
 * Signer that refuses to sign, used as the default so an unconfigured runtime
 * fails loudly at the point of a write instead of appearing to succeed.
 * @returns {GovernanceSigner}
 */
export function createNullSigner() {
  return {
    async getPublicKey() {
      throw new Error("no-signer-configured");
    },
    async signEvent() {
      throw new Error("no-signer-configured");
    },
  };
}
