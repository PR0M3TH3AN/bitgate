import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import { bitgateVersionPlugin, readLibraryVersion } from "../../../scripts/esbuild-bitgate-version.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const versionJs = join(HERE, "..", "..", "core", "src", "version.js");

describe("build-time version injection", () => {
  it("replaces the version module with package.json's version", async () => {
    const version = readLibraryVersion();
    const result = await build({
      entryPoints: [versionJs],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      plugins: [bitgateVersionPlugin(version)],
    });

    const bundled = result.outputFiles[0].text;
    expect(bundled).toContain(`VERSION = ${JSON.stringify(version)}`);
    expect(bundled).not.toContain("Keep this string in lockstep");
  });
});
