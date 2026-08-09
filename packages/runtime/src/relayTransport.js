// WebSocket relay transport.
//
// The runtime depends on no particular relay pool, and an application with one
// should keep using it. This exists so that nobody has to write a transport
// just to get started: it is the difference between "supply an adapter" and
// "pass some relay URLs".
//
// Deliberately small. It speaks enough of the Nostr protocol to load governance
// state, subscribe to reports and mute lists, and publish administrative
// events. It is not a general-purpose relay client and does not try to be.

/**
 * @typedef {import('@bitgate/nostr').NostrEvent} NostrEvent
 * @typedef {import('./interfaces.js').GovernanceTransport} GovernanceTransport
 * @typedef {import('./interfaces.js').SubscriptionHandlers} SubscriptionHandlers
 */

/** Milliseconds to wait for a relay's stored events before resolving `list`. */
const DEFAULT_LIST_TIMEOUT = 8_000;

/** Milliseconds between reconnection attempts, before backoff. */
const DEFAULT_RECONNECT_DELAY = 1_000;

/** Ceiling for reconnect backoff. */
const MAX_RECONNECT_DELAY = 30_000;

let subscriptionCounter = 0;

/**
 * Create a transport backed by plain WebSockets.
 *
 * @param {string[]} urls - Relay URLs (`wss://…`)
 * @param {Object} [options]
 * @param {typeof WebSocket} [options.WebSocketImpl] - Injected for tests or Node
 * @param {number} [options.listTimeout] - Milliseconds to wait for stored events
 * @param {number} [options.reconnectDelay] - Initial reconnect delay
 * @param {(message: string, detail?: unknown) => void} [options.onDiagnostic]
 * @returns {GovernanceTransport & { close: () => void, relays: string[] }}
 */
export function createRelayTransport(urls, options = {}) {
  const relays = (Array.isArray(urls) ? urls : [])
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter(Boolean);

  if (relays.length === 0) {
    throw new Error("createRelayTransport requires at least one relay URL");
  }

  const SocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  if (typeof SocketImpl !== "function") {
    throw new Error("No WebSocket implementation available; pass options.WebSocketImpl");
  }

  const listTimeout = options.listTimeout ?? DEFAULT_LIST_TIMEOUT;
  const baseReconnectDelay = options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY;
  const diagnostic = options.onDiagnostic ?? (() => {});

  /** @type {Map<string, { socket: any, ready: boolean, queue: string[], attempts: number, timer: any }>} */
  const connections = new Map();

  // OK frames answer a publish, not a subscription, so they are dispatched
  // through their own listener set. Keeping them here rather than rebinding a
  // socket's onmessage avoids stacking wrappers across repeated publishes.
  /** @type {Set<(url: string, frame: any[]) => void>} */
  const okListeners = new Set();

  /** @type {Map<string, { filters: object[], handlers: SubscriptionHandlers, relays: Set<string> }>} */
  const subscriptions = new Map();

  let closed = false;

  /**
   * @param {string} url
   * @param {string} payload
   */
  function send(url, payload) {
    const connection = connections.get(url);
    if (!connection) {
      return;
    }
    if (connection.ready) {
      try {
        connection.socket.send(payload);
      } catch (error) {
        diagnostic("relay send failed", { url, error: String(error) });
      }
      return;
    }
    // REQ frames are never queued: every live subscription is re-issued from
    // the subscription map when the socket opens, so queueing one too would
    // send it twice. Everything else (EVENT, CLOSE) is queued rather than
    // dropped, since nothing else would re-send it.
    if (!payload.startsWith('["REQ"')) {
      connection.queue.push(payload);
    }
  }

  /** @param {string} url */
  function connect(url) {
    if (closed) {
      return;
    }

    /** @type {any} */
    const existing = connections.get(url) ?? { socket: null, ready: false, queue: [], attempts: 0, timer: null };
    connections.set(url, existing);

    let socket;
    try {
      socket = new SocketImpl(url);
    } catch (error) {
      diagnostic("relay connect threw", { url, error: String(error) });
      scheduleReconnect(url);
      return;
    }

    existing.socket = socket;
    existing.ready = false;

    socket.onopen = () => {
      existing.ready = true;
      existing.attempts = 0;

      // Re-open every live subscription: a reconnect that dropped them would
      // leave the UI silently stale rather than visibly broken.
      for (const [id, subscription] of subscriptions) {
        subscription.relays.add(url);
        send(url, JSON.stringify(["REQ", id, ...subscription.filters]));
      }

      const queued = existing.queue.splice(0);
      for (const payload of queued) {
        send(url, payload);
      }
    };

    socket.onmessage = (message) => {
      let frame;
      try {
        frame = JSON.parse(typeof message?.data === "string" ? message.data : "");
      } catch {
        return;
      }
      if (!Array.isArray(frame)) {
        return;
      }

      const [verb, id, payload] = frame;

      if (verb === "OK") {
        for (const listener of Array.from(okListeners)) {
          listener(url, frame);
        }
        return;
      }
      if (verb === "NOTICE") {
        diagnostic("relay notice", { url, message: id });
        return;
      }

      const subscription = subscriptions.get(id);
      if (!subscription) {
        return;
      }

      if (verb === "EVENT" && payload) {
        subscription.handlers.onEvent?.(payload);
      } else if (verb === "EOSE") {
        subscription.handlers.onEose?.();
      } else if (verb === "CLOSED") {
        diagnostic("relay closed subscription", { url, id, reason: payload });
      }
    };

    socket.onerror = (error) => {
      diagnostic("relay socket error", { url, error: String(error?.message ?? error) });
    };

    socket.onclose = () => {
      existing.ready = false;
      for (const subscription of subscriptions.values()) {
        subscription.relays.delete(url);
      }
      scheduleReconnect(url);
    };
  }

  /** @param {string} url */
  function scheduleReconnect(url) {
    if (closed) {
      return;
    }
    const connection = connections.get(url);
    if (!connection || connection.timer) {
      return;
    }

    connection.attempts += 1;
    const delay = Math.min(baseReconnectDelay * 2 ** (connection.attempts - 1), MAX_RECONNECT_DELAY);

    connection.timer = setTimeout(() => {
      connection.timer = null;
      connect(url);
    }, delay);

    // Never let a reconnect timer hold a Node process open.
    connection.timer?.unref?.();
  }

  for (const url of relays) {
    connect(url);
  }

  return {
    relays,

    /**
     * Collect stored events matching the filters.
     *
     * Resolves on EOSE from every relay, or when the timeout elapses —
     * whichever comes first. A single slow relay must not stall a page load,
     * and results already received are returned rather than discarded.
     *
     * @param {object[]} filters
     * @param {{ timeout?: number }} [listOptions]
     * @returns {Promise<NostrEvent[]>}
     */
    async list(filters, listOptions = {}) {
      const id = `bg-list-${(subscriptionCounter += 1)}`;
      /** @type {Map<string, NostrEvent>} */
      const collected = new Map();

      return new Promise((resolve) => {
        let settled = false;
        let pendingEose = relays.length;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          subscriptions.delete(id);
          for (const url of relays) {
            send(url, JSON.stringify(["CLOSE", id]));
          }
          resolve([...collected.values()]);
        };

        const timer = setTimeout(finish, listOptions.timeout ?? listTimeout);
        timer?.unref?.();

        subscriptions.set(id, {
          filters,
          relays: new Set(),
          handlers: {
            onEvent: (event) => {
              // Relays overlap heavily; dedupe by id so a caller does not have to.
              if (event?.id && !collected.has(event.id)) {
                collected.set(event.id, event);
              }
            },
            onEose: () => {
              pendingEose -= 1;
              if (pendingEose <= 0) {
                finish();
              }
            },
          },
        });

        for (const url of relays) {
          send(url, JSON.stringify(["REQ", id, ...filters]));
        }
      });
    },

    /**
     * Open a live subscription across every relay.
     * @param {object[]} filters
     * @param {SubscriptionHandlers} handlers
     * @returns {{ close: () => void }}
     */
    subscribe(filters, handlers) {
      const id = `bg-sub-${(subscriptionCounter += 1)}`;
      /** @type {Set<string>} */
      const seen = new Set();

      subscriptions.set(id, {
        filters,
        relays: new Set(),
        handlers: {
          onEvent: (event) => {
            if (!event?.id || seen.has(event.id)) {
              return;
            }
            seen.add(event.id);
            handlers.onEvent?.(event);
          },
          onEose: handlers.onEose,
          onError: handlers.onError,
        },
      });

      const payload = JSON.stringify(["REQ", id, ...filters]);
      for (const url of relays) {
        send(url, payload);
      }

      return {
        close() {
          subscriptions.delete(id);
          const closePayload = JSON.stringify(["CLOSE", id]);
          for (const url of relays) {
            send(url, closePayload);
          }
        },
      };
    },

    /**
     * Publish an event to every relay.
     *
     * Resolves once every relay has answered or the timeout elapses. Partial
     * acceptance is success: one relay accepting means the event exists on the
     * network, and the failures stay on the result for diagnostics.
     *
     * @param {NostrEvent} event
     * @param {{ timeout?: number }} [publishOptions]
     * @returns {Promise<import('./interfaces.js').PublishResult>}
     */
    async publish(event, publishOptions = {}) {
      /** @type {string[]} */
      const accepted = [];
      /** @type {Array<{ relay: string, error: string }>} */
      const failed = [];

      return new Promise((resolve) => {
        let settled = false;
        const answered = new Set();

        /** @param {string} url @param {any[]} frame */
        const listener = (url, frame) => {
          if (frame[1] !== event.id || answered.has(url)) {
            return;
          }
          answered.add(url);

          if (frame[2] === true) {
            accepted.push(url);
          } else {
            failed.push({ relay: url, error: String(frame[3] ?? "rejected") });
          }

          if (answered.size >= relays.length) {
            finish();
          }
        };

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          okListeners.delete(listener);

          // Relays that never answered are reported as timed out rather than
          // silently omitted, so diagnostics show the full picture.
          for (const url of relays) {
            if (!answered.has(url)) {
              failed.push({ relay: url, error: "timeout" });
            }
          }

          resolve({ ok: accepted.length > 0, accepted, failed });
        };

        const timer = setTimeout(finish, publishOptions.timeout ?? listTimeout);
        timer?.unref?.();

        okListeners.add(listener);
        send(relays[0], JSON.stringify(["EVENT", event]));
        for (const url of relays.slice(1)) {
          send(url, JSON.stringify(["EVENT", event]));
        }
      });
    },

    /** Close every socket and stop reconnecting. */
    close() {
      closed = true;
      subscriptions.clear();
      for (const connection of connections.values()) {
        if (connection.timer) {
          clearTimeout(connection.timer);
          connection.timer = null;
        }
        try {
          connection.socket?.close?.();
        } catch {
          // Closing an already-dead socket is not an error worth surfacing.
        }
      }
      connections.clear();
    },
  };
}
