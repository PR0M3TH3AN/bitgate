// Minimal event emitter used by the stores.
//
// Stores emit only when state actually changes, so consumers can treat every
// emission as a real invalidation rather than polling for differences.

/**
 * @typedef {(detail: any) => void} Listener
 */

export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Listener>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} name
   * @param {Listener} handler
   * @returns {() => void} Unsubscribe function
   */
  on(name, handler) {
    if (typeof name !== "string" || typeof handler !== "function") {
      return () => {};
    }

    let handlers = this.listeners.get(name);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(name, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (!handlers.size) {
        this.listeners.delete(name);
      }
    };
  }

  /**
   * Emit an event.
   *
   * A throwing listener must not prevent the remaining listeners from running,
   * nor propagate out of a store's internal state update.
   *
   * @param {string} name
   * @param {any} [detail]
   */
  emit(name, detail) {
    const handlers = this.listeners.get(name);
    if (!handlers?.size) {
      return;
    }
    for (const handler of Array.from(handlers)) {
      try {
        handler(detail);
      } catch {
        // Listener errors are contained; state has already been updated.
      }
    }
  }

  /** Drop every listener. */
  clear() {
    this.listeners.clear();
  }
}
