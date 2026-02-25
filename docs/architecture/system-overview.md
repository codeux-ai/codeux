# System Overview

This project is a Model Context Protocol (MCP) server for Jules APIs with an integrated dashboard and an atomic sprint orchestration engine.

## Core Responsibilities

- Expose structured MCP tools for sources, sessions, activities, and orchestration.
- Orchestrate sprint subtasks with dependency-aware scheduling.
- Inject engineering guides into Jules task prompts.
- Provide an operational dashboard for status, activity, git, CI, and settings.
- Support editable markdown instruction templates for sprint loop messaging.

## Runtime Components

### 1. Entrypoint and runtime composition
- File: `src/index.ts`
- Responsibilities:
  - Load startup config and API key.
  - Instantiate repositories, services, handlers, orchestrator.
  - Start MCP stdio transport.
  - Start dashboard HTTP server.

### 2. MCP tool handlers
- `src/mcp/core-tool-handler.ts`
  - Handles core Jules API tools and wait logic.
- `src/mcp/agent-tool-handler.ts`
  - Handles `sprint_agent` and `task_agent`.

### 3. Sprint orchestration engine
- `src/sprint-orchestrator.ts`
- Atomic step modules in `src/sprint/steps/*`

### 4. Instruction template system
- `src/instructions/service.ts`
- `src/instructions/repository.ts`
- `src/instructions/template-engine.ts`
- Template catalog defaults in `src/instructions/catalog.ts`

### 5. Dashboard server and frontend
- API host: `src/dashboard.ts`
- Frontend app: `dashboard/src/*`

### 6. Data and settings repositories
- Guides: `src/guide-repository.ts`
- Subtasks: `src/subtask-repository.ts`
- Settings DB: `src/settings-repository.ts`

## Runtime Architecture Diagram

```mermaid
flowchart TD
  A[MCP Client] -->|stdio tool call| B[src/index.ts]
  B --> C[src/mcp/core-tool-handler.ts]
  B --> D[src/mcp/agent-tool-handler.ts]
  C --> E[src/jules-api.ts]
  D --> F[src/sprint-orchestrator.ts]
  F --> G[src/sprint/steps/*]
  F --> H[src/instructions/service.ts]
  H --> I[.jules-subagents/instructions/*]
  D --> J[src/task-service.ts]
  J --> K[src/guide-repository.ts]
  B --> L[src/dashboard.ts]
  L --> M[Dashboard UI dashboard/src/*]
  M -->|poll| N[/api/status + /api/live-activities + /api/git-status/]
  L --> O[src/settings-repository.ts]
  O --> P[(~/.jules-subagents/settings.db)]
```

## High-Level Data Flow

1. MCP client sends tool call over stdio.
2. Server dispatches tool to core or agent handler.
3. Handler invokes Jules API client and/or orchestrator.
4. Orchestrator runs atomic steps and updates `lastStatus`.
5. Dashboard polls `/api/status` and `/api/live-activities`.
6. UI renders task pipeline, protocol instructions, and git/CI state.

## Configuration Priority Model

For `.jules-subagents/settings.json` and guides, priority is resolved by search order in repositories and config loader.

Typical priority order (highest first):
1. Repo-scoped path (when `repo_path` provided)
2. Current working directory
3. Project root
4. Home directory (`~/.jules-subagents`)

Instruction templates use the same pattern, with support for both:
- `.jules-subagents/instructions`
- `.jules-subagents/intructions` (compatibility fallback)

## Safety and Guardrails

- Consecutive session creation failures trigger emergency stop (`maxFailures`).
- Branch preflight can block plan/orchestrate until local and remote sprint branch exist.
- Planning preflight can block status/orchestrate until subtask files exist.
- CI Intelligence settings add protocol-level merge guidance for comments/check gates.

## Extensibility Model

The system is designed for independent edits in these layers:
- Tool interface layer (`src/mcp/*`)
- Orchestration control layer (`src/sprint-orchestrator.ts`)
- Step behavior layer (`src/sprint/steps/*`)
- Human-facing protocol text layer (`.jules-subagents/instructions/*`)
- Dashboard settings/presentation layer (`dashboard/src/*`)
