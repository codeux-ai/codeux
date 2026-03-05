# ADR: Sprint 4 Project Management Foundation and Tool Surface Migration

## Status
Accepted

## Context
The current runtime is still centered on:

- single in-memory sprint status context,
- markdown-first sprint/task persistence,
- and a Jules-centric MCP surface.

Product direction now requires a project-management-first model:

- database as source of truth,
- project identity linked to `(source_id + base_dir)`,
- agent-driven CRUD for sprints and tasks,
- onboarding/listen execution entrypoints,
- and persistent telemetry (tokens, durations, outcomes).

## Decision
Sprint 4 will establish a foundation-first architecture:

1. Introduce normalized project/sprint/task/run/telemetry schema in sqlite.
2. Migrate orchestration state reads/writes from markdown files to repositories.
3. Keep markdown as import/export compatibility path only.
4. Ship MCP Tool Catalog v2 focused on project management:
   - `create_source` (`init_source` alias)
   - `create_sprints`
   - `create_subtasks`
   - `start_onboarding`
   - `start_sprint`
   - `start_subtask`
   - `start_listen`
   - `get_settings`
   - `set_setting`
   - `read_docs`
   - `get_help`
5. Deprecate direct Jules source/session/activity tools from default external tool discovery.
6. Enforce a single active execution lane in Sprint 4 (safety-first), while building data/runtime contracts that allow future concurrent multi-project execution.

## Boundaries

- **Domain layer**:
  - owns planning/execution semantics, dependency validation, onboarding/listen flows, telemetry aggregation.
  - does not perform direct DB shell/file side effects.
- **Infrastructure layer**:
  - owns sqlite repositories, migrations, compatibility import/export.
- **API/MCP layer**:
  - owns tool contracts, validators, and compatibility wrappers.
- **Dashboard/API layer**:
  - consumes project-scoped status and stats endpoints.

## Migration Rules

1. Any touched sprint/task mutation path must write through repositories (no direct markdown mutation).
2. Any new MCP tool must have:
   - strict TypeScript argument contract,
   - runtime validator,
   - integration test.
3. Telemetry writes must happen during run execution, not only post-hoc.
4. Backward compatibility is required for transition period:
   - `sprint_agent` / `task_agent` remain as wrappers,
   - old Jules tools hidden by default, internal toggle only.
5. Documentation updates are mandatory with each tool or schema contract change.

## Non-Goals (Sprint 4)

- Full concurrent orchestration across multiple projects.
- Final comprehensive analytics UI (backend contracts and base surfaces only).
- Immediate full removal of compatibility wrappers before migration window closes.

## Sequencing

- Phase 1: data schema + repositories + importer.
- Phase 2: runtime context and orchestrator migration.
- Phase 3: MCP Tool Catalog v2 and execution tools.
- Phase 4: telemetry aggregation + dashboard foundation + hardening.

## Drivers

- Reliability: deterministic persistence and scoped runtime identity.
- Operability: auditable runs, events, and metrics.
- Agentic control: first-class CRUD and execution primitives for autonomous workflows.
