/**
 * esbuild plugin: replace `@bitgate/core`'s version module with the value from
 * package.json so browser bundles cannot drift from the package.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @returns {string} */
export function readLibraryVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

/**
 * @param {string} [injected]
 * @returns {import("esbuild").Plugin}
 */
export function bitgateVersionPlugin(injected = readLibraryVersion()) {
  return {
    name: "bitgate-version",
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /[/\\]core[/\\]src[/\\]version\.js$/ }, () => ({
        contents: `export const VERSION = ${JSON.stringify(injected)};\n`,
        loader: "js",
      }));
    },
  };
}
