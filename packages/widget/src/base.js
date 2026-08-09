// Shared base for governance custom elements.
//
// Every element here follows one rule: it renders decisions and issues
// commands, and computes no policy of its own. The moment a component compares
// a count to a threshold, the duplication this project exists to remove has
// come back in the view layer.
//
// Elements receive a runtime rather than constructing one. A widget that owned
// relay connections would make it impossible for a host application to share
// one governance runtime across its whole page.

/**
 * @typedef {import('@bitgate/runtime').GovernanceRuntime} GovernanceRuntime
 * @typedef {import('@bitgate/core').GovernanceDecision} GovernanceDecision
 * @typedef {import('@bitgate/core').GovernanceTarget} GovernanceTarget
 */

/**
 * Whether custom elements can be defined in this environment.
 *
 * The package is importable in Node so that a server-rendering host can pull in
 * the helpers without a DOM; only registration requires a browser.
 *
 * @returns {boolean}
 */
export function canRegisterElements() {
  return typeof globalThis.HTMLElement === "function" && typeof globalThis.customElements === "object";
}

/** Base styles shared by every element, scoped inside each shadow root. */
export const BASE_STYLES = `
  :host {
    --gov-fg: currentColor;
    --gov-muted: color-mix(in srgb, currentColor 60%, transparent);
    --gov-border: color-mix(in srgb, currentColor 20%, transparent);
    --gov-surface: color-mix(in srgb, canvas 96%, currentColor);
    --gov-warn: #b45309;
    --gov-danger: #b91c1c;
    --gov-radius: 8px;
    display: block;
    color: var(--gov-fg);
    font: inherit;
  }
  :host([hidden]) { display: none; }
  button {
    font: inherit;
    color: inherit;
    background: var(--gov-surface);
    border: 1px solid var(--gov-border);
    border-radius: var(--gov-radius);
    padding: 0.4em 0.8em;
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--gov-fg); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .reason {
    color: var(--gov-muted);
    font-size: 0.875em;
  }
  .row { display: flex; gap: 0.5em; align-items: center; flex-wrap: wrap; }
  .stack { display: grid; gap: 0.75em; }
`;

/**
 * Escape text for interpolation into element markup.
 *
 * Reason identifiers and pubkeys are the only untrusted-ish values these
 * elements render, but they arrive from relays, so they are escaped rather
 * than trusted to be well-formed.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Shorten a pubkey for display without pretending to resolve a profile.
 * @param {string} pubkey
 * @returns {string}
 */
export function shortenKey(pubkey) {
  const value = String(pubkey ?? "");
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

/**
 * Ask the nearest provider for its runtime and commands.
 *
 * Declared here rather than imported from ./provider.js to keep the module
 * graph acyclic: provider.js already depends on this file.
 *
 * @param {Element} element
 * @returns {{ runtime: any, commands: any }|null}
 */
export function requestContext(element) {
  /** @type {{ context: any }} */
  const detail = { context: null };
  element.dispatchEvent(
    new CustomEvent("bitgate:context-request", { detail, bubbles: true, composed: true }),
  );
  return detail.context;
}

/**
 * Parse a governance target from element attributes.
 *
 * Lets markup name a target without JavaScript:
 *   target-event / target-author / target-kind
 *   target-user
 *   target-address (a `kind:pubkey:d` coordinate)
 *
 * @param {Element} element
 * @returns {import('@bitgate/core').GovernanceTarget|null}
 */
export function targetFromAttributes(element) {
  const user = element.getAttribute("target-user");
  if (user) {
    return { type: "user", pubkey: user.trim() };
  }

  const eventId = element.getAttribute("target-event");
  if (eventId) {
    /** @type {any} */
    const target = { type: "event", id: eventId.trim() };
    const author = element.getAttribute("target-author");
    if (author) {
      target.author = author.trim();
    }
    const kind = element.getAttribute("target-kind");
    if (kind && Number.isFinite(Number(kind))) {
      target.kind = Number(kind);
    }
    return target;
  }

  const address = element.getAttribute("target-address");
  if (address) {
    const first = address.indexOf(":");
    const second = address.indexOf(":", first + 1);
    if (first > 0 && second > first) {
      return {
        type: "address",
        kind: address.slice(0, first),
        pubkey: address.slice(first + 1, second),
        identifier: address.slice(second + 1),
      };
    }
  }

  return null;
}

/**
 * Base element: owns a shadow root, a runtime reference, and change
 * subscription lifecycle.
 *
 * Subclasses implement `render()` and may implement `template()`.
 */
export class GovernanceElement extends globalThis.HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    /** @type {GovernanceRuntime|null} */
    this._runtime = null;
    /** @type {(() => void)|null} */
    this._unsubscribe = null;
    this._awaitingProvider = false;
  }

  /**
   * The governance runtime this element reads from.
   * @returns {GovernanceRuntime|null}
   */
  get runtime() {
    return this._runtime;
  }

  set runtime(runtime) {
    if (this._runtime === runtime) {
      return;
    }
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._runtime = runtime ?? null;

    if (this._runtime && this.isConnected) {
      this._subscribe();
    }
    this.render();
  }

  connectedCallback() {
    // Adopt the nearest provider's runtime when one was not assigned directly.
    // This is what lets a page configure BitGate entirely in markup.
    if (!this._runtime) {
      this.adoptContext();
    }
    if (this._runtime && !this._unsubscribe) {
      this._subscribe();
    }
    this.render();
  }

  /**
   * Find a `<bitgate-provider>` ancestor and take its runtime and commands.
   *
   * A provider that is still starting answers with nothing; the element waits
   * for `bitgate:ready` rather than polling.
   *
   * @returns {boolean} Whether a runtime was adopted
   */
  adoptContext() {
    const context = requestContext(this);
    if (context?.runtime) {
      this.runtime = context.runtime;
      if (context.commands && "commands" in this) {
        /** @type {any} */ (this).commands = context.commands;
      }
      return true;
    }

    if (!this._awaitingProvider) {
      this._awaitingProvider = true;
      globalThis.document?.addEventListener(
        "bitgate:ready",
        (event) => {
          const detail = /** @type {CustomEvent} */ (event).detail;
          if (!detail?.runtime || this._runtime) {
            return;
          }
          this.runtime = detail.runtime;
          if (detail.commands && "commands" in this) {
            /** @type {any} */ (this).commands = detail.commands;
          }
        },
        { once: true },
      );
    }
    return false;
  }

  disconnectedCallback() {
    // Elements are routinely moved or removed during rendering; leaving a
    // subscription behind would keep a detached element re-rendering forever.
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  _subscribe() {
    this._unsubscribe = /** @type {GovernanceRuntime} */ (this._runtime).on("change", () =>
      this.render(),
    );
  }

  /**
   * Emit a namespaced, composed event so hosts can react across shadow bounds.
   * @param {string} name
   * @param {any} detail
   */
  emit(name, detail) {
    this.dispatchEvent(
      new CustomEvent(`bitgate:${name}`, { detail, bubbles: true, composed: true }),
    );
  }

  /** Replace shadow content. */
  renderHtml(html) {
    /** @type {ShadowRoot} */ (this.shadowRoot).innerHTML = `<style>${BASE_STYLES}</style>${html}`;
  }

  /** @param {string} selector */
  $(selector) {
    return /** @type {ShadowRoot} */ (this.shadowRoot).querySelector(selector);
  }

  /** Subclass hook. */
  render() {}
}

/**
 * Register an element, tolerating repeat registration.
 *
 * A page that loads the widget bundle twice should not throw; the first
 * definition wins.
 *
 * @param {string} name
 * @param {CustomElementConstructor} constructor
 * @returns {boolean} Whether this call performed the registration
 */
export function defineElement(name, constructor) {
  if (!canRegisterElements()) {
    return false;
  }
  if (globalThis.customElements.get(name)) {
    return false;
  }
  globalThis.customElements.define(name, constructor);
  return true;
}
