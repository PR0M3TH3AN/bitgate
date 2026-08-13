# AGENTS.md — BitGate (Nostr-Governance)

## Purpose

BitGate is a headless governance SDK for Nostr apps: moderation and access
control expressed as four decision dimensions (ranking, visibility,
interaction, transaction). The engine carries no thresholds of its own —
applications supply a policy definition; the engine supplies precedence,
aggregation, composition, and explanation.

## Repository map

- `packages/` — npm workspaces: `core` (pure evaluation, zero deps), `nostr`
  (codecs), `runtime`, `verify` (signature verification), `testing`
  (conformance harness), `widget`, `standalone`, `bitvid-compat`, `site`.
- `tests/` — unit, conformance, performance, and security test suites.
- `examples/` — runnable integration examples (workspace members).
- `fixtures/` — characterization corpus data.
- `docs/` — security model, integration guide, NIPs, ADRs, TODO.
- `scripts/` — corpus/fixture tooling and `verify-no-reference-imports.mjs`.

## Build / test / validate

Requires Node >= 22. Install with `npm ci` (or `npm install`).

- Run `npm test` — unit tests plus conformance suite (vitest).
- Run `npm run test:unit` or `npm run test:conformance` for one half.
- Run `npm run lint` — reference-import check plus typechecking.
- Run `npm run typecheck` for types only.
- Run `npm run build:types`, `npm run build:widget`, `npm run build:standalone`,
  or `npm run build` for everything including the site.
- CI (`.github/workflows/ci.yml`) runs `npm run lint`, `npm test`, and
  `npm run build:types` on Node 22 — match that locally before pushing.

## Conventions

- `@bitgate/core` stays dependency-free: no I/O, no browser globals. The
  `verify` package exists precisely so core never imports crypto.
- `scripts/verify-no-reference-imports.mjs` (part of `lint`) enforces import
  boundaries — do not work around it.
- ESM throughout (`"type": "module"`); TypeScript via JSDoc/`.d.ts` builds.

## Backlog

Open work is tracked in `docs/TODO.md`.

## Security

- Everything arriving from a relay is untrusted input; `event.pubkey` is an
  unauthenticated claim until a signature is verified. Administrative state
  fails closed without `verifySignature`. See `docs/security.md` before
  touching ingest, authorship, or verification paths.
- Never commit secrets or private keys; fixtures must contain only public,
  already-published event data.

## Change policy

- Keep diffs minimal and scoped to the task.
- Behavior changes must update the corresponding tests (including conformance
  fixtures where applicable).
- Never weaken, skip, or delete tests to make a change pass.

## Repo memory

Curated agent memory lives in `.agents/` (index: `.agents/MEMORY.md`). Read it
before substantive work — it holds the fails-closed verification and
relays-are-untrusted conclusions with evidence refs into `docs/security.md`.
Propose additions as files in `.agents/proposals/`; trusted memory under
`.agents/memory/` changes only through reviewed commits. Durable
multi-session plans live under `.agents/plans/` (the canonical backlog stays
`docs/TODO.md`). Code, tests, and configuration always outrank memory.
