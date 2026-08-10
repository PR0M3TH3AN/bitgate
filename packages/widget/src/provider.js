// `<bitgate-provider>` — attribute-driven setup.
//
// This is what makes BitGate droppable into a static page. Without it, a host
// has to construct a runtime in JavaScript and assign it to every element;
// with it, the markup carries the configuration and descendants find the
// runtime themselves.
//
// Descendants discover the provider by firing a bubbling request event rather
// than walking up the DOM. Walking up breaks across shadow boundaries, which is
// exactly where a host is most likely to place these elements.

import { createBitGate, createCommands, createRelayTransport } from "@bitgate/runtime";
import { getPolicyPreset } from "@bitgate/core";

import { GovernanceElement, defineElement, escapeHtml } from "./base.js";

/** Event a descendant fires to locate its provider. */
export const CONTEXT_REQUEST = "bitgate:context-request";

/**
 * Ask the nearest provider for its runtime and commands.
 *
 * Returns null when no provider is present, which is a legitimate state: an
 * element may be configured directly in JavaScript instead.
 *
 * @param {Element} element
 * @returns {{ runtime: any, commands: any }|null}
 */
export function requestContext(element) {
  /** @type {{ context: any }} */
  const detail = { context: null };
  element.dispatchEvent(new CustomEvent(CONTEXT_REQUEST, { detail, bubbles: true, composed: true }));
  return detail.context;
}

export class BitGateProvider extends globalThis.HTMLElement {
  static get observedAttributes() {
    return ["relays", "root", "policy", "profile", "application", "namespace", "viewer", "trust"];
  }

  constructor() {
    super();
    /** @type {any} */
    this.runtime = null;
    /** @type {any} */
    this.commands = null;
    /** @type {any} */
    this.transport = null;
    /** @type {Error|null} */
    this.error = null;
    this._ready = false;

    // A promise as well as an event. The event fires during element upgrade,
    // which for a page that calls defineBitGateElements() after parsing is
    // *before* it can attach a listener — so an event alone would be a race
    // that silently loses. Awaiting `ready` always works.
    /** @type {Promise<{ runtime: any, commands: any }>} */
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    // Nothing may await this before start() runs; keep Node and browsers from
    // reporting an unhandled rejection in that window.
    this.ready.catch(() => {});

    /** @type {Promise<void>|null} */
    this.loaded = null;

    // Answer descendants' context requests. Registered on the host element so
    // it catches events from composed shadow trees too.
    this.addEventListener(CONTEXT_REQUEST, (event) => {
      const custom = /** @type {CustomEvent} */ (event);
      if (!custom.detail || custom.detail.context) {
        return;
      }
      custom.detail.context = this.runtime ? { runtime: this.runtime, commands: this.commands } : null;
      event.stopPropagation();
    });
  }

  connectedCallback() {
    if (!this._ready) {
      this._ready = true;
      void this.start();
    }
  }

  disconnectedCallback() {
    this.stop();
  }

  attributeChangedCallback(name, before, after) {
    // Only rebuild once connected and actually changed; the initial attribute
    // pass would otherwise construct several runtimes during parsing.
    if (this._ready && before !== after) {
      this.stop();
      void this.start();
    }
  }

  /** @returns {string[]} */
  get relayUrls() {
    return (this.getAttribute("relays") ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
  }

  /**
   * Build the runtime and load administrative state.
   *
   * Failures are surfaced as an event and a `data-error` attribute rather than
   * thrown: a page whose relays are unreachable should still render, showing
   * whatever cached state exists.
   */
  async start() {
    try {
      const relays = this.relayUrls;
      const policyName = this.getAttribute("policy") ?? "admin-only";
      const policy = getPolicyPreset(policyName);

      if (!policy) {
        throw new Error(
          `Unknown policy preset "${policyName}". Use social, commerce, admin-only, or set .policy directly.`,
        );
      }
      if (relays.length === 0) {
        throw new Error("bitgate-provider requires a relays attribute");
      }

      this.transport = createRelayTransport(relays);
      this.runtime = createBitGate({
        applicationId: this.getAttribute("application") ?? globalThis.location?.hostname ?? "bitgate",
        namespace: this.getAttribute("namespace") ?? "bitgate",
        root: this.getAttribute("root") ?? undefined,
        transport: this.transport,
        policy,
        storage: createLocalStorage(),
        now: () => Math.floor(Date.now() / 1000),
      });
      this.commands = createCommands(this.runtime);

      const viewer = this.getAttribute("viewer");
      if (viewer) {
        this.runtime.setViewer(viewer);
      }

      this.error = null;
      this.removeAttribute("data-error");
      this._resolveReady?.({ runtime: this.runtime, commands: this.commands });
      this.dispatchEvent(
        new CustomEvent("bitgate:ready", {
          detail: { runtime: this.runtime, commands: this.commands },
          bubbles: true,
          composed: true,
        }),
      );

      await this.runtime.loadAdministrativeState();

      // With a viewer known, build the trust graph without the host having to:
      // fetch their follow list, then read each contact's mute list from that
      // contact's own write relays.
      if (this.runtime.viewerPubkey && this.getAttribute("trust") !== "manual") {
        await this.runtime.loadContacts();
        await this.runtime.loadTrustedMuteLists();
      }

      this.dispatchEvent(new CustomEvent("bitgate:loaded", { bubbles: true, composed: true }));
    } catch (error) {
      this.error = /** @type {Error} */ (error);
      this.setAttribute("data-error", String(error));
      this._rejectReady?.(error);
      this.dispatchEvent(
        new CustomEvent("bitgate:error", {
          detail: { error: String(error) },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** Tear down the runtime and close relay sockets. */
  stop() {
    // A restart needs a fresh promise; the old one has already settled.
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.ready.catch(() => {});

    this.runtime?.destroy?.();
    this.transport?.close?.();
    this.runtime = null;
    this.commands = null;
    this.transport = null;
    this._ready = false;
  }

  /**
   * Attach a signer, typically BitLogin's `window.nostr` provider.
   *
   * Also sets the viewer, since a signer that cannot say who it is would leave
   * the trust graph empty and every capability check failing.
   *
   * @param {{ getPublicKey: () => Promise<string>, signEvent: (event: any) => Promise<any> }} signer
   * @returns {Promise<string>} The viewer pubkey
   */
  async useSigner(signer) {
    if (!this.runtime) {
      throw new Error("bitgate-provider is not ready");
    }
    this.runtime.signer = signer;
    const pubkey = await signer.getPublicKey();
    this.runtime.setViewer(pubkey);

    if (this.getAttribute("trust") !== "manual") {
      await this.runtime.loadContacts();
      await this.runtime.loadTrustedMuteLists();
    }

    return pubkey;
  }
}

/**
 * Storage backed by `localStorage`, falling back to memory where it is
 * unavailable or blocked (private browsing, sandboxed frames).
 * @returns {import('@bitgate/runtime').GovernanceStorage}
 */
function createLocalStorage() {
  /** @type {Map<string, unknown>} */
  const fallback = new Map();

  const available = (() => {
    try {
      const probe = "__bitgate_probe__";
      globalThis.localStorage?.setItem(probe, "1");
      globalThis.localStorage?.removeItem(probe);
      return Boolean(globalThis.localStorage);
    } catch {
      return false;
    }
  })();

  return {
    async read(key) {
      if (!available) {
        return fallback.has(key) ? fallback.get(key) : null;
      }
      try {
        const raw = globalThis.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async write(key, value) {
      if (!available) {
        fallback.set(key, value);
        return;
      }
      try {
        globalThis.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // A full or blocked quota degrades to no persistence, never to a throw
        // that would break rendering.
        fallback.set(key, value);
      }
    },
    async remove(key) {
      fallback.delete(key);
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Nothing to do.
      }
    },
  };
}

/**
 * `<bitgate-error>` — renders a provider's setup failure.
 *
 * Optional, but worth having: a misconfigured `relays` attribute otherwise
 * produces a page that silently governs nothing.
 */
export class BitGateError extends GovernanceElement {
  connectedCallback() {
    super.connectedCallback();
    this._listener = (event) => {
      this._error = event.detail?.error;
      this.render();
    };
    globalThis.document?.addEventListener("bitgate:error", this._listener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._listener) {
      globalThis.document?.removeEventListener("bitgate:error", this._listener);
    }
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }
    if (!this._error) {
      this.renderHtml("");
      return;
    }
    this.renderHtml(
      `<p class="reason" part="error" role="status">BitGate: ${escapeHtml(this._error)}</p>`,
    );
  }
}

/**
 * Register the provider elements.
 * @returns {string[]}
 */
export function defineProviderElements() {
  const registered = [];
  if (defineElement("bitgate-provider", BitGateProvider)) registered.push("bitgate-provider");
  if (defineElement("bitgate-error", BitGateError)) registered.push("bitgate-error");
  return registered;
}
