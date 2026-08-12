#!/usr/bin/env node
/**
 * Bundle the headless engine + Nostr codecs into a single self-contained ESM
 * file for no-build static sites.
 *
 * The output (`dist/bitgate.js`) is the same canonical code the npm packages
 * ship — not a second implementation — with the bare `@bitgate/*` specifiers
 * resolved and inlined. Consumers copy it onto their own origin and import it
 * with a single relative path; they never fetch it from someone else's
 * deployment.
 *
 * Usage: node packages/standalone/build.mjs [--watch]
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
  sourcemap: true,
  minify: true,
  legalComments: "inline",
  banner: {
    js: "/*! BitGate (headless standalone) — GPL-3.0-or-later — https://github.com/PR0M3TH3AN/Nostr-Governance */",
  },
};

const watch = process.argv.includes("--watch");

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("bitgate standalone: watching…");
} else {
  const result = await build(options);
  if (result.errors.length) {
    process.exit(1);
  }
  console.log(`✓ Built ${options.outfile}`);
}
