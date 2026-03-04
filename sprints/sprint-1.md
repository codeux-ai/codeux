# Sprint 1: Senior-Level Codebase Refactor and Modularization

- Sprint window: March 9, 2026 to March 13, 2026
- Sprint type: Internal engineering improvements only (no product feature scope)
- Primary objective: Raise maintainability, modularity, type safety, and execution reliability across backend MCP runtime and dashboard

## 1. Repository-Wide Audit Findings

I scanned the full codebase and function graph before planning this sprint.

- Scanned files: 168 project files
- Scanned code files: 112 TypeScript/TSX files
- Function-like nodes analyzed: 962

### Main hotspots identified

- `src/services/cli-workflow-service.ts` is overloaded (1287 lines, very large workflow methods).
- `src/sprint/sprint-orchestrator.ts` has orchestration, CI-gating, watch-loop, file persistence, and reporting all in one class.
- `src/server/jules-agent-server.ts` constructor is a large composition root with many runtime responsibilities.
- `src/repositories/settings-sanitizer.ts` is a giant sanitizer function and hard to validate safely.
- `src/mcp/core-tool-handler.ts` mixes transport contracts, summarization policy, and session polling.
- Dashboard settings UI has large monolithic components (`CliWorkflowSection`, `AiProviderSection`, `TaskCard`).
- Backend and dashboard duplicate settings defaults/types (`src/contracts/app-types.ts` vs `dashboard/src/types.ts`, and defaults in both layers).
- Test suites include large monolithic files that are hard to maintain (`tests/backend/sprint/sprint-orchestrator.test.ts`, `tests/backend/services/git-status-service.test.ts`).

## 2. Target Architecture (Post-Refactor)

```text
src/
  app/
    runtime-context.ts
    dependency-factory.ts
  shared/
    logging/
      logger.ts
      correlation-id.ts
    config/
      search-paths.ts
      value-readers.ts
    polling/
      wait-until.ts
    subprocess/
      command-runner.ts
  domain/
    sprint/
      orchestrator/
        sprint-orchestrator.ts
        watch-loop-runner.ts
        cycle-runner.ts
      ci/
        feature-pr-gate.ts
        main-merge-gate.ts
    sessions/
      session-sync-service.ts
      activity-summary.ts
    settings/
      settings-schema.ts
      settings-sanitizer.ts
  infrastructure/
    repositories/
      subtask-file-repository.ts
      session-tracking-repository.ts
      settings-repository.ts
    providers/
      cli/
        workflow-service.ts
        workspace-manager.ts
        docker-runner.ts
        provider-runner.ts
      jules/
        jules-api-client.ts
  api/
    mcp/
      tool-registry.ts
      handlers/
        core-tool-handler.ts
        agent-tool-handler.ts
    http/
      dashboard-server.ts
      health-routes.ts
```

### Consolidation decisions

- Centralize path-resolution and settings loading in one shared configuration utility.
- Centralize subtask markdown read/write behavior in one repository.
- Centralize logging and correlation IDs across MCP and dashboard HTTP.
- Move CI gate policy out of `SprintOrchestrator` into isolated services.
- Split CLI workflow into workspace, provider, docker, and PR modules.
- Unify dashboard/backend settings contracts from one source of truth.

## 3. Team Split (Parallel Lanes)

- Lane A: Runtime Architecture and Cross-Cutting Concerns
- Lane B: Sprint Engine and CI Gate Refactor
- Lane C: CLI/Provider Workflow Decomposition
- Lane D: Dashboard Modularization and Type Unification
- Lane E: Test Architecture and CI Quality Gates

## 4. Backlog: 30 Atomic Tasks

### T01 - Establish Refactor Guardrails and ADR
- Finding: Refactors are high-impact and touch multiple critical paths.
- Thought: Without an agreed architecture contract, parallel work will diverge.
- Instructions: Create `docs/architecture/refactor-target-architecture.md` with boundaries, module ownership, migration order, and non-goals.
- Done criteria: ADR merged; each lane references the same target module map.
- Dependencies: None.

### T02 - Build Shared Search Path Resolver
- Finding: Path search logic is repeated in `app-config`, `external-settings`, `guide-repository`, `instruction-template-repository`, and server code.
- Thought: Duplicate path logic increases subtle precedence bugs.
- Instructions: Add `src/shared/config/search-paths.ts` with deterministic, tested `buildSearchRoots` and `buildCandidatePaths` helpers.
- Done criteria: Existing modules call shared resolver only; no duplicated search list builders remain.
- Dependencies: T01.

### T03 - Build Shared Config Value Readers
- Finding: Port/int/bool/string parsing rules are duplicated.
- Thought: Parsing inconsistencies can create hidden runtime behavior differences.
- Instructions: Add `src/shared/config/value-readers.ts` (`readPort`, `readBoolean`, `readInteger`, `readString`) and migrate all consumers.
- Done criteria: No local re-implementations of basic parsing utilities in config/sanitizer modules.
- Dependencies: T02.

### T04 - Refactor `src/config/app-config.ts`
- Finding: `loadAppConfig` mixes arg parsing, env parsing, JSON parsing, and file search.
- Thought: This is startup-critical and should be small and deterministic.
- Instructions: Split into `api-key-loader`, `dashboard-port-loader`, and pure argument parser helpers.
- Done criteria: `loadAppConfig` becomes orchestration-only; unit tests expanded for each loader.
- Dependencies: T02, T03.

### T05 - Refactor External Settings Loader
- Finding: `src/config/external-settings.ts` duplicates search and key normalization logic.
- Thought: External hint logic should be source-agnostic and reusable by dashboard import flow.
- Instructions: Create key normalization mapper and reuse shared path resolver.
- Done criteria: Source-specific key aliases defined once; loader function <= 80 lines.
- Dependencies: T02, T03.

### T06 - Consolidate Guide + Instruction Repositories
- Finding: `GuideRepository` and `InstructionRepository` have near-identical lookup behavior.
- Thought: Two separate implementations drift over time.
- Instructions: Introduce `src/infrastructure/repositories/file-template-repository.ts` for generic lookup and migrate both repositories.
- Done criteria: Common lookup implementation with repository-specific wrappers only.
- Dependencies: T02.

### T07 - Extract Runtime Dependency Factory from `JulesAgentServer`
- Finding: `JulesAgentServer` constructor wires many services inline.
- Thought: Constructor size blocks testability and replaceability.
- Instructions: Add `src/app/dependency-factory.ts` returning typed dependencies; keep server class focused on lifecycle.
- Done criteria: Constructor reduced to wiring via factory and route registration.
- Dependencies: T01.

### T08 - Add Structured Logger + Correlation IDs
- Finding: Codebase uses raw `console.error` across server/orchestrator/workflow.
- Thought: Operational debugging is difficult without request/session correlation.
- Instructions: Implement `src/shared/logging/logger.ts` and `correlation-id.ts`; inject logger through handlers/services.
- Done criteria: MCP tool calls and dashboard API requests include correlation IDs in logs.
- Dependencies: T07.

### T09 - Add `/health` and `/ready` Endpoints
- Finding: Operational guardrails require explicit liveness/readiness endpoints.
- Thought: This is required for reliable production runtime checks.
- Instructions: Add health routes in dashboard server and include readiness checks for settings DB and server boot state.
- Done criteria: `/health` and `/ready` return deterministic JSON with status fields.
- Dependencies: T07.

### T10 - Replace Raw Console Logging in Changed Modules
- Finding: Existing logs are inconsistent and unstructured.
- Thought: Migration must be deliberate and incremental to avoid noise.
- Instructions: Replace console usage in `jules-agent-server`, `sprint-orchestrator`, `cli-workflow-service`, and `dashboard-server` with shared logger.
- Done criteria: No direct console logging in these target files except bootstrap fatal handler.
- Dependencies: T08.

### T11 - Introduce Typed MCP Tool Registry
- Finding: `mcp-request-router.ts` builds an ad hoc handler map with `any` payloads.
- Thought: Tool contract drift is likely and hard to catch at compile time.
- Instructions: Create `src/api/mcp/tool-registry.ts` with strict typed input/output wrappers; remove `ToolHandlerMap` `any` usage.
- Done criteria: All MCP handler map entries are strongly typed; dispatch compiles without `any` escape hatches.
- Dependencies: T07.

### T12 - Tighten Jules API Client Types
- Finding: `JulesApiClient` uses `any` payloads in create/list calls.
- Thought: External API boundaries should be strictest, not loosest.
- Instructions: Add request/response interfaces for each API method and normalize name/id handling in one helper.
- Done criteria: No `any` in `jules-api-client.ts`; tests cover type-safe payload mapping.
- Dependencies: T11.

### T13 - Split `CoreToolHandler` into Summary + Transport Layers
- Finding: `CoreToolHandler` currently handles summarization policies, API calls, and polling loops together.
- Thought: Summarization policy should be reusable and test-isolated.
- Instructions: Extract activity/session/source summarizers to `src/domain/sessions/activity-summary.ts`; keep handler thin.
- Done criteria: Handler methods mostly coordinate dependencies; summary formatting unit tests are isolated.
- Dependencies: T11, T12.

### T14 - Extract Shared Polling Utility
- Finding: Session wait loops are manually implemented and duplicated in tool logic.
- Thought: Polling logic should provide timeout, interval, and stop predicate with one tested utility.
- Instructions: Add `src/shared/polling/wait-until.ts` and migrate session wait behavior.
- Done criteria: No inline `while` polling loops in MCP handlers.
- Dependencies: T13.

### T15 - Split `SprintOrchestrator.execute` into Sub-Runners
- Finding: `execute` and `runOrchestrationCycle` are large and multi-purpose.
- Thought: Separate action routing, cycle execution, and watch mode for readability and safer change.
- Instructions: Create `cycle-runner.ts` and `watch-loop-runner.ts`; move logic behind small interfaces.
- Done criteria: `execute` reduced to high-level orchestration; each sub-runner has focused tests.
- Dependencies: T07.

### T16 - Extract Feature PR CI Gate Policy Service
- Finding: `applyFeatureBranchCiGate` contains merge-gate policy, retry policy, status mutation, and report generation.
- Thought: This is high-risk logic and should be isolated from core loop mechanics.
- Instructions: Move to `src/domain/sprint/ci/feature-pr-gate.ts` with explicit inputs/outputs and no direct file IO.
- Done criteria: Orchestrator delegates gate evaluation; gate service independently unit tested.
- Dependencies: T15.

### T17 - Extract Main Merge CI Feedback Service
- Finding: Main merge CI feedback logic is mixed into orchestrator.
- Thought: Same policy should be callable independently from finalization flow.
- Instructions: Move `renderMainMergeCiFeedback` into `src/domain/sprint/ci/main-merge-gate.ts`.
- Done criteria: Completion phase references new service only.
- Dependencies: T15.

### T18 - Consolidate Subtask Markdown Persistence
- Finding: `persistTaskMergedFlag` logic exists in both orchestrator and server.
- Thought: Duplicate file mutation is a bug source.
- Instructions: Implement `SubtaskFileRepository` with `setMerged(taskId, merged)` and reuse everywhere.
- Done criteria: One implementation for merged flag writes and markdown updates.
- Dependencies: T15.

### T19 - Replace Regex-Based Subtask Parsing with Structured Parser
- Finding: `SubtaskRepository` uses regex extraction and can be brittle.
- Thought: Sprint metadata is core data; parser must be robust and validated.
- Instructions: Build a deterministic frontmatter-like parser for `title`, `depends_on`, `is_independent`, `merged`, `prompt`.
- Done criteria: Parser handles quoting/whitespace edge cases; repository uses structured parse result.
- Dependencies: T18.

### T20 - Optimize Session Sync Lookup Complexity
- Finding: `runSessionSyncStep` performs repeated linear scans and repeated run-key extraction.
- Thought: Complexity rises sharply with many sessions/tasks.
- Instructions: Pre-index sessions by run key once; avoid repeated scans per task.
- Done criteria: Time complexity reduced to O(tasks + sessions); benchmark test added.
- Dependencies: T15.

### T21 - Remove Duplicate CI Status Predicate Logic
- Finding: `isCiCheckFailed` and `isCiRunFailed` duplicate the same decision rules.
- Thought: Divergent failure criteria will cause subtle policy bugs.
- Instructions: Create shared CI status predicate helpers and refactor call sites.
- Done criteria: Single source of truth for failed/pending CI classification.
- Dependencies: T16, T17.

### T22 - Decompose `CliWorkflowService` into Modules
- Finding: Workflow service mixes workspace lifecycle, provider execution, docker runtime, and PR orchestration.
- Thought: This file is the largest technical debt node and blocks safe iteration.
- Instructions: Split into `workspace-manager`, `provider-runner`, `docker-runner`, and `pr-service` modules; preserve behavior.
- Done criteria: Main workflow orchestrator method < 100 lines and delegates to focused modules.
- Dependencies: T07.

### T23 - Extract Docker Bootstrap Script Builder
- Finding: Docker bootstrap shell script is inline and hard to reason/test.
- Thought: Inline long script construction is fragile.
- Instructions: Move script generation to dedicated module with composable sections and snapshot tests.
- Done criteria: Docker runner references generated script builder; script logic tested independently.
- Dependencies: T22.

### T24 - Standardize Subprocess Execution and Error Contracts
- Finding: Command execution wrappers and error handling are inconsistent.
- Thought: Unified execution layer simplifies retry, timeout, and observability.
- Instructions: Introduce shared command runner interface with typed results, normalized stderr clipping, and timeout policy.
- Done criteria: `git-status-service` and CLI workflow modules use same runner abstraction.
- Dependencies: T22.

### T25 - Strengthen Provider Routing Policy Design
- Finding: Provider routing logic is heuristic-heavy and embedded in one file.
- Thought: Policy changes should be testable by matrix, not ad hoc edits.
- Instructions: Split into `manual`, `weighted`, and `orchestrator` strategies with clear contract and deterministic test vectors.
- Done criteria: Routing behavior covered with explicit test matrix and edge cases.
- Dependencies: T22.

### T26 - Unify Backend and Dashboard Settings Contracts
- Finding: Settings types/defaults are duplicated in backend and dashboard.
- Thought: Dual source-of-truth causes drift and incompatible serialization.
- Instructions: Create shared settings contract module consumed by both backend and dashboard builds.
- Done criteria: One canonical type/default definition; dashboard imports from shared module.
- Dependencies: T03.

### T27 - Build Dashboard Settings Update Helpers
- Finding: Settings components repeat verbose nested object updates.
- Thought: Repeated state mutation patterns increase accidental inconsistency.
- Instructions: Add `dashboard/src/lib/settings-updaters.ts` with reusable immutable patch helpers.
- Done criteria: Settings section components call helper functions instead of inline nested object reconstruction.
- Dependencies: T26.

### T28 - Split Oversized Dashboard Components
- Finding: `TaskCard`, `AiProviderSection`, and `CliWorkflowSection` are large and hard to maintain.
- Thought: UI behavior is easier to test when decomposed by responsibility.
- Instructions: Extract presentational subcomponents (status badges, session feed, provider row, docker credentials subsection).
- Done criteria: Each target component reduced below ~120 lines and keeps behavior unchanged.
- Dependencies: T27.

### T29 - Improve Dashboard Runtime Polling Architecture
- Finding: Runtime hook starts independent status and git polling loops with repeated logic.
- Thought: Poll orchestration should be centralized to avoid drift and race conditions.
- Instructions: Create shared poll manager hook with backoff, unified error state, and explicit refresh triggers.
- Done criteria: `use-dashboard-runtime-data` uses centralized poll manager; polling behavior tested.
- Dependencies: T28.

### T30 - Re-architecture of Test Suite and Quality Gates
- Finding: Large monolithic test files and missing script-level CI gates reduce confidence.
- Thought: Refactor without test architecture upgrade will regress quickly.
- Instructions: Split mega-tests by domain, add shared test builders, add `lint`, `typecheck`, `test:coverage`, and `ci` scripts; enforce thresholds in workflow.
- Done criteria: Largest test files reduced significantly, CI scripts aligned with repository standards, coverage threshold enforced for critical modules.
- Dependencies: T11, T15, T22, T26.

## 5. Suggested Delivery Order (Week Plan)

- Day 1: T01-T06, T26
- Day 2: T07-T14
- Day 3: T15-T21
- Day 4: T22-T25
- Day 5: T27-T30, stabilization, full CI

## 6. Definition of Done for the Sprint

- No new `any` in touched backend/dashboard files.
- Hotspot functions decomposed so no critical function exceeds 120 lines in target modules.
- New shared modules replace duplicated logic (path resolution, parsing, persistence, polling).
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:coverage` all pass.
- Docs updated for architecture changes and module map.

## 7. Risk Notes

- Highest risk: behavior drift in sprint orchestration and CLI workflow decomposition.
- Mitigation: keep behavior-compatible test fixtures before refactor moves and split changes into small PRs (<400 changed lines each where possible).
- Rollback plan: feature-flag/adapter layer for new modules so old flow can be re-enabled within one commit if regression appears.
