# Testing and Quality

This guide describes how to validate changes safely.

Test files are organized under `tests/`:
- `tests/backend/**`
- `tests/dashboard/**`

## Core Commands

- Run tests
```bash
pnpm test
```

- Run backend tests only
```bash
pnpm run test:backend
```

- Run dashboard tests only
```bash
pnpm run test:dashboard
```

- Run coverage report (verifies 80% global thresholds)
```bash
pnpm run test:coverage
```

- Run backend coverage only
```bash
pnpm run test:backend:coverage
```

- Run the local fast CI mirror (strict TS validation plus tests)
```bash
pnpm run ci
```

GitHub Actions optimization notes:
- the hosted CI workflow now uses a single `verify` job on the self-hosted runner so checkout, dependency installation, and cache restoration only happen once per run
- the hosted CI workflow installs dependencies with `pnpm` and runs the same ordered validation path as the local `pnpm run ci` script, then finishes with `pnpm run audit`
- the hosted CI workflow cancels superseded runs for the same branch or PR
- CI avoids a second plain `vitest` pass because backend coverage already executes the backend suite while enforcing thresholds
- dashboard tests still run as a separate Vitest invocation because coverage thresholds target `src/**/*.ts`, not the dashboard bundle under `dashboard/`
- dependency installation uses `pnpm install --frozen-lockfile --ignore-scripts` with the pnpm store cached by `actions/setup-node`
- Vite, Vitest, and TypeScript incremental metadata now write into repo-local `.cache/` directories so GitHub Actions can restore them across workflow runs and the `build` step can reuse prior typecheck work
- the shared Vitest setup defaults `LOG_LEVEL` to `error` during tests and installs lightweight canvas stubs so dashboard-heavy suites avoid noisy server logs and repeated DOM warnings
- the shared Vitest setup also redirects `HOME`/XDG paths into a temp directory for each test worker so backend repositories that default to `~/.code-ux/*` cannot wipe or mutate a developer's live local settings during `pnpm test`
- prefer `happy-dom` for simple dashboard component and hook tests; reserve `jsdom` for cases that need stricter browser behavior
- backend server tests that need a real listener should bind with `port: 0` and reuse `handle.port` instead of reserving a throwaway port first
- if a backend route suite does not need host routing or upgrade handling, configure the Express app in-process and drive it with `supertest` instead of booting a real TCP listener
- watch-loop and polling-heavy tests should inject a no-op sleep helper instead of paying the full runtime interval during CI
- split heavy dashboard page tests from their child-component tests so simple component coverage can run under `happy-dom` without importing the full page shell
- for dashboard page-shell tests, mock chart-heavy or animation-heavy visual subtrees when the assertion only cares about page wiring, headings, scope switching, or save flows

- Build backend and dashboard
```bash
pnpm run build
```
  - The build script intentionally runs toolchain commands directly (`tsc`, dashboard typecheck, `vite build`) instead of nested package-manager calls to keep child-process overhead and command noise down.
  - TypeScript validation now uses incremental `.tsbuildinfo` files in `.cache/tsc/`, which lets `pnpm run build` reuse work from an earlier `pnpm run lint` or `pnpm run typecheck` in the same job.
  - The repo-root `vite.config.ts` sets `root: "dashboard"`, so `vite build` and `vite` must keep using that config to resolve `dashboard/index.html`.
  - The dashboard build now uses Vite 8's native `build.rolldownOptions` path instead of the Rollup compatibility key.

- Run dashboard typecheck only
```bash
pnpm run typecheck:dashboard
```

## Test Coverage Areas

### Backend
- Sprint orchestration behavior
- Settings repository defaults and persistence
- Git status service parsing
- Task service prompt construction
- Instruction template rendering and fallback behavior
- Route-level server tests should prefer in-process `supertest` requests over binding ephemeral TCP listeners unless host routing or socket behavior is the thing under test
- Polling/orchestration tests should stub the wait primitive so assertions cover state transitions without spending real wall-clock time
- When socket behavior is under test, let `setupDashboardServer()` bind directly to `port: 0` so the OS assigns the ephemeral port in one step
- Reuse a shared heavy server fixture inside helper-level unit tests when the assertions only touch private methods or repositories; keep full startup/shutdown isolation for lifecycle tests that call `run()`

### Dashboard
- Settings default cloning
- Activity helpers
- Status helpers
- UI tests that only need DOM events and markup assertions should use `@vitest-environment happy-dom` to reduce environment startup cost
- Page-shell tests should focus on page-level state and mock expensive visual children instead of importing full chart/editor stacks

## Quality Expectations

1. Keep strict TypeScript compatibility.
2. Preserve existing tool contracts unless intentional migration.
3. Add tests for behavioral changes.
4. Validate both server and dashboard build.

## Safe Refactor Pattern

1. Add or update tests first for expected behavior.
2. Isolate changes by layer.
3. Run tests after each major phase.
4. Run full build before finalizing.

## Critical Regression Risks

- Tool name or schema drift from `src/contracts/mcp-tool-definitions.ts`
- Dashboard/backend type mismatch for settings
- Instruction template key mismatch
- Step toggle defaults becoming unsafe
- Search path precedence changes affecting overrides
