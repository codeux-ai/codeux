# Testing and Quality

This guide describes how to validate changes safely.

Test files are organized under `tests/`:
- `tests/backend/**`
- `tests/dashboard/**`


## Local Scratch Files

Temporary experiments, scratch files, or test scripts should be created outside the repository root or matched by local `.gitignore` rules (e.g. \`tmp*\` or \`test-*\`). Do not commit or leave these in the root directory.

## Core Commands

- Typecheck server/shared TypeScript
```bash
pnpm run lint
```
  - `pnpm run typecheck` is the same root TypeScript check; prefer `pnpm run lint` because it is the command used by the local CI script.

- Run backend tests only
```bash
pnpm run test:backend
```
  - For a focused backend file, run Vitest directly: `pnpm exec vitest run tests/backend/path/to/file.test.ts`.
  - `pnpm run test:backend -- <file>` still starts from the `tests/backend` script target, so use direct Vitest invocation when you need the narrowest possible run.

- Run dashboard tests only
```bash
pnpm run test:dashboard
```
  - For source-adjacent dashboard tests outside `tests/dashboard`, run `pnpm exec vitest run dashboard/src/.../__tests__/file.test.tsx`.

- Run backend coverage report
```bash
pnpm run test:backend:coverage
```
  - This is the coverage command used by `pnpm run ci`.
  - Use `pnpm run test:coverage` only when you intentionally need coverage for every configured Vitest include.

- Run Playwright E2E browser tests
```bash
pnpm exec playwright test
```
  - Playwright starts the built app with `node dist/index.js`, so run `pnpm run build` first when validating locally or in CI.
  - E2E tests must use the configured `baseURL` (`http://127.0.0.1:4444`) and avoid external network dependencies.
  - Prefer assertion-driven synchronization over fixed sleeps. After navigation, wait for load state plus route-specific landmarks, and after responsive viewport changes, wait for the expected visible or hidden layout state.
  - The Playwright web server receives a fresh per-run temp home via both `HOME` and `USERPROFILE`; tests should prepare onboarding and project selection through `tests/e2e/helpers/prepare-app.ts` instead of relying on persisted local state.
  - The configured projects are Chromium-only desktop and mobile-sized viewports. Keep browser coverage narrow unless a workflow explicitly expands it.
  - Trace collection runs on first retry, screenshots are captured on failure, and videos are retained for failures to make retry/failure artifacts useful without assuming a warm browser cache.

GitHub Actions optimization notes:
- The main CI workflow keeps typecheck, backend coverage, dashboard tests, and security audit jobs separate for fast feedback.
- The Playwright workflow stays separate from the main CI workflow, runs for pushes and pull requests targeting `dev` or `main`, and cancels superseded runs for the same branch or PR.
- Workflow hygiene is guarded by `tests/backend/repository-hygiene.test.ts`, which asserts pinned pnpm and Node versions, frozen lockfile installs, security audit coverage, CI script order, and Playwright E2E isolation.
- Restores and saves Vite, Vitest, and TypeScript compiler increment caches across runs where applicable.
- Caches Playwright browser binaries (`~/.cache/ms-playwright`) to avoid downloading browsers on every run, dramatically reducing E2E setup time.
- Uses `fullyParallel` execution in `playwright.config.ts` on CI to harness all available CPU cores.
- Seamlessly integrates browser-level E2E tests for WebGL visual rendering, failure fallbacks, and mobile/desktop responsive layout breakpoints, removing mock-heavy DOM stubs from Unit tests.
- Uses the GitHub Actions reporter to publish Playwright test failures inline on pull request checks.
- Cancels superseded runs for the same branch or PR to conserve resources.

- Build backend and dashboard
```bash
pnpm run build
```
  - The build script intentionally runs toolchain commands directly (`tsc`, dashboard typecheck, `vite build`) instead of nested package-manager calls to keep child-process overhead and command noise down.
  - TypeScript validation now uses incremental `.tsbuildinfo` files in `.cache/tsc/`, which lets `pnpm run build` reuse work from an earlier `pnpm run lint` or `pnpm run typecheck` in the same job.
  - The repo-root `vite.config.ts` sets `root: "dashboard"`, so `vite build` and `vite` must keep using that config to resolve `dashboard/index.html`.
  - The dashboard build now uses Vite 8's native `build.rolldownOptions` path instead of the Rollup compatibility key.

- Run the full local CI equivalent
```bash
pnpm run ci
```
  - The local CI script runs `pnpm run audit`, `pnpm run lint`, `pnpm run test:backend:coverage`, `pnpm run test:dashboard`, and `pnpm run build` in that order.
  - Playwright E2E is intentionally separate; run `pnpm exec playwright test` when a change affects startup, routing, browser behavior, dashboard accessibility, or responsive flows.

- Run dashboard typecheck only
```bash
pnpm run typecheck:dashboard
```

## Test Coverage Areas

### Coverage Guardrails
- `tests/backend/config/vitest-coverage-config.test.ts` imports the exported Vitest config and verifies coverage settings as data, without executing Vitest from inside the test.
- Backend source coverage must keep `src/**/*.ts` included, must keep generated/runtime entrypoint exclusions explicit, and must not count dashboard-only files unless the include scope is intentionally expanded later.
- Global coverage thresholds must stay at or above the configured minimums in `vitest.config.ts`: 77.4% lines, 71.5% functions, 66.1% branches, and 76.0% statements.
- `src/server/activity-cache-service.ts` has a dedicated 80% line threshold and must not be weakened when global thresholds move.

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
- Provider, Docker, Git, and external API boundaries should be mocked or injected. Use deterministic provider fixtures, fake timers for polling/retry loops, in-memory databases where supported, and temp homes/workspaces that are cleaned after the test.
- Provider invocation tests should assert both durable usage rows and replayable execution messages when telemetry or transcript behavior changes. Sanitized callback-facing telemetry must not leak secrets even when raw provider artifacts are read for parser input.

### Dashboard
- Settings default cloning
- Onboarding/settings default-state regressions: `tests/dashboard/v2/onboarding-defaults.test.tsx` verifies onboarding automation defaults and editability, while `tests/dashboard/v2/settings-page-state.test.tsx` verifies those defaults map into editable settings/view-model state
- Activity helpers
- Status helpers
- UI tests that only need DOM events and markup assertions should use `@vitest-environment happy-dom` to reduce environment startup cost
- Dashboard accessibility and design-system regression tests live under `tests/dashboard/accessibility/`. These tests should assert specific keyboard behavior, accessible names, live-region roles, responsive labels/wrapping, overflow boundaries, and reduced-motion fallbacks without snapshotting full pages or requiring a running backend.
- Dashboard UI changes should preserve accessible names, keyboard operation, visible focus states, loading/error/empty states, color contrast, reduced-motion behavior, and mobile/desktop layout constraints.
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

## Cross-Platform Test Expectations

Tests are expected to pass on Windows, macOS, and Linux. Keep fixtures and assertions portable:

- Use Node-powered subprocess fixtures instead of shell-specific commands such as `sh`, `sleep`, or POSIX-only `echo` behavior.
- Normalize path separators in assertions when the app behavior is not explicitly testing native path rendering.
- Normalize Git working-tree text fixtures for CRLF when assertions only care about logical file contents.
- Stub both `HOME` and `USERPROFILE` when tests need to control `os.homedir()` across platforms.
- Pin date, time, and number formatting to an explicit locale and time zone for UI text that is asserted in tests.
- SQLite repository tests should prefer `tests/backend/helpers/temp-db.ts` for file-backed databases. The helper creates an isolated temp home, tracks adapters/storage for close, removes SQLite sidecar files after close, and then removes the temp root so leaked handles fail deterministically.
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
