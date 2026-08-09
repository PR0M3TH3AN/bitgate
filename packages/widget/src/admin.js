// Moderator console elements.
//
// Two rules govern this file.
//
// First, the UI shows *why* an action is unavailable rather than hiding the
// control. A moderator who cannot see that they lack a capability will assume
// the tool is broken, and a hidden button teaches nothing about the authority
// model. The command layer enforces the same check independently, so the UI is
// an explanation, never the gate.
//
// Second, nothing here computes policy. The console displays effective state
// and issues commands; every accept/reject decision belongs to the runtime.

import { GovernanceElement, defineElement, escapeHtml, shortenKey } from "./base.js";

/**
 * @typedef {import('@nostr-governance/runtime').GovernanceCommands} GovernanceCommands
 * @typedef {import('@nostr-governance/core').GovernanceCapability} GovernanceCapability
 */

/** Human wording for capabilities, used when explaining a refusal. */
export const CAPABILITY_LABELS = {
  "manage-roles": "manage roles",
  "manage-policy": "manage policy",
  "manage-community-sources": "manage community sources",
  "contribute-user-allow": "approve accounts",
  "contribute-user-deny": "restrict accounts",
  "contribute-event-deny": "restrict posts",
  "contribute-address-deny": "restrict listings",
  "contribute-trust-seed": "manage trust seeds",
  "review-evidence": "review evidence",
};

/**
 * `<governance-capabilities>` — what the signed-in moderator may do.
 *
 * Worth rendering explicitly: in the previous generation of this system,
 * moderator status was a UI permission with no cryptographic meaning. Showing
 * the resolved capability set makes the difference visible.
 */
export class GovernanceCapabilities extends GovernanceElement {
  render() {
    if (!this.shadowRoot) {
      return;
    }
    if (!this.runtime) {
      this.renderHtml("");
      return;
    }

    const viewer = this.runtime.viewerPubkey;
    const held = new Set(this.runtime.viewerCapabilities());

    if (!viewer) {
      this.renderHtml('<p class="reason">Not signed in.</p>');
      return;
    }

    const rows = Object.entries(CAPABILITY_LABELS)
      .map(([capability, label]) => {
        const has = held.has(/** @type {GovernanceCapability} */ (capability));
        return `<li part="capability">
          <span aria-hidden="true">${has ? "✓" : "·"}</span>
          <span${has ? "" : ' class="reason"'}>${escapeHtml(label)}</span>
        </li>`;
      })
      .join("");

    this.renderHtml(`
      <style>
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25em; }
        li { display: grid; grid-template-columns: 1.2em 1fr; align-items: baseline; }
      </style>
      <div class="stack" part="capabilities">
        <p class="reason">Signed in as ${escapeHtml(shortenKey(viewer))}</p>
        <ul>${rows}</ul>
        ${held.size === 0 ? '<p class="reason">This account holds no governance capabilities.</p>' : ""}
      </div>
    `);
  }
}

/**
 * `<governance-action>` — a single capability-gated action button.
 *
 * When the actor lacks the capability the button is disabled *and* labelled
 * with what is missing, which is the difference between "broken" and "not
 * yours to do".
 */
export class GovernanceAction extends GovernanceElement {
  static get observedAttributes() {
    return ["capability", "label"];
  }

  constructor() {
    super();
    /** @type {GovernanceCommands|null} */
    this.commands = null;
    /** @type {(() => Promise<any>)|null} */
    this.action = null;
    this._status = "";
  }

  attributeChangedCallback() {
    this.render();
  }

  get capability() {
    return /** @type {GovernanceCapability} */ (this.getAttribute("capability") ?? "");
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }

    const capability = this.capability;
    const label = this.getAttribute("label") ?? "Apply";
    const viewer = this.runtime?.viewerPubkey ?? "";
    const permitted = Boolean(this.runtime && viewer && this.runtime.can(viewer, capability));
    const missing = CAPABILITY_LABELS[capability] ?? capability;

    this.renderHtml(`
      <div class="row" part="action">
        <button type="button" id="run" ${permitted ? "" : "disabled"}>${escapeHtml(label)}</button>
        ${
          permitted
            ? ""
            : `<span class="reason" part="explanation">Requires permission to ${escapeHtml(missing)}</span>`
        }
        <span class="reason" id="status">${escapeHtml(this._status)}</span>
      </div>
    `);

    this.$("#run")?.addEventListener("click", () => void this._run());
  }

  async _run() {
    if (!this.action) {
      return;
    }
    this._status = "Working…";
    this.render();

    try {
      const result = await this.action();
      // Commands return a result object rather than throwing on refusal, so a
      // refusal is reported with its stable error code.
      this._status = result?.ok === false ? `Refused: ${result.code}` : "Done";
      this.emit(result?.ok === false ? "action-refused" : "action-completed", { result });
    } catch (error) {
      this._status = `Failed: ${String(error)}`;
      this.emit("action-failed", { error: String(error) });
    }

    this.render();
  }
}

/**
 * `<governance-admin-panel>` — effective administrative state plus controls.
 *
 * Shows what is currently in force and who contributed it, so a moderator can
 * see that a denial came from a community list rather than from their own team.
 */
export class GovernanceAdminPanel extends GovernanceElement {
  constructor() {
    super();
    /** @type {GovernanceCommands|null} */
    this.commands = null;
    this._status = "";
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }
    if (!this.runtime) {
      this.renderHtml('<p class="reason">No runtime attached.</p>');
      return;
    }

    const state = this.runtime.admin.state;
    const authority = this.runtime.admin.authority;
    const viewer = this.runtime.viewerPubkey;
    const canDenyUser = Boolean(viewer && this.runtime.can(viewer, "contribute-user-deny"));

    const denyRows = Array.from(state.userDeny)
      .map((key) => {
        const pubkey = key.slice("user:".length);
        const sources = state.communitySources.get(key) ?? [];
        const origin = sources.length
          ? `community list (${escapeHtml(shortenKey(sources[0]))})`
          : "moderator";
        return `<tr>
          <td><code>${escapeHtml(shortenKey(pubkey))}</code></td>
          <td class="reason">${origin}</td>
        </tr>`;
      })
      .join("");

    this.renderHtml(`
      <style>
        table { border-collapse: collapse; width: 100%; }
        td, th { text-align: left; padding: 0.3em 0.5em; border-bottom: 1px solid var(--gov-border); }
        code { font-size: 0.9em; }
        h3 { margin: 0; font-size: 1em; }
        .stale { color: var(--gov-warn); }
      </style>
      <div class="stack" part="panel">
        ${
          this.runtime.stale
            ? '<p class="stale" part="stale">Showing cached state — relays unreachable.</p>'
            : ""
        }

        <section class="stack">
          <h3>Roster</h3>
          <p class="reason">
            Root: ${escapeHtml(authority.root ? shortenKey(authority.root) : "not configured")} ·
            ${escapeHtml(Object.keys(authority.actors).length)} actor(s) ·
            ${escapeHtml(authority.protectedActors.length)} protected
          </p>
        </section>

        <section class="stack">
          <h3>Restricted accounts (${escapeHtml(state.userDeny.size)})</h3>
          ${
            denyRows
              ? `<table part="deny-table"><tbody>${denyRows}</tbody></table>`
              : '<p class="reason">None.</p>'
          }
        </section>

        <section class="stack">
          <h3>Restrict an account</h3>
          <div class="row">
            <input id="pubkey" type="text" placeholder="hex pubkey" size="24" part="input" />
            <button type="button" id="deny" ${canDenyUser ? "" : "disabled"}>Restrict</button>
          </div>
          ${
            canDenyUser
              ? ""
              : '<p class="reason">Requires permission to restrict accounts.</p>'
          }
          <span class="reason" id="status">${escapeHtml(this._status)}</span>
        </section>

        <section class="stack">
          <h3>Other state</h3>
          <p class="reason">
            ${escapeHtml(state.eventDeny.size)} restricted post(s) ·
            ${escapeHtml(state.addressDeny.size)} restricted listing(s) ·
            ${escapeHtml(state.userAllow.size)} approved account(s) ·
            ${escapeHtml(state.trustSeeds.size)} trust seed(s)
          </p>
        </section>
      </div>
    `);

    this.$("#deny")?.addEventListener("click", () => void this._deny());
  }

  async _deny() {
    const input = /** @type {HTMLInputElement} */ (this.$("#pubkey"));
    const pubkey = input?.value?.trim() ?? "";
    if (!pubkey || !this.commands) {
      return;
    }

    this._status = "Publishing…";
    this.render();

    const result = await this.commands.denyUser(pubkey);
    this._status = result.ok ? "Restricted" : `Refused: ${result.code}`;
    this.emit(result.ok ? "account-restricted" : "action-refused", { pubkey, result });
    this.render();
  }
}

/**
 * Register the moderator elements.
 * @returns {string[]} Element names newly registered
 */
export function defineAdminElements() {
  const registered = [];
  if (defineElement("governance-capabilities", GovernanceCapabilities)) {
    registered.push("governance-capabilities");
  }
  if (defineElement("governance-action", GovernanceAction)) registered.push("governance-action");
  if (defineElement("governance-admin-panel", GovernanceAdminPanel)) {
    registered.push("governance-admin-panel");
  }
  return registered;
}
