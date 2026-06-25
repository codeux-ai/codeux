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

- Run Playwright E2E browser tests
```bash
pnpm exec playwright test
```

GitHub Actions optimization notes:
- The CI pipeline is split into three parallel, concurrent jobs: `Typecheck & Lint`, `Unit & Integration Tests`, and `Playwright E2E Tests` for maximum speed and fast feedback.
- Restores and saves Vite, Vitest, and TypeScript compiler increment caches across runs.
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
- Page-shell tests should focus on page-level state and mock expensive visual children instead of importing full chart/editor stacks
- Live page regression coverage should explicitly assert sidebar composition (`Live Connections`, `Git / CI / PR`, `Attention Queue`, `Runtime Timeline`, `Execution Runtime`) and order, while asserting removed cards (`Latest Activity`, `Protocol`) stay absent and the Live Connections header counts include listener, worker, and manager/dashboard state.
- Live sidebar Git CI coverage should include at least one active CI run and assert both the status text (for example `IN_PROGRESS`) and an active indicator query (`.animate-spin`) so CI-state rendering regressions are detected quickly.

- Interaction behavior tests should verify pointer cursors, focus management, overlay dismissibility, and reduced-motion states for animated components.
- Flow-specific tests (like destructive actions) must assert that confirmation dialogs appear and that side-effect actions (like "Reset downstream tasks") are triggered correctly based on user selection.


## Quality Expectations

1. Keep strict TypeScript compatibility.
2. Preserve existing tool contracts unless intentional migration.
3. Add tests for behavioral changes.
4. Validate both server and dashboard build.

## Cross-Platform Test Expectations

Tests are expected to pass on Windows, macOS, and Linux. Keep fixtures and assertions portable:

- Use Node-powered subprocess fixtures instead of shell-specific commands such as `sh`, `sleep`, or POSIX-only `echo` behavior.
- Normalize path separators in assertions when the app behavior is not explicitly testing native path rendering.
- Normalize Git working-tree text fixtures for CRLF when assertions only care about logical file contents.
- Stub both `HOME` and `USERPROFILE` when tests need to control `os.homedir()` across platforms.
- Pin date, time, and number formatting to an explicit locale and time zone for UI text that is asserted in tests.
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
