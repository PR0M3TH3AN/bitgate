// Viewer-facing governance elements.
//
// These render a decision the engine already made. They never decide anything:
// no thresholds, no precedence, no "if reports > n". If one of these needs a
// number, the number belongs in a policy profile.

import { GovernanceElement, defineElement, escapeHtml, shortenKey } from "./base.js";

/**
 * @typedef {import('@nostr-governance/core').GovernanceDecision} GovernanceDecision
 * @typedef {import('@nostr-governance/core').GovernanceTarget} GovernanceTarget
 */

/**
 * Default wording for reason identifiers.
 *
 * Deliberately overridable: the engine emits stable identifiers precisely so
 * that applications can phrase them for their own audience. A marketplace says
 * "this seller is suspended"; a video app says "hidden by moderators".
 *
 * @type {Record<string, string>}
 */
export const DEFAULT_REASON_TEXT = {
  "viewer-block": "You blocked this account",
  "viewer-mute": "You muted this account",
  "viewer-override": "You chose to show this",
  "admin-user-deny": "Restricted by moderators",
  "admin-event-deny": "This post was restricted by moderators",
  "admin-address-deny": "This listing was restricted by moderators",
  "community-user-deny": "Restricted by a community list",
  "trusted-report": "Reported by people you follow",
  "trusted-report-threshold": "Reported by enough people you follow",
  "trusted-mute": "Muted by people you follow",
  "trusted-mute-threshold": "Muted by enough people you follow",
  "allowlist-miss": "This account is not approved here",
  "protected-target": "This account cannot be restricted",
  "surface-policy-bypass": "Shown here despite restrictions",
  "policy-disabled": "Moderation is off for this view",
};

/**
 * Turn reason identifiers into display text.
 * @param {GovernanceDecision} decision
 * @param {Record<string, string>} [overrides]
 * @returns {string[]}
 */
export function describeReasons(decision, overrides = {}) {
  const table = { ...DEFAULT_REASON_TEXT, ...overrides };
  return decision.reasons.map((reason) => table[reason.id] ?? reason.id);
}

/**
 * `<governance-veil>` — wraps content and applies a decision to it.
 *
 * Slotted content is always in the DOM; the element controls whether it is
 * shown, blurred, or replaced. Hidden content is removed from the accessibility
 * tree rather than merely visually covered, so a screen reader does not read
 * out something the viewer was not meant to see.
 *
 * Usage:
 *   <governance-veil><img src="..."></governance-veil>
 *   veil.runtime = runtime; veil.target = { type: "event", id, author };
 */
export class GovernanceVeil extends GovernanceElement {
  static get observedAttributes() {
    return ["profile"];
  }

  constructor() {
    super();
    /** @type {GovernanceTarget|null} */
    this._target = null;
    /** @type {Record<string, string>} */
    this.reasonText = {};
    this._revealed = false;
  }

  get target() {
    return this._target;
  }

  set target(target) {
    this._target = target ?? null;
    this._revealed = false;
    this.render();
  }

  get profile() {
    return this.getAttribute("profile") ?? undefined;
  }

  attributeChangedCallback() {
    this.render();
  }

  /** The decision currently applied, or null when not evaluable. */
  get decision() {
    if (!this.runtime || !this._target) {
      return null;
    }
    try {
      return this.runtime.evaluate(this._target, { profile: this.profile });
    } catch {
      return null;
    }
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }

    const decision = this.decision;
    if (!decision) {
      this.renderHtml("<slot></slot>");
      return;
    }

    const effect = decision.visibility.effect;
    const reasons = describeReasons(decision, this.reasonText);
    const reasonLine = reasons.length ? `<p class="reason">${escapeHtml(reasons[0])}</p>` : "";

    // A hidden decision the viewer may override renders a disclosure rather
    // than nothing at all: silently vanishing content is indistinguishable
    // from a bug, and leaves no way to appeal.
    const hidden = effect === "hide" || effect === "deny";
    if (hidden && !this._revealed) {
      const canReveal = decision.visibility.overridable && effect !== "deny";
      this.renderHtml(`
        <div class="veil stack" part="veil">
          <p part="notice">Content hidden</p>
          ${reasonLine}
          ${canReveal ? '<div class="row"><button type="button" id="reveal">Show anyway</button></div>' : ""}
          <div hidden aria-hidden="true"><slot></slot></div>
        </div>
      `);
      this.$("#reveal")?.addEventListener("click", () => {
        this._revealed = true;
        this.emit("revealed", { target: this._target, decision });
        this.render();
      });
      return;
    }

    const blurred = effect === "restrict" && !this._revealed;
    const warned = effect === "warn";

    this.renderHtml(`
      <style>
        .blurred { filter: blur(18px); pointer-events: none; user-select: none; }
        .overlay { position: relative; }
        .overlay .controls {
          position: absolute; inset: 0; display: grid; place-content: center;
          gap: 0.5em; text-align: center; padding: 1em;
        }
        .warn { color: var(--gov-warn); }
      </style>
      <div class="overlay" part="container">
        <div class="${blurred ? "blurred" : ""}" part="content"><slot></slot></div>
        ${
          blurred
            ? `<div class="controls">
                 ${reasonLine}
                 <div class="row" style="justify-content:center">
                   <button type="button" id="reveal">Show anyway</button>
                 </div>
               </div>`
            : ""
        }
      </div>
      ${warned && reasons.length ? `<p class="reason warn" part="warning">${escapeHtml(reasons[0])}</p>` : ""}
    `);

    this.$("#reveal")?.addEventListener("click", () => {
      this._revealed = true;
      this.emit("revealed", { target: this._target, decision });
      this.render();
    });
  }
}

/**
 * `<governance-report>` — a report dialog.
 *
 * Reporting requires no capability: anyone may report, and whether the report
 * counts is decided later by each viewer's own trust graph. The element makes
 * that explicit rather than implying a report is an enforcement action.
 */
export class GovernanceReport extends GovernanceElement {
  constructor() {
    super();
    /** @type {GovernanceTarget|null} */
    this._target = null;
    /** @type {string[]} */
    this.categories = ["spam", "nudity", "profanity", "illegal", "malware", "impersonation", "other"];
    /** @type {import('@nostr-governance/runtime').GovernanceCommands|null} */
    this.commands = null;
    this._status = "";
  }

  get target() {
    return this._target;
  }

  set target(target) {
    this._target = target ?? null;
    this._status = "";
    this.render();
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }

    const options = this.categories
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join("");

    this.renderHtml(`
      <form class="stack" part="form">
        <label class="stack">
          <span>Reason</span>
          <select id="category" part="select">${options}</select>
        </label>
        <label class="stack">
          <span>Details <span class="reason">(optional, public)</span></span>
          <textarea id="details" rows="3" part="textarea"></textarea>
        </label>
        <p class="reason">
          Reports are public Nostr events. Whether a report affects what someone
          sees depends on their own trust graph.
        </p>
        <div class="row">
          <button type="submit" id="submit" ${this._target && this.commands ? "" : "disabled"}>
            Submit report
          </button>
          <span class="reason" id="status">${escapeHtml(this._status)}</span>
        </div>
      </form>
    `);

    this.$("form")?.addEventListener("submit", (fromEvent) => {
      fromEvent.preventDefault();
      void this._submit();
    });
  }

  async _submit() {
    if (!this._target || !this.commands) {
      return;
    }

    const category = /** @type {HTMLSelectElement} */ (this.$("#category"))?.value ?? "";
    const details = /** @type {HTMLTextAreaElement} */ (this.$("#details"))?.value ?? "";

    this._status = "Publishing…";
    this.render();

    const result = await this.commands.report(this._target, category, details);

    // Partial relay acceptance is success: the event exists on the network.
    this._status = result.ok ? "Report published" : `Failed: ${result.code}`;
    this.emit(result.ok ? "reported" : "report-failed", { target: this._target, category, result });
    this.render();
  }
}

/**
 * `<governance-status>` — a compact readout of why something was affected.
 *
 * Shows counts when the profile exposes evidence, and contributor identities
 * only when it does. A surface that redacts evidence gets "reported by people
 * you follow" and no names.
 */
export class GovernanceStatus extends GovernanceElement {
  constructor() {
    super();
    /** @type {GovernanceTarget|null} */
    this._target = null;
    /** @type {Record<string, string>} */
    this.reasonText = {};
  }

  static get observedAttributes() {
    return ["profile"];
  }

  get target() {
    return this._target;
  }

  set target(target) {
    this._target = target ?? null;
    this.render();
  }

  get profile() {
    return this.getAttribute("profile") ?? undefined;
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    if (!this.shadowRoot) {
      return;
    }
    if (!this.runtime || !this._target) {
      this.renderHtml("");
      return;
    }

    let decision;
    try {
      decision = this.runtime.evaluate(this._target, { profile: this.profile });
    } catch {
      this.renderHtml("");
      return;
    }

    const reasons = describeReasons(decision, this.reasonText);
    const evidence = decision.evidence;
    const reporters = evidence?.trustedReporterPubkeys ?? [];
    const muters = evidence?.trustedMuterPubkeys ?? [];

    this.renderHtml(`
      <div class="stack" part="status">
        <div class="row">
          <strong part="effect">${escapeHtml(decision.visibility.effect)}</strong>
          ${
            decision.ranking.effect === "downrank"
              ? `<span class="reason">downranked (${escapeHtml(decision.ranking.weight)})</span>`
              : ""
          }
          ${
            decision.transaction
              ? `<span class="reason">transaction: ${escapeHtml(decision.transaction.effect)}</span>`
              : ""
          }
        </div>
        ${
          reasons.length
            ? `<ul part="reasons">${reasons.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>`
            : '<p class="reason">No governance signals</p>'
        }
        ${
          evidence
            ? `<p class="reason">
                 ${escapeHtml(evidence.trustedReportTotal)} trusted report(s),
                 ${escapeHtml(evidence.trustedMuteTotal)} trusted mute(s)
               </p>`
            : ""
        }
        ${
          reporters.length
            ? `<p class="reason">Reported by: ${reporters.map((key) => escapeHtml(shortenKey(key))).join(", ")}</p>`
            : ""
        }
        ${
          muters.length
            ? `<p class="reason">Muted by: ${muters.map((key) => escapeHtml(shortenKey(key))).join(", ")}</p>`
            : ""
        }
      </div>
    `);
  }
}

/**
 * Register the viewer elements.
 * @returns {string[]} Element names newly registered
 */
export function defineViewerElements() {
  const registered = [];
  if (defineElement("governance-veil", GovernanceVeil)) registered.push("governance-veil");
  if (defineElement("governance-report", GovernanceReport)) registered.push("governance-report");
  if (defineElement("governance-status", GovernanceStatus)) registered.push("governance-status");
  return registered;
}
