#!/usr/bin/env node
/**
 * Bundle the widget into a single self-contained file.
 *
 * This exists because bare module specifiers (`@bitgate/core`) do not resolve
 * in a browser. Node and the test runner resolve them through node_modules, so
 * the source works everywhere except the one place it most needs to: a plain
 * static page. Without this step a consumer would need their own bundler or a
 * hand-written import map, which is exactly the friction the widget is meant
 * to remove.
 *
 * The output is a self-hosted artifact. Consumers copy `dist/bitgate.js` onto
 * their own origin and load it with a single script tag — they never fetch it
 * from someone else's deployment.
 *
 * Usage: node packages/widget/build.mjs [--watch]
 */
import { build, context } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: [join(HERE, "src", "index.js")],
  outfile: join(HERE, "dist", "bitgate.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  // Sourcemaps ship alongside: a moderator console that misbehaves in
  // production is worth being able to debug, and the cost is one extra file.
  sourcemap: true,
  minify: true,
  legalComments: "inline",
  banner: {
    js: "/*! BitGate widget — GPL-3.0-or-later — https://github.com/PR0M3TH3AN/Nostr-Governance */",
  },
};

const watch = process.argv.includes("--watch");

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("bitgate widget: watching…");
} else {
  const result = await build(options);
  if (result.errors.length) {
    process.exit(1);
  }
  console.log(`✓ Built ${options.outfile}`);
}
