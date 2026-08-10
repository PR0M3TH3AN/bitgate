// @vitest-environment happy-dom
//
// The drop-in path: configuration in markup, descendants finding the runtime
// themselves, and targets read from attributes.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineBitGateElements } from "../src/index.js";
import { targetFromAttributes } from "../src/base.js";

const ROOT = "a1".repeat(32);
const CREATOR = "d4".repeat(32);
const EVENT_ID = "1b".repeat(32);

defineBitGateElements();

/** Sockets opened during a test, so nothing tries to reach a real relay. */
let sockets = [];

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    sockets.push(this);
    // Open on a microtask so listeners are attached first.
    queueMicrotask(() => this.onopen?.());
  }
  send(payload) {
    const frame = JSON.parse(payload);
    this.sent.push(frame);
    // Answer every REQ immediately so loadAdministrativeState resolves.
    if (frame[0] === "REQ") {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(["EOSE", frame[1]]) }));
    }
  }
  close() {}
}

/**
 * Mount a provider and wait for it to finish loading.
 * @param {Record<string, string|null>} [attributes]
 * @param {string} [children]
 * @returns {Promise<any>}
 */
async function mountProvider(attributes = {}, children = "") {
  const provider = /** @type {any} */ (document.createElement("bitgate-provider"));
  for (const [name, value] of Object.entries({
    relays: "wss://relay.example",
    root: ROOT,
    policy: "social",
    ...attributes,
  })) {
    if (value !== null) {
      provider.setAttribute(name, value);
    }
  }
  provider.innerHTML = children;

  const loaded = new Promise((resolve) => {
    provider.addEventListener("bitgate:loaded", resolve, { once: true });
    provider.addEventListener("bitgate:error", resolve, { once: true });
  });

  document.body.append(provider);
  await loaded;
  return provider;
}

beforeEach(() => {
  document.body.innerHTML = "";
  sockets = [];
  globalThis.WebSocket = /** @type {any} */ (FakeSocket);
  globalThis.localStorage?.clear?.();
});

describe("targetFromAttributes", () => {
  const parse = (attributes) => {
    const element = document.createElement("div");
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    return targetFromAttributes(element);
  };

  it("reads a user target", () => {
    expect(parse({ "target-user": CREATOR })).toEqual({ type: "user", pubkey: CREATOR });
  });

  it("reads an event target with author and kind", () => {
    expect(parse({ "target-event": EVENT_ID, "target-author": CREATOR, "target-kind": "1" })).toEqual({
      type: "event",
      id: EVENT_ID,
      author: CREATOR,
      kind: 1,
    });
  });

  it("reads an address coordinate", () => {
    expect(parse({ "target-address": `30078:${CREATOR}:sku-001` })).toEqual({
      type: "address",
      kind: "30078",
      pubkey: CREATOR,
      identifier: "sku-001",
    });
  });

  it("keeps colons inside the d-tag", () => {
    const target = parse({ "target-address": `30078:${CREATOR}:shop:sku:1` });
    expect(target?.type === "address" && target.identifier).toBe("shop:sku:1");
  });

  it("returns null when no target attribute is present", () => {
    expect(parse({})).toBeNull();
  });

  it("returns null for a malformed coordinate", () => {
    expect(parse({ "target-address": "garbage" })).toBeNull();
  });
});

describe("<bitgate-provider>", () => {
  it("builds a runtime from attributes alone", async () => {
    const provider = await mountProvider();
    expect(provider.runtime).toBeTruthy();
    expect(provider.commands).toBeTruthy();
    expect(provider.runtime.admin.authority.root).toBe(ROOT);
  });

  it("uses the named policy preset", async () => {
    const provider = await mountProvider({ policy: "commerce" });
    expect(provider.runtime.policies.policy.id).toBe("bitgate-commerce");
  });

  it("defaults to administrative-only governance", async () => {
    const provider = await mountProvider({ policy: null });
    expect(provider.runtime.policies.policy.id).toBe("bitgate-admin-only");
  });

  it("opens a socket per relay", async () => {
    await mountProvider({ relays: "wss://one.example, wss://two.example" });
    expect(sockets.map((socket) => socket.url)).toEqual(["wss://one.example", "wss://two.example"]);
  });

  it("sets the viewer when given one", async () => {
    const provider = await mountProvider({ viewer: CREATOR });
    expect(provider.runtime.viewerPubkey).toBe(CREATOR);
  });

  it("reports an unknown policy without throwing", async () => {
    const provider = await mountProvider({ policy: "invented" });
    expect(provider.runtime).toBeNull();
    expect(provider.getAttribute("data-error")).toMatch(/Unknown policy preset/);
  });

  it("reports a missing relays attribute", async () => {
    const provider = await mountProvider({ relays: null });
    expect(provider.getAttribute("data-error")).toMatch(/relays attribute/);
  });

  it("announces readiness before administrative state finishes loading", async () => {
    const provider = /** @type {any} */ (document.createElement("bitgate-provider"));
    provider.setAttribute("relays", "wss://relay.example");
    provider.setAttribute("policy", "social");

    const ready = vi.fn();
    provider.addEventListener("bitgate:ready", ready);
    document.body.append(provider);

    await new Promise((resolve) => provider.addEventListener("bitgate:loaded", resolve, { once: true }));
    expect(ready).toHaveBeenCalled();
  });

  it("tears the runtime down when removed", async () => {
    const provider = await mountProvider();
    const runtime = provider.runtime;
    provider.remove();

    expect(provider.runtime).toBeNull();
    expect(runtime.destroyed).toBe(true);
  });

  it("accepts a signer and adopts its pubkey as the viewer", async () => {
    const provider = await mountProvider();
    const signer = {
      async getPublicKey() {
        return CREATOR;
      },
      async signEvent(template) {
        return { ...template, id: "ff".repeat(32), pubkey: CREATOR, sig: "00".repeat(64) };
      },
    };

    const pubkey = await provider.useSigner(signer);
    expect(pubkey).toBe(CREATOR);
    expect(provider.runtime.viewerPubkey).toBe(CREATOR);
    expect(provider.runtime.signer).toBe(signer);
  });

  it("refuses a signer before it is ready", async () => {
    const provider = /** @type {any} */ (document.createElement("bitgate-provider"));
    await expect(provider.useSigner(/** @type {any} */ ({}))).rejects.toThrow(/not ready/);
  });
});

describe("context discovery", () => {
  it("gives a descendant the runtime without any JavaScript", async () => {
    const provider = await mountProvider(
      {},
      `<bitgate-veil profile="feed" target-user="${CREATOR}"><p>content</p></bitgate-veil>`,
    );
    const veil = /** @type {any} */ (provider.querySelector("bitgate-veil"));
    expect(veil.runtime).toBe(provider.runtime);
  });

  it("hands commands to elements that publish", async () => {
    const provider = await mountProvider(
      {},
      `<bitgate-report target-user="${CREATOR}"></bitgate-report>`,
    );
    const report = /** @type {any} */ (provider.querySelector("bitgate-report"));
    expect(report.commands).toBe(provider.commands);
  });

  it("renders a decision from markup alone", async () => {
    const provider = await mountProvider(
      { policy: "admin-only" },
      `<bitgate-veil target-user="${CREATOR}"><p>content</p></bitgate-veil>`,
    );

    provider.runtime.admin.setRoles({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    provider.runtime.admin.upsertContribution({
      actor: ROOT,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: CREATOR }],
      createdAt: 1,
    });

    const veil = /** @type {any} */ (provider.querySelector("bitgate-veil"));
    expect(veil.shadowRoot.textContent).toContain("Content hidden");
  });

  it("lets a directly assigned runtime win over the provider's", async () => {
    const provider = await mountProvider(
      {},
      `<bitgate-status target-user="${CREATOR}"></bitgate-status>`,
    );
    const status = /** @type {any} */ (provider.querySelector("bitgate-status"));
    const other = { on: () => () => {}, evaluate: () => null };

    status.runtime = /** @type {any} */ (other);
    expect(status.runtime).toBe(other);
  });

  it("leaves an element outside any provider unconfigured", () => {
    const veil = /** @type {any} */ (document.createElement("bitgate-veil"));
    document.body.append(veil);
    expect(veil.runtime).toBeNull();
  });

  it("adopts a provider that becomes ready later", async () => {
    // An element parsed before its provider finishes starting must still end up
    // configured, or markup order would silently decide whether it works.
    const veil = /** @type {any} */ (document.createElement("bitgate-veil"));
    veil.setAttribute("target-user", CREATOR);
    document.body.append(veil);
    expect(veil.runtime).toBeNull();

    const provider = await mountProvider();
    expect(veil.runtime).toBe(provider.runtime);
  });
});

describe("signature verification posture", () => {
  it("verifies by default", async () => {
    const provider = await mountProvider();
    expect(provider.runtime.describe().signatureVerification).toBe("enabled");
    expect(provider.hasAttribute("data-unverified")).toBe(false);
  });

  it("rejects a forged administrative event by default", async () => {
    const provider = await mountProvider();
    // Structurally plausible but unsigned — exactly what a hostile relay sends.
    const accepted = provider.runtime.ingestEvent({
      id: "ff".repeat(32),
      pubkey: ROOT,
      kind: 30078,
      created_at: 1_750_000_000,
      tags: [["d", "bitgate:governance:roles:v1"]],
      content: "",
      sig: "00".repeat(64),
    });
    expect(accepted).toBe(false);
  });

  it("can be disabled explicitly, and says so", async () => {
    const provider = await mountProvider({ verify: "off" });
    expect(provider.runtime.describe().signatureVerification).toBe("disabled");
    expect(provider.hasAttribute("data-unverified")).toBe(true);
  });
});

describe("environment safety", () => {
  it("keeps the documented promise that it imports without a DOM", async () => {
    // A class declaration evaluates `extends` at module load, so this used to
    // throw in Node before any capability guard could run.
    const { canRegisterElements } = await import("../src/base.js");
    expect(typeof canRegisterElements).toBe("function");
    expect(canRegisterElements()).toBe(true); // happy-dom is present here
  });
});
