import { describe, it, expect } from "vitest";

describe("@bitgate/core smoke", () => {
  it("loads the package entrypoint", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeTypeOf("object");
  });
});
