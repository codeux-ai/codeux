# Repository Map

This map explains where major responsibilities live.

## Top-Level Layout

```text
.
├─ src/                        # Backend MCP server and orchestration engine
├─ dashboard/                  # Preact dashboard app
├─ .jules-subagents/           # Local default guides + instruction templates
├─ docs/                       # Project documentation
├─ dist/                       # Compiled backend output
└─ package.json                # Scripts and dependencies
```

## Backend (`src/`)

- `index.ts`
  - Runtime composition and server startup.
- `mcp/`
  - `core-tool-handler.ts`
  - `agent-tool-handler.ts`
- `sprint-orchestrator.ts`
  - Main sprint orchestration coordinator.
- `sprint/steps/`
  - Atomic step modules used by orchestrator.
- `instructions/`
  - Template loading, fallback, and placeholder rendering.
- `jules-api.ts`
  - Jules API HTTP client.
- `dashboard.ts`
  - Express routes for dashboard APIs and static assets.
- `settings-repository.ts`
  - Persistent dashboard settings in sqlite.
- `guide-repository.ts`
  - Guide markdown search and loading.
- `subtask-repository.ts`
  - Subtask markdown parsing.
- `git-status-service.ts`
  - Git/PR/CI tracking abstraction.

## Dashboard (`dashboard/src/`)

- `app.tsx`
  - Main view orchestration and polling.
- `components/`
  - UI pieces (`SettingsPage`, `TaskCard`, `ActivitySidebar`, etc.).
- `lib/`
  - Frontend helpers (`settings`, `status`, `activity`, `markdown`).
- `types.ts`
  - Dashboard-side type contracts.

## Local Configuration and Templates (`.jules-subagents/`)

- `agents/`
  - `worker.md`, `orchestrator.md`, `watch.md`, `git_manager*.md`, etc.
- `instructions/`
  - Organized sprint-loop templates (guards/planning/protocol/watch/cleanup).
- `sprints/`
  - Runtime sprint plans and generated subtask markdown files.

## Documentation (`docs/`)

- `index.md`
  - Documentation home.
- Topic folders (`mcp/`, `sprint-loop/`, `dashboard/`, etc.)
- `yourdocs.md`
  - Atomic refactor notes and migration details.
