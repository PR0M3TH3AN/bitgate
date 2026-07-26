# Checkpoints

## Checkpoint 0 — Repo skeleton (current)

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

## Next checkpoint

Checkpoint 1 — BitVid fixture and conformance corpus only.
