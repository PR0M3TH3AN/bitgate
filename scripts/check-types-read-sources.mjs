#!/usr/bin/env node
// The typecheck reads package sources, never built type files.
//
// Each package's `exports` points TypeScript at `dist/types/*.d.ts` when that
// exists. Those files are build output: after a change they are stale until
// `npm run build:types` runs again, and a typecheck that read them failed for
// no reason in the code (twice on 2026-11-21). The typecheck configs
// (tsconfig.check.json, packages/widget/tsconfig.check.json) map every
// `@bitgate/*` import to its source instead; this check holds them there. The
// declaration builds (tsconfig.types.json) keep resolving neighbours through
// their built types, as they must: a package's build emits only its own files.
//
// It lists the files each typecheck program would read and fails if any is
// under a `dist/` directory. So that it is never vacuous on a fresh checkout,
// it first puts a decoy `dist/types/index.d.ts` in each package that lacks
// one, and removes it afterwards. `dist/` is ignored build output.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = ["tsconfig.check.json", "packages/widget/tsconfig.check.json"];
const DECOY = "// decoy written by scripts/check-types-read-sources.mjs; a typecheck must not read this\nexport {};\n";

/** @type {string[]} */
const decoys = [];
let failed = false;
try {
  for (const name of readdirSync(join(ROOT, "packages"))) {
    const types = join(ROOT, "packages", name, "dist", "types", "index.d.ts");
    if (existsSync(join(ROOT, "packages", name, "package.json")) && !existsSync(types)) {
      const dist = join(ROOT, "packages", name, "dist");
      // Remove only what this check made: the whole dist/ if there was none.
      decoys.push(existsSync(dist) ? types : dist);
      mkdirSync(dirname(types), { recursive: true });
      writeFileSync(types, DECOY);
    }
  }

  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  for (const project of PROJECTS) {
    const files = execFileSync(process.execPath, [tsc, "-p", project, "--listFilesOnly"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const built = files.filter((file) => /[\\/]packages[\\/][^\\/]+[\\/]dist[\\/]/.test(file));
    if (built.length) {
      failed = true;
      console.error(`✗ ${project} reads ${built.length} built file(s), e.g. ${built[0]}`);
    } else {
      console.log(`✓ ${project} reads package sources only (${files.length} files)`);
    }
  }
} finally {
  for (const decoy of decoys) {
    rmSync(decoy, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
