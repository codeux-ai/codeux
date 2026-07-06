# Testing and Quality

This guide describes how to validate changes safely.

Test files are organized under `tests/`:
- `tests/backend/**`
- `tests/dashboard/**`
- `tests/e2e/**`


## Local Scratch Files

Temporary experiments, scratch files, or test scripts should be created outside the repository root or matched by local `.gitignore` rules (e.g. \`tmp*\` or \`test-*\`). Do not commit or leave these in the root directory.

## Core Commands

- Run TypeScript validation / lint
```bash
pnpm run lint
```

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

- Run focused persistence repository coverage after changing schema migrations,
  SQLite storage lifecycle, or scoped settings resolution
```bash
pnpm run test:backend -- tests/backend/repositories/db/app-db-schema.test.ts tests/backend/repositories/app-db-storage.test.ts tests/backend/repositories/settings-repository.test.ts
pnpm run test:backend:coverage
pnpm run lint
```

Persistence migrations must be replay-safe: startup can execute `runMigrations()` repeatedly against an existing database without duplicating indexes, dropping migrated columns/tables, or damaging legacy rows. Tests for these paths should use `:memory:` databases or temporary homes, seed legacy table/payload shapes behaviorally, and close all SQLite handles before removing temporary paths.

Provider invocation persistence tests should cover required observability fields in `provider_invocations`, including status, provider, model/session identifiers, token and character counters, failure metadata, nullable timestamps, and zero-valued usage. Repository tests must keep default storage on `:memory:` through `VITEST_IN_MEMORY_DB=true` or use an isolated temporary home when file-backed SQLite behavior is under test.

- Run the local fast CI mirror (strict TS validation plus tests)
```bash
pnpm run ci
```

`pnpm run ci` starts with `pnpm run quality:guardrails`, then runs audit, lint, backend coverage, dashboard tests, and build. Run `pnpm run quality:guardrails` directly after changes that affect shared implementation structure, large modules, duplicate logic, dependency factory wiring, realtime snapshot persistence, optimistic task insertion, or the guardrail script itself. Treat blocking guardrail output as CI-equivalent; advisory oversized-file and broad-`any` reports identify cleanup targets but do not fail the command.

GitHub Actions runs the same signals as separate jobs so a vulnerability finding does not obscure compile, test, or build failures. The `Security Audit` job runs `pnpm run audit` independently, while `Typecheck & Lint`, `Backend Tests & Coverage`, `Dashboard Tests`, and `Build` run the repository quality, TypeScript, Vitest, and bundle checks on Node 22 with pnpm 10.33.0. Workflow health tests under `tests/backend/ci/workflow-health.test.ts` assert this split, the `package.json` audit script value, the absence of audit execution from build and Playwright lanes, the pinned `pnpm/action-setup` and `actions/setup-node` versions, frozen `pnpm install --frozen-lockfile --ignore-scripts` installs, concurrency cancellation, and cache keys that include runner OS, Node 22, pnpm 10.33.0, and dependency/config hash inputs.
The quality guardrail script also audits `vitest.config.ts` directly. It fails if `coverage.include` stops observing `src/**/*.ts`, if any global coverage threshold drops below the locked floors, if the `src/server/activity-cache-service.ts` line threshold is missing, malformed, below 80%, or if that file is excluded from coverage observability. The enforced global thresholds in `vitest.config.ts` are:

| Metric | Threshold |
| --- | ---: |
| Lines | `77.4` |
| Functions | `71.5` |
| Branches | `66.1` |
| Statements | `76.0` |

`src/server/activity-cache-service.ts` has an additional file-specific `lines: 80` gate. Coverage thresholds are ratchet-only: never lower the global floors, remove `coverage.include: ["src/**/*.ts"]`, exclude `src/server/activity-cache-service.ts`, or lower the activity-cache-service 80% line gate. The focused backend policy test at `tests/backend/ci/vitest-coverage-policy.test.ts` reads the real Vitest config and `package.json` scripts so deterministic env defaults, backend coverage scope, threshold floors, and `pnpm run test:backend:coverage` CI wiring cannot drift silently. These checks are file-based and deterministic; they do not depend on generated coverage output. Guardrail failures name the exact configured value, required minimum, and remediation command. After intentionally raising or restoring thresholds, run:

```bash
pnpm run quality:guardrails
pnpm run test:backend:coverage
```

- Run Playwright E2E browser tests
```bash
pnpm run test:e2e
```
Build first when running E2E from a clean checkout:
```bash
pnpm run build
pnpm exec playwright test
```
The Playwright config starts `node dist/index.js`, waits on the local `/health` liveness probe, and runs against a temporary HOME/USERPROFILE so the suite does not depend on a developer's browser cache, onboarding state, selected project, or real Code UX database. The E2E suite is local-only: tests must navigate through `baseURL` routes or local API probes, not external websites. Failure artifacts are retained under `test-results/`, and the HTML report is written to `playwright-report/`; CI uploads both paths after every run so traces, videos, screenshots, and reports are available when failures occur.

Focused examples:
```bash
pnpm run test:e2e -- tests/e2e/sprint-task-lifecycle.spec.ts
pnpm run test:e2e -- tests/e2e/app-release-smoke.spec.ts
pnpm run test:e2e -- tests/e2e/project-setup-release.spec.ts
pnpm run test:e2e -- tests/e2e/app-release-smoke.spec.ts -g "normal app shell"
```

### Playwright Release E2E

The release-style E2E suite lives under `tests/e2e` and exercises the production-style dashboard served by the compiled server. It is not a provider orchestration test suite: specs must avoid provider credentials, Docker provider startup, project setup automation, worker dispatch, and sprint execution endpoints. The current coverage includes:

- `tests/e2e/app-release-smoke.spec.ts`, which verifies the normal app shell, core dashboard routes, responsive task-board behavior, route landmarks, and unexpected browser errors.
- `tests/e2e/project-setup-release.spec.ts`, which verifies first-run onboarding completion, visible Add Project modal behavior for a credential-free local directory under the OS temp path, dashboard project selection, `/projects` landmarks, `/tasks` navigation, loading/error checks, and desktop/mobile overflow checks without provider secrets or orchestration endpoints.
- `tests/e2e/sprint-task-lifecycle.spec.ts`, which verifies draft sprint and implementation task create/edit/delete behavior through the visible dashboard flows and collection API assertions.
- `tests/e2e/helpers/prepare-app.ts`, which prepares deterministic app state through dashboard HTTP APIs for onboarding, local project selection, draft sprint setup, task setup, updates, deletes, and cleanup.

`playwright.config.ts` uses Chromium, `http://127.0.0.1:4444`, `fullyParallel: false`, CI retries, and the GitHub plus HTML reporters in CI. It checks `/health` instead of `/ready` because a clean run may not have project live-status activity, while liveness is enough to know the compiled web app accepted the browser session. The default desktop Chromium project runs the full E2E suite, and the mobile Chromium project is scoped to the responsive sprint ledger spec so mobile viewport coverage stays explicit without requiring every release-path test to support a narrow layout.

### E2E Authoring Rules

Root E2E specs should prepare normal app state through `tests/e2e/helpers/prepare-app.ts` before loading pages that depend on onboarding, project selection, sprints, or tasks. The helper layer uses the dashboard HTTP APIs, not direct database writes or shell commands, and creates per-run local project fixtures under the OS temp directory with names prefixed by the Playwright worker and a timestamp-safe run suffix.

- Use `completeOnboarding`, `ensureSelectedProject`, `createDraftSprint`, and `createTaskInSprint` for setup instead of hand-writing setup requests in each spec.
- Use unique fixture keys and generated names from the helper utilities so parallel workers and retries do not collide.
- Prefer role-based locators, accessible names, landmarks, and stable `data-testid` roots over CSS shape or timing assertions.
- For live-updating menus or dropdowns, keep helper clicks idempotent: reopen the menu and retry if a located item detaches between visibility and click, while still asserting the accessible action is visible before each attempt.
- Build paths with Node `os`, `path`, and `fs` APIs so fixtures remain portable on Windows, macOS, and Linux.
- For credential-free project setup coverage, drive the visible Add Project UI and disable the Project Setup Agent option before submitting so the test does not call provider orchestration, Docker provider startup, worker dispatch, or sprint execution endpoints.
- Clean up created sprints and tasks with `deleteTask`, `deleteSprint`, or `cleanupSprintFixture` in `afterEach` when a spec mutates persistent app state.
- Use the exported update/delete helpers to mutate or clean sprint/task records during a spec. Keep setup deterministic and local to the web app contract.

### Deterministic Test Runtime

`vitest.config.ts` pins backend and dashboard Vitest runs to deterministic process defaults before the config is exported:

- `VITEST_IN_MEMORY_DB=true` keeps default `new AppDbStorage()` calls on `:memory:` during tests so suites do not touch `~/.code-ux/app.db`.
- `TZ=UTC`, `LANG=C.UTF-8`, and `LC_ALL=C.UTF-8` keep date, time, and locale formatting stable across Linux, macOS, and Windows runners.
- `tests/setup/runtime-warning-filter.ts` applies an isolated temporary HOME/USERPROFILE/XDG home for the full test process, exports `withIsolatedTestHome` for tests that need their own temp home, and removes temp homes after each scoped callback.
- File-backed SQLite tests should use `tests/backend/repositories/sqlite-cleanup-test-helper.ts` when they need real WAL/SHM behavior; close tracked handles before removing temp roots.
- Fake timers are not enabled globally. Tests that call `vi.useFakeTimers()` must call `vi.useRealTimers()` in `try/finally` or file-level cleanup; the setup file fails the suite if fake timers leak between tests or after a test file.
- Stub Docker, Git, provider CLI/API, subprocess, filesystem-home, and network boundaries unless the test is explicitly validating that boundary. Orchestration regression tests should assert durable rows/events through repositories and mocked provider/session services, not real containers, Git pushes, or provider credentials.

### GitHub Actions E2E Policy

The Playwright workflow is `.github/workflows/playwright.yml`. It runs on pushes and pull requests targeting `main`, keeping the heavyweight OS-matrix E2E lane on the release path while `dev` remains gated by core CI.

The workflow matrix covers `ubuntu-latest`, `macos-latest`, and `windows-latest`. It installs dependencies with pnpm 10.33.0 on Node 22 using `pnpm install --frozen-lockfile --ignore-scripts`, builds the server and dashboard before Playwright starts `node dist/index.js`, caches browser binaries under `.cache/ms-playwright`, restores that cache before installing Chromium, installs Linux Chromium system dependencies only on Linux runners, and runs the same `pnpm run test:e2e` script used locally. Linux and macOS restore a `node_modules` cache for speed; Windows intentionally skips that cache and performs a clean pnpm install so pnpm's nested package links are regenerated instead of reusing a stale symlink tree. It uploads `test-results/` and `playwright-report/` as the `playwright-artifacts` workflow artifact with `if: always()` for seven days, with empty uploads ignored so successful runs do not fail if no failure artifacts were produced.

This lane is credential-free. It validates the compiled dashboard and server, including project setup coverage through `tests/e2e/project-setup-release.spec.ts`, without provider keys, Docker provider startup, project setup automation, sprint orchestration, or real project state.

- Run the local release install verifier
```bash
node scripts/verify-release-install.mjs
```

The release install verifier builds the workspace, creates a local npm tarball with `npm pack --ignore-scripts`, installs that tarball into a temporary isolated npm project, and runs the installed `codeux --help`. Set `CODE_UX_KEEP_RELEASE_INSTALL_TEMP=1` when diagnosing a failed run and you need to inspect the temporary package or install directory.

### Release Checks Policy

The no-secret release validation workflow is `.github/workflows/release-checks.yml`. It runs on pull requests targeting `main` and on manual `workflow_dispatch`, and it uses a native Linux, macOS, and Windows matrix to prove a release candidate can install dependencies, build from source, install from its packed npm tarball, run the installed CLI help command, and build the platform desktop package without provider credentials or publishing credentials.

Each job uses pnpm 10.33.0 and Node 22, runs `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm run build`, `node scripts/verify-release-install.mjs`, rebuilds Electron native dependencies with `pnpm run electron:install-deps`, and then runs the matching Electron distribution script for the runner platform:

- Linux: `pnpm run electron:dist:linux`
- macOS: `pnpm run electron:dist:mac`
- Windows: `pnpm run electron:dist:win`

`node scripts/verify-release-install.mjs` builds the workspace, creates a local npm tarball with `npm pack --ignore-scripts`, installs that tarball into a temporary npm project, and runs the installed `codeux --help` CLI smoke command. Electron packaging sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so CI builds remain unsigned, and release-check Electron commands pass `--publish never` so generated installer/package files under `release/electron/` are uploaded as workflow artifacts only.

Together, `.github/workflows/release-checks.yml` and `.github/workflows/playwright.yml` are the pull-request-to-main credential-free release validation lanes. The former checks source build, package installability, CLI help, and desktop package creation; the latter checks the compiled app in Chromium across Linux, macOS, and Windows, including project setup coverage.

### Main Release Version Gate

The `CI` workflow includes a `Release Version Bump` job for pull requests targeting `main`. It compares `package.json` on the PR head with the target `main` commit and fails unless the head version is a valid semver patch/minor/major increase. This keeps release promotions from merging to `main` without a package version bump while leaving ordinary `dev` integration PRs unaffected.

Local reproduction commands:

```bash
pnpm run build
node scripts/verify-release-install.mjs
pnpm run test:e2e -- tests/e2e/project-setup-release.spec.ts
```

Build first before Playwright because `playwright.config.ts` starts `node dist/index.js`.

### OpenRouter Sprint Validation Policy

The optional credentialed sprint validation workflow is `.github/workflows/openrouter-sprint-e2e.yml`. It runs on `push` to `main` and `workflow_dispatch` on `ubuntu-latest`, installs with pnpm 10.33.0 on Node 22, builds the compiled runtime, and invokes `node scripts/e2e/run-openrouter-sprint-validation.mjs`.

This lane only performs real provider-backed sprint validation when the repository secret `OPENROUTER_API_KEY` is configured. If the secret is absent, the runner prints `Skipping OpenRouter sprint validation: OPENROUTER_API_KEY is not set.` and exits with status 0; the workflow is then a successful skip, not a provider validation pass. The workflow sets `CODEUX_E2E_OPENROUTER_MODEL` from the optional repository variable of the same name, defaulting to `openai/gpt-5-mini`.

The runner uses the existing `codex` provider configured with OpenRouter-compatible settings, isolated app home directories, and temporary local git repositories. It executes three scenarios by default:

- `smoke`: a three-task dependency-chain sprint.
- `ci-repair`: a one-task deterministic CI failure repair sprint.
- `conflict-dag`: a five-task merge-conflict DAG sprint.

Artifacts are written under `.cache/e2e-openrouter/<run-id>/` and uploaded by the workflow as `openrouter-sprint-e2e-artifacts` when validation fails or artifacts exist. The artifact upload includes hidden files because the root is under `.cache/e2e-openrouter/`; retention is 5 days.

Expected failure semantics are strict after the secret is present: unknown scenarios, missing `dist/index.js`, server readiness failures, scenario timeouts, non-terminal tasks, failed task statuses, or failed child commands return a non-zero exit code. Summaries and logs redact provider keys and authorization headers.

Local skip check, which does not require `dist/index.js`:

```bash
node scripts/e2e/run-openrouter-sprint-validation.mjs
```

Local credentialed validation:

```bash
pnpm run build
OPENROUTER_API_KEY=... node scripts/e2e/run-openrouter-sprint-validation.mjs
OPENROUTER_API_KEY=... CODEUX_E2E_OPENROUTER_MODEL=openai/gpt-5-mini node scripts/e2e/run-openrouter-sprint-validation.mjs --scenario smoke
```

Set `CODEUX_E2E_OPENROUTER_MODEL` only when validating a different OpenRouter model intentionally.

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
- Sprint orchestration regression tests should cover repeated watch-loop cycles, including active dispatch reuse, QA/CI gate waits, merge-ready tasks, and failed provider startup rows. These tests should assert durable task-run/dispatch/provider invocation events and avoid real provider CLIs, Docker containers, Git pushes, or GitHub API calls.
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
- Dashboard quality regression tests should cover user-facing contracts with role, name, text, and live-region assertions. For accessibility-sensitive surfaces, include landmark/dialog names, button accessible names, focus restoration after Escape/cancel/dismiss flows, visible `status`/`alert` regions, and reduced-motion behavior that preserves static state without animation-only feedback.
- Destructive dashboard actions must have tests for the full confirmation lifecycle: opening the named dialog, Escape and cancel paths, pending or busy state, final confirmation, and focus restoration to the trigger or a visible fallback. Prefer exercising `useConfirmDialog` through real settings/task actions, with direct `ConfirmDialog` coverage for shared pending-state behavior.
- Realtime and cached dashboard hooks should have deterministic invalidation tests. Matching websocket/custom events should refresh or replace state, unrelated events should not refetch, concurrent silent refreshes should dedupe, and stale completions should not overwrite newer data.
- Loading, error, and empty states should be asserted through visible copy and accessible roles such as `status`, `alert`, `log`, and named `region`/`dialog` containers. Avoid class-name selectors except where motion classes or animation suppression are the behavior under test.
- Page-shell tests should focus on page-level state and mock expensive visual children instead of importing full chart/editor stacks
- Live page regression coverage should explicitly assert sidebar composition (`Invocation Feed`, `Runtime Timeline`, `Git / CI / PR`, `Attention Queue`, `Execution Runtime`) and order, while asserting removed cards (`Latest Activity`, `Protocol`, `Live Connections`) stay absent from the default Live sidebar.
- Live sidebar Git CI coverage should include at least one active CI run and assert both the status text (for example `IN_PROGRESS`) and an active indicator query (`.animate-spin`) so CI-state rendering regressions are detected quickly.

- Interaction behavior tests should verify pointer cursors, focus management, overlay dismissibility, and reduced-motion states for animated components.
- Flow-specific tests (like destructive actions) must assert that confirmation dialogs appear and that side-effect actions (like "Reset downstream tasks") are triggered correctly based on user selection.

Focused dashboard quality lane:
```bash
pnpm run test:dashboard -- tests/dashboard/accessibility/dashboard-quality-regressions.test.tsx tests/dashboard/components/ui/ActionFeedbackRegion.test.tsx tests/dashboard/v2/settings-danger-panel.test.tsx tests/dashboard/v2/settings-page-state.test.tsx tests/dashboard/v2/runtime-event-feed.test.tsx tests/dashboard/v2/use-project-effective-settings.test.tsx tests/dashboard/hooks/use-realtime-resource.test.tsx dashboard/src/v2/components/__tests__/NotificationPanel.test.tsx dashboard/src/v2/lib/__tests__/motion/interaction-tokens.test.tsx
```


## Quality Expectations

1. Keep strict TypeScript compatibility.
2. Preserve existing tool contracts unless intentional migration.
3. Add tests for behavioral changes.
4. Validate both server and dashboard build.
5. If you change invocation reasoning or transcript persistence, keep `docs/architecture/execution-invocation-tracking.md` and `docs/dashboard/design-system-chat.md` aligned with `provider-conversation-message-mapper.ts`, `ProviderExecutionService`, and `ReasoningWidget`, then re-check the docs index links.

## Change-Specific Validation

- Quality guardrail changes: run `pnpm run quality:guardrails`, the focused guardrail tests under `tests/backend/scripts/quality-guardrails.test.ts`, `pnpm run lint`, and `pnpm run build` if package scripts or shared TypeScript imports changed.
- Coverage threshold changes: run `pnpm run quality:guardrails`, `pnpm run test:backend -- tests/backend/ci/vitest-coverage-policy.test.ts tests/backend/scripts/quality-guardrails.test.ts tests/backend/docs/testing-docs-commands.test.ts`, `pnpm run lint`, and the relevant coverage command (`pnpm run test:coverage` or `pnpm run test:backend:coverage`) before proposing an increase. Never lower the global threshold floors, remove `coverage.include: ["src/**/*.ts"]`, exclude `src/server/activity-cache-service.ts`, or lower the activity-cache-service 80% line gate.
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
- Repository-level determinism guardrails live in `tests/backend/scripts/test-determinism-guardrails.test.ts`. They assert the Vitest defaults, isolated HOME/USERPROFILE and XDG helper behavior, explicit fake-timer cleanup, and temp-only filesystem app state for backend tests.
- Backend determinism regressions are covered by focused tests for runtime environment defaults, isolated HOME/USERPROFILE state, SQLite WAL/SHM cleanup, timer-controlled polling, subprocess boundaries, Docker command stubbing, and local Git fixture cleanup. When changing these areas, start with:
```bash
pnpm run test:backend -- tests/backend/repositories/sqlite-connection.test.ts tests/backend/shared/polling/wait-until.test.ts tests/backend/shared/subprocess/command-runner.test.ts tests/backend/infrastructure/local-git-origin.test.ts tests/backend/infrastructure/providers/cli/docker-runner.test.ts
```
- Use Node-powered subprocess fixtures instead of shell-specific commands such as `sh`, `sleep`, or POSIX-only `echo` behavior.
- Normalize path separators in assertions when the app behavior is not explicitly testing native path rendering.
- Normalize Git working-tree text fixtures for CRLF when assertions only care about logical file contents.
- Tests start with `HOME`, `USERPROFILE`, and XDG config/state/cache paths pointed at a temporary Vitest home. When a test needs its own `os.homedir()` sandbox, use `withIsolatedTestHome` from `tests/setup/runtime-warning-filter.ts`; it stubs both `HOME` and `USERPROFILE`, updates the XDG paths, restores the previous values, and removes the temporary directory after the callback finishes.
- Pin date, time, and number formatting to an explicit locale and time zone for UI text that is asserted in tests.
- Fake timers are not enabled globally. Tests that call `vi.useFakeTimers()` must call `vi.useRealTimers()` during cleanup; the shared setup restores leaked fake timers at test-file boundaries and fails loudly so the next test cannot inherit a mocked clock.
- Close SQLite databases before cleanup when possible. Windows can briefly hold SQLite sidecar files open during teardown, so the Vitest setup tolerates transient temp-directory `EBUSY` and `EPERM` removal errors without weakening application lifecycle cleanup.
- File-backed SQLite tests should use `tests/backend/repositories/sqlite-cleanup-test-helper.ts` for temp homes. Use `withSqliteTempHome` when a test must point HOME/USERPROFILE and XDG paths at a disposable SQLite fixture, and use `removeSqliteTempHome` plus `expectSqliteSidecarsRemoved` for manual open/close cycles.
- Tests around provider CLIs, Docker, and remote Git must stub the command boundary. Assert generated command arguments or local config parsing instead of invoking provider binaries, Docker daemons, network remotes, or developer credentials.
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
