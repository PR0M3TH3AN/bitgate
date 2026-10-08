// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VERSION, exposeBitGateVersion } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(join(HERE, "..", "..", "..", "package.json"), "utf8"));

describe("VERSION", () => {
  it("matches package.json", () => {
    expect(VERSION).toBe(rootPkg.version);
  });

  it("is published on window.bitgate when the widget is imported", () => {
    expect(/** @type {any} */ (window).bitgate.version).toBe(VERSION);
  });

  it("writes version onto an existing window.bitgate object", () => {
    const target = { bitgate: { extra: true } };
    exposeBitGateVersion(target);
    expect(target.bitgate.version).toBe(VERSION);
    expect(target.bitgate.extra).toBe(true);
  });
});
