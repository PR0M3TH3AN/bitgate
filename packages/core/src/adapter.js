// Application adapter contract.
//
// An adapter is how an application says "here is what my object is, in
// governance terms" and "here is what a decision means to me". Everything
// application-specific lives in the adapter; nothing application-specific lives
// in the engine. This is the seam that lets one engine serve a video app and a
// marketplace without either leaking into the other.

import { getTargetKey } from "./identifiers.js";
import { isValidTarget } from "./targets.js";
import { composeDecisions } from "./policy.js";

/**
 * @typedef {import('./identifiers.js').GovernanceTarget} GovernanceTarget
 * @typedef {import('./policy.js').GovernanceDecision} GovernanceDecision
 */

/**
 * @template TObject
 * @typedef {Object} GovernanceApplicationAdapter
 * @property {string} applicationId
 * @property {(object: TObject) => GovernanceTarget[]} toTargets - Every target that governs this object
 * @property {(object: TObject) => string} getPrimaryTargetKey - The object's own identity
 * @property {(object: TObject, decision: GovernanceDecision) => TObject} [applyDecision] - Map a decision back into application shape
 */

/**
 * Define an adapter, validating its required members.
 * @template TObject
 * @param {GovernanceApplicationAdapter<TObject>} adapter
 * @returns {GovernanceApplicationAdapter<TObject>}
 */
export function createApplicationAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Adapter must be an object");
  }
  if (typeof adapter.applicationId !== "string" || !adapter.applicationId.trim()) {
    throw new Error("Adapter requires an applicationId");
  }
  if (typeof adapter.toTargets !== "function") {
    throw new Error("Adapter requires toTargets()");
  }
  if (typeof adapter.getPrimaryTargetKey !== "function") {
    throw new Error("Adapter requires getPrimaryTargetKey()");
  }
  return adapter;
}

/**
 * Evaluate every target an object maps to and compose one decision.
 *
 * Composition is the ladder maximum per dimension, so an object is governed by
 * the strictest verdict reaching it: denying a seller takes their listings down
 * even though each listing's own address is clean. Applications that want a
 * different rule can compose the per-target decisions themselves.
 *
 * @template TObject
 * @param {TObject} object
 * @param {GovernanceApplicationAdapter<TObject>} adapter
 * @param {(target: GovernanceTarget) => GovernanceDecision} evaluate
 * @returns {GovernanceDecision}
 */
export function evaluateObject(object, adapter, evaluate) {
  const targets = adapter.toTargets(object).filter((target) => isValidTarget(target));
  if (targets.length === 0) {
    throw new Error(`Adapter produced no valid targets for ${adapter.applicationId}`);
  }

  const decisions = targets.map((target) => evaluate(target));
  const composed = composeDecisions(decisions);

  // The composed decision is reported against the object's own identity, not
  // against whichever contributing target happened to be most severe.
  composed.key = adapter.getPrimaryTargetKey(object);
  return composed;
}

/**
 * Evaluate many objects, returning decisions keyed by primary target.
 * @template TObject
 * @param {TObject[]} objects
 * @param {GovernanceApplicationAdapter<TObject>} adapter
 * @param {(target: GovernanceTarget) => GovernanceDecision} evaluate
 * @returns {Map<string, GovernanceDecision>}
 */
export function evaluateObjects(objects, adapter, evaluate) {
  /** @type {Map<string, GovernanceDecision>} */
  const results = new Map();
  for (const object of objects ?? []) {
    results.set(adapter.getPrimaryTargetKey(object), evaluateObject(object, adapter, evaluate));
  }
  return results;
}

/**
 * Collect the deduplicated targets a batch of objects depends on.
 *
 * Used to tell the runtime which targets to keep evidence fresh for, without
 * subscribing once per object.
 *
 * @template TObject
 * @param {TObject[]} objects
 * @param {GovernanceApplicationAdapter<TObject>} adapter
 * @returns {GovernanceTarget[]}
 */
export function collectTargets(objects, adapter) {
  /** @type {Map<string, GovernanceTarget>} */
  const targets = new Map();
  for (const object of objects ?? []) {
    for (const target of adapter.toTargets(object)) {
      if (isValidTarget(target)) {
        targets.set(getTargetKey(target), target);
      }
    }
  }
  return Array.from(targets.values());
}
