# Testing and Quality

This guide describes how to validate changes safely.

Test files are organized under `tests/`:
- `tests/backend/**`
- `tests/dashboard/**`


## Local Scratch Files

Temporary experiments, scratch files, or test scripts should be created outside the repository root or matched by local `.gitignore` rules (e.g. \`tmp*\` or \`test-*\`). Do not commit or leave these in the root directory.

## Core Commands

- Run tests
```bash
pnpm test
```

- Run backend tests only
```bash
pnpm run test:backend
```

Use focused backend tests first when a change is isolated to a repository, service, script, sprint step, or server route. In this repository, appending a test path to `pnpm run test:backend -- <path>` may still run the backend suite because the script already includes `tests/backend`; check the command output before assuming only one file ran.

- Run dashboard tests only
```bash
pnpm run test:dashboard
```

Use focused dashboard tests first when changing pure view-model helpers, resource hooks, page state, or components under `dashboard/src/`. Broaden to `pnpm run test:dashboard` for user-facing Live, Tasks, Stats, settings, accessibility, or realtime behavior.

- Run coverage report (verifies the configured global and per-file thresholds)
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

`pnpm run ci` starts with `pnpm run quality:guardrails`, then runs audit, lint, backend coverage, dashboard tests, and build. Run `pnpm run quality:guardrails` directly after changes that affect shared implementation structure, large modules, duplicate logic, dependency factory wiring, realtime snapshot persistence, optimistic task insertion, or the guardrail script itself. Treat blocking guardrail output as CI-equivalent; advisory oversized-file and broad-`any` reports identify cleanup targets but do not fail the command.

GitHub Actions runs the same signals as separate jobs so a vulnerability finding does not obscure compile, test, or build failures. The `Security Audit` job runs `pnpm run audit` independently, while `Typecheck & Lint`, `Backend Tests & Coverage`, `Dashboard Tests`, and `Build` run the repository quality, TypeScript, Vitest, and bundle checks on Node 22 with pnpm 10.33.0.
The quality guardrail script also audits `vitest.config.ts` directly. It fails if any global coverage threshold drops below the locked floors (`lines: 77.4`, `functions: 71.5`, `branches: 66.1`, `statements: 76.0`) or if the `src/server/activity-cache-service.ts` line threshold is missing or below 80%. This check is file-based and deterministic; it does not run Vitest coverage.

- Run Playwright E2E browser tests
```bash
pnpm exec playwright test
```
Build first when running E2E from a clean checkout:
```bash
pnpm run build
pnpm exec playwright test
```
The Playwright config starts `node dist/index.js`, waits on the local `/health` liveness probe, and runs against a temporary HOME/USERPROFILE so the suite does not depend on a developer's browser cache, onboarding state, selected project, or real Code UX database. The E2E suite is local-only: tests must navigate through `baseURL` routes or local API probes, not external websites. Failure artifacts are retained under `test-results/`, and the HTML report is written to `playwright-report/`; CI uploads both paths after every run so traces, videos, screenshots, and reports are available when failures occur.

GitHub Actions optimization notes:
- `CI` runs on pushes to `main` and `dev`, and on pull requests targeting any branch. `Playwright Tests` runs on pushes and pull requests targeting `main` or `dev`, keeping release and publish workflows separate from validation.
- The CI pipeline is split into parallel jobs: `Typecheck & Lint`, `Backend Tests & Coverage`, `Dashboard Tests`, `Build`, and `Security Audit`. Playwright E2E runs in its own workflow so browser setup and artifacts stay isolated.
- Every validation job restores dependency cache as a speed hint, then still runs `pnpm install --frozen-lockfile --ignore-scripts` so the lockfile remains the install source of truth.
- Restores and saves Vite, Vitest, and TypeScript compiler increment caches across runs. Build and Playwright jobs intentionally do not restore `.cache/tsc` because stale `.tsbuildinfo` without matching `dist/` output can make compiled entrypoints appear up-to-date when `dist/` is missing.
- Caches Playwright browser binaries (`~/.cache/ms-playwright`) to reduce downloads, then always runs `pnpm exec playwright install chromium --with-deps` so browser and OS dependencies are verified even after a cache restore.
- Keeps Playwright browser tests serialized because the suite shares one local `node dist/index.js` server and isolated SQLite home per run.
- Seamlessly integrates browser-level E2E tests for WebGL visual rendering, failure fallbacks, and mobile/desktop responsive layout breakpoints, removing mock-heavy DOM stubs from Unit tests.
- Uses the GitHub Actions reporter to publish Playwright test failures inline on pull request checks.
- Cancels superseded runs for the same branch or PR to conserve resources.
- Uploads `test-results/` and `playwright-report/` as the `playwright-artifacts` workflow artifact for seven days, with empty uploads ignored so successful runs do not fail if no failure artifacts were produced.

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
- Onboarding/settings default-state regressions: `tests/dashboard/v2/onboarding-defaults.test.tsx` verifies onboarding automation defaults and editability, while `tests/dashboard/v2/settings-page-state.test.tsx` verifies those defaults map into editable settings/view-model state
- Activity helpers
- Status helpers
- UI tests that only need DOM events and markup assertions should use `@vitest-environment happy-dom` to reduce environment startup cost
- Dashboard accessibility and design-system regression tests live under `tests/dashboard/accessibility/`. These tests should assert specific keyboard behavior, accessible names, live-region roles, responsive labels/wrapping, overflow boundaries, and reduced-motion fallbacks without snapshotting full pages or requiring a running backend.
- Page-shell tests should focus on page-level state and mock expensive visual children instead of importing full chart/editor stacks
- Live page regression coverage should explicitly assert sidebar composition (`Invocation Feed`, `Runtime Timeline`, `Git / CI / PR`, `Attention Queue`, `Execution Runtime`) and order, while asserting removed cards (`Latest Activity`, `Protocol`, `Live Connections`) stay absent from the default Live sidebar.
- Live sidebar Git CI coverage should include at least one active CI run and assert both the status text (for example `IN_PROGRESS`) and an active indicator query (`.animate-spin`) so CI-state rendering regressions are detected quickly.

- Interaction behavior tests should verify pointer cursors, focus management, overlay dismissibility, and reduced-motion states for animated components.
- Flow-specific tests (like destructive actions) must assert that confirmation dialogs appear and that side-effect actions (like "Reset downstream tasks") are triggered correctly based on user selection.


## Quality Expectations

1. Keep strict TypeScript compatibility.
2. Preserve existing tool contracts unless intentional migration.
3. Add tests for behavioral changes.
4. Validate both server and dashboard build.
5. If you change invocation reasoning or transcript persistence, keep `docs/architecture/execution-invocation-tracking.md` and `docs/dashboard/design-system-chat.md` aligned with `provider-conversation-message-mapper.ts`, `ProviderExecutionService`, and `ReasoningWidget`, then re-check the docs index links.

## Change-Specific Validation

- Quality guardrail changes: run `pnpm run quality:guardrails`, the focused guardrail tests under `tests/backend/scripts/quality-guardrails.test.ts`, `pnpm run lint`, and `pnpm run build` if package scripts or shared TypeScript imports changed.
- Coverage threshold changes: run `pnpm run quality:guardrails`, `pnpm run test:backend -- tests/backend/scripts/quality-guardrails.test.ts`, `pnpm run lint`, and the relevant coverage command (`pnpm run test:coverage` or `pnpm run test:backend:coverage`) before proposing an increase. Never lower the global threshold floors or the `src/server/activity-cache-service.ts` 80% line gate.
- Execution snapshot or Live runtime performance changes: run focused backend repository/service tests for the changed query or websocket path, focused dashboard hook/view-model tests for stabilization behavior, `pnpm run quality:guardrails`, `pnpm run lint`, and `pnpm run build`.
- Backend-only behavior changes: run the narrowest relevant backend tests first, then `pnpm run test:backend`, `pnpm run lint`, and `pnpm run build` when contracts, repositories, scripts, or app startup paths changed.
- Dashboard-only behavior changes: run the narrowest relevant dashboard tests first, then `pnpm run test:dashboard`, `pnpm run typecheck:dashboard`, and `pnpm run build` for route-level, resource, accessibility, or user-facing changes.
- Documentation-only changes: run commands requested by the task. When the docs describe scripts, CI, contracts, or generated types, also run `pnpm run lint` so markdown-adjacent package and TypeScript references stay consistent.
- Cross-platform repository cleanup regressions: use `tests/backend/repositories/sqlite-cleanup-test-helper.ts` for file-backed SQLite tests that need temporary homes. The helper creates unique temp roots, closes tracked Vitest SQLite adapters before teardown, asserts WAL/SHM sidecars are gone after close, and removes temp roots through the test harness where transient Windows temp lock errors are tolerated. Production SQLite open/close paths should continue to throw real errors.
```bash
pnpm run test:backend -- tests/backend/repositories/sqlite-connection.test.ts tests/backend/repositories/app-db-storage.test.ts
```

## Cross-Platform Test Expectations

Tests are expected to pass on Windows, macOS, and Linux. Keep fixtures and assertions portable:

- Vitest pins deterministic runtime defaults before tests run: `TZ=UTC`, `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `VITEST_IN_MEMORY_DB=true`, `LOG_LEVEL=error`, and `CODEUX_FORCE_LOG_LEVEL=error`. Do not rely on the host timezone, locale, or persisted dashboard log settings in assertions.
- Use Node-powered subprocess fixtures instead of shell-specific commands such as `sh`, `sleep`, or POSIX-only `echo` behavior.
- Normalize path separators in assertions when the app behavior is not explicitly testing native path rendering.
- Normalize Git working-tree text fixtures for CRLF when assertions only care about logical file contents.
- Tests start with `HOME`, `USERPROFILE`, and XDG config/state/cache paths pointed at a temporary Vitest home. When a test needs its own `os.homedir()` sandbox, use `withIsolatedTestHome` from `tests/setup/runtime-warning-filter.ts`; it stubs both `HOME` and `USERPROFILE`, updates the XDG paths, restores the previous values, and removes the temporary directory after the callback finishes.
- Pin date, time, and number formatting to an explicit locale and time zone for UI text that is asserted in tests.
- Fake timers are not enabled globally. Tests that call `vi.useFakeTimers()` must call `vi.useRealTimers()` during cleanup; the shared setup restores leaked fake timers at test-file boundaries and fails loudly so the next test cannot inherit a mocked clock.
- Close SQLite databases before cleanup when possible. Windows can briefly hold SQLite sidecar files open during teardown, so the Vitest setup tolerates transient temp-directory `EBUSY` and `EPERM` removal errors without weakening application lifecycle cleanup.
- When PowerShell execution policy blocks package-manager scripts, run commands through `pnpm.cmd` on Windows.

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
