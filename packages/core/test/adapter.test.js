import { describe, expect, it } from "vitest";

import {
  collectTargets,
  createApplicationAdapter,
  evaluateObject,
  evaluateObjects,
} from "../src/adapter.js";
import { createNeutralDecision } from "../src/policy.js";

const SELLER = "d4".repeat(32);
const EVENT_ID = "1b".repeat(32);

/** @type {import('../src/adapter.js').GovernanceApplicationAdapter<any>} */
const adapter = createApplicationAdapter({
  applicationId: "test-app",
  toTargets: (object) => [
    { type: "user", pubkey: object.author },
    { type: "event", id: object.id, author: object.author },
  ],
  getPrimaryTargetKey: (object) => `event:${object.id}`,
});

const object = { id: EVENT_ID, author: SELLER };

/** Build an evaluator that returns a fixed visibility per target type. */
const evaluatorFor = (byType) => (target) => {
  const decision = createNeutralDecision({ key: `${target.type}` });
  const effect = byType[target.type];
  if (effect) {
    decision.visibility.effect = effect;
  }
  return decision;
};

describe("createApplicationAdapter", () => {
  it("accepts a complete adapter", () => {
    expect(adapter.applicationId).toBe("test-app");
  });

  it("rejects a missing applicationId", () => {
    expect(() =>
      createApplicationAdapter(/** @type {any} */ ({ toTargets: () => [], getPrimaryTargetKey: () => "" })),
    ).toThrow(/applicationId/);
  });

  it("rejects a missing toTargets", () => {
    expect(() =>
      createApplicationAdapter(/** @type {any} */ ({ applicationId: "a", getPrimaryTargetKey: () => "" })),
    ).toThrow(/toTargets/);
  });

  it("rejects a missing getPrimaryTargetKey", () => {
    expect(() =>
      createApplicationAdapter(/** @type {any} */ ({ applicationId: "a", toTargets: () => [] })),
    ).toThrow(/getPrimaryTargetKey/);
  });

  it("rejects a non-object", () => {
    expect(() => createApplicationAdapter(/** @type {any} */ (null))).toThrow(/must be an object/);
  });
});

describe("evaluateObject", () => {
  it("keeps the strictest verdict reaching the object", () => {
    const decision = evaluateObject(object, adapter, evaluatorFor({ user: "hide" }));
    expect(decision.visibility.effect).toBe("hide");
  });

  it("is unaffected by which target was most severe when reporting identity", () => {
    const decision = evaluateObject(object, adapter, evaluatorFor({ user: "hide" }));
    expect(decision.key).toBe(`event:${EVENT_ID}`);
  });

  it("allows an object when no target objects", () => {
    expect(evaluateObject(object, adapter, evaluatorFor({})).visibility.effect).toBe("allow");
  });

  it("escalates from any contributing target", () => {
    expect(
      evaluateObject(object, adapter, evaluatorFor({ event: "deny" })).visibility.effect,
    ).toBe("deny");
  });

  it("filters out invalid targets the adapter emits", () => {
    const loose = createApplicationAdapter({
      applicationId: "a",
      toTargets: () => [
        /** @type {any} */ ({ type: "user", pubkey: "junk" }),
        { type: "user", pubkey: SELLER },
      ],
      getPrimaryTargetKey: () => "user:x",
    });
    expect(() => evaluateObject(object, loose, evaluatorFor({}))).not.toThrow();
  });

  it("throws when an adapter produces no usable targets", () => {
    const broken = createApplicationAdapter({
      applicationId: "broken",
      toTargets: () => [],
      getPrimaryTargetKey: () => "x",
    });
    expect(() => evaluateObject(object, broken, evaluatorFor({}))).toThrow(/no valid targets/);
  });
});

describe("evaluateObjects", () => {
  it("keys results by primary target", () => {
    const results = evaluateObjects([object], adapter, evaluatorFor({}));
    expect(results.has(`event:${EVENT_ID}`)).toBe(true);
  });

  it("handles an empty list", () => {
    expect(evaluateObjects([], adapter, evaluatorFor({})).size).toBe(0);
  });
});

describe("collectTargets", () => {
  it("deduplicates shared targets across objects", () => {
    const targets = collectTargets(
      [object, { id: "2c".repeat(32), author: SELLER }],
      adapter,
    );
    // Two events plus one shared author.
    expect(targets).toHaveLength(3);
  });

  it("returns nothing for an empty list", () => {
    expect(collectTargets([], adapter)).toEqual([]);
  });
});
