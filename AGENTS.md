# Repository Guidelines

## Project Overview
**Code UX** (`@codeuxai/codeux`, bin `codeux`) is a local-first, MIT-licensed, **container-first agentic coding runtime**. It turns a feature/refactor/migration/QA/CI-repair goal into a managed **sprint**: planned into a dependency-aware DAG, routed to a provider, executed in isolated Docker workspaces, gated through Git/CI, and surfaced in a live Preact dashboard. It also runs as an **MCP server** (stdio + optional HTTPS worker gateway) and ships as an **Electron desktop app**.

> Historical note: this began as a Jules MCP server. **Jules is now one (hosted) provider** among several local CLI providers (Gemini, Codex, Claude Code, Qwen, OpenCode, Antigravity). Do not treat the codebase as Jules-specific.

### Core Intent
- Coordinate the provider CLIs developers already use, each in an isolated Docker workspace.
- Move repetitive operational work (branching, dependency ordering, CI polling, merge gates, conflict repair) into deterministic software instead of model reasoning.
- Maintain production-grade quality through strict typing, testing, and CI gates.

## Project Structure & Module Organization
- `src/index.ts`: CLI + MCP server entrypoint; `src/server/code-ux-server.ts` wires the backend; `src/worker/index.ts` is worker-host mode; `src/electron/main.ts` is the desktop shell.
- `src/domain/`, `src/sprint/`: sprint orchestration (DAG scheduling, watch loop, CI gating, QA).
- `src/services/`, `src/infrastructure/providers/cli/`: provider execution in Docker, CLI workflow, git, previews.
- `src/repositories/` (incl. `db/`): data access over **SQLite** (`~/.code-ux/app.db`, WAL, `node:sqlite`). Sprint subtasks round-trip to markdown with YAML frontmatter in each project's `.code-ux/` dir.
- `src/contracts/`: shared domain + MCP tool types.
- `dashboard/`: Preact + Tailwind v4 UI (current UI in `dashboard/src/v2/`), served on `:4444`.
- `dist/`: compiled output (`pnpm run build`). `.env` / `.env.example`: local env (most config is set in the dashboard and stored in the DB).
- `tests/` and dashboard `__tests__/`: Vitest suites. `.github/workflows/`: CI pipelines.

## Build, Test, and Development Commands
Package manager is **pnpm** (`pnpm@10.33.0`), Node **22+**. Use `pnpm`, not `npm`.
- `pnpm install`: Install dependencies.
- `pnpm run dev`: Run server from source (`node --import ./scripts/tsnode-register.mjs src/index.ts`).
- `pnpm run build`: server `tsc` + dashboard typecheck + `vite build`.
- `pnpm run typecheck` / `pnpm run lint`: strict `tsc --noEmit` (the two are the same command).
- `pnpm run test`: full Vitest run. `pnpm run test:backend` / `pnpm run test:dashboard`: scoped suites.
- `pnpm run test:watch`: watch mode. `pnpm run test:coverage`: coverage with threshold enforcement.
- `pnpm run ci`: local CI equivalent (`lint` → `test:backend:coverage` → `test:dashboard` → `build`).
- `pnpm run audit`: `pnpm audit --audit-level=high`.
- `pnpm start`: run compiled `dist/index.js`. `node dist/index.js --help`: list CLI flags / env vars.
- Electron: `pnpm run electron:dev`, `pnpm run electron:dist[:linux|:mac|:win]`.

## Coding Style & Naming Conventions
- Language: full TypeScript across server and dashboard (no new plain JS modules).
- Type declarations:
  - Enable strict compiler options and avoid `any` unless documented and justified.
  - Define shared domain types in dedicated modules (for example `src/contracts/`).
  - Add explicit return types for exported functions and public APIs.
- Indentation: 2 spaces in TypeScript and TSX unless file-local conventions require otherwise.
- Naming:
  - `camelCase` for variables/functions.
  - `PascalCase` for classes/types/components.
  - `SCREAMING_SNAKE_CASE` for env-like constants when appropriate.
- Keep modules focused; place reusable UI logic/components in `dashboard/src/v2/`.
- Enforce formatting/linting through repository scripts and CI.

## Testing Guidelines
- Test framework: Vitest for unit and integration tests.
- Every functional change must include or update tests for behavior and edge cases.
- Minimum validation for each change:
  - `pnpm run lint`
  - `pnpm run test:backend` (and `pnpm run test:dashboard` for UI changes)
  - `pnpm run build`
- For dashboard changes, also verify the dashboard loads at `http://localhost:4444`.
- Default test env is Node; UI tests opt into jsdom via `@vitest-environment` pragmas. Tests use an in-memory DB (`VITEST_IN_MEMORY_DB=true`). Mock external boundaries (provider CLIs, Docker, FS, Jules API).
- Prefer deterministic tests, clear fixtures, and minimal mocking.
- Coverage thresholds (vitest.config.ts, ratchet-only — never lower): lines 73.2%, functions 67.5%, branches 61.13%, statements 72.0%; `src/server/activity-cache-service.ts` has an 80% line gate.

## CI/CD & Quality Gates
- All pull requests must pass automated CI before merge.
- Required CI checks:
  - Install, lint, typecheck, test, build.
  - Coverage upload and threshold enforcement.
  - Dependency vulnerability scan (`pnpm audit --audit-level=high`).
  - Secret scanning on commits and pull requests.
  - Fail fast on TypeScript errors, lint violations, or test failures.

## Commit & Pull Request Guidelines
- Follow Conventional Commits used in history: `feat: ...`, `fix: ...`, `docs: ...`, `style: ...`.
- Keep commits scoped to one change and use imperative, concise summaries.
- Branching policy:
  - `dev` is the integration branch. Always create and work from a feature branch off `dev` (never commit directly to `dev` or `main`).
  - Use descriptive branch names such as `feat/<scope>`, `fix/<scope>`, or `chore/<scope>`.
  - Merge changes into `dev` only via pull requests after required CI checks pass (not into `main`).
  - Push branches to `origin` (the `numnx/codeux` fork) and target it for PRs. `upstream` is `codeux-ai/codeux` — do not push or PR there unless explicitly asked.
  - Use GitHub CLI (`gh`) for PR workflow when available (for example `gh pr create --base dev`, `gh pr view`, `gh pr merge`).
- PRs should include:
  - What changed and why.
  - Linked issue/task (if available).
  - Verification steps and results (`pnpm run ci` output summary).
  - Dashboard screenshots/GIFs for UI changes.
  - Risk/rollback notes for impactful changes.
 - PR review protocol (mandatory before merge):
  - Always review both comment streams:
  - `gh pr view <number> --comments` (issue-style comments).
  - `gh api repos/<owner>/<repo>/pulls/<number>/comments` (inline code review comments/suggestions).
  - Add 👀 reaction to comments currently being reviewed.
  - After implementing fixes, reply on addressed inline comments and add ✅ reaction before merging.

## Release Notes Formatting
When creating or editing a GitHub Release, use polished user-facing release notes rather than raw PR summaries. The release notes must be accurate to the final tag and should be easy to skim on GitHub.

Required format:

````md
## Code UX X.Y.Z

One short paragraph describing the release theme and linking the release PR.

### Release Snapshot

| Item | Details |
| --- | --- |
| Version | `X.Y.Z` |
| Release commit | `<full commit sha>` |
| Release PR | [#NNNN](https://github.com/codeux-ai/codeux/pull/NNNN) |
| Included dev sync | [#NNNN](https://github.com/codeux-ai/codeux/pull/NNNN) |
| Scope | N files changed across <main areas> |

## What’s New

### <Feature Area>

One concise sentence explaining the area.

- User-facing capability or meaningful operational improvement.
- Another feature or enhancement.

## Fixes

### <Fix Area>

- Fixed <specific bug/regression/security issue> and its user-visible impact.
- Fixed <specific operational or developer workflow issue>.

## Validation

| Check | Result |
| --- | --- |
| Typecheck & Lint | Passed |
| Backend Tests & Coverage | Passed |
| Dashboard Tests | Passed |
| Security Audit | Passed |
| Playwright E2E | Passed |
| CodeQL Analysis | Passed |

Additional local validation, if any:

```bash
pnpm run lint
pnpm run test:backend
pnpm run build
```

## Known Follow-Up

- Clear, non-alarming follow-up item with the reason it was deferred.
````

Release note rules:
- Always include both `## What’s New` and `## Fixes`.
- Put new capabilities, performance work, and major behavior changes under `What’s New`.
- Put bugs, regressions, CI repairs, security hardening, and operational reliability repairs under `Fixes`.
- Keep bullets concrete and outcome-focused; avoid internal-only commit wording such as "refactor module X" unless it changes reliability, performance, or maintainability in a meaningful way.
- Use a `Release Snapshot` table with exact version, commit, PR links, and scope.
- Use a `Validation` table for GitHub checks; mention local validation separately.
- Include `Known Follow-Up` for deferred alerts, incomplete hardening, or intentional post-release work.
- Avoid emojis in release notes unless the project explicitly adopts them later.
- Do not claim a check passed unless it actually passed for the release PR or was run locally.

## Collaboration Workflow
- Default working flow for our collaboration:
  - Start every change on a new feature branch off `dev`.
  - Implement and validate locally (`pnpm run build` minimum; `pnpm run ci` preferred).
  - Open a PR into `dev` against the `origin` (`numnx/codeux`) fork using GitHub CLI.
  - Monitor CI continuously after opening the PR.
  - Merge only through PR after all required CI checks pass without errors.
  - Delete merged feature branches to keep the branch list clean.

## Local Dev Access (this environment)
- **Full access to the database and environment.** The runtime DB is `~/.code-ux/app.db` (SQLite, WAL); read/write it as needed via `node:sqlite`. You may inspect and modify environment state.
- **Restart the dev server on port 4444 anytime.** The dashboard/backend runs there; restart it (e.g. `pnpm run dev`) whenever a change needs to take effect — no need to ask first.
- **Run test sprints in the project "Simple Test 2".** It is wired to a local model for testing, so dispatching sprints/tasks there is safe and expected. Use it for end-to-end orchestration checks; do not run experimental sprints against real projects.

## Documentation Workflow (Mandatory)
- Documentation source of truth lives in `docs/` with the main entrypoint at `docs/index.md`.
- The assistant must read relevant documentation at any time during task execution, especially before architectural or behavioral changes.
- After each finished task, the assistant must extend or rewrite the affected documentation pages so docs remain current with code behavior.
- If a new feature or subsystem is introduced, add a dedicated page under the correct `docs/` section and link it from both `docs/index.md` and `docs/SUMMARY.md`.

## Frontend Design Quality
- Treat dashboard UX as production-grade: polished, accessible, and visually distinctive.
- Avoid generic UI defaults; use intentional typography, spacing, color systems, and interaction states.
- Meet accessibility baselines (semantic HTML, keyboard navigation, visible focus states, color contrast).
- Keep responsive behavior first-class for desktop and mobile layouts.
- Prefer reusable design tokens/components over one-off styling.

## Technical Standards for Preact App
- Do not install external libraries beyond dependencies that already exist in the project.
- Build modular, high-quality in-house modules for core features (small, testable, reusable).
- Keep app bundle size as low as possible (code splitting, dead-code avoidance, lean assets).
- Treat award-winning design as the quality target for UX, visuals, and interactions.
- Use Tailwind as the default styling approach (no additional UI styling frameworks).

## Security & Configuration Tips
- Never commit real provider keys; keep `.env.example` sanitized. Most provider config is set from the dashboard and stored in the DB, not env vars — the runtime can start with no keys.
- `JULES_API_KEY` applies only to the Jules provider. Never hardcode it in shared scripts.
- Per-project runtime artifacts live in each repo's `.code-ux/` dir; global state is `~/.code-ux/app.db`.
- Validate and type environment variables at startup to fail fast on misconfiguration.

## Operational Reliability Guardrails
- Add request correlation IDs and structured logs for all server and tool execution paths.
- Maintain `/health` (liveness) and `/ready` (readiness) endpoints for runtime checks.
- Define SLOs for MCP response latency and error rate; alert on sustained breaches.
- Include rollback steps for production-impacting PRs and incident notes in postmortems.

## Code Quality Guardrails
- Require zero new ESLint warnings in changed files.
- Block merges on flaky tests until stabilized or quarantined with owner and follow-up issue.
- Prefer small PRs (target: <400 changed lines excluding generated files) for review quality.
- For API/tool contract changes, add integration tests covering success, validation failure, and timeout/error paths.

# API References:
- Jules API (hosted provider): https://developers.google.com/jules/api/reference/rest
- Architecture: `docs/architecture/system-overview.md`, `docs/architecture/repository-map.md`
- MCP surface: `docs/mcp/tools-and-contracts.md`, `docs/mcp/runtime-and-dispatch.md`
- Orchestration loop: `docs/sprint-loop/atomic-loop.md`. Design system: `STYLEGUIDE.md`.
