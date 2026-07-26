# Checkpoints

## Checkpoint 0 — Repo skeleton (completed)

Delivered:
- npm workspaces monorepo
- Node 22 + ESM
- five empty packages under `packages/`
- Vitest harness
- TypeScript JSDoc typecheck
- GitHub Actions CI
- reference import guard
- provenance docs

Validation:
```bash
npm install
npm run check:references
npm run typecheck
npm test
npm run build:types
```

Gate: do not add runtime or BitVid codecs until fixture corpus exists.

## Checkpoint 1 — BitVid fixture and conformance corpus (current)

Delivered:
- fixture folders for BitVid cases (admin-state, reports, trusted-mutes, overrides, expectations)
- import script harness (`scripts/import-bitvid-fixtures.mjs`)
- characterization cases list (`fixtures/bitvid/characterization-cases.json`)
- conformance test framework (`tests/conformance/bitvid-fixtures.test.js`)
- testing utilities (`packages/testing/src/conformance.js`)

Validation:
```bash
npm run check:references  # still passes
npm test                  # now includes conformance tests
```

Status: Ready for real fixture extraction from BitVid.

Gate: Do not implement evaluator until at least 3 real characterization cases are imported with expectations.

## Next checkpoint

Checkpoint 2 — Pure core implementation (target normalization, authority resolution, policy engine)