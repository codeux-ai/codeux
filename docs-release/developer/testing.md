# Testing & quality gates

Code UX uses **Vitest** as its single test runner across server and dashboard. CI gates enforce coverage thresholds and a full clean build.

## Layout

```
tests/
├── backend/         # server / orchestrator / mcp tests
└── dashboard/       # Preact component tests

src/**/*.test.ts     # co-located unit tests
```

The Vitest config is at `vitest.config.ts`. Test environment is **Node** (not jsdom) by default; dashboard tests opt into `happy-dom` per file.

## Running tests

```bash
pnpm test                       # full suite, single run
pnpm run test:watch             # watch mode
pnpm run test:backend           # backend only
pnpm run test:dashboard         # dashboard only
pnpm run test:coverage          # full coverage with thresholds
pnpm run test:backend:coverage  # backend coverage with thresholds
pnpm test -- tests/backend/smoke.test.ts   # single file
```

## Coverage thresholds

Enforced in CI:

| Metric | Threshold |
| --- | --- |
| Lines | **80%** |
| Functions | **69%** |
| Branches | **64%** |
| Statements | **80%** |

Per-file gate:

| File | Min line coverage |
| --- | --- |
| `src/services/activity-cache-service.ts` | 80% |

A failing threshold fails CI.

## Test patterns

- **`vi.mock()`** for module-level mocks.
- **`vi.spyOn()`** for verifying calls without replacing the implementation.
- **`vi.useFakeTimers()`** is the standard for cycle / watch-loop tests — wall-clock waits are otherwise prohibitively slow.
- **In-memory repositories** for orchestrator integration tests rather than spinning up Postgres.
- **Supertest** for HTTP route tests against the Express app.

## Writing new tests

A behavioural change *must* include or update tests. PRs without test coverage for non-trivial logic will be requested-changes in review.

Conventions:

- File naming: `*.test.ts` co-located with the unit under test, or under `tests/backend/<feature>/`.
- One `describe` per public function or surface; one `it` per scenario.
- Avoid snapshots for non-trivial outputs; prefer explicit assertions.
- Use fixtures from `tests/fixtures/` rather than inline mega-objects.

## Linting

The project uses TypeScript's `--noEmit` as its only lint pass:

```bash
pnpm run lint
```

There is no ESLint pipeline. Style is enforced by review and the type system.

## Local CI equivalent

```bash
pnpm run ci
```

This runs (in order):

1. `pnpm run lint` — typecheck.
2. `pnpm run test:backend:coverage` — backend tests + coverage threshold.
3. `pnpm run test:dashboard` — dashboard tests.
4. `pnpm run build` — server + dashboard build.

If `pnpm run ci` is green, GitHub CI will be too (modulo platform-specific differences).

## CI pipeline (GitHub Actions)

CI runs on Node 22 in `.github/workflows/`:

1. Install with frozen lockfile.
2. Lint (typecheck).
3. Test with coverage and threshold enforcement.
4. Build (server + dashboard).
5. `pnpm audit --audit-level=high`.
6. Coverage upload.
7. Secret scanning on PRs.

A PR cannot be merged with red CI.

## Smoke test

After build, sanity-check the binary:

```bash
pnpm run smoke-test
# = node dist/index.js --help
```

## Performance & flakiness

- Flaky tests should be quarantined (skipped) only with an owner and a follow-up issue. They block merges otherwise.
- Long tests (> 5 s) need justification; consider extracting and tagging as `slow` if necessary.
- Vitest's parallelism is on by default. Tests must not share state through globals or filesystem temp dirs without explicit cleanup.
