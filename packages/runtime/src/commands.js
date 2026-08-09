// Public governance commands.
//
// Every command checks authority before signing. An unauthorized actor must not
// be able to produce an accepted mutation, so the capability check happens
// locally before the signer is ever invoked — a relay is not an access-control
// mechanism, and a client that skipped this check would publish an event that
// merely fails to take effect, which is far harder to diagnose.

import {
  getTargetKey,
  hasCapability,
  isProtectedActor,
  isValidTarget,
} from "@nostr-governance/core";
import { encodeContribution, encodeReport, encodeRoles } from "@nostr-governance/nostr";

/**
 * Stable error codes. Applications match on these rather than on message text.
 */
export const ERROR_CODES = Object.freeze({
  NO_SIGNER: "no-signer-configured",
  NOT_AUTHORIZED: "not-authorized",
  INVALID_TARGET: "invalid-target",
  PROTECTED_TARGET: "protected-target",
  PUBLISH_FAILED: "publish-failed",
  INVALID_ARGUMENT: "invalid-argument",
});

/**
 * The signed event a command published.
 *
 * Described structurally rather than imported so that this package's public
 * types stay nameable without reaching into another package's internal modules.
 *
 * @typedef {Object} SignedEvent
 * @property {string} id
 * @property {string} pubkey
 * @property {number} kind
 * @property {number} created_at
 * @property {string[][]} tags
 * @property {string} content
 * @property {string} [sig]
 */

/**
 * @typedef {Object} CommandResult
 * @property {boolean} ok
 * @property {string} [code] - One of ERROR_CODES when ok is false
 * @property {string} [message]
 * @property {SignedEvent} [event]
 * @property {string[]} [accepted] - Relays that accepted
 * @property {Array<{ relay: string, error: string }>} [failed]
 */

/**
 * @param {string} code
 * @param {string} message
 * @returns {CommandResult}
 */
function failure(code, message) {
  return { ok: false, code, message };
}

/** @type {Record<string, import('@nostr-governance/core').GovernanceCapability>} */
const KIND_CAPABILITY = {
  "user-allow": "contribute-user-allow",
  "user-deny": "contribute-user-deny",
  "event-deny": "contribute-event-deny",
  "address-deny": "contribute-address-deny",
  "trust-seed": "contribute-trust-seed",
};

export class GovernanceCommands {
  /**
   * @param {import('./runtime.js').GovernanceRuntime} runtime
   */
  constructor(runtime) {
    this.runtime = runtime;
  }

  /**
   * Sign and publish an event template.
   *
   * A partial relay acceptance still succeeds: the first acceptance means the
   * event exists on the network. The remaining relay results stay on the result
   * so diagnostics can surface them.
   *
   * @param {{ kind: number, content: string, tags: string[][] }} template
   * @returns {Promise<CommandResult>}
   */
  async #publish(template) {
    let signed;
    try {
      signed = await this.runtime.signer.signEvent({
        ...template,
        created_at: this.runtime.now(),
      });
    } catch (error) {
      return failure(ERROR_CODES.NO_SIGNER, String(error));
    }

    try {
      const result = await this.runtime.transport.publish(signed);
      if (!result?.ok) {
        return {
          ...failure(ERROR_CODES.PUBLISH_FAILED, "no relay accepted the event"),
          event: signed,
          accepted: result?.accepted ?? [],
          failed: result?.failed ?? [],
        };
      }
      return {
        ok: true,
        event: signed,
        accepted: result.accepted ?? [],
        failed: result.failed ?? [],
      };
    } catch (error) {
      return { ...failure(ERROR_CODES.PUBLISH_FAILED, String(error)), event: signed };
    }
  }

  /**
   * Resolve the acting pubkey from the signer.
   * @returns {Promise<string>}
   */
  async #actor() {
    return this.runtime.signer.getPublicKey();
  }

  /**
   * Publish a contribution list.
   *
   * @param {import('@nostr-governance/core').Contribution["kind"]} kind
   * @param {import('@nostr-governance/core').GovernanceTarget[]} targets
   * @param {Object} [options]
   * @param {string} [options.source] - Community list marker
   * @returns {Promise<CommandResult>}
   */
  async contribute(kind, targets, { source } = {}) {
    const capability = KIND_CAPABILITY[kind];
    if (!capability) {
      return failure(ERROR_CODES.INVALID_ARGUMENT, `unknown contribution kind: ${kind}`);
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return failure(ERROR_CODES.INVALID_ARGUMENT, "targets must be a non-empty array");
    }

    for (const target of targets) {
      if (!isValidTarget(target)) {
        return failure(ERROR_CODES.INVALID_TARGET, JSON.stringify(target));
      }
    }

    let actor;
    try {
      actor = await this.#actor();
    } catch (error) {
      return failure(ERROR_CODES.NO_SIGNER, String(error));
    }

    const authority = this.runtime.admin.authority;
    if (!hasCapability(actor, capability, authority)) {
      return failure(ERROR_CODES.NOT_AUTHORIZED, `actor lacks ${capability}`);
    }

    // Protected actors are rejected at the command boundary as well as during
    // reduction, so an operator sees the refusal instead of publishing a list
    // entry that silently never takes effect.
    if (kind === "user-deny") {
      for (const target of targets) {
        if (target.type === "user" && isProtectedActor(target.pubkey, authority)) {
          return failure(ERROR_CODES.PROTECTED_TARGET, target.pubkey);
        }
      }
    }

    const template = encodeContribution(
      { actor, kind, targets, ...(source ? { source } : {}) },
      this.runtime.namespace,
    );

    return this.#publish(template);
  }

  /**
   * Deny a user.
   * @param {string} pubkey
   * @param {Object} [options]
   * @returns {Promise<CommandResult>}
   */
  async denyUser(pubkey, options) {
    return this.contribute("user-deny", [{ type: "user", pubkey }], options);
  }

  /**
   * Allow a user.
   * @param {string} pubkey
   * @returns {Promise<CommandResult>}
   */
  async allowUser(pubkey) {
    return this.contribute("user-allow", [{ type: "user", pubkey }]);
  }

  /**
   * Deny an exact event.
   * @param {string} id
   * @returns {Promise<CommandResult>}
   */
  async denyEvent(id) {
    return this.contribute("event-deny", [{ type: "event", id }]);
  }

  /**
   * Deny an address coordinate.
   * @param {string} kind
   * @param {string} pubkey
   * @param {string} identifier
   * @returns {Promise<CommandResult>}
   */
  async denyAddress(kind, pubkey, identifier) {
    return this.contribute("address-deny", [{ type: "address", kind, pubkey, identifier }]);
  }

  /**
   * Add trust seeds.
   * @param {string[]} pubkeys
   * @returns {Promise<CommandResult>}
   */
  async addTrustSeeds(pubkeys) {
    return this.contribute(
      "trust-seed",
      (pubkeys ?? []).map((pubkey) => ({ type: "user", pubkey })),
    );
  }

  /**
   * Publish the role roster. Requires `manage-roles`.
   * @param {Object} roster
   * @param {Record<string, string[]>} [roster.actors]
   * @param {Record<string, string[]>} [roster.capabilities]
   * @param {string[]} [roster.protectedActors]
   * @returns {Promise<CommandResult>}
   */
  async setRoles(roster) {
    let actor;
    try {
      actor = await this.#actor();
    } catch (error) {
      return failure(ERROR_CODES.NO_SIGNER, String(error));
    }

    if (!hasCapability(actor, "manage-roles", this.runtime.admin.authority)) {
      return failure(ERROR_CODES.NOT_AUTHORIZED, "actor lacks manage-roles");
    }

    return this.#publish(encodeRoles(roster ?? {}, this.runtime.namespace));
  }

  /**
   * Publish a policy document. Requires `manage-policy`.
   * @param {import('@nostr-governance/core').PolicyDefinition} policy
   * @returns {Promise<CommandResult>}
   */
  async setPolicy(policy) {
    let actor;
    try {
      actor = await this.#actor();
    } catch (error) {
      return failure(ERROR_CODES.NO_SIGNER, String(error));
    }

    if (!hasCapability(actor, "manage-policy", this.runtime.admin.authority)) {
      return failure(ERROR_CODES.NOT_AUTHORIZED, "actor lacks manage-policy");
    }
    if (!policy || typeof policy !== "object") {
      return failure(ERROR_CODES.INVALID_ARGUMENT, "policy must be an object");
    }

    return this.#publish({
      kind: 30078,
      content: JSON.stringify(policy),
      tags: [
        ["d", `${this.runtime.namespace}:governance:policy:v1`],
        ["v", "1"],
        ["client", "nostr-governance"],
        ["scope", "policy"],
      ],
    });
  }

  /**
   * Register a community source. Requires `manage-community-sources`.
   * @param {Array<{ curator: string, identifier: string, kind: number }>} sources
   * @returns {Promise<CommandResult>}
   */
  async setCommunitySources(sources) {
    let actor;
    try {
      actor = await this.#actor();
    } catch (error) {
      return failure(ERROR_CODES.NO_SIGNER, String(error));
    }

    if (!hasCapability(actor, "manage-community-sources", this.runtime.admin.authority)) {
      return failure(ERROR_CODES.NOT_AUTHORIZED, "actor lacks manage-community-sources");
    }

    const tags = [
      ["d", `${this.runtime.namespace}:governance:community-sources:v1`],
      ["v", "1"],
      ["client", "nostr-governance"],
      ["scope", "community-sources"],
    ];
    for (const source of sources ?? []) {
      tags.push(["a", `${source.kind}:${source.curator}:${source.identifier}`]);
    }

    return this.#publish({ kind: 30078, content: "", tags });
  }

  /**
   * Publish a NIP-56 report.
   *
   * Reporting needs no capability: any account may report, and whether the
   * report counts is decided by the viewer's trust graph at evaluation time.
   *
   * @param {import('@nostr-governance/core').GovernanceTarget} target
   * @param {string} category
   * @param {string} [content]
   * @returns {Promise<CommandResult>}
   */
  async report(target, category, content = "") {
    if (!isValidTarget(target)) {
      return failure(ERROR_CODES.INVALID_TARGET, JSON.stringify(target));
    }

    let template;
    try {
      template = encodeReport(target, category, content);
    } catch (error) {
      return failure(ERROR_CODES.INVALID_ARGUMENT, String(error));
    }

    return this.#publish(template);
  }

  /**
   * Set a viewer override. Viewer-local, so no capability is required and
   * nothing is published.
   *
   * @param {import('@nostr-governance/core').GovernanceTarget} target
   * @param {string} visibility
   * @param {Object} [options]
   * @param {string} [options.reason]
   * @param {number} [options.expiresAt]
   * @returns {CommandResult}
   */
  setOverride(target, visibility, { reason, expiresAt } = {}) {
    if (!isValidTarget(target)) {
      return failure(ERROR_CODES.INVALID_TARGET, JSON.stringify(target));
    }
    this.runtime.overrides.set(getTargetKey(target), { visibility, reason, expiresAt });
    return { ok: true };
  }

  /**
   * Clear a viewer override.
   * @param {import('@nostr-governance/core').GovernanceTarget} target
   * @returns {CommandResult}
   */
  clearOverride(target) {
    if (!isValidTarget(target)) {
      return failure(ERROR_CODES.INVALID_TARGET, JSON.stringify(target));
    }
    this.runtime.overrides.remove(getTargetKey(target));
    return { ok: true };
  }
}

/**
 * @param {import('./runtime.js').GovernanceRuntime} runtime
 * @returns {GovernanceCommands}
 */
export function createCommands(runtime) {
  return new GovernanceCommands(runtime);
}
