# Sprint 2: Codebase Hardening, Reuse, and Senior-Level Refactor Follow-Up

- Sprint window: March 9, 2026 to March 13, 2026
- Sprint type: Internal engineering improvements only (no product feature scope)
- Primary objective: Complete Sprint 1 carry-over refactors and remove remaining structural/typing/performance debt across backend, sprint engine, CLI provider runtime, and dashboard

## 1. Full Audit Scope and Method

I performed a full AST-based scan of the repository before planning this sprint.

- Files scanned: 166 TypeScript/TSX files
- Production files scanned (`src/` + `dashboard/src/`): 112
- Function-like nodes analyzed: 1,357
- Production LOC analyzed: 11,972
- Baseline validation: `npm run ci` passes on March 4, 2026 (typecheck + lint alias + test)

### Current measurable hotspots (post Sprint 1)

- `src/services/git-status-service.ts` (637 LOC, 45 functions, 4 functions >= 40 lines)
- `src/server/jules-agent-server.ts` (549 LOC, 80 functions)
- `src/repositories/settings-sanitizer.ts` (421 LOC, `sanitizeSettings` is 243 lines)
- `src/domain/sprint/orchestrator/cycle-runner.ts` (375 LOC, includes duplicate CI gate logic)
- `src/domain/sprint/ci/feature-pr-gate.ts` (`evaluateCiGate` is 202 lines)
- `src/sprint/sprint-orchestrator.ts` (`execute` is 130 lines)
- `src/app/dependency-factory.ts` (`createRuntimeDependencies` is 180 lines)
- `dashboard/src/components/ui/settings/DockerCredentialsSection.tsx` (166 lines)
- `dashboard/src/components/ui/settings/ProviderConfigRow.tsx` (117 lines)
- `dashboard/src/components/settings/CiIntelligenceSection.tsx` (115 lines)

### Cross-cutting issues found

- `any` remains in 15 production files, including core contracts and MCP handlers.
- CI gate logic is duplicated between `CycleRunner` and `FeaturePrGateService`.
- `FeaturePrGateService` still performs direct subtask markdown writes (bypasses shared repository).
- MCP typed registry exists, but `contracts/mcp-tool-definitions.ts` and router still use `any` casts.
- Sync shell calls are still used in branch preflight (`execFileSync`) on a hot path.
- Dashboard polling is split into two independent loops with duplicated scheduling behavior.
- CI workflow (`.github/workflows/ci.yml`) does not yet enforce full repository quality gates from project standards.
- Architecture docs still contain drifted module references (e.g., non-existing `subtask-repository.ts`).

## 2. Sprint 1 Follow-Up Assessment (Implemented vs Missing)

### Implemented successfully in Sprint 1

- Shared config path utilities (`src/shared/config/search-paths.ts`)
- Shared config value readers (`src/shared/config/value-readers.ts`)
- File template repository consolidation (`src/infrastructure/repositories/file-template-repository.ts`)
- Structured logging and correlation IDs (`src/shared/logging/logger.ts`, `src/shared/logging/correlation-id.ts`)
- Typed Jules API client request/response surfaces (`src/integrations/jules-api-client.ts`)
- Shared polling utility (`src/shared/polling/wait-until.ts`)
- Sprint loop step extraction foundation (`src/domain/sprint/orchestrator/*`, `src/sprint/steps/*`)
- Dashboard/backend settings type source unification (`dashboard/src/types.ts` importing backend contracts)

### Partially implemented (carry-over required in Sprint 2)

- T07/T15 architecture split started, but `JulesAgentServer`, `dependency-factory`, and `sprint-orchestrator.execute` remain large orchestration hotspots.
- T09 readiness endpoint exists, but readiness semantics are still minimal and not subsystem-aware.
- T10 logging migration is incomplete (`console.error` remains in `subtask-file-repository.ts`).
- T11 typed MCP registry exists, but tool dispatch contracts still use `any` in `contracts/mcp-tool-definitions.ts` and routing cast in `mcp-request-router.ts`.
- T13 summary extraction exists, but `core-tool-handler.ts` remains monolithic and contains `any` in session-output handling.
- T16/T18 CI gate + subtask persistence extraction is incomplete (duplicate gate logic, direct file writes in gate service).
- T22/T23 CLI decomposition happened, but main workflow function and Docker credential builder still need cleanup/hardening.
- T24 command execution standardization is incomplete (`execFileSync` and multiple command pathways remain).
- T28/T29 dashboard modularization improved, but several sections remain oversized and repetitive.
- T30 CI gates and test architecture still need follow-through (workflow checks are not complete; large test files remain).

## 3. Target Architecture for Sprint 2

```text
src/
  app/
    runtime-context.ts
    dependency-factory/
      core-factory.ts
      sprint-factory.ts
      dashboard-factory.ts
    lifecycle/
      settings-lifecycle-service.ts
      readiness-service.ts

  contracts/
    jules-api-types.ts
    session-types.ts
    settings-types.ts
    mcp/
      tool-definitions.ts
      tool-args.ts
      tool-results.ts

  domain/
    settings/
      settings-schema.ts
      settings-sanitizers/
        ai-provider-sanitizer.ts
        git-sanitizer.ts
        ci-sanitizer.ts
        sprint-loop-sanitizer.ts
        cli-workflow-sanitizer.ts
    sprint/
      orchestrator/
        sprint-action-runner.ts
        cycle-runner.ts
        watch-loop-state-machine.ts
      ci/
        feature-pr/
          feature-pr-gate-service.ts
          merge-readiness-policy.ts
          ci-autofix-policy.ts
          ci-notification-builder.ts
        main-merge/
          main-merge-gate-service.ts

  infrastructure/
    repositories/
      subtask-file-repository.ts
      subtask-parser-v2.ts
    git/
      git-status-query-client.ts
      git-status-mappers.ts

  services/
    cli-workflow/
      workflow-pipeline.ts
      steps/
      provider-command-specs.ts

  api/
    mcp/
      tool-registry.ts
      validators/
    http/
      routes/
        health-routes.ts
        dashboard-routes.ts
```

### Consolidation decisions for Sprint 2

- Consolidate all settings sanitization into domain-specific sanitizers under `src/domain/settings/`.
- Consolidate CI gate policy into one code path (remove duplicate logic from cycle runner).
- Consolidate command execution through one standardized async command interface.
- Consolidate MCP contract typing so tool definitions, args, and dispatch are fully type-safe.
- Consolidate dashboard polling into one orchestrated runtime poll manager.

## 4. Team Split (Parallel Lanes)

- Lane A: Contracts, typing, and settings domain hardening
- Lane B: Sprint orchestration and CI gate refactor
- Lane C: Runtime composition, lifecycle, readiness, and server modularization
- Lane D: CLI provider workflow and subprocess/runtime reliability
- Lane E: Dashboard modularization, state flow, and UX maintainability
- Lane F: Tests, CI quality gates, and documentation drift closure

## 5. Backlog: 30 Atomic Sprint 2 Tasks

### T01 - Sprint 1 Gap Closure ADR and Refactor Ruleset
- Finding: Sprint 1 merged successfully but left partial carry-over on critical architecture tasks.
- Thought: We need a strict carry-over contract to prevent repeating partial refactors.
- Instructions: Add `docs/architecture/sprint-2-gap-closure.md` defining hard boundaries, no-`any` rule for touched code, and migration order for Sprint 2.
- Done criteria: ADR merged and referenced by all Sprint 2 PRs.
- Dependencies: None.

### T02 - Remove `any` from Core App Contracts
- Finding: `src/contracts/app-types.ts` still contains `any` in `JulesSession.outputs`, `JulesActivity`, and `Settings`.
- Thought: Contract looseness propagates unsafe casts across MCP handlers and orchestration.
- Instructions: Introduce explicit interfaces for session outputs, activity payload variants, and runtime settings shape; remove index signatures using `any`.
- Done criteria: No `any` in `src/contracts/app-types.ts`; tests updated for typed payload cases.
- Dependencies: T01.

### T03 - Remove `any` from Runtime Context + Dependency Factory Interfaces
- Finding: `src/app/dependency-factory.ts` `ServerContext` still uses `any` in multiple function signatures.
- Thought: Composition-root typing is the first defense against runtime mismatch.
- Instructions: Define strict context interfaces for status payload, CI status args, merge persistence args, and runtime callbacks.
- Done criteria: No `any` in dependency factory interfaces; compile-time safety across server wiring.
- Dependencies: T02.

### T04 - Break `settings-sanitizer.ts` into Domain Sanitizers
- Finding: `sanitizeSettings` is 243 lines and mixes all settings domains.
- Thought: Per-domain sanitizers improve testability and reduce regression risk.
- Instructions: Create sanitizer modules by domain (AI provider, Git, CI, loop steps, CLI workflow, skills/tools) and compose them.
- Done criteria: Top-level `sanitizeSettings` becomes orchestration-only; branch-specific tests split accordingly.
- Dependencies: T02.

### T05 - Add Runtime Settings Schema and Validation Layer
- Finding: Sanitization is imperative and ad hoc; schema constraints are implicit.
- Thought: Explicit schema validation catches drift early and simplifies dashboard/backend evolution.
- Instructions: Add a typed runtime schema module (`src/domain/settings/settings-schema.ts`) and enforce it in settings read/write flow.
- Done criteria: Invalid settings produce deterministic normalization outcomes and typed validation errors.
- Dependencies: T04.

### T06 - Decompose `createRuntimeDependencies` into Sub-Factories
- Finding: `createRuntimeDependencies` is 180 lines and wires all subsystems directly.
- Thought: Sub-factories make dependency graphs explicit and testable per subsystem.
- Instructions: Split into focused factory functions for core services, sprint domain, MCP handlers, dashboard services.
- Done criteria: Main factory function <= 80 lines and only composes sub-factory outputs.
- Dependencies: T03.

### T07 - Introduce `RuntimeContext` and Move Stateful Closures Out of `JulesAgentServer`
- Finding: `JulesAgentServer` owns many mutable fields and closure-based context methods.
- Thought: Central runtime state object reduces incidental coupling and improves lifecycle clarity.
- Instructions: Create `src/app/runtime-context.ts` with typed state access/update APIs; migrate context closures.
- Done criteria: Server no longer exposes broad mutable state through anonymous closures.
- Dependencies: T06.

### T08 - Split `JulesAgentServer` Lifecycle Responsibilities
- Finding: `JulesAgentServer` currently handles config load, settings sync, dashboard boot, and MCP boot in one class.
- Thought: Lifecycle stages should be isolated for easier startup debugging and recovery logic.
- Instructions: Extract services for settings lifecycle, dashboard boot lifecycle, and transport startup lifecycle.
- Done criteria: `JulesAgentServer` reduced to high-level coordinator; each lifecycle service has focused tests.
- Dependencies: T07.

### T09 - Strengthen `/health` and `/ready` to Real Subsystem Probes
- Finding: `/ready` currently depends mainly on in-memory status timestamp.
- Thought: Readiness must reflect true runtime capability, not just one state field.
- Instructions: Add readiness checks for settings DB access, dashboard HTTP binding state, MCP server connection state, and optional git environment sanity.
- Done criteria: `/health` and `/ready` return structured component states and fail deterministically on probe failures.
- Dependencies: T08.

### T10 - Unify MCP Tool Contracts End-to-End
- Finding: Registry is typed, but `contracts/mcp-tool-definitions.ts` dispatch still uses `any` and router uses cast.
- Thought: Partial typing creates false confidence and allows runtime schema drift.
- Instructions: Replace `ToolHandlerMap`/`dispatchTool` `any` types with strict mapped types tied to `McpToolArgsByName`.
- Done criteria: No `any` in MCP contract/dispatch path; router `list_tools` path avoids `as any` cast.
- Dependencies: T02.

### T11 - Add MCP Argument Validation at Dispatch Boundary
- Finding: Incoming tool args are trusted and passed directly to handlers.
- Thought: Validation at boundary prevents malformed payloads from leaking into business logic.
- Instructions: Add per-tool runtime validators in `src/api/mcp/validators` and run them before handler dispatch.
- Done criteria: Validation failures return deterministic MCP errors with actionable messages; tests cover invalid payloads.
- Dependencies: T10.

### T12 - Remove Duplicate Feature CI Gate Logic from `CycleRunner`
- Finding: `cycle-runner.ts` still contains a full `applyFeatureBranchCiGate` method duplicating `FeaturePrGateService`.
- Thought: Duplicated critical policy logic guarantees divergence under future changes.
- Instructions: Delete duplicate method and call `FeaturePrGateService.evaluateCiGate` exclusively.
- Done criteria: One single implementation path for feature CI gate.
- Dependencies: T10.

### T13 - Consolidate Subtask Merge Persistence into `SubtaskFileRepository`
- Finding: `FeaturePrGateService.persistTaskMergedFlag` still writes markdown directly using fs.
- Thought: Persistence logic must remain centralized in one repository to preserve file format guarantees.
- Instructions: Inject `SubtaskFileRepository` into gate service and remove direct fs path writes.
- Done criteria: No direct markdown mutation in gate service; all merged-state writes use repository API.
- Dependencies: T12.

### T14 - Decompose `FeaturePrGateService.evaluateCiGate`
- Finding: `evaluateCiGate` is 202 lines with mixed matching, gating, escalation, and reporting responsibilities.
- Thought: Policy logic should be composed from small deterministic units.
- Instructions: Split into functions/services for PR matching, merge readiness, escalation decision, and report text generation.
- Done criteria: No CI gate function > 80 lines; unit tests for each policy branch matrix.
- Dependencies: T13.

### T15 - Refactor `WatchLoopRunner` Into Explicit State Machine
- Finding: `WatchLoopRunner.run` is 163 lines and mixes loop control, rendering, completion, and cleanup.
- Thought: Explicit state transitions reduce hidden loop bugs and improve observability.
- Instructions: Implement watch loop states (`RUNNING`, `CHECKPOINT`, `FINISHED`, `NEEDS_MANUAL_MERGE`, `NO_MORE_ACTIONS`) and move transition logic to dedicated handlers.
- Done criteria: Watch loop has typed state enum and transition table with focused tests.
- Dependencies: T12.

### T16 - Refactor `SprintOrchestrator.execute` into Action Handlers
- Finding: `execute` still performs planning, orchestration routing, watch setup, report assembly, and status persistence.
- Thought: Action-level handlers (`plan`, `status`, `orchestrate`) make behavior changes safer.
- Instructions: Split into action handler methods/services and shared report composer.
- Done criteria: `execute` becomes minimal router (< 70 lines).
- Dependencies: T15.

### T17 - Optimize `session-sync-step` for Activity Fetch Throughput
- Finding: Activity fetches are executed inside task loop and can serialize network/IO operations.
- Thought: Batched/deduped session activity retrieval materially improves large-sprint performance.
- Instructions: Build session lookup map once, dedupe session names, fetch activities with bounded parallelism, and apply results by task mapping.
- Done criteria: Step remains O(tasks + sessions) with bounded async activity fan-out; add benchmark-style test.
- Dependencies: T16.

### T18 - Replace Sync Branch Preflight Commands with Async Runner
- Finding: Branch preflight uses `execFileSync` and blocking fs APIs.
- Thought: Blocking process calls are avoidable and inconsistent with shared command abstraction.
- Instructions: Reimplement `branch-preflight-step` using shared async command runner and explicit timeout/error handling.
- Done criteria: No sync git shell calls in preflight path; behavior-compatible tests updated.
- Dependencies: T16.

### T19 - Upgrade Subtask Parser to Strict Frontmatter-Compatible Grammar
- Finding: `SubtaskParser` still uses simple regex/split logic and limited array parsing.
- Thought: Sprint plan files are core state; parser must be robust to quoting and formatting variants.
- Instructions: Implement parser v2 with strict key parsing, quoted-array support, multiline prompt retention, and deterministic stringify order.
- Done criteria: Round-trip tests for edge cases (quotes, commas, blank prompt lines, missing fields) pass.
- Dependencies: T13.

### T20 - Improve Subtask Repository Load Path and Logging
- Finding: `SubtaskFileRepository.loadSubtasks` loads sequentially and still uses `console.error`.
- Thought: Repository should be fast and consistently use structured logging.
- Instructions: Add parallel file loading with stable ordering, aggregate parse warnings, and logger injection.
- Done criteria: No direct `console.*` usage in repository; parse errors are structured and test-covered.
- Dependencies: T19.

### T21 - Split `GitStatusService` into Query Client + Mappers + Policy
- Finding: `GitStatusService.getStatus` is 123 lines and class combines command execution, parsing, and policy logic.
- Thought: Separating query and interpretation layers improves reliability and test granularity.
- Instructions: Extract gh query client methods, JSON mappers, and status policy evaluators into dedicated modules.
- Done criteria: `getStatus` becomes orchestration-only; parser/policy units independently tested.
- Dependencies: T03.

### T22 - Parallelize GitHub Data Fetch and Bound Failed-Run Enrichment Concurrency
- Finding: PR, run, merged PR queries are currently sequential and enrichment loops are serial.
- Thought: Controlled concurrency reduces status latency without overloading API.
- Instructions: Use `Promise.all` for base queries and a bounded concurrency queue for failed-run/job log enrichment.
- Done criteria: Median `/api/git-status` latency reduced under representative test fixtures; behavior unchanged.
- Dependencies: T21.

### T23 - Add Short-Lived Git Status Memoization by Tracking Scope
- Finding: Repeated status requests in same interval recompute expensive gh calls.
- Thought: Scope-aware memoization improves dashboard responsiveness and lowers API pressure.
- Instructions: Add per-repo/per-scope memoized status cache with TTL and explicit invalidation hooks.
- Done criteria: Redundant requests within TTL reuse cached result safely; tests cover invalidation paths.
- Dependencies: T22.

### T24 - Decompose `CliWorkflowService.runTaskWorkflow` into Pipeline Steps
- Finding: `runTaskWorkflow` is 116 lines and mixes setup, provider execution, git, PR, and cleanup.
- Thought: Pipeline stages increase readability and permit targeted retries/policies.
- Instructions: Create step modules (`prepare`, `execute-provider`, `git-finalize`, `pr-finalize`, `cleanup`) with typed stage results.
- Done criteria: Main workflow method < 70 lines; each stage unit tested.
- Dependencies: T06.

### T25 - Remove Remaining Provider `any` Casts and Introduce Command Spec Map
- Finding: `provider-runner.ts` and `provider-routing.ts` still use `as any` and provider-specific branch logic.
- Thought: Provider command construction should be declarative and fully typed.
- Instructions: Add typed provider command spec map and remove `as any` casts in provider execution/routing paths.
- Done criteria: No `any` in provider workflow modules; strategy behavior preserved by tests.
- Dependencies: T24.

### T26 - Complete Docker Credential Mount Builder and Harden Runtime Path Handling
- Finding: `docker-runner.ts` contains placeholder comment (“Simplified for brevity”) in credential mount logic.
- Thought: Container credential mounting is security-sensitive and should be explicit and complete.
- Instructions: Expand credential mount assembly into dedicated tested builder with clear path resolution and read-only guarantees.
- Done criteria: Full mount matrix tests (on/off per credential type) and no placeholder simplifications remain.
- Dependencies: T24.

### T27 - Unify Command Execution Stack and Fix Stream Line Framing
- Finding: Command pathways are split (`command-runner`, `cli-process-runner`, sync shell calls); line callbacks can split across chunks.
- Thought: A single robust execution primitive improves correctness and maintainability.
- Instructions: Consolidate runners behind one interface and implement proper line-buffer framing for stdout/stderr callbacks.
- Done criteria: Streaming callbacks preserve line integrity; all subprocess callsites use unified abstraction.
- Dependencies: T18, T24.

### T28 - Create Schema-Driven Dashboard Settings Sections
- Finding: Settings UI components repeat boilerplate input/toggle patterns and nested immutable updates.
- Thought: Descriptor-driven rendering can cut repetitive code and improve consistency.
- Instructions: Introduce section field descriptor model and reusable settings field renderer primitives for common control types.
- Done criteria: `BasicSettingsSection`, `CiIntelligenceSection`, and credential/provider rows shrink significantly with behavior parity.
- Dependencies: T05.

### T29 - Consolidate Dashboard Runtime Polling into Single Scheduler
- Finding: Runtime data and git status use independent poll loops with duplicated schedule/backoff logic.
- Thought: Unified scheduler simplifies state sync and avoids race/stale-state edge cases.
- Instructions: Implement one poll coordinator that fans out endpoint fetches and owns backoff/error state centrally.
- Done criteria: Single active scheduler in runtime hook; deterministic refresh behavior verified by tests.
- Dependencies: T23, T28.

### T30 - Test, CI, and Documentation Drift Hardening
- Finding: CI workflow still runs only test+build, and architecture docs have stale module references.
- Thought: Structural refactors must be protected by stronger gates and current docs.
- Instructions: 
  - Update `.github/workflows/ci.yml` to run install, typecheck, lint, test, build, coverage, and security scan.
  - Split oversized test files (especially sprint orchestrator and core tool handler suites) into domain-focused files.
  - Update docs (`docs/architecture/repository-map.md`, `docs/architecture/system-overview.md`, `docs/sprint-loop/atomic-loop.md`) to match current module layout.
- Done criteria: CI reflects repository standards; docs have no stale file references; large test modules reduced.
- Dependencies: T06, T16, T21, T29.

## 6. Suggested Delivery Order (Next Week)

- Monday, March 9, 2026: T01-T06
- Tuesday, March 10, 2026: T07-T12
- Wednesday, March 11, 2026: T13-T20
- Thursday, March 12, 2026: T21-T27
- Friday, March 13, 2026: T28-T30, stabilization, full CI run, docs pass

## 7. Definition of Done for Sprint 2

- Zero `any` in touched production files.
- No duplicated CI gate logic between orchestrator and CI services.
- No direct markdown writes outside `SubtaskFileRepository`.
- No sync shell calls on orchestration hot paths.
- Full quality gates pass locally: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:coverage`, `npm audit --audit-level=high`.
- CI workflow enforces the same gates.
- Architecture and sprint-loop docs updated to match actual code layout.

## 8. Risks and Mitigations

- Risk: Behavioral drift while splitting orchestration and CI gate modules.
  - Mitigation: Preserve existing fixtures, split by small PRs, keep old/new behavior parity tests during migration.
- Risk: Runtime regression from command runner consolidation.
  - Mitigation: Introduce adapter layer first, then migrate callsites incrementally with integration tests.
- Risk: Dashboard regressions from schema-driven settings refactor.
  - Mitigation: Snapshot + interaction tests for settings save/import flows before and after refactor.

## 9. PR Strategy for Team Throughput

- Keep PRs under ~400 changed lines where feasible.
- One task per PR unless dependency coupling requires paired delivery.
- Mandatory validation checklist in each PR description:
  - changed modules and why
  - test proof
  - rollback plan
  - docs updated yes/no
