// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@bitgate/core";
import {
  createCommands,
  createBitGate,
  createMemoryTransport,
} from "@bitgate/runtime";

import { DEFAULT_REASON_TEXT, describeReasons } from "../src/viewer.js";
import { defineBitGateElements } from "../src/index.js";
import { escapeHtml, shortenKey } from "../src/base.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CREATOR = "d4".repeat(32);
const TRUSTED = "01".repeat(32);
const EVENT_ID = "1b".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "widget",
  version: "1.0.0",
  defaultProfile: "feed",
  profiles: {
    feed: {
      name: "feed",
      administrativeDeny: { visibility: "hide", interaction: "deny" },
      reports: { spam: { warn: 1, restrict: 2 } },
      mutes: {},
    },
    locked: {
      name: "locked",
      administrativeDeny: { visibility: "deny", interaction: "deny" },
      allowViewerOverride: false,
      reports: {},
      mutes: {},
    },
    detail: {
      name: "detail",
      administrativeDeny: { visibility: "restrict", interaction: "deny" },
      exposeEvidence: true,
      reports: { spam: { restrict: 1 } },
      mutes: {},
    },
  },
});

defineBitGateElements();

function makeRuntime() {
  const runtime = createBitGate({
    applicationId: "widget-test",
    namespace: "widget",
    transport: createMemoryTransport(),
    policy: POLICY,
    now: () => NOW,
    root: ROOT,
  });
  runtime.admin.setRoles({
    root: ROOT,
    actors: { [ROOT]: ["super_admin"], [MODERATOR]: ["moderator"] },
  });
  runtime.trust.setContacts([TRUSTED]);
  return runtime;
}

function denyCreator(runtime) {
  runtime.admin.upsertContribution({
    actor: MODERATOR,
    kind: "user-deny",
    targets: [{ type: "user", pubkey: CREATOR }],
    createdAt: NOW,
  });
}

/**
 * Mount an element with content and wait for its initial render.
 * @param {string} tag
 * @param {Object} [options]
 * @param {any} [options.runtime]
 * @param {any} [options.target]
 * @param {string} [options.profile]
 * @param {string} [options.inner]
 * @returns {any}
 */
function mount(tag, { runtime, target, profile, inner = "<p>content</p>" } = {}) {
  const element = /** @type {any} */ (document.createElement(tag));
  if (profile) {
    element.setAttribute("profile", profile);
  }
  element.innerHTML = inner;
  document.body.append(element);
  if (runtime) element.runtime = runtime;
  if (target) element.target = target;
  return element;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("helpers", () => {
  it("escapes markup", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).not.toContain("<img");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  it("handles nullish input", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("shortens long keys and leaves short ones alone", () => {
    expect(shortenKey(CREATOR)).toMatch(/^d4d4d4d4…d4d4$/);
    expect(shortenKey("short")).toBe("short");
  });
});

describe("describeReasons", () => {
  it("maps stable identifiers to wording", () => {
    const decision = { reasons: [{ id: "admin-user-deny" }] };
    expect(describeReasons(/** @type {any} */ (decision))).toEqual([
      DEFAULT_REASON_TEXT["admin-user-deny"],
    ]);
  });

  it("lets an application override the wording", () => {
    const decision = { reasons: [{ id: "admin-user-deny" }] };
    expect(
      describeReasons(/** @type {any} */ (decision), { "admin-user-deny": "Seller suspended" }),
    ).toEqual(["Seller suspended"]);
  });

  it("falls back to the raw identifier for unknown reasons", () => {
    const decision = { reasons: [{ id: "future-reason" }] };
    expect(describeReasons(/** @type {any} */ (decision))).toEqual(["future-reason"]);
  });
});

describe("<bitgate-veil>", () => {
  it("renders content untouched when nothing objects", () => {
    const runtime = makeRuntime();
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
    });
    expect(veil.shadowRoot.querySelector("slot")).not.toBeNull();
    expect(veil.shadowRoot.textContent).not.toContain("Content hidden");
  });

  it("hides content behind a disclosure when the decision hides", () => {
    const runtime = makeRuntime();
    denyCreator(runtime);
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });

    expect(veil.shadowRoot.textContent).toContain("Content hidden");
    expect(veil.shadowRoot.querySelector("#reveal")).not.toBeNull();
  });

  it("explains why rather than vanishing silently", () => {
    const runtime = makeRuntime();
    denyCreator(runtime);
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });
    expect(veil.shadowRoot.textContent).toContain(DEFAULT_REASON_TEXT["admin-user-deny"]);
  });

  it("keeps hidden content out of the accessibility tree", () => {
    const runtime = makeRuntime();
    denyCreator(runtime);
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });
    const wrapper = veil.shadowRoot.querySelector("[aria-hidden='true']");
    expect(wrapper).not.toBeNull();
    expect(wrapper.hasAttribute("hidden")).toBe(true);
  });

  it("reveals on request and announces it", () => {
    const runtime = makeRuntime();
    denyCreator(runtime);
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });

    const revealed = vi.fn();
    veil.addEventListener("bitgate:revealed", revealed);
    veil.shadowRoot.querySelector("#reveal").click();

    expect(revealed).toHaveBeenCalled();
    expect(veil.shadowRoot.textContent).not.toContain("Content hidden");
  });

  it("offers no reveal when the profile forbids overrides", () => {
    const runtime = makeRuntime();
    denyCreator(runtime);
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "locked",
    });

    expect(veil.shadowRoot.textContent).toContain("Content hidden");
    expect(veil.shadowRoot.querySelector("#reveal")).toBeNull();
  });

  it("blurs rather than hides on a restrict decision", () => {
    const runtime = makeRuntime();
    runtime.reports.ingest(
      { reporter: TRUSTED, category: "spam", createdAt: NOW },
      `user:${CREATOR}`,
    );
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "detail",
    });

    expect(veil.shadowRoot.querySelector(".blurred")).not.toBeNull();
    expect(veil.shadowRoot.textContent).not.toContain("Content hidden");
  });

  it("re-renders when governance state changes", () => {
    const runtime = makeRuntime();
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });
    expect(veil.shadowRoot.textContent).not.toContain("Content hidden");

    denyCreator(runtime);
    expect(veil.shadowRoot.textContent).toContain("Content hidden");
  });

  it("stops re-rendering once detached", () => {
    const runtime = makeRuntime();
    const veil = mount("bitgate-veil", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });
    veil.remove();

    denyCreator(runtime);
    expect(veil.shadowRoot.textContent).not.toContain("Content hidden");
  });

  it("renders plainly without a runtime", () => {
    const veil = mount("bitgate-veil", {});
    expect(veil.shadowRoot.querySelector("slot")).not.toBeNull();
  });

  it("tolerates an invalid target instead of throwing", () => {
    const runtime = makeRuntime();
    const veil = mount("bitgate-veil", { runtime });
    expect(() => {
      veil.target = { type: "user", pubkey: "not-a-key" };
    }).not.toThrow();
  });
});

describe("<bitgate-report>", () => {
  it("disables submission with no target or commands", () => {
    const report = mount("bitgate-report", { runtime: makeRuntime() });
    expect(report.shadowRoot.querySelector("#submit").disabled).toBe(true);
  });

  it("states plainly that reports are public", () => {
    const report = mount("bitgate-report", { runtime: makeRuntime() });
    expect(report.shadowRoot.textContent).toContain("public");
  });

  it("publishes a report and announces success", async () => {
    const runtime = makeRuntime();
    const commands = createCommands(runtime);
    vi.spyOn(commands, "report").mockResolvedValue({ ok: true, accepted: ["wss://a"] });

    const report = mount("bitgate-report", { runtime });
    report.commands = commands;
    report.target = { type: "event", id: EVENT_ID };

    const reported = vi.fn();
    report.addEventListener("bitgate:reported", reported);

    report.shadowRoot.querySelector("#category").value = "spam";
    report.shadowRoot.querySelector("form").dispatchEvent(new Event("submit"));
    await report.pending;
    expect(reported).toHaveBeenCalled();

    expect(commands.report).toHaveBeenCalledWith({ type: "event", id: EVENT_ID }, "spam", "");
    expect(report.shadowRoot.textContent).toContain("Report published");
  });

  it("surfaces the stable error code on refusal", async () => {
    const runtime = makeRuntime();
    const commands = createCommands(runtime);
    vi.spyOn(commands, "report").mockResolvedValue({ ok: false, code: "invalid-target" });

    const report = mount("bitgate-report", { runtime });
    report.commands = commands;
    report.target = { type: "event", id: EVENT_ID };

    const failed = vi.fn();
    report.addEventListener("bitgate:report-failed", failed);
    report.shadowRoot.querySelector("form").dispatchEvent(new Event("submit"));
    await report.pending;
    expect(failed).toHaveBeenCalled();

    expect(report.shadowRoot.textContent).toContain("invalid-target");
  });
});

describe("<bitgate-status>", () => {
  it("reports the effect and reasons", () => {
    const runtime = makeRuntime();
    denyCreator(runtime);
    const status = mount("bitgate-status", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });

    expect(status.shadowRoot.textContent).toContain("hide");
    expect(status.shadowRoot.textContent).toContain(DEFAULT_REASON_TEXT["admin-user-deny"]);
  });

  it("says so when there is nothing to report", () => {
    const status = mount("bitgate-status", {
      runtime: makeRuntime(),
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });
    expect(status.shadowRoot.textContent).toContain("No governance signals");
  });

  it("withholds contributor identities on a redacting profile", () => {
    const runtime = makeRuntime();
    runtime.reports.ingest(
      { reporter: TRUSTED, category: "spam", createdAt: NOW },
      `user:${CREATOR}`,
    );
    const status = mount("bitgate-status", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "feed",
    });

    expect(status.shadowRoot.textContent).toContain("1 trusted report");
    expect(status.shadowRoot.textContent).not.toContain("Reported by:");
  });

  it("shows contributor identities when the profile exposes evidence", () => {
    const runtime = makeRuntime();
    runtime.reports.ingest(
      { reporter: TRUSTED, category: "spam", createdAt: NOW },
      `user:${CREATOR}`,
    );
    const status = mount("bitgate-status", {
      runtime,
      target: { type: "user", pubkey: CREATOR },
      profile: "detail",
    });

    expect(status.shadowRoot.textContent).toContain("Reported by:");
    expect(status.shadowRoot.textContent).toContain(shortenKey(TRUSTED));
  });

  it("renders no status without a target", () => {
    const status = mount("bitgate-status", { runtime: makeRuntime() });
    expect(status.shadowRoot.querySelector("[part='status']")).toBeNull();
  });
});
