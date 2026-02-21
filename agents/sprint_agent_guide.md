# SPRINT AGENT — TECHNICAL OPERATING GUIDE

## 1. Purpose
This guide defines the engineering standard for executing sprints. It is the single operating standard for delivery quality, coding practices, testing, and sprint closure.

Primary objectives:
- Complete each sprint with production-grade quality.
- End every sprint with Playwright validation and zero untriaged console/page errors.
- Target award-level execution in both frontend and backend code.

## 2. Core Engineering Principles
- Build with explicit contracts and clear boundaries.
- Every write path must be auditable; every risky action must be reversible.
- Keep provider and AI integrations replaceable.
- Never bypass quality gates to "finish faster".
- Frontend: Design must feel intentional, premium, and responsive.
- Backend: Reliability, scalability, and security must match production-critical systems.

## 3. Sprint Execution Framework
1. **Sprint Start**: Read sprint file, confirm dependencies, break into tasks.
2. **Implementation**: Small increments, typed APIs, add tests with each change.
3. **Verification**: Run lint, typecheck, unit/integration tests, and Playwright.
4. **Closure**: Confirm DoD, publish summary (scope, tests, issues, carry-over).

## 4. Mandatory End-of-Sprint Quality Gate
A sprint is not complete until these commands pass locally:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e` (Playwright)

## 5. Playwright Standard
- **Minimum Coverage**: One happy-path and one negative/edge scenario for new critical flows.
- **Global Failure Conditions**: Fail on `pageerror` or unexpected `console.error`.
- **Artifacts**: Collect trace, screenshot, and video for failures.
- **Stability**: Fix flaky tests before closure.

## 6. Coding Standards
- **TypeScript**: Strict mode, avoid `any`.
- **Structure**: Organize by domain; separate transport, domain logic, and persistence.
- **APIs**: Validate all external input; use consistent error formats.
- **Data**: Migration files for every schema change; forward-safe and rollback-aware.
- **Frontend**: Reusable primitives, deterministic rendering, handle loading/error states.

## 7. Security & Compliance
- Enforce auth/RBAC checks server-side.
- No secrets in code or logs.
- Audit all critical writes.

## 8. Git Workflow and Branch Strategy
- **Branching**: Sprints on feature branches (`feature/sprint-<n>-<description>`).
- **Commits**: Small units (feat, fix, chore, test, docs).
- **PRs**: Create using `gh pr create`; monitor CI checks until green; squash merge.
- **PR Content**: Summary, test evidence (including local Playwright results), known risks.

## 9. Definition of Done
- Deliverables implemented.
- Tests added and passing.
- End-of-sprint quality gate is fully green.
- Playwright coverage exists and is stable.
- Documentation updated.
- No critical or high severity open defects.
