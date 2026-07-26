#!/usr/bin/env node
/**
 * Fail if packages import BitVid/BitRoad source or depend on those trees.
 * BitVid and BitRoad are read-only reference repos only.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(__filename));

const FORBIDDEN_PATH_FRAGMENTS = [
  "/Documents/GitHub/bitvid",
  "/Documents/GitHub/bitroad",
  "Documents/GitHub/bitvid",
  "Documents/GitHub/bitroad",
];

const FORBIDDEN_PACKAGE_NAMES = ["bitvid", "bitroad"];

const FORBIDDEN_IMPORT_RE =
  /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
]);

/** @param {string} dir */
async function walk(dir) {
  /** @type {string[]} */
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "coverage"
    ) {
      continue;
    }

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
      continue;
    }

    const ext = entry.name.includes(".")
      ? `.${entry.name.split(".").pop()}`
      : "";
    if (TEXT_EXTENSIONS.has(ext)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isForbiddenImportSource(value) {
  const normalized = value.replace(/\\/g, "/");

  if (
    normalized === "bitvid" ||
    normalized === "bitroad" ||
    normalized.startsWith("bitvid/") ||
    normalized.startsWith("bitroad/")
  ) {
    return true;
  }

  for (const fragment of FORBIDDEN_PATH_FRAGMENTS) {
    if (normalized.includes(fragment)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Record<string, string> | undefined} deps
 * @param {string} location
 * @param {string[]} violations
 */
function checkDeps(deps, location, violations) {
  for (const [name, version] of Object.entries(deps || {})) {
    if (FORBIDDEN_PACKAGE_NAMES.includes(name) || isForbiddenImportSource(name)) {
      violations.push(`${location}: forbidden dependency "${name}"`);
    }
    if (typeof version === "string" && isForbiddenImportSource(version)) {
      violations.push(
        `${location}: forbidden dependency version for "${name}": ${version}`,
      );
    }
  }
}

async function main() {
  const rootPkgPath = join(ROOT, "package.json");
  await stat(rootPkgPath);

  /** @type {string[]} */
  const violations = [];

  const rootPkg = JSON.parse(await readFile(rootPkgPath, "utf8"));
  checkDeps(rootPkg.dependencies, "package.json", violations);
  checkDeps(rootPkg.devDependencies, "package.json", violations);
  checkDeps(rootPkg.optionalDependencies, "package.json", violations);
  checkDeps(rootPkg.peerDependencies, "package.json", violations);

  const packagesDir = join(ROOT, "packages");
  let packageDirs = [];
  try {
    packageDirs = (await readdir(packagesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(packagesDir, entry.name));
  } catch {
    packageDirs = [];
  }

  for (const packageDir of packageDirs) {
    const pkgPath = join(packageDir, "package.json");
    let pkg;
    try {
      pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    } catch {
      continue;
    }

    const rel = relative(ROOT, pkgPath);
    checkDeps(pkg.dependencies, rel, violations);
    checkDeps(pkg.devDependencies, rel, violations);
    checkDeps(pkg.optionalDependencies, rel, violations);
    checkDeps(pkg.peerDependencies, rel, violations);
  }

  const scanRoots = [
    join(ROOT, "packages"),
    join(ROOT, "scripts"),
    join(ROOT, "tests"),
    join(ROOT, "examples"),
  ];

  for (const scanRoot of scanRoots) {
    const files = await walk(scanRoot);
    for (const file of files) {
      // Allow the guard script itself to mention forbidden path fragments.
      if (file === __filename) {
        continue;
      }

      const content = await readFile(file, "utf8");
      const rel = relative(ROOT, file);

      for (const match of content.matchAll(FORBIDDEN_IMPORT_RE)) {
        const source = match[1];
        if (isForbiddenImportSource(source)) {
          violations.push(`${rel}: forbidden import of "${source}"`);
        }
      }

      // Catch file: / link: absolute path deps written into package.json files.
      if (file.endsWith("package.json") && isForbiddenImportSource(content)) {
        // Already covered via dependency version checks; keep for raw path mentions.
      }
    }
  }

  if (violations.length > 0) {
    console.error("Reference import guard failed:\n");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    console.error(
      "\nBitVid and BitRoad are read-only reference repositories. Do not import from them.",
    );
    process.exit(1);
  }

  console.log("✓ No forbidden BitVid/BitRoad imports detected");
}

main().catch((error) => {
  console.error("check:references failed:", error);
  process.exit(1);
});
