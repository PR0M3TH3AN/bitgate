// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPolicyDefinition } from "@nostr-governance/core";
import {
  createCommands,
  createGovernanceRuntime,
  createMemoryTransport,
} from "@nostr-governance/runtime";

import { CAPABILITY_LABELS } from "../src/admin.js";
import { defineGovernanceElements } from "../src/index.js";
import { shortenKey } from "../src/base.js";

const ROOT = "a1".repeat(32);
const MODERATOR = "b2".repeat(32);
const CURATOR = "c3".repeat(32);
const CREATOR = "d4".repeat(32);
const STRANGER = "f6".repeat(32);
const NOW = 1_750_000_000;

const POLICY = createPolicyDefinition({
  id: "widget",
  version: "1.0.0",
  profiles: { feed: { name: "feed", reports: {}, mutes: {} } },
});

defineGovernanceElements();

function makeRuntime(viewer) {
  const runtime = createGovernanceRuntime({
    applicationId: "widget-test",
    namespace: "widget",
    transport: createMemoryTransport(),
    policy: POLICY,
    now: () => NOW,
    root: ROOT,
  });
  runtime.admin.setRoles({
    root: ROOT,
    actors: {
      [ROOT]: ["super_admin"],
      [MODERATOR]: ["moderator"],
      [CURATOR]: ["curator"],
    },
  });
  if (viewer) {
    runtime.setViewer(viewer);
  }
  return runtime;
}

/**
 * @param {string} tag
 * @param {any} runtime
 * @param {Record<string, string>} [attributes]
 * @returns {any}
 */
function mount(tag, runtime, attributes = {}) {
  const element = /** @type {any} */ (document.createElement(tag));
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.append(element);
  element.runtime = runtime;
  return element;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<governance-capabilities>", () => {
  it("says when nobody is signed in", () => {
    const panel = mount("governance-capabilities", makeRuntime());
    expect(panel.shadowRoot.textContent).toContain("Not signed in");
  });

  it("lists what a moderator holds", () => {
    const panel = mount("governance-capabilities", makeRuntime(MODERATOR));
    const text = panel.shadowRoot.textContent;
    expect(text).toContain(CAPABILITY_LABELS["contribute-user-deny"]);
    expect(text).toContain(shortenKey(MODERATOR));
  });

  it("shows capabilities an actor lacks rather than omitting them", () => {
    const panel = mount("governance-capabilities", makeRuntime(CURATOR));
    // A curator holds only contribute-user-deny, but every capability is
    // listed so the boundary is legible.
    for (const label of Object.values(CAPABILITY_LABELS)) {
      expect(panel.shadowRoot.textContent).toContain(label);
    }
  });

  it("marks held capabilities distinctly from unheld ones", () => {
    const panel = mount("governance-capabilities", makeRuntime(CURATOR));
    const items = [...panel.shadowRoot.querySelectorAll("li")];
    const held = items.filter((item) => item.textContent.includes("✓"));
    expect(held).toHaveLength(1);
    expect(held[0].textContent).toContain(CAPABILITY_LABELS["contribute-user-deny"]);
  });

  it("tells an account with no authority that it has none", () => {
    const panel = mount("governance-capabilities", makeRuntime(STRANGER));
    expect(panel.shadowRoot.textContent).toContain("no governance capabilities");
  });

  it("grants the root everything", () => {
    const panel = mount("governance-capabilities", makeRuntime(ROOT));
    const held = [...panel.shadowRoot.querySelectorAll("li")].filter((item) =>
      item.textContent.includes("✓"),
    );
    expect(held).toHaveLength(Object.keys(CAPABILITY_LABELS).length);
  });
});

describe("<governance-action>", () => {
  it("enables the control when the actor holds the capability", () => {
    const action = mount("governance-action", makeRuntime(MODERATOR), {
      capability: "contribute-user-deny",
      label: "Restrict",
    });
    expect(action.shadowRoot.querySelector("#run").disabled).toBe(false);
  });

  it("disables it and explains why when they do not", () => {
    const action = mount("governance-action", makeRuntime(CURATOR), {
      capability: "contribute-event-deny",
      label: "Restrict post",
    });

    expect(action.shadowRoot.querySelector("#run").disabled).toBe(true);
    expect(action.shadowRoot.textContent).toContain("Requires permission to");
    expect(action.shadowRoot.textContent).toContain(CAPABILITY_LABELS["contribute-event-deny"]);
  });

  it("keeps the control visible rather than hiding it", () => {
    const action = mount("governance-action", makeRuntime(CURATOR), {
      capability: "manage-roles",
      label: "Edit roles",
    });
    expect(action.shadowRoot.querySelector("#run")).not.toBeNull();
    expect(action.shadowRoot.textContent).toContain("Edit roles");
  });

  it("runs the action and announces completion", async () => {
    const action = mount("governance-action", makeRuntime(MODERATOR), {
      capability: "contribute-user-deny",
      label: "Restrict",
    });
    action.action = vi.fn().mockResolvedValue({ ok: true });

    const completed = vi.fn();
    action.addEventListener("governance:action-completed", completed);
    action.shadowRoot.querySelector("#run").click();
    await action.pending;
    expect(completed).toHaveBeenCalled();

    expect(action.shadowRoot.textContent).toContain("Done");
  });

  it("reports a refusal with its stable code", async () => {
    const action = mount("governance-action", makeRuntime(MODERATOR), {
      capability: "contribute-user-deny",
      label: "Restrict",
    });
    action.action = vi.fn().mockResolvedValue({ ok: false, code: "protected-target" });

    const refused = vi.fn();
    action.addEventListener("governance:action-refused", refused);
    action.shadowRoot.querySelector("#run").click();
    await action.pending;
    expect(refused).toHaveBeenCalled();

    expect(action.shadowRoot.textContent).toContain("protected-target");
  });

  it("reports a thrown failure without breaking the element", async () => {
    const action = mount("governance-action", makeRuntime(MODERATOR), {
      capability: "contribute-user-deny",
    });
    action.action = vi.fn().mockRejectedValue(new Error("relay down"));

    const failed = vi.fn();
    action.addEventListener("governance:action-failed", failed);
    action.shadowRoot.querySelector("#run").click();
    await action.pending;
    expect(failed).toHaveBeenCalled();

    expect(action.shadowRoot.textContent).toContain("relay down");
  });

  it("re-evaluates permission when the roster changes", () => {
    const runtime = makeRuntime(MODERATOR);
    const action = mount("governance-action", runtime, {
      capability: "contribute-user-deny",
    });
    expect(action.shadowRoot.querySelector("#run").disabled).toBe(false);

    runtime.admin.setRoles({ root: ROOT, actors: { [ROOT]: ["super_admin"] } });
    expect(action.shadowRoot.querySelector("#run").disabled).toBe(true);
  });
});

describe("<governance-admin-panel>", () => {
  /**
   * @param {any} runtime
   * @param {Object} [options]
   * @param {string} [options.source]
   */
  function denyCreator(runtime, { source } = {}) {
    runtime.admin.upsertContribution({
      actor: source ? CURATOR : MODERATOR,
      kind: "user-deny",
      targets: [{ type: "user", pubkey: CREATOR }],
      createdAt: NOW,
      ...(source ? { source } : {}),
    });
  }

  it("reports when no runtime is attached", () => {
    const panel = /** @type {any} */ (document.createElement("governance-admin-panel"));
    document.body.append(panel);
    expect(panel.shadowRoot.textContent).toContain("No runtime attached");
  });

  it("shows the roster summary", () => {
    const panel = mount("governance-admin-panel", makeRuntime(MODERATOR));
    expect(panel.shadowRoot.textContent).toContain(shortenKey(ROOT));
    expect(panel.shadowRoot.textContent).toContain("actor(s)");
  });

  it("lists restricted accounts", () => {
    const runtime = makeRuntime(MODERATOR);
    denyCreator(runtime);
    const panel = mount("governance-admin-panel", runtime);
    expect(panel.shadowRoot.textContent).toContain(shortenKey(CREATOR));
  });

  it("distinguishes a community list from a moderator action", () => {
    const runtime = makeRuntime(MODERATOR);
    denyCreator(runtime, { source: "curated-list" });
    const panel = mount("governance-admin-panel", runtime);
    expect(panel.shadowRoot.textContent).toContain("community list");
  });

  it("attributes a direct action to a moderator", () => {
    const runtime = makeRuntime(MODERATOR);
    denyCreator(runtime);
    const panel = mount("governance-admin-panel", runtime);
    expect(panel.shadowRoot.textContent).toContain("moderator");
    expect(panel.shadowRoot.textContent).not.toContain("community list");
  });

  it("disables restriction for an actor without the capability", () => {
    const panel = mount("governance-admin-panel", makeRuntime(STRANGER));
    expect(panel.shadowRoot.querySelector("#deny").disabled).toBe(true);
    expect(panel.shadowRoot.textContent).toContain("Requires permission");
  });

  it("issues the command through the runtime", async () => {
    const runtime = makeRuntime(MODERATOR);
    const commands = createCommands(runtime);
    vi.spyOn(commands, "denyUser").mockResolvedValue({ ok: true });

    const panel = mount("governance-admin-panel", runtime);
    panel.commands = commands;
    panel.shadowRoot.querySelector("#pubkey").value = CREATOR;

    const restricted = vi.fn();
    panel.addEventListener("governance:account-restricted", restricted);
    panel.shadowRoot.querySelector("#deny").click();
    await panel.pending;
    expect(restricted).toHaveBeenCalled();

    expect(commands.denyUser).toHaveBeenCalledWith(CREATOR);
  });

  it("surfaces a refusal from the command layer", async () => {
    const runtime = makeRuntime(MODERATOR);
    const commands = createCommands(runtime);
    vi.spyOn(commands, "denyUser").mockResolvedValue({ ok: false, code: "protected-target" });

    const panel = mount("governance-admin-panel", runtime);
    panel.commands = commands;
    panel.shadowRoot.querySelector("#pubkey").value = ROOT;

    const refused = vi.fn();
    panel.addEventListener("governance:action-refused", refused);
    panel.shadowRoot.querySelector("#deny").click();
    await panel.pending;
    expect(refused).toHaveBeenCalled();

    expect(panel.shadowRoot.textContent).toContain("protected-target");
  });

  it("warns when serving cached state", () => {
    const runtime = makeRuntime(MODERATOR);
    runtime.stale = true;
    const panel = mount("governance-admin-panel", runtime);
    expect(panel.shadowRoot.textContent).toContain("relays unreachable");
  });

  it("updates when administrative state changes", () => {
    const runtime = makeRuntime(MODERATOR);
    const panel = mount("governance-admin-panel", runtime);
    expect(panel.shadowRoot.textContent).toContain("Restricted accounts (0)");

    denyCreator(runtime);
    expect(panel.shadowRoot.textContent).toContain("Restricted accounts (1)");
  });
});

describe("element registration", () => {
  it("is idempotent", () => {
    // Elements were registered at module load; a second call must not throw.
    expect(() => defineGovernanceElements()).not.toThrow();
    expect(defineGovernanceElements()).toEqual([]);
  });
});
