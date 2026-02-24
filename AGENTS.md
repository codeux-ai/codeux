# Repository Guidelines

## Project Overview
This project is a production-grade **Model Context Protocol (MCP)** server for the **Jules Agent API**. It enables LLMs to interact with Jules for codebase management, agent session creation, and intelligent sprint orchestration.

### Core Intent
- Expose a reliable MCP interface for orchestrating Jules Agent workflows.
- Support robust codebase operations and multi-step sprint execution paths.
- Maintain production-grade quality through strict typing, testing, and CI gates.

## Project Structure & Module Organization
- `src/index.ts`: Main MCP server entrypoint (tool registration, Jules API integration, sprint orchestration logic).
- `dashboard/`: Static Preact dashboard served by Express.
- `dashboard/src/components/`: UI components (`TaskCard.tsx`, `StatsGrid.tsx`, etc.).
- `dist/`: Compiled TypeScript output used at runtime (`npm run build`).
- `.jules-subagents/`: Local agent settings/guides (runtime config overrides).
- `.env` / `.env.example`: API key and local environment settings.
- `tests/` and `src/**/*.test.ts(x)`: Unit/integration tests (Vitest).
- `.github/workflows/`: CI pipelines (build, typecheck, lint, test, coverage gates).

## Build, Test, and Development Commands
- `npm install`: Install dependencies.
- `npm run dev`: Run server from source via `ts-node-esm`.
- `npm run build`: Compile TypeScript from `src/` to `dist/` with zero type errors.
- `npm run typecheck`: Run strict TypeScript validation without emit.
- `npm run lint`: Run linting for TypeScript and frontend code.
- `npm run test`: Run Vitest test suite once (CI mode).
- `npm run test:watch`: Run Vitest in watch mode for local development.
- `npm run test:coverage`: Generate coverage report and enforce thresholds.
- `npm run ci`: Run the full local CI equivalent (`lint`, `typecheck`, `test`, `build`).
- `npm start`: Run compiled server from `dist/index.js`.
- `node dist/index.js --api-key <KEY>`: Quick runtime verification after build.

## Coding Style & Naming Conventions
- Language: full TypeScript across server and dashboard (no new plain JS modules).
- Type declarations:
  - Enable strict compiler options and avoid `any` unless documented and justified.
  - Define shared domain types in dedicated modules (for example `src/types/`).
  - Add explicit return types for exported functions and public APIs.
- Indentation: 2 spaces in TypeScript and TSX unless file-local conventions require otherwise.
- Naming:
  - `camelCase` for variables/functions.
  - `PascalCase` for classes/types/components.
  - `SCREAMING_SNAKE_CASE` for env-like constants when appropriate.
- Keep modules focused; place reusable UI logic in `dashboard/src/components/` or `dashboard/src/utils.ts`.
- Enforce formatting/linting through repository scripts and CI.

## Testing Guidelines
- Test framework: Vitest for unit and integration tests.
- Every functional change must include or update tests for behavior and edge cases.
- Minimum validation for each change:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
- For dashboard changes, also verify `http://localhost:4444` loads and `/api/status` responds.
- Prefer deterministic tests, clear fixtures, and minimal mocking.
- Maintain meaningful coverage (target: 80%+ lines/branches for critical modules unless explicitly exempted).

## CI/CD & Quality Gates
- All pull requests must pass automated CI before merge.
- Required CI checks:
  - Install, lint, typecheck, test, build.
  - Coverage upload and threshold enforcement.
  - Dependency vulnerability scan (`npm audit --audit-level=high` or equivalent SCA check).
  - Secret scanning on commits and pull requests.
  - Fail fast on TypeScript errors, lint violations, or test failures.

## Commit & Pull Request Guidelines
- Follow Conventional Commits used in history: `feat: ...`, `fix: ...`, `docs: ...`, `style: ...`.
- Keep commits scoped to one change and use imperative, concise summaries.
- Branching policy:
  - Always create and work from a feature branch (never commit directly to `main`).
  - Use descriptive branch names such as `feat/<scope>`, `fix/<scope>`, or `chore/<scope>`.
  - Merge changes into `main` only via pull requests after required CI checks pass.
  - Use GitHub CLI (`gh`) for PR workflow when available (for example `gh pr create`, `gh pr view`, `gh pr merge`).
- PRs should include:
  - What changed and why.
  - Linked issue/task (if available).
  - Verification steps and results (`npm run ci` output summary).
  - Dashboard screenshots/GIFs for UI changes.
  - Risk/rollback notes for impactful changes.

## Collaboration Workflow
- Default working flow for our collaboration:
  - Start every change on a new feature branch.
  - Implement and validate locally (`npm run build` minimum; `npm run ci` preferred).
  - Open a PR to `main` using GitHub CLI.
  - Monitor CI continuously after opening the PR.
  - Merge only through PR after all required CI checks pass without errors.
  - Delete merged feature branches to keep the branch list clean.

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
- Never commit real API keys; use `.env` locally and keep `.env.example` sanitized.
- Prefer `JULES_API_KEY` over hardcoded flags in shared scripts.
- Use `.jules-subagents/settings.json` for project-specific behavior (for example `maxFailures`).
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
Jules API: https://developers.google.com/jules/api/reference/rest
