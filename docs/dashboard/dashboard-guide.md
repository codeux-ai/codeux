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
- `GET /api/projects/:projectId/agent-presets`
  - Lists DB-backed project agents and auto-imports unseen markdown agents from `.sprint-os/agents`
- `POST /api/projects/:projectId/agent-presets`
  - Creates a DB-backed agent and, when project markdown mirroring is enabled, also writes `.sprint-os/agents/<name>.md`
- `PATCH /api/agent-presets/:agentPresetId`
  - Updates agent metadata and instruction markdown, mirroring the markdown back into the project agent directory when enabled
- `DELETE /api/agent-presets/:agentPresetId`
  - Deletes an agent record
- `POST /api/agent-presets/:agentPresetId/import-markdown`
  - Re-imports a linked markdown agent into sqlite
- `POST /api/projects/:projectId/agent-presets/sync-markdown`
  - Re-imports every out-of-sync linked markdown agent for the selected project
- `POST /api/projects/:projectId/planning/improve-sprint-prompt`
  - Sends a draft sprint prompt to the Planning agent through a connected worker and returns the improved prompt
- `POST /api/projects/:projectId/sprints/:sprintId/plan`
  - Sends a created sprint to the Planning agent through a connected worker, creates subtasks from the reply, and can auto-start the sprint
  - Auto-start orchestration now prepares the local sprint feature branch automatically and attempts to push it to `origin` when that remote exists
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
- `GET /api/projects/:projectId/stats?window=24h|7d`
  - Project-scoped token/time statistics snapshot with hourly or daily buckets, task/sprint/provider/purpose rollups, and telemetry-source mix
- `POST /api/projects/:projectId/attention-items/:attentionItemId/claim`
  - Claims an active worker-owned attention item on behalf of the assigned project worker
- `POST /api/projects/:projectId/attention-items/:attentionItemId/resolve`
  - Resolves or dismisses an active attention item from the dashboard runtime surface
- `GET /api/live-activities`
  - Session activity stream for running tasks in the selected project
- `GET /api/system-settings`
  - Persisted system-wide settings (`runtime`, `integrations`, `defaults`, `mcpTools`)
- `PUT /api/system-settings`
  - Save system-wide settings
- `GET /api/projects/:projectId/settings`
  - Raw project override document
- `PUT /api/projects/:projectId/settings`
  - Save project overrides
- `DELETE /api/projects/:projectId/settings`
  - Reset project overrides back to inherited system defaults
- `GET /api/projects/:projectId/settings/effective`
  - Resolved project settings plus source metadata
- `GET /api/sprints/:sprintId/settings`
  - Raw sprint override document
- `PUT /api/sprints/:sprintId/settings`
  - Save sprint overrides (requires `projectId` in body)
- `DELETE /api/sprints/:sprintId/settings`
  - Reset sprint overrides
- `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`
  - Resolved sprint settings plus source metadata
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
- Sprint cells and ledger rows now surface a dedicated human-intervention badge when a paused sprint needs merge work, planning, or another operator action, and the hover card explains what to do before resuming
- Sprints page now also starts and stops sprint orchestration directly from sprint cards, with optimistic visual state updates tied to project-scoped execution data
- The organic sprint bubble cells use the same live start/stop control path as the registry list, so the hover play/stop action is now functional instead of decorative
- Sprint creation no longer asks for start/end dates
- Sprint creation now uses an in-page composer that replaces the showcase while writing, instead of opening a detached modal
- The sprint composer supports `Plan & Start`, `Plan Only`, and `Save Draft`
- Sprint data now hydrates cache-first when revisiting the page and refreshes in the background, so the showcase and ledger do not flash empty while the latest data loads
- `Improve with AI` is worker-backed through the Planning agent and only rewrites the sprint prompt
- Sprint planning is also worker-backed through the Planning agent and automatically creates task records from the returned plan
- The built-in Planning agent now expects a strict database task JSON contract:
  - task keys should use `T01`, `T02`, `T03`, ...
  - the `tasks` array is returned in DAG order
  - each task prompt is standardized to `Objective`, `Scope`, `Implementation Requirements`, `Constraints`, and `Verification`
- The sprint page now shows a visible planning-connection indicator, preferring a listen-mode project `worker` and then a listen-mode project `listener`
- New sprints are showcased by default, showcased sprints are controlled by the heart toggle, and the showcase gallery is no longer capped to 3 sprint cells
- Completed sprints are automatically removed from showcase pinning and drop out of the top gallery
- The sprint gallery selection is now the full set of showcased sprints, ordered newest-first by sprint creation time
- Completed sprint cells now use a static finished treatment and fade slightly instead of continuing animated motion
- Sprint cell settings now open an animated menu with showcase toggle, `Edit`, `Export`, `Delete`, and live `Overrides`
- The showcase wrappers now leave enough vertical breathing room for hover expansion, so bubble motion is no longer clipped top or bottom
- Sprint cells now use created-date metadata on the accent rail and move the visible sprint key into the card body instead of surfacing the UUID there
- Sprint markdown export now includes direct download actions in the export modal
- The in-page sprint composer collapses into a stacked single-column layout on smaller screens, and both create and edit now use that same inline flow
- The sprint ledger below the showcase now uses elevated card rows, supports sorting from the column headers, includes showcase pinning controls, and can sort by sprint id (`SPR-x`)
- Ledger rows now expose the same control model as sprint cells: a primary start/stop button, an `Open Subtasks` button, and a compact settings menu for edit/export/showcase/overrides/delete
- The sprint page no longer runs a full-page entrance fade on mount, which keeps initial navigation more immediate and avoids perceived flashing
- The sprint page now uses lighter targeted motion on the heading instead of a full-page fade, keeping navigation more immediate without leaving the page static
- Tasks page is project-scoped and supports create/edit/delete plus dependency metadata
- Navigating from a sprint cell into `View Tasks` now preselects that sprint instead of leaving the board on `All Sprints`
- Tasks page now refreshes from the same project-structure realtime invalidation path as sprints
- Tasks and sprints now refresh silently on background realtime invalidation, so opening the Tasks page no longer repeatedly flashes loading state when project metadata or structure updates arrive
- Tasks page also stores explicit task executor preference (`auto`, `docker_cli`, `jules`, `mcp_worker`)
- The Tasks board entrance animation now replays only for project/view/filter changes instead of every background task refresh
- Stats page is project-scoped and visualizes tracked token/time usage for the selected project with `24h` and `7d` windows
- Stats page now matches the high-interaction v2 dashboard card language more closely:
  - animated metric cards
  - a unified glass-panel system that mirrors the premium live card surfaces instead of using a separate visual treatment
  - a full-width analysis studio that switches completely between `Trend`, `Composition`, and `Reliability` modes
  - an interactive trend graph with hover bucket inspection and a toggleable legend for tokens, active time, and invocation volume
  - donut-style composition charts for providers, token anatomy, and telemetry-source mix
  - redesigned task and sprint ledgers with search, sort-by-recency/tokens/time/input/output/name, and richer token/time breakdowns
- The Stats page uses the same project realtime invalidation channels as the rest of the v2 dashboard, then falls back to polling so usage graphs and tables stay current during active sprint execution
- Overview widgets and headline stat cards now read project/task data from the same project-management API surface
- Agents page is DB-backed and manages project-scoped agents (`name`, `labels`, `instruction markdown`)
- Agents are auto-imported from project and home `.sprint-os/agents/*.md` when first discovered
- Project-local markdown mirroring is enabled by default through project settings, so dashboard edits create/update `.sprint-os/agents/*.md` in the selected repo without touching shipped defaults
- Markdown-backed agents now show sync state and support both manual single-agent re-import and bulk `Sync All`
- The first built-in role is `Planning agent`, which is editable under Agents like any other DB-backed agent
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
- When no sprint is running but a paused sprint needs human intervention, the overview telemetry now switches from an empty state to an attention state with the exact reason and operator instructions
- Task pipeline cards
- Task cards include a `Rerun` action with confirmation prompt; rerun clears session/PR/merge state for that task and starts it again
- Reruns now reuse the same dispatch model as normal dashboard orchestration instead of bypassing execution state
- Task cards now open a DB-backed runtime feed sourced from `task_run_events`
- The runtime feed now includes direct CLI stage events, action-required and protocol events, sprint-run lifecycle events, and CI/merge-gate state changes in addition to provider session activity
- `recentEvents` is now a unified runtime timeline spanning both `task_run_events` and `sprint_run_events`
- The selected-project execution snapshot now keeps the full task-dispatch and task-run event history for the active or most recent sprint run, so completed tasks in Live view keep their runtime feed and stage timings visible even after later tasks start
- The execution runtime panel can now start or resume sprint orchestration, pause or cancel sprint runs, cancel queued dispatches, and retry terminal dispatches
- The execution runtime panel now also exposes the active attention queue, including worker claim, resolve, and dismiss controls for open project blockers
- The Live page now keeps the Git/CI/PR card in a dedicated `GitCIStatusPanel` component so the page shell stays focused on wiring runtime state, controls, and layout
- Live task stats, filter counts, the active filtered task list, and per-card runtime payloads are memoized from the selected project's runtime snapshot so high-frequency realtime updates do not repeatedly recompute unchanged projections
- Live Session now shows a clear paused-for-human-intervention banner, repeats the reason/instructions in the hero state, and surfaces the same guidance inside paused sprint run cards
- worker-owned merge conflicts are now excluded from that human-intervention projection; they remain visible in the attention queue and realtime runtime feed, but they no longer tell the operator to merge or resume while the worker is handling them
- Worker mode is now explicit in settings:
  - `Connected MCP` keeps worker dispatches and worker-owned attention on live MCP listeners
  - `Virtual on-demand` hands that same work to short-lived internal CLI workers that do not create MCP connection rows
- The Live view no longer blocks task stats and task cards on the execution snapshot finishing first:
  - `/api/status` and `/api/execution` now hydrate independently
  - task stats and the race view can render from the latest runtime status snapshot even when execution metadata is still catching up
  - the page only shows the full `Waiting for Sprint Start` empty state when neither runtime status nor execution state has sprint context
- The Live view hero now has three interchangeable visualizations:
  - `Stats` for a compact asymmetric telemetry deck with one dominant sprint-time panel, a slimmer runtime intelligence rail, live flow-state deltas, merge pressure, and accumulated stage timing
  - `Race` for stage-based progress across the execution course
  - `DAG` for an animated dependency graph of the current sprint using real `depends_on` edges, live task phases, and merge-stage state
- The Stats deck no longer uses the old shimmer card treatment; count changes now surface as short-lived `+1` / `-1` indicators instead of flashing the entire card
- Sprint timing in the Stats deck now includes:
  - total sprint elapsed time
  - average completed-task duration
  - longest task duration
  - a Stage Ledger with four columns — `Coding`, `CI / Review`, `Autofix`, and `Merge` — showing accumulated wall-clock time per stage across all tasks; `Queued` time is tracked internally but is not surfaced as a stats column
- Task cards in Live view show per-stage timing pills so a task can separately expose coding time, CI wait time, autofix time, merge time, and a final total duration
- Execution summaries now also carry normalized usage rollups, so task, sprint, and project stats can report token/time telemetry without reconstructing it from raw provider output in the browser
- Virtual planning runs now persist into that same telemetry ledger with purpose `planning`, so sprint-level stats can show planning usage before orchestration even starts
- Completed task cards retain their final elapsed duration: once a task reaches a terminal state the elapsed-time badge freezes at the finish time and remains visible; only truly active work continues ticking once per second
- Stage timing is scoped to the current task identity and active sprint run, so reused task keys or stale task history from older attempts no longer leak durations into blocked or freshly restarted tasks
- Completed task timing stops at the task's terminal runtime event or dispatch finish time, so later provider/session sync noise does not keep increasing a finished task's total
- Once a merge-backed task is actually settled, Live view freezes that task back at coding completion instead of preserving later PR/merge wait as task runtime
- Coding-complete tasks freeze at coding completion until a real `CI / Review`, `Autofix`, or `Merge` runtime stage begins, so post-execution tasks do not keep counting as active coding time just because merge metadata exists
- `merge_indicator: AUTOMERGE` is treated as a settled merge state for live timing and sprint completion, so brief lag on the persisted `is_merged` flag does not reopen merge timers for already-merged tasks
- Stage attribution now follows the task runtime event stream more strictly:
  - `run_completed` and `cli_workflow_completed` mark the end of coding for PR-backed tasks
  - `ci_gate_status` drives later `CI / Review`, `Autofix`, and `Merge` buckets
  - auto-merge conflicts and merge-confirmation windows are counted under `Merge`, not `Code`
  - successful merge events such as `merge_confirmed` and `automerge_succeeded` stop the merge timer immediately, even if later sync events still arrive
- The selected-project execution snapshot now ships a deeper recent runtime event window so stage timing remains accurate across larger sprints and reruns
- In the active v2 settings UI, these controls live under `Settings -> Sprint Engine -> Worker Runtime`
- Sprint compose/planning also follows that same worker mode:
  - with `Connected MCP`, the composer looks for a live planning worker/listener
  - with `Virtual on-demand`, the composer shows the selected virtual worker route and planning works without any live MCP connection
- that exclusion is now sticky while the worker-owned conflict item remains active, so transient PR metadata gaps no longer flip the same task back into a manual merge warning
- the same suppression now applies to any active worker-owned supervision item, so agent-managed blocked dispatches and worker-owned action-required recovery no longer trigger the generic `Manual attention required` pause banner while the worker still has actionable queue work
- merge conflicts are now first-class task indicators in the live UI, including dedicated task badges and a realtime `Conflicts` metric in the runtime stats row
- Worker escalations now also create project chat threads with a system-authored handoff message, so operator follow-up lives in the same project conversation model as the rest of dashboard chat
- The execution runtime panel now also shows live project connections with transport, role, listening metadata, inbox load, dispatch load, and heartbeat-derived status
- stale and offline connection rows now disappear much faster in practice: cold start prunes disconnected connections with no active dispatches, and live heartbeat aging promotes dead workers to `stale` or `offline` quickly enough that new worker-owned merge conflicts route to the live connected worker instead of lingering on an older listener
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
- The active backend model is now scoped as `system -> project -> sprint`
- System settings own runtime, integrations, default project behavior, and MCP tool exposure
- Project settings own inheritable execution behavior such as provider routing, git defaults, CI intelligence, sprint loop steps, CLI workflow, and skills
- Project settings also own agent authoring behavior, including whether dashboard edits mirror agent markdown into the project directory
- The `/config` page keeps the existing v2 settings shell and categories, but now binds them to real scoped settings instead of draft-only values
- System scope only edits system-owned controls, while project scope only edits project-owned overrides for the selected project
- The integrations view now owns provider API keys plus GitHub token and GitHub workflow settings, rather than splitting those across separate categories
- The integrations view uses a registry-style list with per-integration `Configure` actions so additional integrations can be added without turning the page into one long form
- Individual MCP tool toggles and skill toggles are intentionally not exposed in the current user-facing settings surface
- The settings surface is regrouped into smaller operational cards so GitHub integration, provider credentials, merge gates, loop control, and execution runtime are separated cleanly
- Danger Zone now supports project deletion in project scope and full database reset in system scope
- Project saves operate on the effective form but persist only sparse diffs relative to the current system defaults
- Sprint settings are sparse overrides applied from the sprint page through the live override modal
- Effective settings APIs expose per-field source metadata so the UI can show inherited vs overridden values
- The old legacy dashboard settings route is removed; there is no runtime fallback to the pre-refactor global settings page

## Polling Behavior

From `dashboard/src/hooks/use-dashboard-runtime-data.ts`:
- Status and execution snapshot now use websocket-first updates with a `5s` fallback poll for degraded transport cases.
- Runtime fallback refresh now applies status and execution results independently instead of waiting for both responses before updating the page, which avoids slow `/api/execution` responses blanking the whole live view.
- Git status keeps a `30s` fallback poll and also refreshes opportunistically from project realtime events with internal rate limiting, so the live view no longer waits for the next full poll cycle after sprint activity.
- The sprint boat-race animation now resets cached vessel positions whenever the live sprint goes idle, and it keys each vessel by persisted task identity instead of raw task key so a new sprint starts from harbour rather than drifting backward from the previous finish line.
- The boat race no longer caps the visible fleet at ten vessels, and the race canvas now renders at a fixed `800px` height instead of scaling per-boat.

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

Live view behavior:

- `project.execution.updated` replaces the execution snapshot immediately
- `project.runtime_status.updated` replaces the runtime task state immediately
- `project.structure.updated` triggers a silent background reload for structural changes that are not already embedded in the execution payload
- attention queue changes now flow through the same realtime execution snapshot path, so merge-conflict escalation, worker claims, and resolution actions appear without waiting for a poll tick

The old legacy settings hook remains outside the active v2 flow; the live dashboard now uses the scoped settings API above.

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
- `featurePrAutoMergeMode = ALWAYS` bypasses CI waiting only when `waitForCiBeforeFeatureMerge` is disabled; if CI waiting is enabled, Sprint OS still waits for green checks before attempting auto-merge.
- a successful feature-PR automerge now refreshes dependency readiness in the same loop pass, so downstream tasks can continue without forcing a manual resume
- Feature-PR CI wait/automerge matching uses worker branch first and falls back to the task `pr_url`, so tasks without a stored worker branch still remain gated correctly.
- Tasks that are still waiting on feature-PR CI now persist as `in_progress` in the dashboard task store instead of staying marked `completed` just because the provider session finished.
- Feature PRs already in GitHub `DIRTY` merge state are surfaced as merge conflicts before any CI wait, so branch-protection deadlocks do not leave the task stuck in perpetual pending-check state.
- If a matched feature PR has no checks, Sprint OS now consults local workflow definitions and only keeps waiting when a `pull_request` or `pull_request_target` workflow actually applies to that PR base branch; otherwise the task skips CI waiting and proceeds to merge readiness/review gating.
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
