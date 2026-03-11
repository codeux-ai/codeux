# Dashboard Guide

The dashboard provides real-time visibility and runtime controls for orchestration.

## Access

Default URL:
- `http://localhost:4444`

Configured by:
- dashboard settings (`dashboardPort`)
- `.env` (`DASHBOARD_PORT`)
- `config.json` (`dashboardPort` / `DASHBOARD_PORT` / `dashboard.port`)
- fallback default `4444`

If the requested port is busy, startup automatically retries the next port (`+1`) until it finds a free port.

## API Endpoints Used by Dashboard

Implemented in `src/server/dashboard-server.ts`.

Project management:
- `GET /api/projects`
  - Lists projects plus selected project id and aggregate counts
- `POST /api/projects`
  - Creates a project (`local` or `git`)
- `PATCH /api/projects/:projectId`
  - Updates project metadata
- `DELETE /api/projects/:projectId`
  - Deletes a project and cascades its sprints/tasks
- `PUT /api/projects/:projectId/select`
  - Persists the active dashboard project
- `GET /api/projects/:projectId/sprints`
  - Lists sprints for the selected project
- `POST /api/projects/:projectId/sprints`
  - Creates a sprint
- `POST /api/projects/:projectId/sprints/import`
  - Imports sprint/task markdown into sqlite
- `GET /api/projects/:projectId/sprints/:sprintId/export`
  - Exports one sprint plus its tasks back to markdown
- `PATCH /api/sprints/:sprintId`
  - Updates sprint metadata
- `DELETE /api/sprints/:sprintId`
  - Deletes a sprint and cascades its tasks
- `GET /api/projects/:projectId/tasks`
  - Lists tasks for a project, optionally filtered by `sprintId`
- `POST /api/projects/:projectId/tasks`
  - Creates a task
- `PATCH /api/tasks/:taskId`
  - Updates task metadata and dependency ids
- `DELETE /api/tasks/:taskId`
  - Deletes a task
- `GET /api/projects/:projectId/connections`
  - Lists MCP connections visible to the selected project
- `PATCH /api/connections/:connectionId`
  - Updates connection metadata such as role/status/instruction payload
- `GET /api/projects/:projectId/conversations/threads`
  - Lists project conversation threads
- `POST /api/projects/:projectId/conversations/threads`
  - Creates a new project conversation thread
- `GET /api/conversations/threads/:threadId/messages`
  - Lists stored messages for one thread
- `POST /api/projects/:projectId/conversations/messages`
- Stores a dashboard-authored message and queues it for a listener
- Threads now remain explicitly `unassigned` until the dashboard targets a connection or a real listener claims them
- The active thread header now supports explicit assignment and reassignment to a project-bound connection
- Reassigning a thread re-queues any unprocessed dashboard messages so the newly assigned listener can receive them
- Connection badges now reflect heartbeat-derived `stale` and `offline` states instead of keeping dead listeners permanently `connected`

Legacy runtime:
- `GET /api/status`
  - Selected-project runtime payload (`sprint_number`, `subtasks`, `instructions`, etc.) projected from sqlite
- `GET /api/execution`
  - Selected-project execution control-plane snapshot (`sprintRuns`, `taskDispatches`, `recentEvents`, lease ownership)
- `GET /api/telemetry/overview`
  - Cross-project overview telemetry snapshot for all currently active project runs
- `GET /api/realtime`
  - websocket upgrade endpoint for dashboard realtime subscriptions (`projects`, `overview`, `project:<projectId>`, `thread:<threadId>`)
- `GET /api/projects/:projectId/execution`
  - Project-scoped execution control-plane snapshot for the v2 runtime
- `GET /api/live-activities`
  - Session activity stream for running tasks in the selected project
- `GET /api/settings`
  - Persisted dashboard settings
- `PUT /api/settings`
  - Save settings
- `GET /api/settings/import-sources`
  - External key hints from env/json
- `GET /api/git-status`
  - Git branch, PR, CI, merge history, warnings
- `POST /api/tasks/:taskId/rerun`
  - Resets a selected-project runtime task and creates a fresh DB-backed task dispatch/task run for that task

## UI Sections

### V2 project management
- Top-nav project selector persists the active project in sqlite
- Projects page is DB-backed and can create/select/delete projects
- Project selector and project cards now refresh over websocket when the project collection or selected project changes
- Sprints page is project-scoped, creates sprint records in sqlite, and exposes markdown import/export controls
- Sprints page now also refreshes from project-structure realtime invalidation, so sprint CRUD and status-adjacent updates propagate across open dashboard tabs
- Sprints page now also starts and stops sprint orchestration directly from sprint cards, with optimistic visual state updates tied to project-scoped execution data
- The organic sprint bubble cells use the same live start/stop control path as the registry list, so the hover play/stop action is now functional instead of decorative
- Tasks page is project-scoped and supports create/edit/delete plus dependency metadata
- Tasks page now refreshes from the same project-structure realtime invalidation path as sprints
- Tasks and sprints now refresh silently on background realtime invalidation, so opening the Tasks page no longer repeatedly flashes loading state when project metadata or structure updates arrive
- Tasks page also stores explicit task executor preference (`auto`, `docker_cli`, `jules`, `mcp_worker`)
- The Tasks board entrance animation now replays only for project/view/filter changes instead of every background task refresh
- Overview widgets and headline stat cards now read project/task data from the same project-management API surface
- Agents page is DB-backed and manages project-scoped agent presets (`name`, `labels`, `instruction markdown`)
- Chat page is DB-backed and stores project conversation threads/messages in sqlite
- Chat page now receives websocket updates for thread assignment changes and incoming thread messages in the active thread
- Chat page now shows a live "working" bubble once a listener has picked up a dashboard message and is preparing a reply
- Chat threads can now be deleted directly from the history rail; deletion is realtime-aware and removes the thread across open dashboard views
- New thread creation now deduplicates optimistic UI insertion against realtime thread updates, so the sidebar count no longer briefly overstates the number of chats
- Chat page now hydrates thread lists and conversation panes from cache first, so revisiting a project or switching between already-seen threads is immediate instead of blocking on a fresh fetch
- Loading states are now reserved for first hydration only; realtime invalidation, manual refresh, send/delete flows, reassignment, and unrelated project updates refresh in the background without replacing the thread rail or active conversation with loading cards
- Creating and deleting threads now stay on the cache-first path too, so the thread rail count and conversation pane no longer flash or fall back to blocking loaders during thread mutations
- Chat composer now sends on `Enter` and inserts a newline on `Shift+Enter`
- Thread assignment control is explicitly labeled as `Worker:` in the thread header to make routing intent clearer
- Worker-routed tasks are created from the same task modal and appear in the same board; the executor badge shows whether work is automatic, CLI-backed, Jules-backed, or queued for a connected worker

### Dashboard view
- Task statistics
- Execution runtime panel for sprint runs, dispatch queue state, live project connections, worker assignment, lease ownership, and recent runtime events
- Live runtime visuals are only considered active when the selected project has a `running` or `queued` sprint run; cancelled, paused, and completed runs fall back to a waiting state
- Task pipeline cards
- Task cards include a `Rerun` action with confirmation prompt; rerun clears session/PR/merge state for that task and starts it again
- Reruns now reuse the same dispatch model as `sprint_agent` instead of bypassing execution state
- Task cards now open a DB-backed runtime feed sourced from `task_run_events`
- The runtime feed now includes direct CLI stage events, action-required and protocol events, sprint-run lifecycle events, and CI/merge-gate state changes in addition to provider session activity
- `recentEvents` is now a unified runtime timeline spanning both `task_run_events` and `sprint_run_events`
- The execution runtime panel can now start or resume sprint orchestration, pause or cancel sprint runs, cancel queued dispatches, and retry terminal dispatches
- The execution runtime panel now also shows live project connections with transport, role, listening metadata, inbox load, dispatch load, and heartbeat-derived status
- The Overview page telemetry now renders a consolidated runtime timeline across all currently active projects instead of a static placeholder
- Running dispatch cancel is now request-based instead of instant-terminal:
  - local CLI runs move to `cancel_requested` and abort through the process runner
  - worker runs move to `cancel_requested` and surface a stop request through the worker heartbeat response
  - Jules runs move to `cancel_requested` and get a best-effort in-session stop message
- Sprint runs also use `cancel_requested` while active work is shutting down, then finalize to `cancelled` once no active dispatches remain
- Dashboard rerun and cancel actions now rely on DB task/task-run/dispatch records instead of patching the selected-project runtime snapshot directly
- Live activity sidebar
- Protocol instruction panel
- Git/CI status panel

Runtime scoping:
- the selected project in the v2 top navigation now also scopes live session status, reruns, live activities, and git tracking
- the selected project also scopes Agents and Chat data
- dashboard runtime state is projected through sqlite task-run records instead of being served only from one in-memory global payload

### Settings view
- Basic settings
  - includes `Dashboard Port` field
- AI provider settings
- Git settings
- CI Intelligence settings
- Sprint loop step toggles
- MCP tool toggles
- Skill toggles

## Polling Behavior

From `dashboard/src/hooks/use-dashboard-runtime-data.ts`:
- Status and execution snapshot poll every 30 seconds.
- Git status polls every 30 seconds.

From `dashboard/src/hooks/use-overview-telemetry.ts` and `dashboard/src/v2/hooks/use-project-execution.ts`:
- Overview telemetry and project execution are now websocket-first through `/api/realtime`.
- Both still keep slower polling fallback for reconnect recovery and degraded transport cases.
- Websocket-backed fallback polling now defaults to `30s` instead of `10s`.
- Current websocket scopes are:
  - `projects`
  - `overview`
  - `project:<projectId>`
  - `thread:<threadId>`

Realtime consumers currently include:

- `dashboard/src/v2/context/project-data.tsx`
- `dashboard/src/v2/hooks/use-project-sprints.ts`
- `dashboard/src/v2/hooks/use-project-tasks.ts`
- `dashboard/src/v2/hooks/use-project-execution.ts`
- `dashboard/src/hooks/use-dashboard-runtime-data.ts`
- `dashboard/src/hooks/use-overview-telemetry.ts`
- `dashboard/src/v2/ChatPage.tsx`

Chat-specific behavior:

- The Chat refresh button is now manual-only.
- Background realtime sync and fallback refreshes no longer drive the refresh button spinner state.

Settings are loaded from `dashboard/src/hooks/use-dashboard-settings.ts` and saved through
`dashboard/src/lib/api/dashboard-api.ts` request helpers.

Project management requests are centralized in:
- `dashboard/src/v2/lib/project-api.ts`
- `dashboard/src/v2/context/project-data.tsx`
- `dashboard/src/v2/lib/connection-api.ts`

## Multi-Provider Settings

AI Provider settings now support:
- Providers: `jules`, `gemini`, `codex`
- Routing strategy:
  - `MANUAL` (single default provider)
  - `WEIGHTED` (weight-based distribution)
  - `ORCHESTRATOR` (rule-based routing with weighted fallback)
- Provider toggles (`enabled`)
- Model selection
  - Gemini: curated model list in UI
  - Codex/Jules: text model field
- Thinking mode (`SMALL`, `MEDIUM`, `HIGH`)
- Optional per-provider API key fields

Behavior:
- Empty provider key fields are valid.
- Runtime falls back to system auth/environment where supported.

## CI Intelligence Settings

Settings group:
- `enabled`
- `enableLivePrMonitoring`
- `waitForCiBeforeMainMerge`
- `resolveAllCommentsBeforeMainMerge`
- `waitForCiBeforeFeatureMerge`
- `resolveAllCommentsBeforeFeatureMerge`
- `waitForJulesCiAutofix`
- `julesCiAutofixMaxRetries`
- `featurePrAutoMergeMode` (`OFF|WHEN_GREEN|ALWAYS`)

Effect:
- These settings influence protocol text generated by orchestrator.
- When `waitForCiBeforeFeatureMerge` is enabled (REMOTE mode), merge readiness is now gated by real feature-PR checks (not instruction text only).
- `enableLivePrMonitoring` can disable live PR/CI polling gates entirely; in `LOCAL` git mode it is forced off.
- `waitForJulesCiAutofix` controls feedback mode while blocked:
  - enabled: explicit autofix-wait guidance for failed checks.
  - disabled: merge-gate guidance without autofix wording.
- `julesCiAutofixMaxRetries` sets how many Jules autofix notifications are attempted before escalation. Escalation output includes exact task ids, PR links, failed check names, failed run summaries, and failed job names so no manual searching is needed.
- `featurePrAutoMergeMode = WHEN_GREEN` executes feature-PR auto-merge once checks are green and review blockers are clear.
- `featurePrAutoMergeMode = ALWAYS` attempts feature-PR auto-merge regardless of CI state (subject to repository merge protections).
- Feature-PR CI wait/automerge matching uses worker branch first and falls back to the task `pr_url`, so tasks without a stored worker branch still remain gated correctly.
- CI Runs in `Feature PR CI` tracking include recent runs from PR head branches targeting the feature implementation branch (plus feature branch runs), sorted newest-first; the panel shows the latest 5.
- Failed CI runs in tracking are enriched with failed job details and failed-job log excerpts (bounded) from GitHub Actions `gh run view` data.
- Main merge stage (`feature -> main`) now emits live CI/review gate feedback with failed check names and ready-to-run `gh` commands.
- Main merge into default branch still stays manual.

## Sprint Loop Step Toggles

Each step can be independently enabled or disabled in settings:
- Branch preflight
- Planning preflight
- Load subtasks
- Session sync
- Status derivation
- Start ready tasks
- Merge protocol
- Action-required protocol
- Status table
- Watch loop

Use case:
- Controlled rollout, debugging, experimentation, or operational recovery.

## Git Status Panel Notes

`src/services/git-status-service.ts` behavior:
- Git/CI tracking uses the active sprint repository path (`repo_path`) from the latest sprint status update, not the MCP server repository root.
- In `LOCAL` mode, PR/CI tracking is disabled.
- In `REMOTE` mode, requires `gh` and auth.
- Warnings include common conflict/CI trigger issues.
- Tracking scope is dynamic and shown in panel metadata:
  - `Feature PR CI` while sprint tasks are actively running and feature CI wait gate is enabled.
  - `Main Branch CI` outside active running-task windows (including final merge stage).
- PR comment counters are sourced from GitHub `comments` payloads in both object and numeric shapes.
- Recent merges list includes all fetched merges into feature-prefixed branches and the default branch.

## No-Key Startup Mode

Server startup no longer exits when Jules API key is missing.

Behavior:
- MCP server and dashboard still start.
- API-backed tools return setup guidance until key is configured.
- Guidance points to:
  - `.env` (`JULES_API_KEY`)
  - `.jules-subagents/settings.json` (`julesApiKey`)
  - Dashboard settings (`http://localhost:4444` by default)

Runtime update:
- Saving a key in dashboard settings updates runtime API usage without restart.
- Leaving the dashboard key empty is supported; system-wide environment keys are used when present.

## Session Tracking and Live Feed

For provider-backed runs, session polling is now used to ingest durable runtime events into sqlite:
- Session IDs and states appear in task cards.
- Provider activity is mirrored into `task_run_events` and shown through the runtime feed.
- PR URL is shown once the workflow creates the PR.

## Security Notes

- API keys are masked in UI inputs.
- Settings persistence is local sqlite, not a cloud backend.
- Token priority for git status:
  - UI token first
  - then external hint fallback
- Markdown rendering now strips raw inline HTML before inserting into the DOM, reducing script injection risk from activity/prompt content.

## Frontend Architecture Notes

- `dashboard/src/app.tsx` now focuses on view composition only.
- Runtime status polling, live activity merge, and stat derivation are encapsulated in `use-dashboard-runtime-data`.
- Settings load/save/import flows are encapsulated in `use-dashboard-settings`.
- HTTP calls are centralized in `dashboard/src/lib/api/dashboard-api.ts` for consistent error handling and easier testability.
- V2 project CRUD and selected-project state are centralized in `dashboard/src/v2/lib/project-api.ts` and `dashboard/src/v2/context/project-data.tsx`.
- `dashboard/src/components/SettingsPage.tsx` now acts as a container and delegates each settings domain to focused section components under `dashboard/src/components/settings/`.
- Shared settings UI primitives now live in `dashboard/src/components/settings/primitives.tsx` (`SettingsCard`, `ToggleRow`, `FieldLabel`) to reduce duplicate form markup and keep section components consistent.
- `dashboard/src/components/ui/` now contains focused presentation subcomponents for large cards/sections:
  - `ui/task-card/` hosts `TaskHeader`, `SessionFeed`, `TaskMetadata`, and `StatusBadge`.
  - `ui/settings/` hosts `StrategySelector`, `ProviderConfigRow`, `ExecutionModeSelector`, and `DockerCredentialsSection`.
- Immutable settings state updates are centralized in `dashboard/src/lib/settings-updaters.ts`; settings sections consume these typed helpers instead of manually reconstructing nested objects.
- Task cards use button semantics and ARIA expansion state for title/details/log toggles.
