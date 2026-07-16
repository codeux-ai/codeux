# Testing & quality gates

Code UX uses **Vitest** as its single test runner across server and dashboard. CI gates enforce coverage thresholds and a full clean build.

## Layout

```
tests/
├── backend/         # server / orchestrator / mcp tests
├── dashboard/       # Preact component tests
└── e2e/             # Playwright browser tests against dist/index.js

src/**/*.test.ts     # co-located unit tests
```

The Vitest config is at `vitest.config.ts`. Test environment is **Node** (not jsdom) by default; dashboard tests opt into `happy-dom` per file.

## Running tests

```bash
pnpm run test                   # full suite, single run
pnpm run test:watch             # watch mode
pnpm run test:backend           # backend only
pnpm run test:dashboard         # dashboard only
pnpm run test:e2e               # Playwright E2E against the compiled app
pnpm run test:coverage          # full coverage with thresholds
pnpm run test:backend:coverage  # backend coverage with thresholds
npx vitest run tests/backend/smoke.test.ts # single file
```

Build before Playwright from a clean checkout:

```bash
pnpm run build
pnpm exec playwright test --project=navigation
```

`pnpm run test:e2e` is a wrapper around `pnpm exec playwright test`; it chooses an isolated dashboard/MCP port pair and exports `CODEUX_E2E_DASHBOARD_PORT` before Playwright starts `node dist/index.js`. The Playwright config starts the compiled server, waits on the local `/health` liveness probe, and runs against a temporary HOME/USERPROFILE/XDG home so the suite does not depend on a developer's browser cache, onboarding state, selected project, or real Code UX database. The compiled server receives the resolved value as `DASHBOARD_PORT` and `MCP_HTTP_PORT`, plus `CODEUX_E2E_PROVIDER_CLI_SHIM`, which points at `scripts/e2e/mock-provider-cli.mjs`. It disables MCP stdio and the MCP HTTP gateway, so the inherited Playwright stdin pipe cannot become an MCP transport during browser-only tests. Provider command specs only use that fake provider when the explicit shim env var is present. The shim also uses the fixture's configured provider concurrency without production adaptive resource throttling, keeping DAG assertions deterministic across runners with different CPU counts. The E2E suite is local-only: tests must navigate through `baseURL` routes or local API probes, not external websites. Failure artifacts are retained under `test-results/`, and the HTML report is written to `playwright-report/`; CI uploads both paths per OS and purpose group so traces, videos, screenshots, and reports are available when failures occur.

The isolated loopback runtime uses normal automatic local-file credential custody under its temporary home. Do not inject a mounted-key fixture into the shared runtime: POSIX mode emulation differs on Windows, while automatic custody follows the supported platform ownership checks. Unavailable-custody specs start a separate explicit-provider runtime. Specs that create durable shared-server records must delete them in `afterEach` so retries cannot inherit duplicate fixtures. Route effects must also abort pending requests during cleanup; expected navigation cancellation must not become a browser console error or update an unmounted route.

The release-install verifier installs the packed tarball with the upstream optional ONNX CUDA/TensorRT download disabled, then imports `onnxruntime-node` from the clean install to prove its bundled CPU native runtime loads. The npm package smoke therefore remains independent of NuGet availability while retaining native-runtime validation.

The explicit local-only `pnpm run test:orchestration:extreme-dag` lane runs a deterministic 400-task DAG with task and sprint QA, a QA coding follow-up, routed CI repair, eight full runtime restarts, and a hard 16-worker ceiling. It is intentionally excluded from CI and the normal pentest catalog. Its resource artifact enforces runtime RSS, application/session database and WAL growth, bounded failed-attempt amplification, zero final leaked non-running containers across all Docker states, separate task/sprint QA prompt policies, task-run/event/invocation growth, and exact terminal ordering.

`playwright.config.ts` keeps `testDir: './tests/e2e'` and defines purpose projects selected by directory glob: `navigation`, `settings`, `projects`, `tasks`, `agents`, and `config`. Add new E2E specs under `tests/e2e/<purpose>/` so suites can grow without editing the config. Use `pnpm exec playwright test --list` to confirm discovery, or `pnpm exec playwright test --project=tasks` to run one group. The `navigation` project includes Docs page smoke coverage for exactly five routes: `/docs`, the docs overview, and three representative user/developer/architecture pages.

In GitHub Actions, `.github/workflows/playwright.yml` builds once per OS, uploads `dist/`, `dashboard/dist/`, and `.cache/tsc/` together as an OS-scoped artifact, then runs each purpose project in parallel against the restored build. A separate npm-package job packs the package, verifies its explicit bundled `.code-ux` allowlist excludes local logs, databases, and environment files, installs the tarball into a clean project, and runs the installed CLI help command independently of the source checkout.

Use `tests/e2e/helpers/prepare-app.ts` and `tests/e2e/helpers/e2e-fixtures.ts` for deterministic browser tests that need onboarding completion, dashboard tour suppression, selected Code UX projects, public-API sprint/task seeding, temporary git repositories, local-git HOST execution, QA-disabled project settings, or API polling. The fake provider supports prompt markers such as `[mock-provider:sleep=250]`, `[mock-provider:fail]`, `[mock-provider:exit=2]`, `[mock-provider:no-op]`, and `[mock-provider:write=relative/path.txt]`.

`tests/e2e/projects/filesystem-persistence.spec.ts` covers host filesystem persistence for instruction-file saves, local-directory browsing, sanitized traversal rejection, and Settings Appearance background-image uploads. The Playwright server exposes the OS temp directory through `CODE_UX_DIRECTORY_BROWSER_ROOTS` so temporary git fixtures can be browsed without Docker-backed file-browser sessions. `tests/e2e/navigation/dashboard-workflows.spec.ts` covers the pre-orchestration product path: isolated local-git project selection, UI draft sprint creation, UI task creation with dependencies, core route landmarks, collection API visibility, and unhandled browser error capture without starting planning or provider execution.

## Coverage thresholds

Enforced in CI:

| Metric | Threshold |
| --- | --- |
| Lines | **77.4%** |
| Functions | **71.5%** |
| Branches | **66.1%** |
| Statements | **76.0%** |

Per-file gate:

| File | Min line coverage |
| --- | --- |
| `src/server/activity-cache-service.ts` | 80% |

A failing threshold fails CI.

## Test patterns

- **`vi.mock()`** for module-level mocks.
- **`vi.spyOn()`** for verifying calls without replacing the implementation.
- **`vi.useFakeTimers()`** is the standard for cycle / watch-loop tests — wall-clock waits are otherwise prohibitively slow.
- **In-memory repositories** for orchestrator integration tests rather than spinning up Postgres.
- **Supertest** for HTTP route tests against the Express app.

Automatic base-agent update regressions are covered by `tests/backend/integration/agent-base-update-invocation.test.ts`. Keep that harness on the real `AgentBaseUpdateService` → `StructuredAgentRequestService` → `StructuredProviderResponseService` → `AgentPresetSyncService` path, with only the provider execution boundary replaced by deterministic output. The suite must continue to verify the `planning` / `agent_base_update` invocation contract, same-session parse retries at the configured cap, and that parse or provider failures leave both instruction markdown and the stored bundled-revision baseline untouched.

## Writing new tests

A behavioural change *must* include or update tests. PRs without test coverage for non-trivial logic will be requested-changes in review.

For shared QA or CI card behavior, run `pnpm exec vitest run tests/dashboard/v2/qa-ci-card-status.integration.test.tsx`. This deterministic suite passes one review and execution snapshot through the real Task, Live, and Sprint page projections before rendering the Task, Live, Sprint gallery, and Sprint ledger cards. It covers accessible labels, keyboard-only details and follow-up expansion, failure recovery, attention precedence, unrelated-event isolation, Escape focus restoration, and reconnect replay without Docker, provider CLIs, Git hosting, or a live database.

Conventions:

- File naming: `*.test.ts` co-located with the unit under test, or under `tests/backend/<feature>/`.
- One `describe` per public function or surface; one `it` per scenario.
- Avoid snapshots for non-trivial outputs; prefer explicit assertions.
- Use fixtures from `tests/fixtures/` rather than inline mega-objects.
- Chat composer persistence regressions should cover backend user/project isolation plus dashboard remount restoration and ArrowUp/ArrowDown history traversal using deterministic fixtures instead of timing-dependent debounce waits.

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

`quality:guardrails -> audit -> lint -> test:backend:coverage -> test:dashboard -> build`

If `pnpm run ci` is green, GitHub CI will be too (modulo platform-specific differences).

## CI pipeline (GitHub Actions)

The canonical automatic lane is `.github/workflows/ci.yml`, named `Code UX CI Pipeline`. It runs the core numbered jobs for pushes to every branch and for pull requests targeting `dev` or `main`; the full browser and release matrices run only for `main` validation and manual dispatches.

It is staged as:

1. `01 Preflight / release policy`: strict version bump gate for pull requests targeting `main`.
2. `02 Static`, `03 Build`, and `04 Security`: prerequisite type/guardrail, build, and audit checks.
3. `05 Backend`, `06 Dashboard`, `07 Package`, and `08 Orchestration`: run in parallel after those prerequisites. The orchestration matrix includes Linux Docker and macOS/Windows Electron on feature branches, `dev`, and `main`.
4. `09 Docs / five-page smoke`: loads the Docs index, its overview route, and three representative pages on Linux for every target branch. It fails on HTTP, console, or page errors without crawling all subpages.
5. `09 E2E`: full Playwright on Linux, macOS, and Windows only for `main` validation and manual dispatches.
6. `10 Release Candidate`: unsigned desktop release-candidate packages with `--publish never`, only for `main` validation and manual dispatches. Every native row installs its finished `.deb`, NSIS `.exe`, or DMG app, starts the installed copy with isolated state, and requires packaged backend and renderer readiness plus a clean exit before upload.

The main branch ruleset still includes historical context names from older CI numbering and matrix definitions. Compatibility aggregate jobs emit those names only after the corresponding current backend, dashboard, audit, package, orchestration, 18-shard E2E, or desktop release-candidate gate succeeds. They preserve branch-protection compatibility without replacing any current validation job and can be removed once a repository administrator cleans up the obsolete ruleset entries.

`Playwright Diagnostics`, `Release Candidate Diagnostics`, and `Mockup Sprint Diagnostics` are manual-only rerun workflows. A PR cannot be merged with red CI.

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
