// Import BitVid fixtures into the conformance harness.
// This is a one-time extractor that reads from reference repos only.
// No live imports are allowed in package sources.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(__filename, "../../..");

// BitVid checkout we're extracting from (read-only)
const BITVID_ROOT = "/home/user/Documents/GitHub/bitvid";

// Target directories
const FIXTURES_ROOT = join(ROOT, "fixtures/bitvid");
const ADMIN_STATE_DIR = join(FIXTURES_ROOT, "admin-state");
const REPORTS_DIR = join(FIXTURES_ROOT, "reports");
const TRUSTED_MUTES_DIR = join(FIXTURES_ROOT, "trusted-mutes");
const OVERRIDES_DIR = join(FIXTURES_ROOT, "overrides");
const EXPECTATIONS_DIR = join(FIXTURES_ROOT, "expectations");

// Ensure directories exist
async function setupDirectories() {
  const dirs = [
    FIXTURES_ROOT,
    ADMIN_STATE_DIR,
    REPORTS_DIR,
    TRUSTED_MUTES_DIR,
    OVERRIDES_DIR,
    EXPECTATIONS_DIR,
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
}

// Read a file from BitVid and write it to our fixtures
async function copyFixture(srcPath, destPath, transform = null) {
  const content = await readFile(srcPath, "utf8");
  const finalContent = transform ? transform(content) : content;
  await writeFile(destPath, finalContent, "utf8");
  console.log(`Copied ${relative(BITVID_ROOT, srcPath)} → ${relative(ROOT, destPath)}`);
}

// Example: copy a test file that demonstrates trusted-report behavior
async function importTrustedReportFixtures() {
  // This would extract specific test cases from BitVid's test files
  // For now, we'll create placeholders that describe what we need
  const placeholder = `// Trusted report threshold fixture
// Extracted from BitVid js/services/moderationService.js characterization
export default {
  description: "Trusted report threshold reached",
  state: {
    // Admin list state (curators, editors, super admin)
    adminState: {
      editors: [],
      whitelist: [],
      blacklist: [],
      eventBlacklist: []
    },
    // Trust graph state (who trusts whom)
    trust: {
      // pubkey -> [trustedBy1, trustedBy2, ...]
    },
    // Active reports
    reports: [
      // { reporter: pubkey, target: pubkey, category: string, timestamp: number }
    ],
    // Trusted mutes (aggregated from trust graph)
    trustedMutes: [
      // { target: pubkey, count: number, categories: { spam: number, ... } }
    ],
    // Overrides (viewer-specific)
    overrides: {
      // pubkey -> { visibility: "allow"|"restrict"|"hide", reason: string }
    }
  },
  // Target to evaluate
  target: {
    type: "user",
    pubkey: "example_pubkey_hex"
  },
  // Expected outcome
  expectation: {
    visibility: "hide",
    interaction: "deny",
    reasons: ["trusted-report-threshold"],
    evidence: [
      // { reporter: pubkey, category: string, timestamp: number }
    ]
  }
};`;
  
  await writeFile(
    join(FIXTURES_ROOT, "trusted-report-threshold.fixture.js"),
    placeholder
  );
  console.log("Created trusted-report-threshold fixture placeholder");
}

// Main import process
async function main() {
  await setupDirectories();
  await importTrustedReportFixtures();
  console.log("Fixture import script ready. Add real extractors as needed.");
}

main().catch((error) => {
  console.error("Fixture import failed:", error);
  process.exit(1);
});