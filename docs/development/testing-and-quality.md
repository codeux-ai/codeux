# Testing and Quality

This guide describes how to validate changes safely.

Test files are organized under `tests/`:
- `tests/backend/**`
- `tests/dashboard/**`

## Core Commands

- Run tests
```bash
npm test
```

- Run backend tests only
```bash
npm run test:backend
```

- Run dashboard tests only
```bash
npm run test:dashboard
```

- Run coverage report (verifies 80% global thresholds)
```bash
npm run test:coverage
```

- Run backend coverage only
```bash
npm run test:backend:coverage
```

- Run the local fast CI mirror (strict TS validation plus tests)
```bash
npm run ci
```

GitHub Actions optimization notes:
- the hosted CI workflow is broader than the local `npm run ci` script: it also runs coverage, build, and audit gates
- the hosted CI workflow cancels superseded runs for the same branch or PR
- lint/typecheck, backend coverage, dashboard tests, build, and audit run in parallel jobs
- CI avoids a second plain `vitest` pass because backend coverage already executes the backend suite while enforcing thresholds
- dashboard tests run in their own non-coverage job because coverage thresholds target `src/**/*.ts`, not the dashboard bundle under `dashboard/`
- dependency installation uses the cached npm package store with `npm ci --prefer-offline --no-audit`; the security scan still runs in its own audit job
- Vite and Vitest now write transform and test caches into repo-local `.cache/` directories so GitHub Actions can restore them across workflow runs

- Build backend and dashboard
```bash
npm run build
```
  - The build script intentionally runs toolchain commands directly (`tsc`, dashboard typecheck, `vite build`) instead of nested `npm run` calls to avoid npm env-config warning noise in child npm processes.
  - The repo-root `vite.config.ts` sets `root: "dashboard"`, so `vite build` and `vite` must keep using that config to resolve `dashboard/index.html`.

- Run dashboard typecheck only
```bash
npm run typecheck:dashboard
```

## Test Coverage Areas

### Backend
- Sprint orchestration behavior
- Settings repository defaults and persistence
- Git status service parsing
- Task service prompt construction
- Instruction template rendering and fallback behavior

### Dashboard
- Settings default cloning
- Activity helpers
- Status helpers

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
