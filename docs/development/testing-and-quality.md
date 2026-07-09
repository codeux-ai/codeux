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
pnpm run test
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

Chat composer persistence regressions should cover both sides of the contract: backend route/repository tests for dashboard-user and project isolation, and dashboard hook/component tests for remount restoration plus ArrowUp/ArrowDown message-history traversal. Prefer deterministic in-memory fixtures and direct key events over wall-clock waits for debounced draft writes.

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

`pnpm run ci` executes `quality:guardrails -> audit -> lint -> test:backend:coverage -> test:dashboard -> build`.

GitHub Actions runs the same signals as separate jobs so a vulnerability finding does not obscure compile, test, or build failures. The `06 Security / dependency audit` job runs `pnpm run audit` independently, while `02 Static / typecheck and guardrails` runs `pnpm run quality:guardrails`, `pnpm run typecheck`, and `pnpm run typecheck:dashboard`, `04 Test / backend coverage` runs the backend Vitest coverage pass, `05 Test / dashboard suite` runs the dashboard Vitest pass, and `03 Build / server and dashboard artifact` runs the repository bundle checks on Node 22 with pnpm 10.33.0. Workflow health tests under `tests/backend/ci/workflow-health.test.ts` assert this split, the `package.json` audit script value, artifact reuse, the absence of audit execution from build and Playwright lanes, the pinned `pnpm/action-setup` and `actions/setup-node` versions, frozen `pnpm install --frozen-lockfile --ignore-scripts` installs, concurrency cancellation, and cache keys that include runner OS, Node 22, pnpm 10.33.0, and dependency/config hash inputs.
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
pnpm run test:e2e
```

`pnpm run test:e2e` runs `scripts/e2e/run-playwright.mjs`, which selects an unused dashboard/MCP port pair and then delegates to `pnpm exec playwright test`. `playwright.config.ts` starts `node dist/index.js`, waits on the local `/health` liveness probe, and gives the child process an isolated `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME`, and `XDG_DATA_HOME`. That temporary home keeps browser tests away from the developer's real `~/.code-ux/app.db`, selected project, onboarding state, provider auth, and runtime cache. The suite runs against the compiled server so it validates the packaged runtime path used by `pnpm start`, Electron, and release checks; run `pnpm run build` first whenever `dist/index.js` may be absent or stale.

The compiled E2E server receives `DASHBOARD_PORT`, `MCP_HTTP_PORT`, `CODE_UX_CONTAINERIZED_GIT=0`, `CODE_UX_GIT_CONTAINER_MODE=host`, `CODE_UX_DIRECTORY_BROWSER_ROOTS=<os temp dir>`, and `CODEUX_E2E_PROVIDER_CLI_SHIM=scripts/e2e/mock-provider-cli.mjs`. The specs are deterministic fake-CLI orchestration coverage, not coverage of real provider CLIs. Normal provider execution must remain unaffected: `src/infrastructure/providers/cli/provider-command-specs.ts` only swaps provider commands when `CODEUX_E2E_PROVIDER_CLI_SHIM` is explicitly set, and `src/domain/settings/settings-sanitizers/cli-workflow-sanitizer.ts` only preserves `HOST` execution for that guarded E2E lane. Without the shim env var, provider settings sanitize back toward Docker execution and real provider command specs.

Focused E2E commands:
```bash
pnpm exec playwright test --list
pnpm exec playwright test --project=navigation
pnpm exec playwright test --project=tasks tests/e2e/tasks/sprint-task-lifecycle.spec.ts
pnpm exec playwright test --project=projects tests/e2e/projects/filesystem-persistence.spec.ts
```

### Playwright E2E Suite

The Playwright suite lives under `tests/e2e` and exercises the production-style dashboard served by the compiled server. Specs are grouped by purpose directory, and `playwright.config.ts` maps each directory to a project with a scoped `testMatch` glob. Add new browser specs under the matching purpose directory instead of editing the Playwright project list.

- `tests/e2e/navigation/**/*.spec.ts`, which verifies the local dashboard shell, route landmarks, sprint ledger navigation, responsive navigation behavior, accessibility smoke coverage, speed audits, product smoke paths, and release-path app smoke coverage.
- `tests/e2e/tasks/**/*.spec.ts`, which verifies draft task creation and editing, sprint/task lifecycle flows, visual composer feedback, deterministic fake-provider invocation runtime coverage, full sprint orchestration, and sprint controls stress behavior.
- `tests/e2e/projects/**/*.spec.ts`, which verifies first-run project setup coverage and host filesystem persistence, including instruction-file writes, local-directory browsing, sanitized traversal rejection, and Settings Appearance background-image uploads. The Playwright server exposes the OS temp directory through `CODE_UX_DIRECTORY_BROWSER_ROOTS` so temporary git fixtures can be browsed without Docker-backed file-browser sessions.
- `tests/e2e/agents/**/*.spec.ts`, which verifies agent avatar and agent surface browser coverage.
- `tests/e2e/settings/**/*.spec.ts` and `tests/e2e/config/**/*.spec.ts`, which are reserved purpose groups for downstream Settings and Config suites.
- `tests/e2e/helpers/prepare-app.ts`, which prepares deterministic app state through dashboard HTTP APIs for onboarding, dashboard tour suppression, local project selection, draft sprint setup, task setup, updates, deletes, and cleanup.
- `tests/e2e/helpers/e2e-fixtures.ts`, which adds reusable helpers for temporary git repositories, selected Code UX project seeding, project settings overrides for local-git HOST execution, QA-disabled deterministic sprint/task fixtures, API polling, and dashboard onboarding/tour suppression.
- `scripts/e2e/mock-provider-cli.mjs`, which is the cross-platform fake provider used by the Playwright shim.

`playwright.config.ts` keeps `testDir: './tests/e2e'`, runs with `fullyParallel: true`, CI retries, one shared worker, Desktop Chrome project defaults, and the GitHub plus HTML reporters in CI. It defines the purpose projects `navigation`, `settings`, `projects`, `tasks`, `agents`, and `config`, each selected by `tests/e2e/<purpose>/**/*.spec.ts`. It checks `/health` because a clean run may not have project live-status activity, while liveness is enough to know the compiled web app accepted the browser session.

### Fake Provider Shim

The fake provider shim is `scripts/e2e/mock-provider-cli.mjs`. It is only active when the server process receives `CODEUX_E2E_PROVIDER_CLI_SHIM`; do not set that variable in normal development, manual QA against real providers, or production runtime. The shim accepts the provider, model, and prompt from the provider command boundary, writes deterministic workspace artifacts by default, emits provider-shaped JSON events, and exits without provider credentials, Docker, remote Git, or network calls.

Supported prompt markers:

- Success: omit failure markers. The shim writes `mock-provider-output.txt`, `.codeux-mock-provider/provider-run.json`, and the Codex output file when `--codex-output-path` is provided.
- Sleep: `[mock-provider:sleep=250]` delays for the requested milliseconds, clamped to 10 seconds, so controls can exercise pause/cancel/retry timing.
- Failure: `[mock-provider:fail]` exits non-zero, and `[mock-provider:exit=2]` selects a specific exit code from 1 through 125.
- No change: `[mock-provider:no-op]` skips deterministic file writes while still emitting a successful provider response unless combined with a failure marker.
- File output: `[mock-provider:write=relative/path.txt]` writes the deterministic output to a safe repository-relative path.

The shim sanitizes write paths, supports Codex session output arguments, and is excluded from `mockup-cli`, which has its own built-in deterministic provider path.

### E2E Authoring Rules

Purpose-grouped E2E specs should prepare normal app state through `tests/e2e/helpers/prepare-app.ts` before loading pages that depend on onboarding, project selection, sprints, or tasks. The helper layer uses the dashboard HTTP APIs, not direct database writes or shell commands, and creates per-run local project fixtures under the OS temp directory with names prefixed by the Playwright worker and a timestamp-safe run suffix.

- Use `completeOnboarding`, `ensureSelectedProject`, `createDraftSprint`, and `createTaskInSprint` for setup instead of hand-writing setup requests in each spec.
- Use `suppressDashboardTour(page)` before loading pages that would otherwise show the guided dashboard tour. It installs the same localStorage key through an init script so reloads and first navigations are stable.
- Use the exported REST helpers such as `createProjectViaApi`, `createTaskViaApi`, and `deleteTaskViaApi` when a suite needs direct public-API fixture setup without adding new protocol shapes.
- Use unique fixture keys and generated names from the helper utilities so parallel workers and retries do not collide.
- Use `tests/e2e/helpers/e2e-fixtures.ts` when a browser test needs a real temporary git repository, local HOST execution settings, fake provider dispatch, or API polling. `createTemporaryGitRepository` initializes an OS-temp Git repo on `main`, configures a local test identity, commits fixture files, and exposes safe relative file writes plus cleanup. `seedSelectedCodeUxProject` and `prepareSelectedLocalGitProject` complete onboarding, create a local project through public APIs, configure project settings for local-git `HOST` execution, select that project, and delete both the project record and temp repository during cleanup.
- Use `configureProjectForLocalHostExecution` only for fake-provider E2E projects. It disables remote Git/CI/QA/preview automation, routes worker profiles to the Codex shim, sets local Git mode, and relies on `CODEUX_E2E_PROVIDER_CLI_SHIM` for the settings sanitizer to keep `HOST` execution.
- Clean runtime state with the fixture cleanup functions in `afterEach`: delete tasks/sprints/projects through public APIs, remove temporary repositories, and let the isolated HOME expire with the Playwright server process.
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

The automatic Playwright gate is part of `.github/workflows/ci.yml`, named `Code UX CI Pipeline`. During the dev-first rollout it runs from the shared build artifact so E2E coverage validates the same compiled app used by package smoke, orchestration, and release-candidate packaging.

The automatic E2E stage has one shared job template. `09 E2E / <os> full` fans out across Linux, macOS, and Windows, and each OS runs all purpose projects (`navigation`, `settings`, `projects`, `tasks`, `agents`, and `config`) with `max-parallel: 3`. Every shard downloads `codeux-build-linux`, installs Chromium with browser binaries cached under `.cache/ms-playwright`, installs Linux Chromium system dependencies only on Linux runners with `pnpm exec playwright install-deps chromium`, runs `pnpm exec playwright test --project=<purpose>` directly, and uploads `test-results/` plus `playwright-report/` for seven days. Artifact names use `playwright-<runner>-<purpose>` for every OS.

The manual `.github/workflows/playwright.yml` workflow is now `Playwright Diagnostics`. It remains available for full OS/project reruns and uploads `playwright-diagnostic-<runner>-<purpose>` artifacts, but it does not run automatically on pull requests.

This lane is credential-free. It validates the compiled dashboard and server, including deterministic fake-CLI orchestration coverage, without provider keys, real provider CLIs, Docker provider startup, remote Git infrastructure, or real project state.

OS-specific caveats:

- Build paths with `path.join`, `path.resolve`, and URL encoding instead of hard-coded `/` separators; fixture helpers accept both POSIX and Windows separators when validating safe relative paths.
- Browser file inputs need real temporary files created with Node `fs` APIs; do not depend on shell-specific paths, quoting, or glob expansion.
- Spawn shell commands with explicit command/argument arrays. On Windows, prefer resolving package-manager shims to their Node-run CLI entrypoints when a script spawns npm or pnpm directly, as `scripts/e2e/run-playwright.mjs` does for pnpm.
- Linux CI installs Chromium system packages separately. Local Linux failures that mention missing shared libraries usually need `pnpm exec playwright install-deps chromium`; macOS and Windows normally only need `pnpm exec playwright install chromium`.

### E2E Troubleshooting

- Stale sprint runs: use a fresh `pnpm run test:e2e` invocation so Playwright creates a new temporary HOME and app database. Within specs, delete created tasks, sprints, and projects through fixture cleanup helpers instead of reusing state from a previous run.
- Stuck fake CLI processes: inspect the spec for long `[mock-provider:sleep=...]` markers, canceled dispatches, or a crashed Playwright server. Stop orphaned `node dist/index.js` and `mock-provider-cli.mjs` processes, then rerun the focused spec.
- Missing build artifacts: if Playwright reports that `dist/index.js` cannot be found, run `pnpm run build` before `pnpm run test:e2e`. CI stores `.cache/tsc/` only inside the same OS build artifact as `dist/` and `dashboard/dist/`, so incremental TypeScript state is never restored without its matching emitted output.
- Accidental real-provider execution: verify `CODEUX_E2E_PROVIDER_CLI_SHIM` is present in the Playwright server environment and that the project was configured through `configureProjectForLocalHostExecution`. If that env var is absent, the sanitizer returns to Docker execution and provider command specs use real CLI binaries.

- Run the local release install verifier
```bash
node scripts/verify-release-install.mjs
```

The release install verifier builds the workspace, creates a local npm tarball with `npm pack --ignore-scripts`, installs that tarball into a temporary isolated npm project, verifies the local `node_modules/.bin/codeux` shim exists, and runs the installed package's `codeux --help` bin target directly through Node. That keeps the smoke check pinned to the tarball install and avoids npm registry package resolution. On Windows, the verifier invokes package-manager CLI JavaScript entrypoints through Node when available instead of spawning `.cmd` shims directly. Set `CODE_UX_KEEP_RELEASE_INSTALL_TEMP=1` when diagnosing a failed run and you need to inspect the temporary package or install directory.

CI may set `CODE_UX_SKIP_RELEASE_INSTALL_BUILD=1` after downloading the compiled build artifact. In that mode the verifier refuses to continue unless `dist/index.js`, `dist/worker/index.js`, and `dashboard/dist/` are already present, then it packs and installs the artifact-backed workspace without rebuilding.

### CI Pipeline Policy

The automatic GitHub lane is `.github/workflows/ci.yml`, named `Code UX CI Pipeline`. During the CI refactor rollout it runs on pushes to `dev` and `main`, pull requests targeting any branch, and manual dispatches so the main-grade lane can stabilize on `dev` before the final trigger shape is tightened.

The lane is intentionally numbered and staged:

- `01 Preflight / release policy` keeps the main-PR version bump gate strict. Pull requests targeting `main` must increase `package.json` above the base version; ordinary `dev` integration PRs are not blocked by the release version rule.
- `02` through `06` run the fast core checks after preflight: quality guardrails plus backend/dashboard typecheck, server/dashboard build, backend coverage, dashboard Vitest, and security audit. These are the first runner burst and are designed around a six-runner budget.
- `03 Build` uploads one `codeux-build-linux` artifact containing `dist/`, `dashboard/dist/`, and TypeScript cache output.
- `07 Package` verifies the npm tarball install from that build artifact with `CODE_UX_SKIP_RELEASE_INSTALL_BUILD=1`.
- `08 Orchestration` runs one shared OS matrix from the build artifact: Linux validates the Docker-backed mockup DAG, while macOS and Windows validate the same DAG through the Electron app.
- `09 E2E` runs Playwright from the build artifact with one shared matrix template across Linux, macOS, and Windows. Every OS runs all six project groups (`navigation`, `settings`, `projects`, `tasks`, `agents`, and `config`) with `max-parallel: 3`.
- `10 Release Candidate` starts after `07 Package` verifies the artifact-backed npm install, then builds unsigned Linux, macOS, and Windows desktop packages with `--publish never` beside the active E2E and orchestration matrices.

The former standalone `Playwright Tests`, `Release Checks`, and `Mockup Sprint Orchestration` workflows are now manual diagnostics only: `Playwright Diagnostics`, `Release Candidate Diagnostics`, and `Mockup Sprint Diagnostics`. They remain useful for focused reruns, but the automatic PR signal comes from the numbered `Code UX CI Pipeline`.

### Main Release Version Gate

The `Code UX CI Pipeline` includes a strict preflight version gate for pull requests targeting `main`. It compares `package.json` on the PR head with the target `main` commit and fails unless the head version is a valid semver patch/minor/major increase. This keeps release promotions from merging to `main` without a package version bump while leaving ordinary `dev` integration PRs unaffected.

Local reproduction commands:

```bash
pnpm run build
node scripts/verify-release-install.mjs
pnpm exec playwright test --project=projects tests/e2e/projects/project-setup-release.spec.ts
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

### Mockup Sprint Orchestration Policy

The credential-free mockup sprint orchestration gate is part of `.github/workflows/ci.yml`. Its `08 Orchestration / <runtime> DAG` job is a shared OS matrix that runs after the shared build artifact is available. Linux runs `pnpm run test:orchestration:ci-dag:run`, so the deterministic 10-task DAG executes through Docker-backed provider workspaces without provider secrets and without rebuilding the app.

The macOS and Windows entries in the same `08 Orchestration` matrix run `pnpm run test:orchestration:ci-dag:electron:run`. Those jobs install the cached Electron binary, rebuild native dependencies, launch `dist/electron/main.js`, wait for the embedded Code UX server, and run the host-execution mockup fixture. GitHub-hosted Windows and macOS runners do not provide Docker job containers, so the native Electron entries validate desktop orchestration while Ubuntu remains the Docker-backed orchestration gate.

The manual `.github/workflows/mockup-sprint-orchestration.yml` workflow remains available as `Mockup Sprint Diagnostics` for focused orchestration reruns. The fast `test:orchestration:rapid` lane remains available for local unit-level regression checks, while the compiled `test:orchestration:full` catalog and heavy `test:orchestration:pentest` lane remain manual escalation tools.

Use [Mockup Sprint Pentest](./mockup-sprint-pentest.md) for local commands, CI trigger and artifact policy, covered scenarios, and the distinction between this no-secret lane and the credentialed OpenRouter validation lane.

- Build backend and dashboard
```bash
pnpm run build
```
  - The build script intentionally runs toolchain commands directly (`tsc`, dashboard typecheck, `vite build`) instead of nested package-manager calls to keep child-process overhead and command noise down.
  - Dashboard type validation uses incremental `.tsbuildinfo` files in `.cache/tsc/`, but the server emit intentionally runs non-incrementally so release and Electron packaging always regenerate every `dist/` runtime module before `npm pack`.
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
