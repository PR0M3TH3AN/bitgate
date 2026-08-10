#!/usr/bin/env node
/**
 * Assemble the static site.
 *
 * Copies `public/` and drops the built widget in at `vendor/bitgate/`, which is
 * the same path the docs tell integrators to use — so the site is itself an
 * example of the instructions it gives.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const widgetDir = join(HERE, "..", "widget");
const widgetDist = join(widgetDir, "dist");
const publicDir = join(HERE, "public");
const outDir = join(HERE, "dist");

// Always rebuild rather than reusing whatever is on disk. A stale bundle is
// exactly how a broken demo ships: the page loads, the module resolves, and an
// export added since the last build is silently missing.
console.log("Building @bitgate/widget…");
execSync("node build.mjs", { cwd: widgetDir, stdio: "inherit" });

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(publicDir, outDir, { recursive: true });

mkdirSync(join(outDir, "vendor", "bitgate"), { recursive: true });
cpSync(widgetDist, join(outDir, "vendor", "bitgate"), { recursive: true });

console.log(`✓ Built ${outDir}`);
