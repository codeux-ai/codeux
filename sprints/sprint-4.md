# Sprint 4: Project Management Foundation and Agentic Control Surface

- Sprint window: March 23, 2026 to April 3, 2026
- Sprint type: Platform foundation + MCP contract migration
- Primary objective: Replace markdown-first sprint state with a database-first project/sprint/task model and ship an agentic MCP tool surface focused on project management, execution control, and telemetry.

## 1. Audit Scope and Key Findings

I performed a focused architecture and contract audit across backend runtime, sprint orchestration, MCP contracts, repositories, and dashboard polling/API surfaces.

- Files scanned (`src/` + `dashboard/src/` + `tests/`): 245
- Production TypeScript/TSX files scanned (`src/` + `dashboard/src/`): 147
- Production LOC scanned (`src/` + `dashboard/src/`): 13,381
- Current MCP tools exposed: 14

### Current measurable hotspots relevant to Sprint 4

- `src/server/jules-agent-server.ts` (511 LOC): holds global singleton runtime state and single-status assumptions.
- `src/repositories/session-tracking-repository.ts` (373 LOC): tracks sessions with `repo_path` only, but no project/sprint/task relational identity.
- `src/contracts/app-types.ts` (341 LOC): `DashboardStatus` is single-context and not project-scoped.
- `src/sprint/sprint-orchestrator.ts` (304 LOC): derives subtasks from filesystem paths and sprint number.
- `src/mcp/core-tool-handler.ts` (286 LOC): still centered on direct Jules API primitives.
- `src/contracts/mcp-tool-definitions.ts` (198 LOC): current tool catalog still exposes source/session/activity primitives that are no longer the preferred external interface.

### Structural gaps blocking multi-project management

- Runtime keeps one global `lastStatus`; no project-level status registry.
- Settings DB uses one-row payload storage; no project/sprint/task model exists.
- Orchestrator loads tasks from `.jules-subagents/sprints/sprintN-subtasks/*.md` directly.
- Session sync relies on run-key string matching rather than explicit task/run foreign keys.
- Dashboard API and UI read one active sprint context only.
- No persistent first-class telemetry model for per-project token and duration analytics.

## 2. Product and Platform Decisions (Locked for Sprint 4)

These decisions are accepted and drive the implementation plan:

1. Database is source of truth for project/sprint/task management.
2. Markdown becomes import-compatible legacy format (not canonical state).
3. Project identity is one unique `(source_id + base_dir)` pair.
4. Sprint 4 prioritizes foundation over full concurrent multi-project execution.
5. New MCP surface must include project management and CRUD-centric agent workflows.
6. Legacy direct Jules API tools are no longer primary user-facing tools.
7. Telemetry is mandatory: token usage, task durations, sprint durations, provider outcomes, and rollups per project.

## 3. Target Data Model (Database-First)

```text
pm_projects
  id (pk, uuid)
  name
  source_id
  source_type
  base_dir
  default_branch
  feature_branch_scheme
  status
  created_at, updated_at
  UNIQUE(source_id, normalized_base_dir)

pm_sprints
  id (pk, uuid)
  project_id (fk pm_projects.id)
  sprint_number
  title
  status (PLANNED|ACTIVE|PAUSED|COMPLETED|ARCHIVED)
  sort_index
  started_at, completed_at
  created_at, updated_at
  UNIQUE(project_id, sprint_number)

pm_tasks
  id (pk, uuid)
  sprint_id (fk pm_sprints.id)
  task_key
  title
  prompt
  status (PENDING|RUNNING|COMPLETED|FAILED|BLOCKED)
  provider
  session_id
  worker_branch
  pr_url
  is_merged
  intervention_owner
  intervention_hint
  sort_index
  started_at, completed_at
  created_at, updated_at
  UNIQUE(sprint_id, task_key)

pm_task_dependencies
  task_id (fk pm_tasks.id)
  depends_on_task_id (fk pm_tasks.id)
  PRIMARY KEY(task_id, depends_on_task_id)

pm_runs
  id (pk, uuid)
  project_id, sprint_id, task_id (nullable for sprint-level runs)
  run_type (SPRINT|TASK|LISTEN|ONBOARDING)
  status
  started_at, ended_at
  metadata_json

pm_task_events
  id (pk, uuid)
  task_id
  run_id
  event_type
  payload_json
  created_at

pm_usage_samples
  id (pk, uuid)
  run_id
  project_id, sprint_id, task_id
  provider
  model
  prompt_tokens
  completion_tokens
  total_tokens
  estimated_cost_usd
  started_at, ended_at
  duration_ms
```

### Data rules

- `sort_index` is explicit for both sprints and tasks; reorder is transactional.
- Dependency graph must be acyclic and validated at write time.
- Durations are persisted at task/run granularity and aggregated for sprint/project metrics.
- Token metrics can be partial (`null`) for providers without token visibility; rollups must preserve completeness flags.

## 4. Target Runtime and Architecture Changes

```text
src/
  domain/
    project-management/
      project-service.ts
      sprint-service.ts
      task-service.ts
      task-ordering-service.ts
      task-dependency-validator.ts
      onboarding-service.ts
      listen-service.ts
      telemetry/
        usage-capture-service.ts
        stats-aggregation-service.ts
    sprint/
      orchestrator/
        ... (existing engine migrated to repository-backed reads/writes)

  infrastructure/
    repositories/
      project-repository.ts
      sprint-repository.ts
      task-repository.ts
      run-repository.ts
      telemetry-repository.ts
      project-management-db.ts
      legacy-markdown-importer.ts

  api/
    mcp/
      tool-registry.ts
      tool-validators/
      handlers/
        project-tool-handler.ts
        execution-tool-handler.ts
        utility-tool-handler.ts
```

### Runtime behavior direction

- Replace singleton `lastStatus` with project-scoped runtime registry.
- Keep single active execution lane in Sprint 4 via coordinator lock (foundation-first decision).
- All orchestration state transitions persist to DB first, then render response text.
- Markdown files become import/export compatibility path only.

## 5. MCP Tool Surface v2 (Agentic Project Management)

Sprint 4 introduces a new primary tool family. Names below are canonical targets.

### Project and planning tools

- `create_source` (alias: `init_source`)
- `create_sprints` (batch-capable)
- `create_subtasks` (batch-capable)
- `update_sprint`
- `delete_sprint`
- `reorder_sprints`
- `update_subtask`
- `delete_subtask`
- `reorder_subtasks`

### Execution tools

- `start_onboarding`
- `start_sprint`
- `start_subtask`
- `start_listen`

### Utility and operator tools

- `get_settings`
- `set_setting`
- `read_docs`
- `get_help`

### Contract transition policy

- Existing Jules-centric source/session/activity tools are removed from default external surface.
- `sprint_agent` and `task_agent` remain temporarily as compatibility shims (project-aware wrappers) during migration.
- Disabled/deprecated tools stay callable only behind explicit internal feature flags.

## 6. Team Split (Parallel Lanes)

- Lane A: Data model, repositories, migration, and transactional ordering.
- Lane B: Orchestrator migration to DB-backed project/sprint/task runtime.
- Lane C: MCP Tool Catalog v2, handler split, validators, and compatibility gateway.
- Lane D: Onboarding/listen execution services and runtime coordination lock.
- Lane E: Telemetry ingestion, usage statistics, and API surfaces.
- Lane F: Dashboard foundation APIs and first project management UX.
- Lane G: Tests, CI enforcement, migration docs, and rollback readiness.

## 7. Backlog: 30 Atomic Sprint 4 Tasks

### T01 - Sprint 4 Architecture Contract and Migration ADR
- Finding: Sprint 4 introduces storage, tool, and orchestration contract changes across multiple subsystems.
- Thought: Without a strict migration contract, parallel delivery will diverge and break compatibility.
- Instructions: Add `docs/architecture/sprint-4-project-management-foundation.md` with architecture boundaries, migration sequencing, and compatibility policy.
- Done criteria: ADR accepted and referenced by all Sprint 4 PRs.
- Dependencies: None.

### T02 - Canonical Project/Sprint/Task Identity Contract
- Finding: IDs are currently inferred from path + sprint number + markdown filenames.
- Thought: Identity must be explicit and stable before data migration.
- Instructions: Define ID strategy and status enums for projects, sprints, tasks, and runs in contracts/domain types.
- Done criteria: No sprint runtime path-based identity assumptions in touched modules.
- Dependencies: T01.

### T03 - Implement Project Management SQLite Schema v1
- Finding: No normalized persistence exists for project/sprint/task state.
- Thought: Schema and index design are the foundation for all higher-level behavior.
- Instructions: Add schema bootstrap + migration scripts for `pm_projects`, `pm_sprints`, `pm_tasks`, dependencies, runs, events, and usage samples.
- Done criteria: Fresh DB boot + migration idempotency tests pass.
- Dependencies: T02.

### T04 - Build `ProjectRepository` CRUD + Uniqueness Rules
- Finding: Source/base-dir mappings are implicit and non-transactional today.
- Thought: Projects must be first-class and deduplicated.
- Instructions: Implement project create/read/update/archive/list with unique `(source_id, normalized_base_dir)` constraint handling.
- Done criteria: Duplicate source/base-dir writes return deterministic domain error.
- Dependencies: T03.

### T05 - Build `SprintRepository` CRUD + Sort Index
- Finding: Sprint ordering and lifecycle are file-path and number driven.
- Thought: Sprint management requires explicit sortable records.
- Instructions: Implement create/list/update/delete/archive/reorder operations scoped by project.
- Done criteria: Reorder operation is transactional and stable under concurrent writes.
- Dependencies: T03.

### T06 - Build `TaskRepository` CRUD + Sort Index
- Finding: Task state currently lives in markdown and in-memory mutation flow.
- Thought: CRUD is mandatory for agent-driven planning edits.
- Instructions: Implement task create/list/update/delete/reorder with strong input validation and optimistic write semantics.
- Done criteria: All task state transitions persist in DB; markdown is no longer canonical.
- Dependencies: T03.

### T07 - Implement Dependency Graph Validator
- Finding: Dependency cycles can be introduced manually in markdown.
- Thought: DB writes should block invalid dependency graphs at source.
- Instructions: Add cycle detection and missing-reference validation on task create/update operations.
- Done criteria: Cycles are rejected with explicit task IDs in error payload.
- Dependencies: T06.

### T08 - Build Legacy Markdown Import Service
- Finding: Existing users keep sprint plans in `.jules-subagents/sprints/*`.
- Thought: Migration must preserve historical effort and avoid hard cutovers.
- Instructions: Implement markdown-to-DB importer for existing sprint/task files with dependency mapping.
- Done criteria: Import creates equivalent task graph and preserves prompts/status/merged flags.
- Dependencies: T06, T07.

### T09 - Add Optional DB-to-Markdown Export Compatibility
- Finding: Teams may still need human-readable sprint snapshots.
- Thought: Export support de-risks migration and supports rollback.
- Instructions: Add read-only export utility for sprint/task records to markdown snapshot format.
- Done criteria: Exported markdown round-trips with importer for supported fields.
- Dependencies: T08.

### T10 - Add One-Time Migration CLI Command
- Finding: Manual migration is error-prone across multiple project roots.
- Thought: Controlled migration command improves repeatability and auditability.
- Instructions: Add CLI/maintenance command to import legacy sprints into DB with dry-run support.
- Done criteria: Dry-run and execute modes are test-covered and log migrated counts.
- Dependencies: T08.

### T11 - Replace Singleton Status With Project Runtime Registry
- Finding: Runtime currently stores one `lastStatus`.
- Thought: Multi-project management requires project-scoped runtime snapshots.
- Instructions: Implement `ProjectRuntimeRegistry` keyed by project and sprint IDs.
- Done criteria: Status APIs and orchestrator writes read/write scoped records only.
- Dependencies: T04, T05, T06.

### T12 - Add `ActiveExecutionCoordinator` (Foundation-First Lock)
- Finding: Sprint 4 intentionally does not ship full concurrent multi-project execution.
- Thought: A coordinator lock enables safe rollout while preserving future extensibility.
- Instructions: Add process-level execution lock service enforcing one active `start_sprint`/`start_subtask` pipeline at a time.
- Done criteria: Concurrent start attempts return explicit `ACTIVE_RUN_EXISTS` response with run metadata.
- Dependencies: T11.

### T13 - Refactor Orchestrator Args to Project/Sprint Identity
- Finding: Orchestrator inputs are currently `sprint_number` and `repo_path`.
- Thought: DB-backed orchestration should be identity-first.
- Instructions: Extend orchestration argument contracts to include `project_id` and `sprint_id`, with compatibility mapping for legacy args.
- Done criteria: New tools use identity-first args; legacy paths route via compatibility resolver.
- Dependencies: T11.

### T14 - Migrate Orchestration Loop to Repository-Backed Tasks
- Finding: Cycle runner still loads/writes markdown task files.
- Thought: Core runtime must operate on DB entities for project management reliability.
- Instructions: Replace load/update/persist flows with repository operations and scoped transactions.
- Done criteria: No orchestration-critical task mutation writes markdown files directly.
- Dependencies: T06, T13.

### T15 - Refactor Task Rerun and Status Derivation for Scoped Context
- Finding: Task rerun reads global status and path-derived sprint context.
- Thought: Rerun must target one project/sprint/task identity deterministically.
- Instructions: Update rerun service and status derivation to use runtime registry + repositories.
- Done criteria: Rerun works from project-scoped context and updates task/run telemetry.
- Dependencies: T11, T14.

### T16 - Expand Session Tracking Schema with Foreign Keys
- Finding: Session tracking currently stores `repo_path` and run-key hints only.
- Thought: Session linkage should be explicit for analytics and sync performance.
- Instructions: Add `project_id`, `sprint_id`, `task_id`, and `run_id` references and indexed lookup paths.
- Done criteria: Session sync no longer depends only on title parsing for matching.
- Dependencies: T03, T14.

### T17 - Rework Run-Key and Branch Naming to Stable Task Identity
- Finding: Current run-key is slug-based and title-embedded.
- Thought: Stable IDs reduce collisions and simplify cross-project correlation.
- Instructions: Build new run key format with task UUID identity and update branch/tag generation compatibility.
- Done criteria: New sessions carry stable run IDs; legacy titles remain parseable.
- Dependencies: T16.

### T18 - Implement `start_onboarding` Workflow Foundation
- Finding: Onboarding is currently ad hoc and not stateful.
- Thought: Onboarding should be a resumable, instrumented run type.
- Instructions: Add onboarding workflow service with persisted step state (`DISCOVER`, `VALIDATE`, `CONFIGURE`, `DONE`) and MCP entrypoint.
- Done criteria: Interrupted onboarding can resume from persisted state.
- Dependencies: T03, T11.

### T19 - Implement `start_listen` Continuous Loop Foundation
- Finding: No dedicated persistent listen mode exists yet.
- Thought: Continuous listen mode is required for future autonomous operation.
- Instructions: Add listen service with loop heartbeat, checkpoint output interval, and safe stop controls.
- Done criteria: `start_listen` returns run handle + periodic checkpoint output; supports graceful cancellation.
- Dependencies: T12, T14.

### T20 - Add Project Run/Event Audit Trail
- Finding: Existing logs are structured but not queryable for project analytics.
- Thought: Persistent event trails are needed for auditability and diagnostics.
- Instructions: Persist major state transitions and tool execution events in `pm_task_events`/`pm_runs`.
- Done criteria: Every `start_*` tool invocation writes run + event records with correlation IDs.
- Dependencies: T03, T11.

### T21 - Define MCP Tool Catalog v2 and Validation Contracts
- Finding: Existing registry is tied to legacy source/session/activity tool family.
- Thought: New control-plane tools need strict schema and backward-compat policy.
- Instructions: Define typed arg/result contracts and runtime validators for Sprint 4 tool set.
- Done criteria: New tools are typed end-to-end and discoverable via `list_tools`.
- Dependencies: T01, T13.

### T22 - Implement `create_source` / `init_source`
- Finding: There is no first-class source-to-base-dir initialization flow.
- Thought: This is the entrypoint for project lifecycle creation.
- Instructions: Implement tool that validates base dir, resolves/links source identity, and creates project record.
- Done criteria: Creating same source/base-dir pair twice returns deterministic conflict response.
- Dependencies: T04, T21.

### T23 - Implement Sprint CRUD MCP Tools
- Finding: Sprint planning state cannot currently be edited through MCP as first-class DB entities.
- Thought: Agents need full sprint lifecycle CRUD and ordering controls.
- Instructions: Implement `create_sprints`, `update_sprint`, `delete_sprint`, `reorder_sprints`, plus list/read operations.
- Done criteria: Sprint CRUD is fully repository-backed and transaction-safe.
- Dependencies: T05, T21.

### T24 - Implement Subtask CRUD MCP Tools
- Finding: Task edits are currently markdown mutations.
- Thought: Subtask operations must be first-class CRUD skills.
- Instructions: Implement `create_subtasks`, `update_subtask`, `delete_subtask`, `reorder_subtasks`, and dependency update operations.
- Done criteria: Agents can fully manage tasks without touching files directly.
- Dependencies: T06, T07, T21.

### T25 - Implement Execution Tools: `start_sprint` and `start_subtask`
- Finding: Execution currently routes through legacy `sprint_agent`/`task_agent` assumptions.
- Thought: New execution entrypoints should consume project/sprint/task IDs directly.
- Instructions: Add tools that start orchestration pipelines with coordinator locking and scoped runtime status writes.
- Done criteria: Execution tools return structured run handles and checkpoint output.
- Dependencies: T12, T14, T21.

### T26 - Implement Utility Tools: `get_settings`, `set_setting`, `read_docs`, `get_help`
- Finding: Operators need runtime control and guidance tools in the new agentic surface.
- Thought: Utility tools reduce context switching and improve safe operation.
- Instructions: Add settings read/write (allowlisted), docs reader with path guards, and contextual help tool.
- Done criteria: Utility tools enforce path and key safety with deterministic validation errors.
- Dependencies: T21.

### T27 - Legacy Tool Transition and Jules Tool Deprecation Path
- Finding: Direct Jules API tools remain part of default external surface.
- Thought: Sprint 4 should shift default interface to project-management-first without abrupt breakage.
- Instructions: Move Jules source/session/activity tools behind internal toggle; keep temporary compatibility wrappers for `sprint_agent`/`task_agent`.
- Done criteria: Default `list_tools` emphasizes new agentic surface only; compatibility policy documented and tested.
- Dependencies: T21, T25.

### T28 - Implement Telemetry Capture for Tokens, Duration, and Provider Outcomes
- Finding: Token and duration analytics are not persisted as first-class entities.
- Thought: Telemetry must be captured at run/task boundaries during execution, not reconstructed later.
- Instructions: Record usage samples per provider run with token fields, duration, completion state, and failure category.
- Done criteria: Every task run writes duration + provider + token metrics (or explicit `unknown` markers).
- Dependencies: T16, T20.

### T29 - Build Stats Aggregation Service + APIs + Dashboard Foundation
- Finding: No project-level analytics API exists today.
- Thought: Comprehensive dashboard later requires stable backend stats contracts now.
- Instructions: Implement stats rollups per project/sprint/task (`token_totals`, `runtime_durations`, `success_rate`, `provider_mix`) and expose through new dashboard APIs.
- Done criteria: Dashboard can query project summary and sprint/task drill-down stats from backend endpoints.
- Dependencies: T28.

### T30 - Test, CI, and Documentation Hardening for Sprint 4
- Finding: Sprint 4 changes are cross-cutting and migration-sensitive.
- Thought: Strong test and docs gates are mandatory to prevent regression.
- Instructions:
  - Add integration tests for new MCP tools and migration paths.
  - Add repository tests for reorder transactions and dependency cycle rejection.
  - Add orchestration tests for DB-backed flow and execution lock behavior.
  - Update docs (`docs/mcp/tools-and-contracts.md`, `docs/settings/configuration-and-storage.md`, `docs/dashboard/dashboard-guide.md`, `docs/sprint-loop/atomic-loop.md`).
- Done criteria: `npm run ci` passes and documentation reflects actual post-migration behavior.
- Dependencies: T10, T19, T27, T29.

## 8. Suggested Delivery Order

- Week 1 (March 23-27, 2026): T01-T12
- Week 2 (March 30-April 3, 2026): T13-T30

## 9. Definition of Done for Sprint 4

- Database is canonical for project/sprint/task lifecycle operations.
- Agents can create/update/delete/reorder sprints and subtasks through MCP tools.
- `start_onboarding`, `start_sprint`, `start_subtask`, and `start_listen` are implemented with persisted run state.
- Default external MCP tool surface is project-management-first; legacy Jules API tools are no longer primary.
- Telemetry captures token usage and duration metrics with project/sprint/task rollups.
- Foundation constraint enforced: one active execution lane at a time, with explicit future extension points.
- Quality gates pass: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.

## 10. Risks and Mitigations

- Risk: Migration regressions while moving from markdown-backed to DB-backed task state.
  - Mitigation: keep importer/exporter parity tests and phased compatibility wrappers.
- Risk: Tool contract disruption for existing MCP clients.
  - Mitigation: preserve compatibility shims and publish deprecation matrix with target removal date.
- Risk: Token telemetry inconsistency across providers.
  - Mitigation: explicit nullable/unknown semantics and provider-specific capture adapters.
- Risk: Execution lock may be perceived as reduced capability.
  - Mitigation: document as intentional Sprint 4 safety constraint and provide multi-run roadmap in Sprint 5.

## 11. PR Strategy

- Keep PRs scoped to one task (or tightly coupled task pair).
- Target <400 changed lines per PR where feasible (excluding generated files/migrations).
- Require migration safety checklist in each PR:
  - schema impact
  - backward compatibility
  - rollback path
  - docs updated
  - test evidence
