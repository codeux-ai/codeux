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

## Live Data Contracts
All live fields rendered in the dashboard originate from the SQLite database, are assembled by the backend, and transported via HTTP/WebSockets. The browser does not reconcile competing states. See the [Live Runtime Contract](../architecture/live-runtime-contract.md) for details on ownership of fields like `projectId`, `status`, and `execution`.

## API Endpoints

Implemented in `src/server/dashboard-server.ts`.

Project management:
- `GET /api/projects`
  - Lists projects plus selected project id, selected sprint id, and aggregate counts
- `POST /api/projects`
  - Creates a project (`local` or `git`)
  - May include `setup.enabled: true` with setup options to run the Project Setup Agent immediately after creation
- `POST /api/projects/:projectId/setup`
  - Runs the Project Setup Agent for an existing project and applies selected setup artifacts (`agents`, `quicksprints`, `previewScript`, `ci`)
  - With `background: true`, returns `202` plus `invocationId` immediately so the dashboard can track the run in the invocation rail while setup continues server-side
- `PATCH /api/projects/:projectId`
  - Updates project metadata
- `DELETE /api/projects/:projectId`
  - Deletes a project and cascades its sprints/tasks
- `PUT /api/projects/:projectId/select`
  - Persists the active dashboard project
- `PUT /api/projects/:projectId/selected-sprint`
  - Persists the active sprint for the selected project
- `GET /api/projects/:projectId/sprints`
  - Lists sprints for the selected project, plus the currently selected sprint ID
- `POST /api/projects/:projectId/sprints`
  - Creates a sprint
- `POST /api/projects/:projectId/sprints/import`
  - Imports sprint/task markdown into sqlite
- `GET /api/projects/:projectId/issues`
  - Searches GitHub/GitLab issues for the selected project using provider, repository, text, state, label, and assignee filters
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
  - Lists DB-backed project agents and auto-imports unseen markdown agents from `.code-ux/agents`
- `POST /api/projects/:projectId/agent-presets`
  - Creates a DB-backed agent and, when project markdown mirroring is enabled, also writes `.code-ux/agents/<name>.md`
- `PATCH /api/agent-presets/:agentPresetId`
  - Updates agent metadata and instruction markdown, mirroring the markdown back into the project agent directory when enabled
- `DELETE /api/agent-presets/:agentPresetId`
  - Deletes an agent record
- `POST /api/agent-presets/:agentPresetId/import-markdown`
  - Re-imports a linked markdown agent into sqlite
- `POST /api/projects/:projectId/agent-presets/sync-markdown`
  - Re-imports every out-of-sync linked markdown agent for the selected project
- `POST /api/projects/:projectId/planning/improve-sprint-prompt`
  - Sends a draft sprint prompt to the Planning agent through the configured virtual worker provider and returns the improved prompt
  - Planning overrides may explicitly target a specific `planningAgentPresetId`, as well as a virtual CLI provider/model for that one request. The composer defaults to the project Agent Routing planning preset.
- `POST /api/projects/:projectId/sprints/:sprintId/plan`
  - Sends a created sprint to the Planning agent through the configured virtual worker provider, creates subtasks from the reply, and can auto-start the sprint
  - Auto-start orchestration now prepares the local sprint feature branch automatically and attempts to push it to `origin` when that remote exists
  - Planning overrides may explicitly target a specific `planningAgentPresetId`, task coding routing mode, manual worker preset, and virtual CLI provider/model for that one request.
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
- `GET /api/projects/:projectId/scheduler?from=<iso>&to=<iso>`
  - Lists persisted scheduler entries plus expanded calendar occurrences for the requested window
- `POST /api/projects/:projectId/scheduler`
  - Creates a scheduler entry for a sprint, quicksprint template, or chat message
- `PATCH /api/scheduler/:entryId`
  - Updates scheduler status, timing, recurrence, or target payload
- `DELETE /api/scheduler/:entryId`
  - Deletes a scheduler entry

Legacy runtime:
- `GET /api/status`
  - Selected-project runtime payload (`sprint_number`, `subtasks`, `instructions`, etc.) projected from sqlite, explicitly scoped to the newly persisted active sprint when one is set
- `GET /api/execution`
  - Selected-project execution control-plane snapshot (`sprintRuns`, `taskDispatches`, `recentEvents`, lease ownership)
- `GET /api/telemetry/overview`
  - Cross-project overview telemetry snapshot for all currently active project runs
- `GET /api/realtime`
  - websocket upgrade endpoint for dashboard realtime subscriptions (`projects`, `overview`, `project:<projectId>`, `thread:<threadId>`)
- `GET /api/projects/:projectId/execution`
  - Project-scoped execution control-plane snapshot for the v2 runtime
- `GET /api/projects/:projectId/stats?window=24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Project-scoped token/time statistics snapshot with adaptive hourly/daily/weekly buckets, task/sprint/provider/purpose rollups, and telemetry-source mix
  - `custom` requires both `from` and `to`; presets ignore them
- `POST /api/projects/:projectId/attention-items/:attentionItemId/claim`
  - Claims an active worker-owned attention item on behalf of the assigned project worker
- `POST /api/projects/:projectId/attention-items/:attentionItemId/resolve`
  - Resolves or dismisses an active attention item from the dashboard runtime surface
- `GET /api/system-settings`
  - Persisted system-wide settings (`runtime`, `integrations`, `defaults`, `mcpTools`)
  - `runtime.consoleLogLevel` controls server console verbosity:
    - `standard` keeps important lifecycle, orchestration, MCP, invocation, warning, and error output visible.
    - `full` also prints routine dashboard HTTP request-completion logs.
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
- `GET /api/projects/:projectId/preview/sessions`
  - Lists persisted sprint preview container sessions for the selected project
- `POST /api/projects/:projectId/sprints/:sprintId/preview/start`
  - Starts or reuses the sprint-scoped preview container for one sprint
- `POST /api/browser/sessions/:sessionId/rebuild`
  - Rebuilds and restarts one sprint preview session
- `POST /api/browser/sessions/:sessionId/stop`
  - Stops one sprint preview session
- `GET /api/projects/:projectId/sprints/:sprintId/preview/script`
  - Loads the editable preview startup script or generated fallback for one sprint
- `PUT /api/projects/:projectId/sprints/:sprintId/preview/script`
  - Saves the sprint-local preview startup script override
- `GET /api/browser/sessions/:sessionId/logs`
  - Returns recent preview container logs
- `ALL /api/browser/sessions/:sessionId/proxy/*`
  - Same-origin proxy used by the in-app browser to render the sprint preview app
- `GET /api/settings/import-sources`
  - External key hints from env/json
- `GET /api/onboarding/readiness`
  - First-run onboarding readiness payload with Docker/Git dependency checks and local provider auth detection
- `GET /api/local-directories?path=/absolute/path`
  - Lists child directories for the local Add Project directory picker, including current, parent, root, and home paths for browser-style navigation
- `GET /api/git-status`
  - Git branch, PR, CI, merge history, warnings
- `POST /api/tasks/:taskId/rerun`
  - Resets a selected-project runtime task and creates a fresh DB-backed task dispatch/task run for that task
- `POST /api/projects/:projectId/sprints/:sprintId/orchestrate`
  - Starts sprint orchestration for the selected sprint
- `POST /api/sprint-runs/:sprintRunId/pause`
  - Pauses an active sprint run
- `POST /api/sprint-runs/:sprintRunId/resume`
  - Resumes a paused sprint run
- `POST /api/sprint-runs/:sprintRunId/cancel`
  - Stops an active sprint run

## UI Sections

### Stats page
- The Stats page keeps the time-window selector in the hero header, above the visual mode tabs, so preset and custom range controls remain visible no matter which analysis tab is active.
- The trend-chart filter flyout is now metric-series only, which keeps the graph controls focused on series visibility while the header owns the time range.
- The system invocation ledger beneath the stats analysis views is a sortable, card-row table with sticky sort controls for Time, In, Out, Total, and Duration; explicit input/output/cached/total token columns; status chips; task context chips; empty and loading states; and expandable detail placeholders that will later host message history.
- The System stats view uses a local `useSystemViewData(projectId)` hook to fetch project invocation records, apply client-side search/filter/sort state, and derive summary metrics directly from the filtered list.

### V2 project management
- The `AvantgardeSelect` popup now restores focus to its trigger on `Escape`, keeps arrow-key highlight changes visually eased, and clamps its portal position against scroll/resize boundary changes so the dropdown stays inside clipped cards and dialogs.
- Interactive dashboard controls use pointer cursors consistently: enabled buttons, links, tab controls, form toggles, menu/popover triggers, DAG nodes, cards, and dismissible overlays expose a pointer affordance, while disabled controls retain `not-allowed`.
- V2 pages use the shared `PageContainer` atomic component for page-level layout. Its `2400px` max width matches the `/` overview dashboard and is the single source of truth for page container width across overview, project, sprint, task, live, memory, stats, settings, agents, chat, and browser routes.
- Top-nav project selector persists the active project in sqlite
- Top-nav sprint selector persists the active sprint for the selected project
- Top-nav search sits in the left header cluster beside the brand, while the active task counter uses the same compact height as the project, sprint, and worker selectors
- The Live Sprint Clock card in the Sprint Stats deck now shows a six-tile grid with Finished, Avg Finish, Accumulated, Input, Output, and Cached values, and the token tiles reuse the shared compact formatter from the Stats page.
- Live runtime pages now use the persisted top-nav sprint selection as the page scope, so the Live view follows the selected sprint from the header menu
- That selection is view-only for the dashboard surface; it does not change which sprint run is actually executing in the backend
- The Live page Git / CI / PR panel now uses compact status metric tiles plus state-specific iconography for PR and CI rows, including animated indicators for active CI states (`IN_PROGRESS`, `QUEUED`, `PENDING`, `QUOTA`) with reduced-motion fallback (`motion-reduce:animate-none`)
- Creating a new sprint automatically updates the active sprint selection to that new sprint
- The top-nav worker selector now always lists the built-in virtual workers even when no live MCP worker is connected
- Selecting a virtual worker from the top nav switches the selected project into `workers.executionMode = VIRTUAL` with that provider
- Connected MCP worker selection has been removed; the worker selector is now virtual-only
- Projects page is DB-backed and can create/select/delete projects
- The `Add Project` dialog now keeps keyboard focus inside the active form field while typing, and its initial focus respects the form's `autofocus` input instead of jumping to the header close button
- The Projects page `Add Project` placeholder card uses the same full-height card footprint and internal padding as project cards, and the add dialog fields use rounded field surfaces with amber focus states instead of bare underline inputs; the dialog also constrains itself to the viewport on shorter screens
- The `Add Project` dialog now has a wider desktop layout, keeps a stable Git-form-height floor while switching source types, and exposes the inline directory browser on both local project paths and optional Git clone destination paths, with home, refresh, parent-directory navigation, child-directory traversal, and an explicit use-current-folder action
- The `Add Project` dialog now also includes a `New Project` source type. That branch keeps creation inside the same modal, preselects `Local Repo` or `Remote Repo` init modes, shows provider and visibility toggles for remote initialization, and skips the Project Setup Agent controls entirely.
- The `Add Project` dialog preselects Project Setup Agent initialization. When enabled, creation advances to a setup scope step where operators choose Agents, Quicksprint Templates, Preview Container Script, and CI before the backend creates repository-specific artifacts.
- Existing project cards expose a Project Setup Agent action that opens the same setup scope for later initialization or regeneration. See [Project Initialization](./project-initialization.md).
- Project setup runs display immediate toast feedback, an `Initializing` project-card state, and direct `Open invocation` actions while the background setup invocation is running and after it finishes.
- Git URL projects are cloned into a local checkout before the project record is created. When the optional clone directory is left empty, Code UX uses `~/.code-ux/projects/<repo-name>` so Docker workspaces always seed from a real repository root instead of a relative placeholder path.
- Project selector and project cards now refresh over websocket when the project collection or selected project changes
- Sprints page is project-scoped, creates sprint records in sqlite, and exposes a structured Import flyout with Markdown plus GitHub/GitLab/Jira issue import capabilities, plus markdown export controls. See [Sprint Imports](./sprint-imports.md).
- Sprints page now also refreshes from project-structure realtime invalidation, so sprint CRUD and status-adjacent updates propagate across open dashboard tabs
- Sprint cells and ledger rows now surface a dedicated human-intervention badge when a paused sprint needs merge work, planning, or another operator action, and the hover card explains what to do before resuming
- Sprint and Live status messaging now uses a shared presentation mapper (`dashboard/src/v2/lib/sprint-status-presentation.ts`) so manual pauses and system-stopped states render consistent title/reason/detail copy and consistent human-intervention badge visibility across cards, rows, and live detail panels
- Sprints page now also starts and stops sprint orchestration directly from sprint cards, with optimistic visual state updates tied to project-scoped execution data
- The organic sprint bubble cells use the same live start/stop control path as the registry list, so the hover play/stop action is now functional instead of decorative
- Sprint cells now surface a QA-reviewed indicator with an expandable overlay section inside the created column, and allow marking sprints completed directly from the cell menu
- Task rows and Live task cards now surface task-level QA review badges from the latest task QA run, including a running indicator while QA review is in progress.
- Rendered markdown previews use near-black body, heading, list, blockquote, and table text in light mode while preserving slate/white dark-mode text and signal-colored links/code.
- Live task cards now include `Edit` and `Force complete` actions:
  - `Edit` deep-links to `/tasks?taskId=<taskId>&sprintId=<sprintId>` so operators can open the task editor directly from the live surface.
  - `Force complete` calls `POST /api/projects/:projectId/tasks/:taskId/force-complete`, disables itself for already completed tasks, and surfaces inline failures on the card.
- Sprint creation no longer asks for start/end dates
- Sprint creation now uses an in-page composer that replaces the showcase while writing, instead of opening a detached modal
- The sprint composer supports `Plan & Start`, `Plan Only`, and `Save Draft`.
- The sprint composer prompt area renders a full-width editor until an original prompt exists, at which point it uses a split layout.
- The sprint composer now shows a live Sprint Name boundary counter with helper text, and its imported issue and original-prompt panels animate in with a subtle fade-and-slide entry when they appear.
- Sprint key previews now reserve pending creation numbers in the page state, so opening `New Sprint` or `Quicksprint` while another create/plan request is still pending advances the visible key sequentially (for example `SPR-02` then `SPR-03`) and releases reservations after refresh or failure.
- When planning a sprint (`Plan Only` or `Plan & Start`), the pre-improvement raw prompt is saved to `originalPrompt` if it isn't already set, keeping the worker-improved text as the goal.
- The planning feedback overlay surfaces both an ETA countdown and an elapsed runtime timer. ETA comes from `GET /api/projects/:projectId/sprints/composer/eta`, computed server-side from the latest 10 planning invocations for the selected project, with a 3:00 fallback when no usable sample exists.
- When editing a sprint that already has planned tasks, the composer offers `Replan` (discard and regenerate subtasks), `Append Tasks` (open a task-creation modal pre-scoped to the sprint with dependency selection from existing tasks), and `Save Draft` (update name/goal only)
- The sprint composer includes a planning-agent selector that allows operators to choose an alternate planning preset (filtered for presets with a `planning` label) for the current sprint. Leaving this on the default `Planning agent` preserves existing behavior, and any selection is honored by `Plan ahead with AI`, `Plan Only`, `Plan & Start`, and `Replan`.
- Imported GitHub/GitLab/Jira issues render as linked issue cards directly under the Sprint Prompt field and are persisted with the sprint. The prompt receives a linked-issues markdown section so planning sees the imported issue scope.
- Settings -> Sprint -> Git Flow includes `Auto-close linked issues`, which closes imported GitHub/GitLab issues only after sprint completion and the main merge gate is no longer blocking. Jira auto-close is configured separately in Settings -> Integrations -> Jira and uses the configured transition name.
- The sprint composer now features a visible, animated planning feedback overlay that replaces the generic spinner during `Plan ahead with AI`, `Plan Only`, `Plan & Start`, and `Replan` actions.
- Planning feedback is deterministic and staged, using an animated ship treatment (Wooden Ship for AI improvement, Container Ship for planning) that drifts across the composer based on elapsed time to make progress visible
- Planning and prompt-improvement requests continue server-side if the browser tab is refreshed or closed. The overlay's `Cancel Active Request` action now sends an explicit cancellation request, while `New Sprint` detaches the current planning run from the composer and opens a fresh sprint form without blocking the active run.
- Clicking `Minimize` fully dismisses the planning overlay action row (`Minimize`, secondary action, and overlay cancel button). Any progress restore affordance remains inside the composer/quicksprint panel layout instead of floating over unrelated page content.
- Sprints page `View Tasks`/`Open` links pass the sprint id to the Tasks page and the Tasks page persists that sprint as the global selected sprint scope, keeping the top navigation selector and page-wide task filtering aligned.
- Settings now expose separate CLI retry controls for quota resets and rate limits, including the rate-limit delay and a max rate-limit retry count (`5` by default). Session sync preserves quota/rate-limit dispatch errors so active retry timers remain visible, while expired or missing cooldown metadata requeues the task instead of leaving it stuck in `QUOTA`.
- The v2 settings workspace restores the full Git Flow and Git host controls:
  - Git Flow lives in the Sprint tab with default branch, branch prefix, sprint branch scheme, remote/local mode, and auto-create PR
  - Integrations exposes system GitHub, GitLab, and Jira credentials plus per-scope GitHub auth-copy mounts and Docker git identity; local `.gitconfig` copying hides the editable name/email fields when enabled
  - CLI provider credentials are managed per named instance, including optional local auth-copy mounts and custom auth paths for each Gemini, Codex, or Claude entry
- The first-run onboarding flow guides operators through installation checks, container security basics, provider auth-copy setup, AI behaviour defaults, appearance preferences, and primary dashboard controls. See [Dashboard Onboarding](./onboarding.md).
- The Docker top-nav control now consumes onboarding readiness data. If Docker is unavailable, it shows a `Cluster not ready` badge with an info icon and explains that Docker is mandatory for containerized CLI execution.
- Settings -> General now orders runtime setup as Automation, System Runtime, Docker Runtime, then Onboarding. The old Inheritance Model card has been removed from General, and `Open Onboarding` remains at the bottom to reopen setup without clearing saved settings.
- Settings -> Appearance previews unsaved edits immediately in the active dashboard shell. Theme, motion, navigation mode, animated/static background selection, static color, uploaded background image, and pattern overlay all update before Save Changes; leaving Settings clears the preview back to the persisted effective settings.
- Settings now guard unsaved edits during route transitions and browser refresh/close events. Internal navigation prompts only when the active settings scope is dirty, and listeners are removed immediately after save, explicit reset/discard flows, or Settings page unmount.
- Saved system or project settings invalidate cached effective project settings in mounted dashboard routes, so persisted appearance changes continue applying after navigating away from Settings without requiring a full app reload.
- The notification center now renders startup-check notifications from real readiness data and persists read/dismissed notification state in browser storage.
- GitLab support is available from Integrations with dashboard token persistence, backend GitLab host detection, `glab` support, and GitLab CI queries. `GITLAB_TOKEN` / `GLAB_TOKEN` remain supported as external fallbacks.
- The Integrations catalog is grouped by purpose (`CLI`, `GIT`, `PM`) and keeps host hint import plus runtime auth-copy status in the panel header.
- Jira support is available from Integrations with system-scoped site URL, account email, API token, default project key, close transition, and Jira-specific auto-close controls. The Sprints page Jira import opens directly from the Import menu and links selected issues into the same composer flow as GitHub/GitLab imports.
- Sprint data now hydrates cache-first when revisiting the page and refreshes in the background, so the showcase and ledger do not flash empty while the latest data loads. First-hydration uses skeleton placeholders while background refreshes continue, preserving existing data without reintroducing blocking loaders
- Sprint and task list windows support selectable page size options (`10`, `20`, `50`, `100`, `All`) with a default of `20` (a frontend-only view change with no API contract change)
- The Sprints page gallery show/hide control persists its browser-local visibility preference, so the gallery remains hidden or shown after navigation and reloads
- `Improve with AI` is worker-backed through the Planning agent and only rewrites the sprint prompt
- Sprint planning is also worker-backed through the Planning agent and automatically creates task records from the returned plan
- The built-in Planning agent now expects a strict database task JSON contract:
  - task keys should use `T01`, `T02`, `T03`, ...
  - the `tasks` array is returned in DAG order
  - each task prompt is standardized to `Objective`, `Scope`, `Implementation Requirements`, `Constraints`, and `Verification`
- The sprint page now routes planning through the configured virtual worker provider instead of waiting on a connected worker
- New sprints and quicksprints are showcased by default, showcased sprints are controlled by the heart toggle, and the showcase gallery is no longer capped to 3 sprint cells
- Showcase pinning is now fully operator-controlled; pinned sprints remain in the gallery until explicitly unpinned, surviving transitions like sprint start, pause, and completion
- Showcase heart controls in the sprint ledger remain available for completed sprints, so completed work can stay pinned in or be removed from the gallery manually
- Sprint ledger row action menus and sprint showcase cell action menus now use sprint-scoped fixed-position math (`dashboard/src/v2/lib/sprint-menu-positioning.ts`) that right-aligns to the trigger edge, clamps inside viewport padding, and flips upward near the viewport bottom without changing shared dropdown behavior used by unrelated components
- The sprint gallery selection is now the full set of showcased sprints, ordered newest-first by sprint creation time
- The Sprints page top action row includes a `Hide Gallery` / `Show Gallery` control that collapses or restores the sprint gallery cells without affecting Import, Quicksprint, New Sprint, or the ledger.
- On a fresh installation with no selected project, the Sprints page renders a polished project-scope placeholder with working `Add First Project` and `Manage Projects` actions; the first action opens the shared Add Project dialog directly
- Completed sprint cells now use a static finished treatment and fade slightly instead of continuing animated motion
- Sprint cell settings now open an animated menu with showcase toggle, `Edit`, `Export`, `Delete`, and live `Overrides`
- The showcase wrappers now leave enough vertical breathing room for hover expansion, so bubble motion is no longer clipped top or bottom
- Sprint cells now use the created column for both created-date metadata and QA review badges, and move the visible sprint key into the card body instead of surfacing the UUID there
- The sprint cell `Needs you` intervention indicator now sits slightly higher and farther right in the metadata corner, and its pulse animation runs slower while honoring reduced-motion settings by disabling the pulse.
- QA review badge overlays on sprint cells and ledger rows render beside the badge icon through a viewport-level overlay, so review summaries and findings are not clipped by the ledger controls or table layout.
- Sprint markdown export now includes direct download actions and per-section copy-to-clipboard buttons (with brief `Copied` confirmation) in the export modal
- The in-page sprint composer collapses into a stacked single-column layout on smaller screens, and both create and edit now use that same inline flow. The Quicksprint panel and the Sprint Composer are mutually exclusive; opening one automatically dismisses the other to maintain focus.
- The Quicksprint panel now separates `Default Templates` from custom templates and includes a purpose selector for built-in template sets. The first shipped built-in purpose is `Fullstack JS App`, which groups six project-agnostic engineering and UI quicksprint templates. See [Quicksprint Templates](./quicksprint-templates.md).
- The refreshed sprint ledger below the showcase renders as a responsive card/table hybrid: mobile rows collapse into touch-friendly sprint cards, desktop keeps sortable table scanning, and the header includes live visible/pinned/active/completed counters.
- The desktop ledger table now enforces mirrored per-column width guards (`w-*` + `min-w-*`) with a container-scoped horizontal scroller, preventing header/body overlap at narrow widths while avoiding page-level horizontal overflow.
- Sprint ledger rows now include dedicated mobile field labels (`Sprint ID`, `Sprint`, `Status`, `Tasks`, `Completion`, `Created`, `Controls`) so narrow viewports keep critical values readable without clipping.
- Ledger controls include real-time search, dropdown filters for status, showcase, and QA state, page-size selection, a filtered/total counter, and a clear action that resets the full filter set.
- Ledger search integrates with selection: the header select-all checkbox operates on the currently filtered set only, and the selection is automatically pruned when the filter changes so stale hidden selections cannot accumulate
- When one or more ledger rows are selected, a bulk action bar appears with `Start` and `Delete` controls that operate on all selected sprints, plus a `Clear` button to deselect
- Sprint ledger row controls now expose pause/resume in addition to existing start/stop semantics, and each runtime action shows pending/disabled state while the control request is in flight.
- Sending a chat message now inserts an optimistic invocation row immediately in the invocations rail and reconciles it when the server returns the persisted invocation record.
- Sortable column headers cycle through unsorted, ascending, and descending for showcasePinned, sprintKey, name, status, tasksCount, completion, and createdAt (default: newest-first)
- Ledger rows expose: pinned/showcase state, sprint key, review and human-intervention badges, task count, gradient progress, created/updated metadata, a primary start/stop button, an `Open Subtasks` deep link (`/tasks?sprint=<id>`) that navigates to the Tasks page pre-filtered to that sprint, and a compact settings menu for edit/export/showcase/overrides/delete
- The sprint page no longer runs a full-page entrance fade on mount, which keeps initial navigation more immediate and avoids perceived flashing
- The sprint page now uses lighter targeted motion on the heading instead of a full-page fade, keeping navigation more immediate without leaving the page static
- Sprint composer planning-route overrides now correctly force the selected virtual provider instead of only overriding the model on the project default provider
- Heavy WebGL-only dashboard surfaces are now lazy-loaded, including the global ocean background and the agent avatar scene, so the initial dashboard route no longer eagerly pulls those renderer modules into the first page chunk
- Tasks page is project-scoped and uses a three-column board state (`Queued`, `In Progress`, `Completed`), where `coding_completed` acts as active work.
- Tasks page renders create/edit inline through the new `TaskComposer` replacing the modal flow.
- On a fresh installation, the Tasks page replaces the old generic project/sprint/task database message with a polished task-scope placeholder; the project action opens the shared Add Project dialog and the sprint action routes operators to the Sprints page before the kanban controls appear.
- Task cards now explicitly show downstream dependent tasks as readable metadata tags.
- Task cards keep the premium glass layout with pointer-driven tilt, status wave, border trace, compact executor/time metadata, and dependency status badges.
- Navigating from a sprint cell into `View Tasks` now preselects that sprint instead of leaving the board on `All Sprints`
- Tasks page sprint deep links are now local route filters; they no longer rewrite the project-wide selected sprint until the operator explicitly changes sprint scope from the selector
- Tasks page now refreshes from the same project-structure realtime invalidation path as sprints
- Tasks and sprints now refresh silently on background realtime invalidation, so opening the Tasks page no longer repeatedly flashes loading state when project metadata or structure updates arrive
- Tasks board is now scoped to the active sprint selection when one is set, filtering the view to only tasks for that sprint
- Tasks page stores explicit task executor preference (`auto`, `docker_cli`, `jules`)
- The Tasks board entrance animation now replays only for project/view/filter changes instead of every background task refresh
- Stats page is project-scoped and visualizes tracked token, time, and Git usage (insertions, deletions, PRs) for the selected project with `24h`, `7d`, `30d`, `all time`, and custom date windows
- Scheduler page is project-scoped and provides a calendar plus 24-hour day view for timed sprint starts, quicksprint launches, and `/chat` messages. Recurring entries expand into every visible day in the calendar and support endless, fixed-count, and end-date/time recurrence. See [Scheduler](./scheduler.md).
- Browser page is project-scoped and provides a polished in-app browser surface for sprint preview containers:
  - floating horizontal slider in its own top strip, with large-screen five-card visibility for preview selection
  - the browser window starts directly below the slider instead of sharing a stretched first-row layout with the sprint controls
  - one preview session per sprint
  - the slider shows preview container cards only, then appends a placeholder `Launch Container` card as the final entry
  - the launch card includes a sprint selector so any sprint can start a preview container directly from the rail
  - browser window chrome state for fullscreen, minimize, and close
  - same-origin iframe navigation with back, forward, refresh, and editable URL
  - route changes coming from the Browser chrome use the preview bridge and HTML5 history where possible, so SPA previews stop hard-refreshing on every in-app navigation
  - when the active preview is stopped, still starting, or otherwise unavailable, the iframe stays on the preview origin and the server returns a same-origin standby page with `Start Container` / `Rebuild Container` controls instead of exposing raw proxy connection errors
  - non-critical side-panel data such as startup-script contents and container logs now load after the main browser surface, so the page opens faster and the iframe/session rail render first
  - remove actions on session cards fully delete preview-session entries after stopping any live container
  - rebuild, stop, open-in-tab, startup-script editing, and log viewing
  - sprint previews are proxied through the dashboard instead of embedding raw localhost origins directly
  - extensionless preview-host deep links such as `/sprints` now recover to the preview app shell when the upstream dev server returns `404`, so direct loads and refreshes stay routable
- File Browser page is project-scoped and mirrors the same v2 hierarchy and workbench visual language as Browser Preview:
  - signal-accent eyebrow and `font-display` heading hierarchy with responsive supporting copy
  - normalized control rail with semantic status badge, sprint/branch context, mode toggle, and rebuild/stop controls
  - restrained panel surfaces for sidebar and viewer regions using shared neutral/light-dark borders and backgrounds
  - launch state card matching Browser Preview container-launch conventions (accent icon treatment, selector styling, and primary action button)
  - file browsing/diff behavior remains unchanged (`files` and `changes` modes, selected path display, side-by-side toggle, and status semantics)
- Stats page now matches the high-interaction v2 dashboard card language more closely with a unified **Analysis Studio UX**:
  - unified glass-panel system that mirrors the premium live card surfaces instead of using a separate visual treatment
  - an embedded grouped metric selector instead of separate tabs, organizing Tokens, Time, and Git metrics into unified groupings
  - relocated analysis-mode controls that focus the workspace on trend, composition, or reliability
  - a full-width interactive trend graph (Usage Graph) with hover bucket inspection and drag-to-zoom timeframe selection
  - a Trend Studio summary band above the chart and a purpose activity section below it, keeping the trend tab self-contained for window-level analysis
  - a Composition Studio that now layers cache efficiency, token-flight timing, and a per-provider activity ledger beneath the donut charts so the provider picture stays readable without tab switching
  - a persistent right-side selected-metrics rail for configuring the chart series; same-window refreshes preserve user chart selections
  - hourly views keep one-hour hover targets while reducing visible axis labels to a three-hour rhythm for readability
  - donut-style composition charts for providers, token anatomy, and telemetry-source mix now animate as interactive slices with hover emphasis and center-detail readouts
  - tabbed task and sprint telemetry sections replacing the always-visible ledger layout, complete with search, sort-by-recency/tokens/time/input/output/name, and richer token/time breakdowns
  - Git stats (Insertions, Deletions, Files Changed, Pull Requests, Merged PRs) are integrated directly alongside Tokens and Time metrics in the Analysis Studio
- The Stats page uses the same project realtime invalidation channels as the rest of the v2 dashboard, then falls back to polling so usage graphs and tables stay current during active sprint execution
- Overview widgets and headline stat cards now read project/task data from the same project-management API surface, and task streams are filtered to the currently selected active sprint only (a frontend-only view change with no API contract change)
- Agents page features an immersive, showcase-first layout that defaults to presenting the selected agent's 3D animated avatar, details, and route-assignment tags, rather than a raw edit form.
- Agents are generated with a random persisted avatar on creation and can be fully customized in the dedicated edit mode.
- Edit mode exposes a new toggleable Memory Template Override control, allowing operators to explicitly provide custom memory injection instructions on a per-agent basis.
- Edit mode now also exposes a dedicated `Manage Memory` popover for tier selection, category filtering, global and per-category minimum strength, and short/long-term memory caps. Empty category selection means all categories are included, and per-category overrides are only shown for categories currently eligible for injection.
- The agent editor shows a compact memory summary chip under the filter trigger so operators can see the active memory scope without opening the popover.
- Worker prompt preparation honors that memory config at runtime by filtering injected memories after retrieval, so the prompt only includes the configured tier(s), categories, strength thresholds, and per-tier caps.
- Agents page is DB-backed and manages project-scoped agents (`name`, `short routing description`, `instruction markdown`, `memory template markdown`)
- Agents are auto-imported from project and home `.code-ux/agents/*.md` when first discovered
- Project-local markdown mirroring is enabled by default through project settings, so dashboard edits create/update `.code-ux/agents/*.md` in the selected repo without touching shipped defaults
- Markdown-backed agents now show sync state and support both manual single-agent re-import and bulk `Sync All`
- The first built-in role is `Planning agent`, which is editable under Agents like any other DB-backed agent
- `Settings -> Agents` now includes the QA controls above instruction templates, with per-trigger agent selection across all project agents and QA-labeled presets floated to the top
- Chat page is DB-backed and stores project conversation threads/messages in sqlite
- Chat page now provides a `Threads / Invocations` toggle to switch between human conversation threads and read-only execution invocations.
- Chat page UI is redesigned with animated identities, structured widgets for rich messages, and automatic worker pickup derived from active project routing.
- Chat page logs invocation activity explicitly in the background, providing observable execution artifacts directly in the chat view.
- Chat page filters the "Threads" mode to show user-facing conversation threads (`scope === "project"`).
- Chat page "Invocations" mode provides a read-only list with metadata for active/completed execution invocations without cluttering the main thread rail.
- Invocation cards and detail headers now show the resolved provider model when available, so planning runs expose the same model visibility as worker cards.
- Invocation cards and the invocation message stream now surface classified provider errors such as `Rate limit` and `Quota reset`, including retry wait information when Code UX is backing off automatically. If Code UX restarts while an invocation is sleeping until a retry time, startup recovery closes the stale running invocation with a recovery message and moves task-backed work back to a retryable state so the recovered sprint loop can start a fresh continuation.
- Chat page now receives websocket updates for thread assignment changes and incoming thread messages in the active thread
- Chat page now shows a live "working" bubble once a listener has picked up a dashboard message and is preparing a reply
- Chat page now force-refreshes the selected thread when realtime thread updates arrive, so virtual replies clear stale `pending` delivery badges and sidebar counts as soon as the reply lands
- Chat message and thread timestamp chrome now suppresses malformed timestamps instead of rendering `Invalid Date`
- Thread compaction now works on both virtual and connected chat routes: virtual routes invoke the selected CLI chat worker directly, while connected routes send a hidden control request to the selected live worker, store its compaction summary, and use that saved handoff for the next fresh reply prompt
- Hidden compaction control messages are excluded from visible thread history, previews, pending badges, and connection inbox counts so the chat UI stays clean while compaction runs
- Chat threads can now be deleted directly from the history rail; deletion is realtime-aware and removes the thread across open dashboard views
- New thread creation now deduplicates optimistic UI insertion against realtime thread updates, so the sidebar count no longer briefly overstates the number of chats
- Chat page now hydrates thread lists and conversation panes from cache first, so revisiting a project or switching between already-seen threads is immediate instead of blocking on a fresh fetch
- Loading states are now reserved for first hydration only; realtime invalidation, manual refresh, send/delete flows, reassignment, and unrelated project updates refresh in the background without replacing the thread rail or active conversation with loading cards
- Creating and deleting threads now stay on the cache-first path too, so the thread rail count and conversation pane no longer flash or fall back to blocking loaders during thread mutations
- Fresh-install chat states now render polished placeholders for the no-project, no-thread, empty-thread, and no-invocation paths, including an animated sidebar rail placeholder instead of an empty sidebar column; the chat rail/detail layout now waits until large screens before splitting into two columns so empty states remain readable on narrower viewports
- Chat composer now sends on `Enter` and inserts a newline on `Shift+Enter`
- Thread assignment control is explicitly labeled as `Worker:` in the thread header to make routing intent clearer
- Virtual-worker-routed tasks are created from the same task modal and appear in the same board; the executor badge shows whether work is automatic, CLI-backed, Jules-backed, or handled by the virtual worker lane
- Settings page now exposes Browser Preview as its own primary left-rail category, covering preview enablement, in-app browser visibility, launch/rebuild automation, Git sync on rebuild, maximum active preview containers, port allocation, and the project-relative preview startup script path
- The Integrations settings panel now returns the selected detail view to normal document flow after the slide animation completes, so tall forms like GitHub configuration can extend to full height instead of being clipped to the shorter integrations list.

### Dashboard view
- Task statistics
- Execution runtime panel for sprint runs, dispatch queue state, live project connections, worker assignment, lease ownership, and recent runtime events
- Live runtime visuals are only considered active when the selected project has a `running` or `queued` sprint run; cancelled, paused, and completed runs fall back to a waiting state
- When no sprint is running but a paused sprint needs human intervention, the overview telemetry now switches from an empty state to an attention state with the exact reason and operator instructions
- Task pipeline cards
- Task cards include a `Rerun` action with confirmation prompt; rerun clears session/PR/merge state for that task and starts it again
- Rerun now performs a full runtime reset instead of only changing task status:
  - failed-session retries clear stale session ids, provider activity, worker branch, PR URL, merge flags, and intervention metadata before a new run starts
  - if the operator chooses `Reset downstream tasks`, Code UX writes fresh pending execution snapshots for every dependent task so completed/running descendants no longer keep stale PR or session state during a clean rerun
  - if `Clear worktree` is enabled, the existing task worktree is removed before the reset so the next run starts from a clean workspace
- Rerun confirmation now warns when the selected task, or the selected downstream reset chain, already merged code; operators can use the **Undo the Git merge** checkbox to programmatically revert the merge commit in the feature branch before restarting the task cleanly.
- Reruns now reuse the same dispatch model as normal dashboard orchestration instead of bypassing execution state
- Task cards now open a DB-backed runtime feed sourced from `task_run_events`
- The runtime feed now includes direct CLI stage events, action-required and protocol events, sprint-run lifecycle events, and CI/merge-gate state changes in addition to provider session activity
- `recentEvents` is now a unified runtime timeline spanning both `task_run_events` and `sprint_run_events`
- The selected-project execution snapshot now keeps the full task-dispatch and task-run event history for the active or most recent sprint run, so completed tasks in Live view keep their runtime feed and stage timings visible even after later tasks start
- The execution runtime panel can now start or resume sprint orchestration, pause or cancel sprint runs, cancel queued dispatches, and retry terminal dispatches
- The Live sidebar now renders `Live Connections`, `Attention Queue`, `Runtime Timeline`, and `Execution Runtime` as separate standalone cards under the shared execution timeline context, with the same card chrome and collapsible behavior while keeping the execution runtime card focused on runs and dispatches
- The Live page now keeps the Git/CI/PR card in a dedicated `GitCIStatusPanel` component so the page shell stays focused on wiring runtime state, controls, and layout
- Live task stats, filter counts, the active filtered task list, and per-card runtime payloads are memoized from the selected project's runtime snapshot so high-frequency realtime updates do not repeatedly recompute unchanged projections
- Live task cards, the DAG, and timing summaries now render from the same projected task model:
  - the task list now comes from the selected sprint inside the unified `/api/live` snapshot instead of being reconstructed from separate task, status, and activity endpoints in the browser
  - task ordering, dependency edges, visible phase, and task activities all come from that same selected-sprint snapshot
  - execution dispatches and runtime events still enrich cards with session, provider, branch, PR, attention, and timing metadata without becoming a second visual source of truth for task identity
- Live Session status copy now comes from the shared sprint status presentation mapper, so manual pauses render manual-attention messaging while worker/system pauses render system-stop messaging; the human-intervention badge appears at most once in the status area and is suppressed for system stops
- The Live page no longer shows the timer-based `Stale Data` transport infobox while connected; reconnecting, recovering, and explicit transport errors still surface through the live transport banner.
- worker-owned merge conflicts are now excluded from that human-intervention projection; they remain visible in the attention queue and realtime runtime feed, but they no longer tell the operator to merge or resume while the worker is handling them
- Worker mode is now explicit in settings:
  - `Virtual on-demand` hands worker-owned attention and automation follow-up to short-lived internal CLI workers that do not create MCP connection rows
- The Live view now uses one authoritative runtime contract:
  - one initial `GET /api/live?projectId=<selectedProjectId>` fetch hydrates the page
  - after hydration, `project.live.updated` is the only websocket event the Live page applies for selected-project runtime state
  - task stats, DAG state, race positions, protocol text, git status, and the visible task list all derive from the same payload, so the hero visualizations stay in sync during normal updates and websocket recovery
  - the page only shows the full `Waiting for Sprint Start` empty state when the selected-sprint live snapshot has no sprint context
- The Live view hero now has three interchangeable visualizations:
  - `Stats` for a compact asymmetric telemetry deck with one dominant sprint-time panel, a slimmer runtime intelligence rail, live flow-state deltas, merge pressure, and accumulated stage timing
  - `Race` for stage-based progress across the execution course, with labelled checkpoint buoys for Coding, Code Done, CI, Merge, and Completed; the race is scoped to the selected sprint context so completed or paused sprint snapshots still render their fleet instead of falling back to the idle harbour
  - `DAG` for an animated dependency graph of the current sprint using real `depends_on` edges, live task phases, and merge-stage state
- The DAG canvas positions task cards directly against its absolute coordinate system, with fixed card dimensions and centered per-column row spacing so cards do not stack and dependency connectors attach to the visible node ports.
- DAG node hover cards now use the shared portal tooltip with a full-card trigger area and a compact contextual panel showing task title, phase, prompt, dependencies, depth, and dependency counts instead of relying on native browser title overlays.
- DAG task cards use a clipped rounded skin with external connector ports, compact truncating metadata chips, and a bottom-aligned runtime footer so long ids, status labels, providers, and dependency counts cannot overlap the card body or bleed dark corner artifacts.
- DAG task-card status glows use shape-following `drop-shadow` utilities instead of rectangular wrapper `box-shadow` classes, preventing visible square shadow corners around rounded cards.
- DAG rows are top-aligned with tighter vertical spacing, and connector ports only render when a real incoming or outgoing dependency exists so orphan dots do not imply missing lines.
- DAG node hover details use a compact local infobox instead of the shared portal tooltip. The panel is positioned directly to the right of the hovered card inside the scrollable DAG canvas, with a right-side canvas gutter, signal accent bar, prompt panel, dependency list, metrics, and rounded-shape drop shadows.
- DAG node infoboxes become pointer-interactive while visible, so operators can move the mouse into the panel and scroll long prompts or dependency lists without closing the hover state.
- Portal tooltip positioning now clamps against viewport-capped overlay dimensions after collision flips, so wide DAG details stay visible and do not introduce page scrollbars.
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
  - with `Virtual on-demand`, the composer shows the selected virtual worker route and planning works without any live MCP connection
- that exclusion is now sticky while the worker-owned conflict item remains active, so transient PR metadata gaps no longer flip the same task back into a manual merge warning
- the same suppression now applies to any active worker-owned supervision item, so agent-managed blocked dispatches and worker-owned action-required recovery no longer trigger the generic `Manual attention required` pause banner while the worker still has actionable queue work
- merge conflicts are now first-class task indicators in the live UI, including dedicated task badges and a realtime `Conflicts` metric in the runtime stats row
- Worker escalations now also create project chat threads with a system-authored handoff message, so operator follow-up lives in the same project conversation model as the rest of dashboard chat
- The execution runtime panel now also shows live project connections with transport, role, listening metadata, inbox load, dispatch load, and heartbeat-derived status
- stale and offline MCP connection rows now disappear much faster in practice: cold start prunes disconnected connections with no active dispatches, and live heartbeat aging promotes dead listeners to `stale` or `offline` quickly enough that the runtime view stops surfacing outdated connection state
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
- the selected project and selected sprint in the v2 top navigation now also scope live session status, reruns, live activities, and git tracking
- the selected project also scopes Agents and Chat data
- dashboard runtime state is projected through sqlite task-run records instead of being served only from one in-memory global payload
- Memory embedding map uses a bounded nearest-neighbor algorithm and caps results at 1000 items to guarantee dashboard responsiveness for large projects

### Settings view
- The active backend model is now scoped as `system -> project -> sprint`
- System settings own runtime, integrations, default project behavior, and MCP tool exposure
- Project settings own inheritable execution behavior such as provider routing, git defaults, CI intelligence, sprint loop steps, CLI workflow, and skills
- Project settings also own agent authoring behavior, including whether dashboard edits mirror agent markdown into the project directory
- The `/config` page keeps the existing v2 settings shell and categories, but now binds them to real scoped settings instead of draft-only values
- System scope only edits system-owned controls, while project scope only edits project-owned overrides for the selected project
- The integrations view now owns provider API keys plus GitHub and GitLab tokens and GitHub workflow settings, rather than splitting those across separate categories
- The integrations view uses a registry-style list with per-integration `Add` and `Manage` actions so additional integrations can be added without turning the page into one long form
- Provider integrations are now instance-based:
  - each CLI type can have multiple named credentials
  - the list shows connected counts per CLI type rather than a single connected/disconnected badge
  - GitHub and GitLab tokens remain system-scoped and are edited from dedicated configuration panels
- Individual MCP tool toggles and skill toggles are intentionally not exposed in the current user-facing settings surface
- CLI workflow settings now expose provider throttle controls in addition to workspace cleanup:
  - `Retry after quota reset`
  - `Retry on rate limit`
  - `Rate limit retry delay`
- The settings surface is regrouped into smaller operational cards so GitHub integration, provider credentials, merge gates, loop control, and execution runtime are separated cleanly
- Danger Zone now supports project deletion in project scope and full database reset in system scope
- Project saves operate on the effective form but persist only sparse diffs relative to the current system defaults
- Sprint settings are sparse overrides applied from the sprint page through the live override modal, which renders the same `ProjectSettingsEditor` in `sprint` scope, loads effective settings with per-field source metadata, and persists only the delta relative to resolved project defaults; a `Reset` action clears all sprint overrides back to inherited values
- Effective settings APIs expose per-field source metadata so the UI can show inherited vs overridden values
- The old legacy dashboard settings route is removed; there is no runtime fallback to the pre-refactor global settings page

## Polling Behavior

From `dashboard/src/hooks/use-dashboard-runtime-data.ts`:
- Live view now does one initial `/api/live` fetch, then subscribes only to `project.live.updated` for selected-project runtime state. The UI explicitly reflects websocket degradation states (`connecting`, `reconnecting`, etc.) without altering the stable Live snapshot payload.
- There is no steady-state client poll for status, execution, or git on the Live page anymore.
- When the websocket reports `snapshot_required`, the browser re-fetches `/api/live` and replaces the whole live snapshot atomically.
- Git status is refreshed server-side and folded into that same live snapshot stream, including a periodic background refresh owned by the server.
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

- `project.live.updated` replaces the entire selected-project live snapshot immediately
- `project.execution.updated`, `project.runtime_status.updated`, and `project.structure.updated` still exist for other dashboard surfaces and also fan into a follow-up `project.live.updated` publish for Live-page consumers
- attention queue changes now flow into the same live snapshot path, so merge-conflict escalation, worker claims, and resolution actions appear without waiting for a poll tick
- git status changes also arrive through that same live snapshot path instead of a separate client poll
- provider-backed runtime feeds still render the persisted agent/user message text from `provider_activity` events, but the Live page no longer tries to reconcile those events against independently fetched task structure

The old legacy settings hook remains outside the active v2 flow; the live dashboard now uses the scoped settings API above.

The Overview telemetry rail provides a compact, visually rich runtime surface that shows high-signal intervention data (titles only) and differentiated event coloring.

Project management requests are centralized in:
- `dashboard/src/v2/lib/project-api.ts`
- `dashboard/src/v2/context/project-data.tsx`
- `dashboard/src/v2/lib/connection-api.ts`

## Multi-Provider Settings

*(Note: `available` means detected credentials/auth presence, whereas `enabled` means user-approved routing participation.)*

AI Provider settings now support:
- Named provider instances grouped under `jules`, `gemini`, `codex`, and `claude-code`
- Routing strategy:
  - `MANUAL` (single default provider instance)
  - `WEIGHTED` (weight-based distribution across enabled instances)
  - `AGENT` (uses the selected agent preset's optional provider/model preference, then inherits route defaults)
- Provider-instance toggles (`enabled`)
- Model selection
  - Gemini: curated model list in UI
  - Codex/Jules: text model field
- Thinking mode (`SMALL`, `MEDIUM`, `HIGH`)
- Invocation routing at the provider-instance level, including instance pools and sparse per-instance overrides

Behavior:
- Empty provider key fields are valid.
- Runtime falls back to system auth/environment where supported.
- Multiple instances of the same CLI type are routed independently, so operators can weight several Codex or Gemini credentials differently inside one route pool.

## CI Intelligence Settings

Settings group:
- `enabled`
- `enableLivePrMonitoring`
- `resolveAllCommentsBeforeMainMerge`
- `resolveAllCommentsBeforeFeatureMerge`
- `waitForJulesCiAutofix`
- `julesCiAutofixMaxRetries`
- `featurePrAutoMergeMode` (`OFF|CREATE_PR|WHEN_GREEN|ALWAYS`)

Effect:
- These settings influence protocol text generated by orchestrator.
- When `featurePrAutoMergeMode = WHEN_GREEN` (REMOTE mode), merge readiness is gated by real feature-PR checks (not instruction text only).
- `enableLivePrMonitoring` can disable live PR/CI polling gates entirely; in `LOCAL` git mode it is forced off.
- `waitForJulesCiAutofix` controls feedback mode while blocked:
  - enabled: explicit autofix-wait guidance for failed checks.
  - disabled: merge-gate guidance without autofix wording.
- `julesCiAutofixMaxRetries` sets how many Jules autofix notifications are attempted before escalation. Escalation output includes exact task ids, PR links, failed check names, failed run summaries, and failed job names so no manual searching is needed.
- `featurePrAutoMergeMode = CREATE_PR` opens or reuses the feature PR and then stops before auto-merge, marking the task settled with `PR_ONLY`.
- `featurePrAutoMergeMode = WHEN_GREEN` executes feature-PR auto-merge once checks are green and review blockers are clear.
- `featurePrAutoMergeMode = ALWAYS` attempts auto-merge without waiting for CI, while still respecting merge conflicts and configured review-comment blockers.
- a successful feature-PR automerge now refreshes dependency readiness in the same loop pass, so downstream tasks can continue without forcing a manual resume
- Feature-PR CI wait/automerge matching uses worker branch first and falls back to the task `pr_url`, so tasks without a stored worker branch still remain gated correctly.
- Tasks that are still waiting on feature-PR CI now persist as `in_progress` in the dashboard task store instead of staying marked `completed` just because the provider session finished.
- Feature PRs already in GitHub `DIRTY` merge state are surfaced as merge conflicts before any CI wait, so branch-protection deadlocks do not leave the task stuck in perpetual pending-check state.
- If a matched feature PR has no checks, Code UX now consults local workflow definitions and only keeps waiting when a `pull_request` or `pull_request_target` workflow actually applies to that PR base branch; otherwise the task skips CI waiting and proceeds to merge readiness/review gating.
- CI Runs in `Feature PR CI` tracking include recent runs from PR head branches targeting the feature implementation branch (plus feature branch runs), sorted newest-first; the panel shows the latest 5.
- Failed CI runs in tracking are enriched with failed job details and failed-job log excerpts (bounded) from GitHub Actions `gh run view` data.
- Main merge stage (`feature -> main`) now emits live CI/review gate feedback with failed check names and ready-to-run `gh` commands.
- Main merge into default branch now stays active until an enabled auto-merge flow actually settles; it no longer marks the sprint complete just because all task PRs are done.

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
  - `Feature PR CI` while sprint tasks are actively running and `featurePrAutoMergeMode = WHEN_GREEN`.
  - `Main Branch CI` outside active running-task windows (including final merge stage).
- PR comment counters are sourced from GitHub `comments` payloads in both object and numeric shapes.
- Recent merges list includes all fetched merges into feature-prefixed branches and the default branch.

## No-Key Startup Mode

Server startup no longer exits when Jules API key is missing. Code UX also performs startup availability checks for Gemini, Codex, and Claude Code, looking for API-key hints and stable local auth artifacts to prepare future onboarding decisions.

Behavior:
- MCP server and dashboard still start.
- Startup does not emit warning logs solely because the Jules API key is missing.
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
- The v2 frontend is organized into page-scoped module boundaries (overview, sprints, tasks, stats, live), exclusively loading resources they need.
- A shared dashboard resource layer manages resource keys, caching, and invalidation, deduplicating fetches and avoiding UI flashing during background updates.
- Heavy list views use a progressive list strategy (`useProgressiveList`) with an intersection observer to render items in batches and prevent main-thread blocking.
- Backend read-model optimizations efficiently project data to support the resource layer while leaving API routes and backend contracts entirely unchanged.
- Extensionless dashboard routes like `/sprints` are served by the SPA app shell on direct load or refresh. This routing behavior remains consistent even when Code UX itself is running inside a preview container.

- A "Live Preview" CTA link now appears in the Live view header when the relevant sprint has an active (`running`) preview session with a resolved `hostPort`. The link securely routes directly to the iframe preview origin (`buildPreviewUrl`) at the `lastKnownPath`.
