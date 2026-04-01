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

- Run coverage report (verifies 80% global thresholds)
```bash
npm run test:coverage
```

- Run full CI verification suite (lint, typecheck, build, test, and coverage)
```bash
npm run ci
```

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
