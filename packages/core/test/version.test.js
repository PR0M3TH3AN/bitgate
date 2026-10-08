import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(join(HERE, "..", "..", "..", "package.json"), "utf8"));
const corePkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));

describe("VERSION", () => {
  it("matches package.json (root and @bitgate/core)", () => {
    expect(VERSION).toBe(rootPkg.version);
    expect(VERSION).toBe(corePkg.version);
  });
});
