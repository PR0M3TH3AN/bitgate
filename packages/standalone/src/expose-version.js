import { VERSION } from "@bitgate/core";

/**
 * Publish `window.bitgate.version` for script-tag integrators.
 *
 * Additive: creates `window.bitgate` when missing, otherwise writes `version`
 * onto the existing object so a host-provided namespace is not replaced.
 * No-op in Node (no `window`).
 *
 * @param {Record<string, any>} [target] - Defaults to `globalThis.window`
 * @returns {Record<string, any>|null} The namespace that received `version`
 */
export function exposeBitGateVersion(target) {
  const root =
    target ??
    (typeof globalThis.window !== "undefined"
      ? /** @type {Record<string, any>} */ (globalThis.window)
      : null);
  if (!root || typeof root !== "object") {
    return null;
  }

  const existing = root.bitgate;
  const ns =
    existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  ns.version = VERSION;
  root.bitgate = ns;
  return ns;
}
