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

The v2 Live Session route keeps runtime data wiring in `LiveSessionPage.tsx`, pure projection/filter derivation in `dashboard/src/v2/lib/live-session-view-model.ts`, and repeated panel markup under `dashboard/src/v2/components/live-session/`. Keep sprint-scoped arrays such as dispatches, events, invocations, and projected task card items memoized from stabilized runtime snapshots so reconnects, stale banners, filters, and pending runtime actions do not force avoidable recomputation or change accessibility semantics.

## Sprint Navigation Scope

Sprint ledger rows and showcase sprint cards expose separate **Tasks** and **Live** actions. Both actions include the owning `projectId` and target `sprintId` in the route query:

- `/tasks?projectId=<projectId>&sprintId=<sprintId>`
- `/live?projectId=<projectId>&sprintId=<sprintId>`

Destination pages must switch the selected project first, then apply the sprint scope through the selected project's sprint API. The Tasks page still accepts legacy same-project links such as `/tasks?sprint=<sprintId>` and `/tasks?sprintId=<sprintId>`, but project-aware links are required when navigation originates from sprint rows or cards so a sprint is never applied to the previously selected project.

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
- `PUT /api/sprints/:sprintId/linked-issues`
  - Replaces linked sprint issues and, for linked Jira imports, attempts the configured import transition. The response includes persisted `linkedIssues` plus non-fatal transition `warnings`.
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
  - Lists sqlite-backed project agents and auto-imports unseen markdown agents from `.code-ux/agents`
- `POST /api/projects/:projectId/agent-presets`
  - Creates a sqlite-backed agent and, when project markdown mirroring is enabled, also writes `.code-ux/agents/<name>.md`
- `PATCH /api/agent-presets/:agentPresetId`
  - Updates agent metadata and instruction markdown, mirroring the markdown back into the project agent directory when enabled
- `DELETE /api/agent-presets/:agentPresetId`
  - Deletes an agent record
- `POST /api/agent-presets/:agentPresetId/import-markdown`
  - Pulls one linked markdown source into sqlite
- `POST /api/agent-presets/:agentPresetId/export-markdown`
  - Pushes one sqlite agent preset to the selected project `.code-ux/agents` directory, links the preset to that project source, and refuses to overwrite a markdown file linked to a different agent
- `POST /api/projects/:projectId/agent-presets/sync-markdown`
  - Legacy/backward-compatible alias for the current **Pull from files** workflow; discovers `.code-ux/agents/*.md`, imports new files, and re-imports out-of-sync linked agents
- `POST /api/projects/:projectId/agent-presets/pull-markdown`
  - Explicitly pulls project markdown files into sqlite using the same precedence and default-agent discovery rules as normal agent sync
- `POST /api/projects/:projectId/agent-presets/push-markdown`
  - Pushes sqlite presets to project markdown files when `agents.saveToProjectDirectory` is enabled, exporting manual, missing-source, out-of-sync, home-backed, and default-backed agents as project-local files
- `POST /api/projects/:projectId/agent-presets/push`
  - Commits `.code-ux/agents/*.md` changes from the selected project, optionally pushes the branch, and can open a pull request against the default branch when repository remotes are available
- `POST /api/projects/:projectId/planning/improve-sprint-prompt`
  - Sends a draft sprint prompt to the Planning agent through the configured virtual worker provider and returns the improved prompt
  - Planning overrides may explicitly target a specific `planningAgentPresetId`, as well as a virtual CLI provider/model for that one request. The composer defaults to the project Agent Routing planning preset.
- `POST /api/projects/:projectId/sprints/:sprintId/plan`
  - Sends a created sprint to the Planning agent through the configured virtual worker provider, creates subtasks from the reply, and can auto-start the sprint
  - Auto-start orchestration now prepares the local sprint feature branch automatically and attempts to push it to `origin` when that remote exists
  - Planning overrides may explicitly target a specific `planningAgentPresetId`, task coding routing mode, manual worker preset, and virtual CLI provider/model for that one request.
  - Completed planning invocations persist the generated execution plan on that invocation's transcript message as `metadata.executionPlan`, scoped to the linked sprint for the request. Replaying the invocation transcript reads that persisted message metadata rather than the currently selected sprint or a later planning run.
- `GET /api/projects/:projectId/conversations/threads`
  - Lists project conversation threads
- `POST /api/projects/:projectId/conversations/threads`
  - Creates a new project conversation thread
- `PATCH /api/conversations/threads/:threadId`
  - Updates a conversation thread's connection, runtime state, or non-empty title. Title changes also mirror to `.code-ux/conversations/<thread-id>/session-title.md` in the project checkout.
- `POST /api/conversations/threads/:threadId/compact`
  - Compacts a thread's conversation history into a stored handoff summary
- `POST /api/conversations/threads/:threadId/cancel`
  - Cancels the currently running dashboard turn for a thread
  - The active thread header renders a `Cancel Request` button only while the selected thread still has pending dashboard messages
- `GET /api/conversations/threads/:threadId/messages`
  - Lists stored messages for one thread
- `POST /api/projects/:projectId/conversations/messages`
  - Stores a dashboard-authored message and queues it for a listener
  - Create-app quickactions use the same endpoint with `metadata.quickaction.type = "create_app"`, `kind` (`web_app` or `desktop_app`), `requestId`, `templateId`, stack summary, and suggestion tags. The server persists the dashboard message, bypasses normal provider reply routing, launches the matching detached quicksprint in `Plan & Start` mode, posts an `app_progress` widget, and tracks follow-up handling in thread `runtimeState.createAppQuickaction`.
  - Stores a dashboard-authored message and queues it for a listener or provider-backed dashboard reply
  - Chat message posts update the selected thread message cache from the returned `ConversationMessageRecord`; the Chat invocation rail remains backed by `GET /api/projects/:projectId/execution/invocations` snapshots and realtime refreshes, so invocation rows are server-created and the browser does not create a frontend-only optimistic invocation placeholder while the backend record is still being persisted.
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
- `GET /api/projects/:projectId/scheduler/memory-remediation`
  - Evaluates memory metrics and proposes scheduled remediation tasks
- `PUT /api/projects/:projectId/scheduler/memory-remediation`
  - Configures the automatic memory remediation schedule
- `POST /api/scheduler/run-due`
  - Processes due scheduler entries manually

Legacy runtime:
- `GET /api/status`
  - Selected-project runtime payload (`sprint_number`, `subtasks`, `instructions`, etc.) projected from sqlite, explicitly scoped to the newly persisted active sprint when one is set
- `GET /api/execution`
  - Selected-project execution control-plane snapshot (`sprintRuns`, `taskDispatches`, lease ownership) without heavy recent feeds
- `GET /api/telemetry/overview`
  - Cross-project overview telemetry snapshot for all currently active project runs
- `GET /api/stats/header-throughput?projectId=<projectId>&window=20s|1h|24h|7d|30d|all`
  - Compact app-wide token throughput for the top dashboard header. The header polls the `20s` live activity window once per second and shows the active-duration token rate for invocations updated in that window; detailed charts, ledgers, and model/provider analysis remain on the Stats page.
- `GET /api/live`
  - Unified Live runtime snapshot for the selected project, scoped to the selected sprint when the top-nav sprint selector has a persisted sprint
- `PUT /api/projects/:projectId/preferred-worker`
  - Sets the preferred worker host for the selected project
- `GET /api/realtime`
  - websocket upgrade endpoint for dashboard realtime subscriptions (`projects`, `overview`, `project:<projectId>`, `thread:<threadId>`)
- `GET /api/projects/:projectId/execution`
  - Project-scoped execution control-plane snapshot for the v2 runtime, including recent runtime events and invocation summaries
- `GET /api/projects/:projectId/stats?window=1h|24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Project-scoped token/time statistics snapshot with adaptive hourly/daily/weekly buckets, task/sprint/provider/purpose rollups, and telemetry-source mix
  - `custom` requires both `from` and `to`; presets ignore them
- `POST /api/projects/:projectId/attention-items/:attentionItemId/claim`
  - Claims an active worker-owned attention item on behalf of the assigned project worker
- `POST /api/projects/:projectId/attention-items/:attentionItemId/resolve`
  - Resolves or dismisses an active attention item from the dashboard runtime surface
- `GET /api/system-settings`
  - Persisted system-wide settings (`runtime`, `integrations`, `defaults`, `mcpTools`)
  - `runtime.consoleLogLevel` controls minimum server console severity (`off`, `debug`, `info`, `warn`, `error`).
  - `runtime.debugLogFileLevel` controls minimum `.code-ux/debug.log` severity and defaults to `error`; `off` disables file logging.
  - `runtime.consoleLogMode` controls server console visibility:
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
- `GET /api/projects/:projectId/file-browser/sessions`
  - Lists persisted sprint file-browser sessions for the selected project
- `POST /api/projects/:projectId/sprints/:sprintId/file-browser/start`
  - Starts or reuses a file-browser session for one sprint
- `POST /api/file-browser/sessions/:sessionId/rebuild`
  - Rebuilds and restarts a file-browser session
- `POST /api/file-browser/sessions/:sessionId/stop`
  - Stops a file-browser session
- `DELETE /api/file-browser/sessions/:sessionId`
  - Deletes a file-browser session
- `GET /api/file-browser/sessions/:sessionId/tree`
  - Lists the filesystem tree for the sprint branch
- `GET /api/file-browser/sessions/:sessionId/file`
  - Reads a file from the file-browser session
- `GET /api/file-browser/sessions/:sessionId/changes`
  - Gets git status/changes for the sprint branch
- `GET /api/file-browser/sessions/:sessionId/diff`
  - Gets a diff for the sprint branch
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
- `POST /api/onboarding/dependencies/install`
  - Explicitly confirmed Docker/Git installer execution for advertised onboarding modes
  - Also drives the header Docker status control: `cluster.status === "not_ready"` renders the red `Runtime not ready` alert badge, updates the icon-only trigger's accessible name, and exposes Docker/Git dependency resolution details in the popover.
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
- `GET /api/projects/:projectId/quicksprints/templates`
  - Lists resolved quicksprint templates for the selected project
- `GET /api/projects/:projectId/quicksprints/templates/:templateId`
  - Gets one quicksprint template
- `POST /api/projects/:projectId/quicksprints/templates`
  - Creates a new custom project quicksprint template
- `PATCH /api/projects/:projectId/quicksprints/templates/:templateId`
  - Updates a quicksprint template
- `DELETE /api/projects/:projectId/quicksprints/templates/:templateId`
  - Deletes or hides a quicksprint template
- `POST /api/projects/:projectId/quicksprints/execute`
  - Plans and starts a quicksprint directly

## UI Sections

### Overview
- Overview metric cards use the restored `StatsCard` visual system from the operational command surface: four responsive cards with ambient bottom sparklines, stable card height, and compact detail rows for cost, invocations, active sprint, queue health, and active time.
- Overview telemetry keeps the cross-project `Human Intervention Needed`, active sprint, and runtime timeline sections, and now adds a compact selected-sprint attention queue when the selected project live snapshot includes active attention items.
- The Overview attention queue uses the same row labels, severity/status tones, markdown summary rendering, empty-state language, and bounded scrollbar treatment as the Live sidebar queue, but renders read-only so action handling stays centralized on the Live page.

### Navigation
- Sidebar and dock navigation expose the primary routes in guided-tour order: Chat, Overview, Sprints, Tasks, Agents, Stats, Schedule (`/scheduler`), Memory, Knowledge (`/knowledge`), Browser, Files (`/files`, providing project and sprint File Browser capabilities), Live, and Settings/Config.
- The primary navigation honors the persisted Settings -> Appearance experience mode. Easy shows Chat, Browser, Stats, Settings/Config, and external Docs. Standard shows Chat, Overview, Sprints, Tasks, Agents, Stats, Browser, Docs, and Settings/Config. Expert is the default and shows the full set. This only changes primary navigation visibility: routes remain registered, Docs opens the external project docs, and the Browser item still follows the project sprint-preview visibility settings.
- The header places global search beside the tech-stack guidance and styleguide selectors. The guidance selectors mirror the active project's effective `designGuidance` values, support `None`, and save project-level overrides immediately when changed.
- Guidance dropdown footer actions use the same settings destination: **Add Tech Stack**, **Add Styleguide**, and **Manage Guidance** open `/config?category=guidance#guidance` so custom guidance entries and visibility controls stay centralized in Settings -> Guidance.
- The sprint selector remains enabled for projects with no sprints so its footer actions are always reachable. **Add Sprint** opens a compact header flow for creating an idle sprint from a name and goal, then selects it after the sprint collection refreshes. **Manage Sprints** opens the full Sprints page for planning, imports, bulk actions, and sprint detail editing.
- The top-nav workspace search trigger uses a more opaque glass surface in light and dark mode so it stays readable against page content while preserving the existing blur treatment.
- The notification panel announces refresh, mark-read, dismiss, and action outcomes through polite live regions. Refresh and mark-all-read controls expose pending state with `aria-busy`, disabled controls include visible reasons, and every repeated row action includes the notification title in its accessible name.
- Notification rows include textual read/unread state in addition to the severity accent rail. Initial rows use the `listReveal` motion contract, read/dismiss compaction uses `listReorder`, and reduced-motion users receive immediate static state changes without transitional movement.
- Critical notifications are rendered ahead of non-critical items so scroll overflow cannot push blocking startup issues behind lower-priority messages. They remain visible until the notification source clears or the user explicitly dismisses a dismissible critical item.
- Action and dismiss clicks return focus to the notification panel after the row state changes, giving keyboard users a stable fallback when an item leaves the list.
- Active agent-created task runs and wakeups are projected into the existing notification pipeline with stable IDs based on scheduler entry IDs. Read and dismissed state therefore survives notification refreshes while the entry remains scheduled.

### Stats page
- The Stats page is available at `/stats` and is scoped to the selected project. Without a selected project, it renders the Stats shell with a polite no-project state instead of attempting to fetch telemetry.
- Stats data comes from `GET /api/projects/:projectId/stats`; System mode additionally uses `useSystemViewData(projectId)` and invocation APIs for paginated records and transcript detail. Background refreshes keep the previous snapshot visible while the studio state changes to `Refreshing`.
- The header is the flat command surface for the page. It shows the page title, selected project, generated snapshot time, sprint lens, active mode guidance, and time-window controls before the mode-specific metric deck.
- Time-window presets are `1h`, `24h`, `7d`, `30d`, `All time`, and `Custom`. Presets apply immediately. `Custom` only opens date fields; the range changes after a valid `Apply`. Incomplete or inverted ranges remain inline, mark the date inputs invalid, and announce the error.
- Visual modes are `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, and `System`. `Providers` opens the reliability workspace while keeping the shorter user-facing label.
- Mode-specific top cards are the single primary metric deck for the selected analysis surface. Trend emphasizes work, runtime, cost, invocation health, cache rate, and velocity; Composition emphasizes provider and token mix; Models emphasizes model performance; Providers emphasizes telemetry confidence and risk; Ledgers emphasizes entity volume and Git scope; System emphasizes invocation health.
- The workspace starts directly after that metric deck. Avoid duplicate KPI bands, visible chart-summary card decks, repeated context strips, and stray metadata chips that restate the selected window or active mode.
- Stats component styling is owned by shared flat Stats primitives and semantic tokens (`PANEL_CLASS`, `SUBPANEL_CLASS`, `CHIP_CLASS`, `INPUT_CLASS`, `STATUS_TONE_CLASS`, tab classes, empty states, ledger row classes, and track classes). Surfaces use neutral fills, hairline borders, compact typography, black/neutral selected tags, and data-color accents only when the color carries telemetry meaning.
- Trend mode is the chart workspace. It includes the interactive usage chart, graph filters, minimap, focused-bucket inspection, grouped series switches, screen-reader data table, purpose activity, and selected-range metadata. Filter switches change visible series only; they do not change the time window.
- Composition mode explains provider share, token anatomy, cache behavior, source quality, purpose distribution, Git-blocker context, and low-data fallbacks using donuts, ribbons, flow bars, and neutral metadata chips backed by snapshot totals.
- Models mode ranks model activity by token volume and surfaces provider identity, success tone, latency, tokens per call, cache hit rate, reasoning share, output velocity, pricing signals, and sparse-telemetry states.
- Providers mode summarizes reliability, fallback usage, source confidence, failure pressure, provider coverage, duration coverage, provider-specific risk, and audit notes without fabricating health when telemetry is missing.
- Ledgers mode provides Task Telemetry, Sprint Telemetry, and Git Telemetry tabs. Task and sprint ledgers include search, sort, progressive rendering, token-flow anatomy, status/provider/purpose context, recency, visible share, leader share, and optional duration percentile chips. Git ledgers use churn visuals for insertions and deletions so code change volume stays distinct from token flow.
- System mode is an administrative invocation workbench organized around Sprint State, Health Snapshot, External API Activity, Error Categories, filters, pagination, an invocation ledger, and expandable message transcripts.
- System filtering covers search, status, purpose, provider, error category, record mode (`All`, `Errors`, `System Msgs`), sort, page controls, clear-all, active-filter counts, and result counts. These controls wrap rather than clipping on narrow screens.
- Loading, no-data, low-data, empty, and error states reuse the Stats shell. Loading panels use `role="status"` and error panels use `role="alert"` with retry where recovery is available.
- For implementation details and page-level design rules, see [Stats & Analytics Design System](./design-system-stats.md). For telemetry collection semantics, see [Usage Telemetry And Stats](../architecture/usage-telemetry-and-stats.md).

### Memory
- Memory map ambient node labels are visible at the default camera zoom, while focused node cards still require the deeper selected-node zoom. This keeps the map readable immediately after load without forcing operators to zoom in.

### V2 project management
- Interactive dashboard controls use pointer cursors consistently: enabled buttons, links, tab controls, form toggles, menu/popover triggers, DAG nodes, cards, and dismissible overlays expose a pointer affordance, while disabled controls retain `not-allowed`.
- V2 pages use the shared `PageContainer` atomic component for page-level layout. It renders fullscreen (`max-w-none`, no fixed cap) with a consistent horizontal/vertical padding rhythm, and is the single source of truth for page container width across overview, project, sprint, task, live, memory, knowledge, stats, settings, agents, chat, and browser routes.
- V2 pages render their intro/heading via the shared `PageHeader` atomic component (`components/layout/PageHeader.tsx`): an optional icon + uppercase eyebrow, a unified `text-2xl md:text-3xl` title, an optional subtitle, and optional actions. Header titles and subtitles use balanced wrapping, and action clusters stack/wrap below the heading until the `lg` breakpoint so mobile and tablet layouts do not squeeze controls beside long titles. Keep all non-H1 headings visually lighter than the route title with explicit Tailwind classes, generally `text-xl`/`text-2xl` with `font-semibold` for section headings and `text-base`/`text-lg` with `font-semibold` for card titles.
- Light mode resolves the shared `signal-*` utilities to a stable blue accent for active, selected, focus, and primary controls; dark mode keeps the existing jade signal. Use the semantic signal utilities or CSS variables instead of hardcoded green values in new dashboard UI.
- Top-nav project selector persists the active project in sqlite and uses a bounded scrollable listbox so long project lists stay inside the header overlay.
- Top-nav techstack selector sits beside the project and sprint selectors. It reads the active project's effective `techstack` selection plus the system-owned techstack catalog, displays `None` when `selectedTechstackId` is `null`, and keeps imported/unclassified projects explicitly unassigned until an operator chooses a catalog entry. Saving from the navbar first loads the existing project override, merges only the project `techstack.selectedTechstackId` and `techstack.applicationKind` fields into it, clears cached effective settings for that project, and never mutates the system catalog or sibling project override sections such as Jira, agents, or QA settings. New-project creation remains the only dashboard flow that may prefill the catalog default as an explicit project override.
- Top-nav sprint selector persists the active sprint for the selected project and uses the same bounded scrollable listbox pattern. The header dropdown lists only real sprints; if persisted scope is null, `All Sprints` remains a fallback trigger label rather than a selectable header row.
- Top-nav search sits in the left header cluster beside the brand and lazy-loads project tasks only after the search overlay opens; the active task counter uses the same compact height as the project, sprint, and worker selectors
- Top-nav shows a compact scheduled-agent count only when the selected project has active `agent_scheduler` task or wakeup entries. Hovering or focusing the count reveals a keyboard-accessible disclosure with the entry type, title, scheduled time or anchor summary, target summary, and status.
- Global Search preserves previous results during its token-timed debounce to avoid layout shift, only polls for container previews when opened, and keeps arrow-key/Enter/Escape navigation wired through `aria-activedescendant` while focus remains on the combobox. The trigger, overlay entrance/exit, row reveal, active-row movement, and control feedback all resolve through the shared `enterExit`, `listReveal`, `selectionMovement`, and `controlFeedback` motion contracts; reduced-motion users get instant state changes with static cues such as focus rings, selected borders, disabled badges, count chips, `aria-busy`, and live copy. Stale result refreshes keep current rows visible with `aria-busy`, a single polite refresh announcement, and a persistent updating badge, while a newly committed query with no matches shows a true empty state instead of a loading placeholder. Keyboard movement scrolls only the overlay results container so the page behind the search does not jump. Unavailable rows remain inspectable with a visible reason referenced by `aria-describedby`, are marked `aria-disabled`, are skipped by pointer and keyboard activation when another row can open, and stay non-navigating on Enter when every result is unavailable. Sprint results use the selected project's configured sprint key prefix, so searches for project keys such as `CODUX-32` match the same sprint key shown in the row. Selecting a sprint opens the Sprints page with `?sprintKey=<key>` so the ledger filter is seeded from the explicit route payload rather than from visible row text.
- Shared dropdown menus enhance nested menu items inside layout wrappers, so keyboard navigation and item entrance animation remain consistent when menu content is grouped.
- Shared popovers own trigger open/close toggling; feature triggers such as Agent Memory avoid duplicate local toggles that can immediately close the panel after opening.
- The Agents page now includes a Push Agents header action with an inline destination picker, so users explicitly choose between a local commit, branch push, or pull request before dispatching the backend push request.
- The Live Sprint Clock card in the Sprint Stats deck now shows a six-tile grid with Finished, Avg Finish, Accumulated, Input, Output, and Cached values, and the token tiles reuse the shared compact formatter from the Stats page.
- Live runtime pages now use the persisted top-nav sprint selection as the page scope, so the Live view follows the selected sprint from the header menu
- Overview telemetry reads the same selected-project live snapshot for its compact attention queue, so Overview and Live show the same selected-sprint queue items without client-side reconstruction from project-wide blockers.
- That selection is view-only for the dashboard surface; it does not change which sprint run is actually executing in the backend
- Live attention resolve/dismiss dialogs are portaled to a viewport-fixed overlay, preserve viewport position after confirmation, use action-specific tones, and return focus without scrolling the page when the originating queue row disappears.
- The Live attention queue, Invocation Feed, and Execution Runtime panels share a compact sidebar feed language with smaller type, subtle row backgrounds, bounded scroll regions, explicit empty states, and narrow colored left rails for status/severity distinction.
- The Live page Git / CI / PR panel now uses compact status metric tiles plus state-specific iconography for PR and CI rows, including animated indicators for active CI states (`IN_PROGRESS`, `QUEUED`, `PENDING`, `QUOTA`) with reduced-motion fallback (`motion-reduce:animate-none`)
- Live telemetry and runtime panels expose loading, empty, reconnecting, disconnected, pending, warning, and error states through named regions, polite status/log live regions, and assertive alerts only for blocking disconnect/error states. Dense runtime strings such as branches, PR titles, workflow names, provider/model labels, connection keys, and event snippets wrap inside their panels to avoid page-level horizontal overflow.
- The Sprint ledger keeps sorting, filtering, list-window changes, row selection, per-row menus, and bulk actions accessible with and without motion. Filtered select-all acts on the current filtered result set, selections are pruned when filters hide rows, rows expose stable `aria-selected`/`aria-busy` states with selected and pending badges, and each ledger action emits one concise live outcome with visible and selected counts. Pending bulk controls show a visible disabled reason, reference that reason with `aria-describedby`, suppress duplicate activation, and destructive bulk delete uses the shared hold-to-confirm dialog with a target-specific title and focus restoration to the delete trigger or ledger fallback.
- Creating a new sprint automatically updates the active sprint selection to that new sprint
- The Sprints page closes open sprint and quicksprint composer surfaces when the active project changes, preventing stale project-scoped composer state from carrying into the newly selected project.
- Sprint and quicksprint planning overlays can be minimized without blocking the next composer action. The minimized status surfaces expose a new sprint/quicksprint action that detaches the UI from the in-flight request while the request continues in the background; cancellation remains a separate explicit control.
- The top-nav worker selector now always lists the built-in virtual workers even when no live MCP worker is connected
- Selecting a virtual worker from the top nav switches the selected project into `workers.executionMode = VIRTUAL` with that provider
- Connected MCP worker selection has been removed; the worker selector is now virtual-only
- Projects page is DB-backed and can create/select/delete projects
- Project cards now surface richer read-only metadata from `GET /api/projects`, including source badges, repository URL or workspace path, created/updated timestamps, last run timestamp/status, branch details, provider, host, and task-completion counts.
- Project card quick actions are always visible and include `Open`, `Setup project`, `Project settings`, and `Delete`; the settings action first selects the project and then routes to `/config` so the existing scoped settings surface opens for the right project.
- The overview page `Projects & Sources` grid shows up to the five most recently updated project source cells by default. It keeps as many cells as fit on one row while at least three can fit; below that threshold it switches to two compact rows and trims the visible default set to avoid leaving one project cell alone on a wrapped row.
- Project source cells now select the clicked project before routing: the `Sprints` action loads `/sprints`, and the settings gear loads `/config`.
- The Projects page now uses the dashed grid Add Project card as the single entry point for creating a project; the top-right header CTA was removed to keep creation affordance in one place.
- The `Add Project` dialog now keeps keyboard focus inside the active form field while typing, and its initial focus respects the form's `autofocus` input instead of jumping to the header close button
- The Projects page `Add Project` placeholder card uses the same full-height card footprint and internal padding as project cards, and the add dialog fields use rounded field surfaces with amber focus states instead of bare underline inputs; the dialog also constrains itself to the viewport on shorter screens
- The `Add Project` dialog now has a wider desktop layout, keeps a stable Git-form-height floor while switching source types, and exposes the inline directory browser on both local project paths and optional Git clone destination paths, with home, refresh, parent-directory navigation, child-directory traversal, and an explicit use-current-folder action
- The `Add Project` dialog now also includes a `New Project` source type. That branch keeps creation inside the same modal, preselects `Local Repo` or `Remote Repo` init modes, shows provider and visibility toggles for remote initialization, and skips the Project Setup Agent controls entirely.
- The `Add Project` dialog preselects Project Setup Agent initialization. When enabled, creation advances to a setup scope step where operators choose Agents, Quicksprint Templates, Preview Container Script, and CI before the backend creates repository-specific artifacts.
- Existing project cards expose a Project Setup Agent action that opens the same setup scope for later initialization or regeneration. See [Project Initialization](./project-initialization.md).
- Project setup runs display immediate toast feedback, an `Initializing` project-card state, and direct `Open invocation` actions while the background setup invocation is running and after it finishes.
- Git URL projects are cloned into a local checkout before the project record is created. When the optional clone directory is left empty, Code UX uses `~/.code-ux/projects/<repo-name>` so Docker workspaces always seed from a real repository root instead of a relative placeholder path.
- Project selector and project cards now refresh over websocket when the project collection or selected project changes
- Sprints page is project-scoped, creates sprint records in sqlite, and exposes a structured Import flyout with Markdown plus provider-specific GitHub, GitLab, and Jira issue import entries. The issue import modals open on a low-noise guided search surface with progressive advanced filters, active filter summaries, select-all and clear-selection controls, conversation appends, linked-issue composer cards, and special remediation-task routing, while markdown export remains available for sprint round-tripping. See [Sprint Imports](./sprint-imports.md).
- Sprint and Quicksprint planning route controls list virtual provider instances by their settings-page names (for example, `Codex Primary`) with provider brand icons, keep connected worker routes visually distinct, and show resolved default route/model labels such as `Default Route (Codex Primary)` and `Default Model (gpt-5.5)`.
- Sprints page now also refreshes from project-structure realtime invalidation, so sprint CRUD and status-adjacent updates propagate across open dashboard tabs
- Sprint cells and ledger rows now surface a compact human-intervention badge when a paused sprint needs merge work, planning, or another operator action.
- Sprint and Live status messaging now uses a shared presentation mapper (`dashboard/src/v2/lib/sprint-status-presentation.ts`) so manual pauses, system-stopped states, QA gates, attempts to merge into the base branch, and base branch merge conflicts render consistent title/reason/detail copy and consistent human-intervention badge visibility across cards, rows, and live detail panels
- Sprint cells and ledger rows now support specific status badges for QA, Merge, and Merge Conflict states when the sprint is in QA, attempting a base branch merge, or blocked by a base branch merge conflict.
- Worker-owned merge-conflict attention now renders as a compact `Merge conflict` badge instead of `System stopped`, and the badge no longer opens the legacy hover text panel on sprint rows.
- Live sprint-run cards keep intervention reason/instruction prose collapsed behind an `Instructions` button so long attention messages do not resize the invocation feed unexpectedly.
- Sprints page now also starts and stops sprint orchestration directly from sprint cards, with optimistic visual state updates tied to project-scoped execution data
- The organic sprint bubble cells use the same live start/stop control path as the registry list, so the hover play/stop action is now functional instead of decorative
- Organic sprint bubble cell shadows use the shared project-cell organic shadow underlay from `organic-cell-styles.ts`, keeping sprint and project gallery cells at the same ambient depth in light and dark themes.
- Sprint cells now surface a QA-reviewed indicator with an expandable overlay section inside the created column, and allow marking sprints completed directly from the cell menu
- Task rows and Live task cards now surface task-level QA review badges from the latest task QA run, including a running indicator while QA review is in progress, and the same task records carry an optional latest `selfReflectionRating` payload when a completed task run persisted one. Rated tasks expose `overallRating` plus per-section `sections`; unrated or historical tasks without a captured rating omit the field and do not show a placeholder badge.
- The Tasks page sprint scope selector uses a keyboard-accessible listbox pattern with selected, open, loading, and empty option state, arrow/Home/End navigation, Escape close, outside-click close, and trigger focus restoration. Task board status and priority filters keep the current cards visible during the short filter transition, then announce the settled result count through a polite live region. Task board lanes render as named regions with count summaries, drop-target feedback, reduced-motion drag-disabled copy, and status regions for loading, empty, and error states; Kanban cards expose task id/title/status/priority, dependency blockers, optimistic saving, session, preview, PR, live runtime, rerun availability, duration, QA review context, self-reflection rating context, and screen-reader drag guidance in stable accessible text while keeping drag-and-drop pointer-only. Creating or editing a task opens a named editor viewbox inside the task workspace: it sits to the right of the board on wide screens, becomes the primary full-width region on narrow screens, keeps the selected sprint scope plus active board filters intact, and can persist a task-level `agentPresetId` worker-agent override. Card quick actions sit in the bottom footer below metadata/dependency indicators; fine-pointer layouts reserve the action tray and reveal it on hover or keyboard focus, while touch/coarse-pointer layouts keep actions visible.
- Rendered markdown previews use near-black body, heading, list, blockquote, and table text in light mode while preserving slate/white dark-mode text and signal-colored links/code.
- Live task cards now include `Edit` and `Force complete` actions:
  - `Edit` deep-links to `/tasks?taskId=<taskId>&sprintId=<sprintId>` so operators can open the task editor directly from the live surface.
  - `Force complete` calls `POST /api/projects/:projectId/tasks/:taskId/force-complete`, disables itself for already completed tasks, and surfaces inline failures on the card.
- Sprint creation no longer asks for start/end dates
- Sprint creation now uses an in-page composer that replaces the showcase while writing, instead of opening a detached modal
- The sprint composer supports `Plan & Start`, `Plan Only`, and `Save Draft`.
- The sprint composer prompt area renders a full-width editor until an original prompt exists, at which point it uses a split layout.
- Sprint key previews now reserve pending creation numbers in the page state, so opening `New Sprint` or `Quicksprint` while another create/plan request is still pending advances the visible key sequentially (for example `SPR-02` then `SPR-03`) and releases reservations after refresh or failure.
- When planning a sprint (`Plan Only` or `Plan & Start`), the pre-improvement raw prompt is saved to `originalPrompt` if it isn't already set, keeping the worker-improved text as the goal.
- The planning feedback overlay surfaces both an ETA countdown and an elapsed runtime timer. ETA comes from `GET /api/projects/:projectId/sprints/composer/eta`, computed server-side from the latest 10 planning invocations for the selected project, with a 3:00 fallback when no usable sample exists. The dashboard uses that estimate visually only; the overlay does not change backend planning behavior.
- When editing a sprint that already has planned tasks, the composer offers `Replan` (discard and regenerate subtasks), `Append Tasks` (open a task-creation modal pre-scoped to the sprint with dependency selection from existing tasks), and `Save Draft` (update name/goal only)
- The sprint composer includes a planning-agent selector that allows operators to choose an alternate planning preset (filtered for presets with a `planning` label) for the current sprint. Leaving this on the default `Planning agent` preserves existing behavior, and any selection is honored by `Plan ahead with AI`, `Plan Only`, `Plan & Start`, and `Replan`.
- Imported GitHub/GitLab/Jira issues render as linked issue cards directly under the Sprint Prompt field and are persisted with the sprint. Each card shows source metadata, state, labels, assignees, and whether conversation context is included. The prompt receives a linked-issues markdown section so planning sees the imported issue scope. Linked Jira imports also attempt the Settings -> Integrations -> Jira import transition, enabled by default as `In Work`; transition failures are returned as warnings and do not remove the local linked issue. Special remediation tasks render in a separate composer tray and are persisted through the imported-task endpoint instead of being folded into planning prose or moved through Jira import transitions.
- Settings -> Sprint -> Git Flow includes `Auto-close linked issues`, which closes imported GitHub/GitLab issues only after sprint completion and the main merge gate is no longer blocking. Jira auto-close is configured separately in Settings -> Integrations -> Jira and uses the close transition name, defaulting to `Done`; it is separate from the import transition.
- The sprint composer and quicksprint panel share a visible planning feedback overlay that replaces the generic spinner during `Plan ahead with AI`, `Plan Only`, `Plan & Start`, `Replan`, and quicksprint planning actions. It presents request-specific status copy, ETA/elapsed timers, and the same minimize/cancel/recovery model in both flows.
- Planning feedback is deterministic and staged, using an animated vessel treatment (Wooden Ship for AI improvement, Container Ship for planning and quicksprints) that travels across the course, exits cleanly to the right, and respawns offscreen on the left for the next pass so progress feels continuous without jumping.
- The vessel itself is an accessible interaction target: activating it swaps the vessel for a coffee reminder and keeps planning running. The reminder is a lightweight dashboard easter egg; it does not alter the request, timers, cancellation, or `New Sprint` / `New Quicksprint` recovery behavior.
- Planning and prompt-improvement requests continue server-side if the browser tab is refreshed or closed. Request initiation immediately disables duplicate composer actions, marks the composer busy for assistive technology, keeps the current form content visible, and announces state-specific pending copy through the existing action feedback region. The overlay's `Cancel Active Request` action sends an explicit cancellation request and leaves visible recovery feedback in the composer. Quicksprint requests expose `Cancel Quicksprint Request` in the same shared overlay and keep an inline cancel control available after minimizing. Form validation focuses the first invalid required field for prompt improvement or submission attempts instead of silently leaving the operator in place. The `Save Draft` and `Append Tasks` modes also have defined progressive text for planning feedback, while `New Sprint` and `New Quicksprint` detach the current planning run from the visible composer, immediately reset the form controls, and leave the old run to finish without closing or mutating the fresh composer. Reduced-motion users see the planning overlay in a static-but-informative state rather than a moving ship animation.
- Clicking `Minimize` fully dismisses the planning overlay action row (`Minimize`, secondary action, and overlay cancel button). Any progress restore affordance remains inside the composer/quicksprint panel layout instead of floating over unrelated page content.
- Sprints page `View Tasks`/`Open` links pass the sprint id to the Tasks page as `/tasks?sprintId=<id>`. The Tasks controller treats that value as a project-local route filter: it applies the sprint only when it belongs to the currently selected project, ignores stale sprint ids after navbar project changes, and clears invalid sprint query state without changing the global project selector.
- Settings now expose separate CLI retry controls for quota resets and rate limits, including the rate-limit delay and a max rate-limit retry count (`5` by default). Exact provider reset timestamps are honored, while ambiguous Codex wall-clock hints fall back to a bounded 30-minute retry. Session sync preserves quota/rate-limit dispatch errors so active retry timers remain visible, and runtime events plus invocation records surface the same `retryAfterIso` metadata the worker actually uses. Expired or missing cooldown metadata still requeues the task instead of leaving it stuck in `QUOTA`.
- The v2 settings workspace restores the full Git Flow and Git host controls:
  - Git Flow lives in the Sprint tab with default branch, branch prefix, sprint branch scheme, remote/local mode, and auto-create PR
  - Integrations exposes system GitHub, GitLab, Jira, Notion, Asana, Linear, Miro, Lucid/Lucidspark, Figma/FigJam, and Mural credentials plus per-scope GitHub auth-copy mounts and Docker git identity; local `.gitconfig` copying hides the editable name/email fields when enabled
  - CLI provider credentials are managed per named instance, including optional local auth-copy mounts and custom auth paths for each Gemini, Codex, or Claude entry
- The first-run onboarding flow starts with Easy, Standard, and Expert setup modes, then guides operators through installation checks, container security basics, provider auth-copy setup, AI behaviour defaults, and appearance preferences. Expert is the default and keeps the full installation, provider auth-copy, Git, Jira, default routing, automation, and appearance flow. Standard is the user-facing spelling for the balanced `STANDARD` mode. Easy uses one recommended-provider path, two GitHub checkboxes, and safe default settings, then lands on Chat. Appearance changes preview immediately during onboarding, including Light/Dark/System theme, navigation mode, reduced motion, background mode, static color, and supported desktop zoom. See [Dashboard Onboarding](./onboarding.md).
- The Docker top-nav control now consumes onboarding readiness data. If Docker is unavailable, it shows a `Cluster not ready` badge with an info icon and explains that Docker is mandatory for containerized CLI execution.
- Settings -> General now orders runtime setup as Automation, System Runtime, Docker Runtime, then Onboarding. The old Inheritance Model card has been removed from General, and `Open Onboarding` remains at the bottom to reopen setup without clearing saved settings.
- Settings -> Appearance previews unsaved edits immediately in the active dashboard shell. Theme, motion, navigation mode, animated/static background selection, static color, uploaded background image, and pattern overlay all update before Save Changes; leaving Settings clears the preview back to the persisted effective settings. New installs default the pattern overlay to `None`.
- Settings now guard unsaved edits during route transitions and browser refresh/close events. Internal navigation prompts only when the active settings scope is dirty, and listeners are removed immediately after save, explicit reset/discard flows, or Settings page unmount.
- Saved system or project settings invalidate cached effective project settings in mounted dashboard routes, so persisted appearance changes continue applying after navigating away from Settings without requiring a full app reload.
- The notification center now renders startup-check notifications from real readiness data, surfaces human-intervention alerts when a sprint needs operator attention, and persists read/dismissed notification state in browser storage.
- GitLab support is available from Integrations with dashboard token persistence, backend GitLab host detection, `glab` support, and GitLab CI queries. `GITLAB_TOKEN` / `GLAB_TOKEN` remain supported as external fallbacks.
- The Integrations catalog is grouped by purpose (`API`, `CLI`, `GIT`, `PM`, `CANVAS`) and keeps host hint import plus runtime auth-copy status in the panel header.
- Jira support is available from Integrations with system-scoped site URL, account email, API token, default project key, import transition controls defaulting to `In Work`, close transition controls defaulting to `Done`, and Jira-specific auto-close controls. The Sprints page Jira import opens directly from the Import menu and uses the same sprint composer flow as GitHub/GitLab imports, with exact-key lookup in the default guided search, progressive user, label, date-window, and JQL override filters, plus optional special-task routing for security and quality follow-ups.
- Notion, Asana, and Linear appear in the PM group; Miro, Lucid/Lucidspark, Figma/FigJam, and Mural appear in the CANVAS group. Each detail panel edits enablement, API token, optional secret, base URL, search limit, and provider-specific default workspace/team/project/database/board/document/file IDs. Cards show `Active` only when enabled and the provider's required fields are present, and `Configured` when the minimum credentials/defaults are saved. These integrations are read-only importers; Code UX uses them to attach external context to sprints and does not write back to the provider.
- Sprint data now hydrates cache-first when revisiting the page and refreshes in the background, so the showcase and ledger do not flash empty while the latest data loads. First-hydration uses skeleton placeholders while background refreshes continue, preserving existing data without reintroducing blocking loaders
- Sprint and task list windows support selectable page size options (`10`, `20`, `50`, `100`, `All`) with a default of `20` (a frontend-only view change with no API contract change)
- The Tasks board applies status and priority filters before list-windowing; lane headers and aggregate stats count the full filtered set, while only the visible card arrays are capped by the selected window. Filter changes preserve the previous board content until the settled result is ready to announce. `coding_completed` and `QA_REVIEW_FAILED` tasks continue to render in the `in_progress` lane.
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
- The Quicksprint panel shows default and custom templates in one shared browse rail and includes a purpose selector for built-in template sets. The first shipped built-in purpose is `Fullstack JS App`, which groups six project-agnostic engineering and UI quicksprint templates loaded from `.code-ux/quicksprints/templates` and overrideable from project or home `.code-ux` directories. The browse rail uses a two-row horizontal slider with left/right paging controls, direct horizontal scrolling, vertical wheel forwarding so normal page scrolling still works over the panel, and project-local deletion markers for default templates. See [Quicksprint Templates](./quicksprint-templates.md).
- Quicksprint browse mode is browse-only: it changes how templates are discovered, but template execution still uses the same planning flow, shared ETA/elapsed overlay, coffee reminder interaction, and subtask-count controls as sprint planning.
- The refreshed sprint ledger below the showcase renders as a responsive card/table hybrid: mobile rows collapse into touch-friendly sprint cards, desktop keeps sortable table scanning, and the header includes live visible/pinned/active/completed counters.
- The sprint ledger receives the full project sprint collection for counting, searching, sorting, selection, and task-count/progress accounting; the local `Show` selector is the only row-windowing layer, so large projects do not under-report sprints or task totals during initial render.
- The desktop ledger table now enforces mirrored per-column width guards (`w-*` + `min-w-*`) with a container-scoped horizontal scroller, preventing header/body overlap at narrow widths while avoiding page-level horizontal overflow.
- Sprint ledger rows now include dedicated mobile field labels (`Sprint ID`, `Sprint`, `Status`, `Tasks`, `Completion`, `Created`, `Controls`) so narrow viewports keep critical values readable without clipping.
- Ledger controls include real-time search, dropdown filters for status, showcase, and QA state, page-size selection, a filtered/total counter, and a clear action that resets the full filter set.
- Ledger search integrates with selection: the header select-all checkbox operates on the currently filtered set only, and the selection is automatically pruned when the filter changes so stale hidden selections cannot accumulate
- When one or more ledger rows are selected, a bulk action bar appears with `Start` and `Delete` controls that operate on all selected sprints, plus a `Clear` button to deselect
- Sprint ledger row controls now expose pause/resume in addition to existing start/stop semantics, and each runtime action shows pending/disabled state while the control request is in flight.
- Sending a chat message updates the thread transcript immediately from the returned message record, while the invocations rail waits for the server-created invocation row from the execution snapshot or realtime refresh.
- Sortable column headers cycle through unsorted, ascending, and descending for showcasePinned, sprintKey, name, status, tasksCount, completion, and createdAt (default: newest-first)
- Ledger rows expose: pinned/showcase state, sprint key, review and human-intervention badges, task count, gradient progress, created/updated metadata, a primary start/stop button, an `Open Subtasks` deep link (`/tasks?sprintId=<id>`) that navigates to the Tasks page pre-filtered to that sprint, and a compact settings menu for edit/export/showcase/overrides/delete
- The sprint page no longer runs a full-page entrance fade on mount, which keeps initial navigation more immediate and avoids perceived flashing
- The sprint page now uses lighter targeted motion on the heading instead of a full-page fade, keeping navigation more immediate without leaving the page static
- Sprint composer planning-route overrides now correctly force the selected virtual provider instead of only overriding the model on the project default provider
- Sprint composer includes a `Schedule` execution mode that saves the sprint and creates a scheduler entry without planning or starting immediately. The schedule can use an absolute date/time or run after another project sprint ends, and the saved sprint keeps key overrides, prompts, routing/model choices, agent presets, linked issues, and imported tasks.
- Heavy WebGL-only dashboard surfaces are now lazy-loaded, including the global ocean background and the agent avatar scene, so the initial dashboard route no longer eagerly pulls those renderer modules into the first page chunk
- Tasks page is project-scoped and uses a three-column board state (`Queued`, `In Progress`, `Completed`), where `coding_completed` acts as active work.
- Tasks page renders create/edit through the `TaskComposer` as a full-height right-side editor viewbox inside the task workspace. The board remains available beside the editor on wide screens, while narrow screens place the editor as the primary full-width region above the board.
- Tasks page keeps route-level state, sprint scope routing, optimistic task insertion, and task mutation handlers in `useTaskBoardController`, while `TasksPage.tsx` wires focused task-board components under `dashboard/src/v2/components/tasks/` to render the sprint scope selector, filters, and Kanban lanes from the shared task-board view-model/action helpers.
- Tasks page task-card PR affordances use resolved project settings from `GET /api/projects/:projectId/settings/effective`: `PR pending` metadata and pending PR actions are hidden when effective project git settings disable task PR creation, including `git.autoCreatePr` off or `git.githubMode` set to `LOCAL`, while runtime-enriched PR links remain visible for existing pull requests whenever a URL exists.
- The create/edit task editor announces validation through the shared action feedback region, focuses and scrolls the first invalid required field into view, and exposes title, description, markdown prompt, status, priority, executor, dependencies, and worker-agent selection as labeled controls. Dependency filtering reports result-count changes through a polite live region and preserves selected dependencies when the current filter hides them. The worker-agent selector saves the built-in worker as no override and configured presets as the task's `agentPresetId`.
- On a fresh installation, the Tasks page replaces the old generic project/sprint/task database message with a polished task-scope placeholder; the project action opens the shared Add Project dialog and the sprint action routes operators to the Sprints page before the kanban controls appear.
- Task cards now explicitly show downstream dependent tasks as readable metadata tags.
- Task cards keep the premium glass layout with pointer-driven tilt, status wave, border trace, compact executor/time metadata, and dependency status badges. Quick actions for edit, delete, rerun, preview, PR, and live runtime are visually revealed on hover or keyboard focus instead of being persistently shown, and they remain keyboard accessible with fixed hit targets and task-specific labels. Low-value visible metadata such as the default `Auto` executor and the pointer-only drag helper chip are omitted from cards; screen-reader drag guidance, dependency blockers, QA review, optimistic saving, PR-disabled pending states, and drag-disabled context remain available through accessible text, badges, or labels.
- Navigating from a sprint cell into `View Tasks` preselects that sprint when it belongs to the active project instead of leaving the board on `All Sprints`.
- Tasks page sprint deep links are local route filters. They do not change the global project selector, and stale `?sprintId=` values from another project are discarded when the navbar project changes.
- Selecting sprint scope from the Tasks page body remains project-local: the selector updates `?sprintId=` and persists the selected sprint through `PUT /api/projects/:projectId/selected-sprint` for the active project only.
- Tasks page now refreshes from the same project-structure realtime invalidation path as sprints
- Tasks and sprints now refresh silently on background realtime invalidation, so opening the Tasks page no longer repeatedly flashes loading state when project metadata or structure updates arrive
- Tasks board is now scoped to the active sprint selection when one is set, filtering the view to only tasks for that sprint
- Tasks page stores explicit task executor preference (`auto`, `docker_cli`, `jules`) plus optional task-level `agentPresetId` worker-agent overrides.
- Shared task rating UI uses `SelfReflectionRatingBadge` for optional task-run self-reflection records. The badge stays compact for dense task headers, exposes an accessible 5-star meter with numeric copy, and shows section ratings plus notes in a viewport-positioned tooltip on hover or keyboard focus. Tooltip rows are derived from each section's `label`/`normalizedLabel`, `rating`, and optional `note`, so hover details explain the individual self-reflection sections instead of only repeating the overall score.
- The Tasks board entrance animation now replays only for project/view/filter changes instead of every background task refresh
- Stats page is project-scoped and visualizes tracked token, time, model/provider, source, task/sprint, Git, and system invocation telemetry for the selected project with `1h`, `24h`, `7d`, `30d`, `all time`, and custom date windows.
- Scheduler page is project-scoped and provides a calendar plus 24-hour day view for timed sprint starts, quicksprint launches, and `/chat` messages. Recurring entries expand into every visible day in the calendar and support minute-level recurrence (`minutely` in API/MCP payloads, `Minutes` in the form) plus endless, fixed-count, and end-date/time recurrence. It also supports editing existing entries directly from scheduled entries or occurrences with full form hydration, title customization, cancellation support, and the shared absolute/after-sprint-end timing contract used by sprint composer and quicksprint scheduling shortcuts. See [Scheduler](./scheduler.md).
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
  - browser chrome and session controls expose explicit accessible names for window controls, back/forward/reload, external open, rebuild, stop, script save, and session removal
  - preview state changes are announced through status/alert regions for loading, starting, running, stopped, reconnecting or unavailable containers, stale logs, saving scripts, launching containers, and empty session states
  - session rail controls expose selected, starting, removing, health, disabled launch, and unavailable-link states through visible text/badges plus ARIA state; overflow scrolling respects reduced-motion preferences and does not rely on hover-only arrow discovery
  - address entry has a programmatic label, disabled-state description, and announced navigation submissions while preserving focus in the form
  - remove actions on session cards fully delete preview-session entries after stopping any live container
  - rebuild, stop, open-in-tab, startup-script editing, and log viewing
  - sprint previews are proxied through the dashboard instead of embedding raw localhost origins directly
  - extensionless preview-host deep links such as `/sprints` now recover to the preview app shell when the upstream dev server returns `404`, so direct loads and refreshes stay routable
  - fluid responsive design across device classes (mobile stacking to wide side-panels) with safe viewport-constrained iframe sizing and scrollable/wrappable control chrome
  - dashboard accessibility responsibilities stay in the browser chrome, session rail, address form, script/log panels, and preview state banners; embedded preview app content remains isolated inside the iframe
- File Browser page is project-scoped and mirrors the same v2 hierarchy and workbench visual language as Browser Preview:
  - signal-accent eyebrow and `font-display` heading hierarchy with responsive supporting copy
  - normalized control rail with semantic status badge, sprint/branch context, mode toggle, and rebuild/stop controls
  - restrained panel surfaces for sidebar and viewer regions using shared neutral/light-dark borders and backgrounds
  - launch state card matching Browser Preview container-launch conventions (accent icon treatment, selector styling, and primary action button)
  - file tree, change list, loading, empty, and error states expose explicit roles and selected-state semantics so keyboard and screen-reader users can browse without pointer hover
  - background refreshes keep cached tree, selected file, changed-file list, and selected diff content visible when available, then layer polite refreshing or cached-copy recovery messages over the stale data instead of replacing the workbench with spinner-only panels
  - file tree search and file/changes mode switches announce result counts plus the active file or change selection through polite live regions
  - start, rebuild, and stop actions expose pending and success feedback; rebuild/stop controls suppress duplicate activation with `aria-busy` and provide disabled-state reasons when no selected or running session is available
  - long sprint names, branch names, file paths, and diff labels wrap inside their panels instead of forcing page-level horizontal overflow
  - file browsing/diff behavior remains unchanged (`files` and `changes` modes, selected path display, side-by-side toggle, and status semantics)
- Stats page uses a flat project analytics workspace with light/dark support and responsive behavior across screen sizes:
  - page-scoped Stats panels, chips, cards, inputs, ledgers, and focus rings come from `stats-theme.css` and the shared Stats primitives.
  - selected tags stay black/neutral, while data-color accents are reserved for chart series, source confidence, status, and other telemetry meaning.
  - visual-mode navigation focuses the workspace on Trend, Composition, Models, Providers, Ledgers, or System.
  - Trend uses an interactive usage chart with hover and keyboard bucket inspection, minimap selection, drag zoom, graph filters, grouped series switches, and accessible chart summaries.
  - Composition layers provider share, token anatomy, source confidence, purpose activity, cache efficiency, Git context, and low-data fallbacks.
  - Models ranks model usage and efficiency from snapshot model summaries, including success tone, latency, cache, reasoning, token volume, pricing, and output velocity.
  - Providers surfaces reliability, telemetry confidence, failure pressure, provider coverage, duration coverage, source mix, and audit notes from the existing stats snapshot.
  - Ledgers uses tabbed Task Telemetry, Sprint Telemetry, and Git Telemetry with search, sort, progressive rendering, token-flow bars, and dedicated Git churn visuals.
  - System splits operational debugging into sprint state, health snapshot, external API activity, error categories, filters, pagination, invocation rows, and expandable transcript detail.
- The Stats page uses the same project realtime invalidation channels as the rest of the v2 dashboard, then falls back to polling so usage graphs and tables stay current during active sprint execution
- Overview widgets and headline stat cards now read project/task data from the same project-management API surface, and task streams are filtered to the currently selected active sprint only (a frontend-only view change with no API contract change)
- Agents page features an immersive, showcase-first layout that defaults to presenting the selected agent's 3D animated avatar, details, and route-assignment tags, rather than a raw edit form.
- Agents page route-assignment tags include every configured QA reviewer in each trigger roster: task completion reviewers show `QA Task`, sprint completion reviewers show `QA Sprint`, and completed-task-without-PR reviewers show `QA No PR`; legacy single-agent QA settings still render the same badges.
- `Settings > Agents` groups Project Markdown Mirror, Agent Routing, persistent skill storage, and self-reflection into a compact workspace. Agent Routing now uses option-card controls for Manual versus Orchestrator mode, a shared multi-select roster for orchestrator-eligible coding agents, and disabled role selectors with explicit project-agent guidance while keeping built-in fallbacks for planning, coding, CI fix, merge conflict, dashboard reply, and clarification reply routes.
- Agents are generated with a random persisted avatar on creation and can be fully customized in the dedicated edit mode. Server-side sync also resolves missing avatar metadata for base roles and Project Setup Agent generated specialists, then persists the result into sqlite and mirrored markdown.
- Agent detail cards show selected-agent usage totals from execution invocations, including total cost, tokens, run count, and completion rate alongside provider/model, MCP, and instruction metadata.
- Edit mode exposes a new toggleable Memory Template Override control, allowing operators to explicitly provide custom memory injection instructions on a per-agent basis.
- Edit mode now also exposes a dedicated `Manage Memory` popover for tier selection, category filtering, global and per-category minimum strength, and short/long-term memory caps. Empty category selection means all categories are included, and per-category overrides are only shown for categories currently eligible for injection.
- The agent editor shows a compact memory summary chip under the filter trigger so operators can see the active memory scope without opening the popover.
- Worker prompt preparation honors that memory config at runtime by filtering injected memories after retrieval, so the prompt only includes the configured tier(s), categories, strength thresholds, and per-tier caps.
- Agents page is DB-backed and manages project-scoped agents (`name`, `short routing description`, `instruction markdown`, `memory template markdown`)
- Agents are auto-imported from project and home `.code-ux/agents/*.md` when first discovered
- Project-local markdown mirroring is enabled by default through project settings, so dashboard edits create/update `.code-ux/agents/*.md` in the selected repo without touching shipped defaults
- Markdown-backed agents now show sync state and support single-agent `Import`, roster-level `Pull from files`, roster-level `Push to files`, and single-agent `Push to file`; sqlite remains the live authority, pull copies file content into sqlite, and push exports sqlite presets to project files
- The first built-in role is `Planning agent`, which is editable under Agents like any other DB-backed agent
- `Settings > Sprint & Git` now includes the QA controls immediately below `Merge Gates & Autofix`, with comparable max-run and exhaustion-policy controls plus per-trigger toggle-linked rows. Each task-completion, sprint-completion, and completed-task-without-PR row combines the enable switch with a shared multi-select agent roster, selected-count feedback, keyboard focus, disabled guidance, and the same project-scope behavior for local QA edits. The persisted settings path stays anchored at `agents.qualityAssurance`; leaving a trigger with no custom agents selected clearly uses the built-in QA fallback without saving placeholder preset ids.
- Chat page is DB-backed and stores project conversation threads/messages in sqlite
- New dashboard chat threads derive an 8-word-or-less title from the first visible user message, persist it with the thread, and mirror it to `.code-ux/conversations/<thread-id>/session-title.md`; hidden/internal messages do not drive user-facing titles.
- Prompt preparation includes a title-refresh instruction every 20 provider invocations so long-running conversations can update their title from current context without replacing the visible transcript.
- Chat thread titles can be renamed inline from the active thread header. The header editor supports pointer and keyboard use, saves on Enter, cancels on Escape, rejects empty titles before sending, uses `PATCH /api/conversations/threads/:threadId` with `{ title }`, and updates both the active header and thread rail from the returned thread record without replacing the visible transcript.
- Active chat titles wrap or truncate inside the bounded header area, while thread rail titles clamp to two stable lines with long-word wrapping so manual renames remain readable without causing rail layout churn.
- Chat page now provides a `Threads / Invocations` toggle to switch between human conversation threads and read-only execution invocations.
- Chat page UI is redesigned with animated identities, structured widgets for rich messages, and automatic worker pickup derived from active project routing.
- Sprint and task references in chat messages and invocation transcripts resolve to live status widgets when they match real records in the selected project. Sprint widgets link to the matching Sprint page, task widgets link to the matching Tasks page, and ambiguous bare task keys are left as normal text instead of being guessed.
- Chat Threads mode exposes **Create Desktop App** and **Create Web App** quickactions beside the composer, including empty threads. Clicking either control posts the short visible chat message immediately, creates a thread first when needed, and does not open a confirmation dialog or switch to Invocations. The dashboard includes the active project's effective techstack in the quickaction metadata, using the assigned catalog entry or the catalog default plus stack item labels as suggestion tags. The backend launches the matching detached quicksprint with `Plan & Start`, then the transcript shows an app progress widget with app kind, sprint name, stack fields, metadata-driven stages, and suggestion tags. Users can keep typing in the same thread while planning runs; follow-up messages are queued until tasks exist, then appended to the sprint-level goal under `Additional direction from chat`.
- Agent replies can append optional prompt suggestion tags from `metadata.promptSuggestions` below the normal markdown message. Each tag can show one supported generic icon (`sparkles`, `search`, `edit`, `code`, `terminal`, `bug`, `check`, `play`, `refresh`, `settings`, `file`, `folder`, `git-branch`, `git-pull-request`, `database`, `shield`, `book-open`, `message-circle`, `list-checks`, `rocket`, `zap`, `lightbulb`, `clipboard`, `download`, `upload`, `eye`, `package`, `server`, `clock`, or `help-circle`) and fills the composer with the next-step prompt when clicked, without auto-sending or changing read-only invocation transcripts.
- Chat page logs invocation activity explicitly in the background, providing observable execution artifacts directly in the chat view.
- Chat page filters the "Threads" mode to show user-facing conversation threads (`scope === "project"`).
- Chat page "Invocations" mode provides a read-only list with metadata for active/completed execution invocations without cluttering the main thread rail.
- Sprint-planning invocation transcripts include the execution plan generated for that invocation's linked sprint. The plan card is replayed from persisted invocation message metadata (`metadata.widget_metadata.type = "planning_request"` plus `metadata.executionPlan`), so historical transcripts do not change when the operator selects another sprint or replans the same project later.
- Invocation cards and detail headers now show the resolved provider model when available, so planning runs expose the same model visibility as worker cards.
- Invocation cards and the invocation message stream now surface classified provider errors such as `Rate limit` and `Quota reset`, including retry wait information when Code UX is backing off automatically. If Code UX restarts while an invocation is sleeping until a retry time, startup recovery closes the stale running invocation with a recovery message and moves task-backed work back to a retryable state so the recovered sprint loop can start a fresh continuation.
- Chat page playful-agent copy is presentation-only and workplace-safe. Active reply statuses, invocation-container statuses, tool-call context lines, reasoning/thinking lines, and assistant mood asides use curated non-offensive humor keyed to the agent/provider/model/phase or transcript item. Active status copy stays visible for at least five seconds before rotating so polite live regions remain readable. These adjunct lines never replace the actual provider response, tool name, arguments, output, reasoning text, status metadata, or persisted conversation/invocation transcript content.
- Chat page now receives websocket updates for thread assignment changes and incoming thread messages in the active thread
- Chat page now shows a live "working" bubble once a listener has picked up a dashboard message and is preparing a reply
- Chat page message, invocation, and working bubbles now use light-mode slate surfaces and darker text to keep chat transcripts readable without altering the Warm Void dark theme
- Chat and agent avatar scenes can render a lightweight pseudo-raytraced flashlight effect using ordinary WebGL presentation primitives: a translucent beam, target glow, accent-aware light, and small material glows. It tracks the pointer when motion is allowed, idly scans when appropriate, and may show a brief bounded low-battery humor overlay. Reduced-motion settings or WebGL fallback paths use the static SVG avatar and omit scanning/flicker behavior.
- Chat page invocation navigation keeps the rail and transcript height-bounded, so clicking through long invocation records scrolls only the internal panes and does not add page-level blank space.
- Chat page now force-refreshes the selected thread when realtime thread updates arrive, so virtual replies clear stale `pending` delivery badges and sidebar counts as soon as the reply lands
- Chat message and thread timestamp chrome now suppresses malformed timestamps instead of rendering `Invalid Date`
- Thread compaction works on virtual chat routes by resuming the selected CLI provider session and sending its native compact command, while connected routes send a hidden control request to the selected live worker, store the compaction output, and use that saved handoff when a fresh reply prompt is required
- Hidden compaction control messages are excluded from visible thread history, previews, pending badges, and connection inbox counts so the chat UI stays clean while compaction runs
- Chat threads can now be deleted directly from the history rail; deletion is realtime-aware and removes the thread across open dashboard views
- New thread creation now deduplicates optimistic UI insertion against realtime thread updates, so the sidebar count no longer briefly overstates the number of chats
- Chat page now hydrates thread lists and conversation panes from cache first, so revisiting a project or switching between already-seen threads is immediate instead of blocking on a fresh fetch
- Loading states are now reserved for first hydration only; realtime invalidation, manual refresh, send/delete flows, reassignment, and unrelated project updates refresh in the background without replacing the thread rail or active conversation with loading cards
- Creating and deleting threads now stay on the cache-first path too, so the thread rail count and conversation pane no longer flash or fall back to blocking loaders during thread mutations
- Fresh-install chat states now render polished placeholders for the no-project, no-thread, empty-thread, and no-invocation paths, including an animated sidebar rail placeholder instead of an empty sidebar column; the chat rail/detail layout now waits until large screens before splitting into two columns so empty states remain readable on narrower viewports
- When no project is selected, `/chat` shows a local onboarding assistant with exactly five quick bubbles: Add my first project, Build a desktop app, Build a web app, Explain Code UX, and Change settings. These turns stay local to the browser page; they do not create persistent conversation threads or call project-scoped chat APIs. Provider-backed project chat starts only after a project exists.
- Chat composer now sends on `Enter` and inserts a newline on `Shift+Enter`
- Thread assignment control is explicitly labeled as `Worker:` in the thread header to make routing intent clearer
- Virtual-worker-routed tasks are created from the same task editor and appear in the same board; the executor badge shows whether work is automatic, CLI-backed, Jules-backed, or handled by the virtual worker lane
- Settings page now exposes Browser Preview as its own primary left-rail category, covering preview enablement, in-app browser visibility, launch/rebuild automation, Git sync on rebuild, maximum active preview containers, port allocation, and the project-relative preview startup script path
- The Integrations settings panel now returns the selected detail view to normal document flow after the slide animation completes, so tall forms like GitHub configuration can extend to full height instead of being clipped to the shorter integrations list.

### File Browser view
- Responsive container layout with bounded height stacking on narrow screens and side-by-side grid panels on wide screens
- Automatic toggle between inline and side-by-side diff modes based on viewport width
- Resilient long-path wrapping in action bar, file tree rows, change-list rows, and active file viewer controls
- File tree rows expose treeitem selection/expanded state, change rows expose listbox option selection, and loading/error/empty regions announce their state
- Search, mode-switch, and selection changes are summarized in polite live regions with result counts, so operators hear whether they are in Files or Changes mode and which file/change remains selected
- Tree, file, change-list, and diff refreshes preserve matching cached content with visible stale/refreshing copy; first-load states still use centered loading panels, and failed refreshes keep stale content visible with recovery messaging
- Rebuild and Stop controls disable while pending, set `aria-busy`, and describe why they are unavailable when there is no selected or running file-browser session
- Automatic Monaco viewer layout recalculation to prevent hidden or overflowing code views

### Dashboard view
- Task statistics
- Execution runtime panel for sprint runs, dispatch queue state, live project connections, worker assignment, lease ownership, and recent runtime events
  - Queued/deferred dispatches show a stable status indicator `Waiting for slot (current/limit)` when an invocation is waiting for a provider concurrency slot.
- Live runtime visuals are only considered active when the selected project has a `running` or `queued` sprint run; cancelled, paused, and completed runs fall back to a waiting state
- When no sprint is running but a paused sprint needs human intervention, the overview telemetry now switches from an empty state to an attention state with the exact reason and operator instructions
- Task pipeline cards
- Task cards include a `Rerun` action with confirmation prompt; rerun clears session/PR/merge state for that task and starts it again
- Rerun now performs a full runtime reset instead of only changing task status:
  - failed-session retries clear stale session ids, provider activity, worker branch, PR URL, merge flags, and intervention metadata before a new run starts
  - if the operator chooses `Reset downstream tasks`, Code UX writes fresh pending execution snapshots for every dependent task so completed/running descendants no longer keep stale PR or session state during a clean rerun
  - if `Clear worktree` is enabled, the existing task worktree is removed before the reset so the next run starts from a clean workspace
- Rerun confirmation now warns when the selected task, or the selected downstream reset chain, already merged code; operators can use the **Undo the Git merge** checkbox to programmatically revert the merge commit in the feature branch before restarting the task cleanly.
- Rerun confirmation keeps provider/model loading, downstream reset, clear worktree, and undo-merge options visible and keyboard reachable. Pending, success, retry, and error recovery stay inside the modal through the shared action feedback region so failed reruns can be retried without losing context.
- Reruns now reuse the same dispatch model as normal dashboard orchestration instead of bypassing execution state
- Task cards now open a DB-backed runtime feed sourced from `task_run_events`
- Task cards now expose a task-scoped invocation feed sourced from the Live snapshot's `recentInvocations`, matching by task, dispatch, and task-run identity and linking each row to the full Chat invocation transcript
- The runtime feed now includes direct CLI stage events, action-required and protocol events, sprint-run lifecycle events, and CI/merge-gate state changes in addition to provider session activity
- `recentEvents` is now a unified runtime timeline spanning both `task_run_events` and `sprint_run_events`
- The selected-project execution snapshot now keeps the full task-dispatch and task-run event history for the active or most recent sprint run, so completed tasks in Live view keep their runtime feed and stage timings visible even after later tasks start
- The execution runtime panel can now start or resume sprint orchestration, pause or cancel sprint runs, cancel queued dispatches, and retry terminal dispatches
- The Live sidebar now renders `Invocation Feed`, `Runtime Timeline`, `Git / CI / PR`, `Attention Queue`, and `Execution Runtime` as separate standalone cards under the shared execution timeline context, with the invocation feed first and runtime timeline second while keeping the execution runtime card focused on runs and dispatches
- The Live sidebar invocation feed is scoped to the selected sprint when a sprint is selected, while still falling back to project-wide recent invocations when no sprint context exists
- The Live sidebar attention queue follows the same selected-sprint scope for active `open` and `claimed` items, including sprint-run-scoped blockers for that sprint; when no sprint is selected, the queue remains project-wide
- The Live API includes all invocation records for the selected sprint plus all invocation records for expanded active/paused/queued sprint runs, so paused or stopped sprint feeds remain visible and concurrent live sprints do not evict each other from the feed
- Jules task dispatches now appear in the Live invocation feed and Chat invocation tab immediately with a running placeholder row; Jules live/terminal sync later replaces the placeholder transcript with the real remote conversation and estimated usage
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
- Local embedding models support Hugging Face `tokenizer.json` files using WordPiece/BPE vocab records and SentencePiece Unigram vocab arrays, including XLM-R-style multilingual E5 special tokens.

### Settings view
- The active backend model is now scoped as `system -> project -> sprint`
- System settings own runtime, integrations, default project behavior, and MCP tool exposure
- Project settings own inheritable execution behavior such as provider routing, git defaults, CI intelligence, sprint loop steps, CLI workflow, and skills
- Project settings also own agent authoring behavior, including whether dashboard edits mirror agent markdown into the project directory
- Project scope General settings expose the selected project's display name as an immediate metadata edit. Saving calls `PATCH /api/projects/:projectId` with the trimmed `name`, refreshes the project collection, and leaves the project id, settings overrides, tasks, and runtime history unchanged.
- The `/config` page keeps the existing v2 settings shell and categories, but now binds them to real scoped settings instead of draft-only values
- System scope only edits system-owned controls, while project scope only edits project-owned overrides for the selected project
- The Settings command/status bar stays sticky below the app shell while scrolling, keeping the System/Project selector, selected-scope context, project availability or inheritance summary, active panel, and save state visible in one wrapping row. Smart Find adds context chips for current scope, active category, and save state above search and labels the quick category jump buttons as quick actions. The visible-category count is search-only metadata and appears there only while Smart Find is active; otherwise the visible search status stays to a quiet prompt and keeps the exact category total for screen readers. The bar avoids a long background card behind the scope controls; each control or chip carries its own tokenized contrast, focus ring, and reduced-motion-safe status cue.
- The integrations view now owns provider API keys, GitHub/GitLab tokens, GitHub workflow settings, Jira, and read-only importer settings for Notion, Asana, Linear, Miro, Lucid/Lucidspark, Figma/FigJam, and Mural, rather than splitting those across separate categories
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
- Danger Zone now supports confirmed project override reset and project deletion in project scope, plus full database reset in system scope
- Project saves operate on the effective form but persist only sparse diffs relative to the current system defaults
- Sprint settings are sparse overrides applied from the sprint page through the live override modal, which renders the same `ProjectSettingsEditor` in `sprint` scope, loads effective settings with per-field source metadata, and persists only the delta relative to resolved project defaults; a `Reset` action clears all sprint overrides back to inherited values
- Effective settings APIs expose per-field source metadata so the UI can show inherited vs overridden values
- The old legacy dashboard settings route is removed; there is no runtime fallback to the pre-refactor global settings page

## Polling Behavior

From `dashboard/src/hooks/use-dashboard-runtime-data.ts`:
- Live view now does one initial `/api/live` fetch, then subscribes only to `project.live.updated` for selected-project runtime state. The UI explicitly reflects websocket degradation states (`connecting`, `reconnecting`, etc.) without altering the stable Live snapshot payload.
- There is no steady-state client poll for status or execution on the Live page. Git/CI state hydrates from `/api/git-status` and then streams on the dedicated `project:<projectId>:git` websocket sub-scope.
- When the websocket reports `snapshot_required`, the browser re-fetches `/api/live` and replaces the whole live snapshot atomically.
- Git status is refreshed server-side on its own throttled `project.git.updated` stream so pages that only need the base `project:<projectId>` scope never parse large Git/CI payloads.
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
  - `project:<projectId>:live`
  - `project:<projectId>:git`
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

- The Chat header no longer exposes a manual refresh button; thread and invocation data stay current through realtime sync, route-driven hydration, and bounded fallback polling.

Live view behavior:

- `project.live.updated` replaces the entire selected-project live snapshot immediately
- `project.execution.updated`, `project.runtime_status.updated`, and `project.structure.updated` still exist for other dashboard surfaces and also fan into a follow-up `project.live.updated` publish for Live-page consumers
- attention queue changes now flow into the same live snapshot path, so merge-conflict escalation, worker claims, and resolution actions appear without waiting for a poll tick
- git status changes arrive through `project.git.updated` on `project:<projectId>:git`, which keeps heavy Git/CI payloads away from file browser, sprint, and scheduler subscribers
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
- Named provider instances grouped under `jules`, `gemini`, `codex`, `claude-code`, `qwen-code`, `opencode`, and `antigravity`
- Routing strategy:
  - `MANUAL` (single default provider instance)
  - `WEIGHTED` (weight-based distribution across enabled instances)
  - `AGENT` (uses the selected agent preset's optional provider/model preference, then inherits route defaults)
- Provider-instance toggles (`enabled`)
- Model selection
  - CLI providers expose curated model lists or configured custom endpoint models where supported
  - Jules remains hosted/managed and does not expose local CLI model controls
- Provider-specific thinking/reasoning selection
  - Gemini: `minimal`, `low`, `medium`, `high`
  - Codex: `low`, `medium`, `high`, `xhigh`
  - Claude Code and Qwen Code: `low`, `medium`, `high`, `xhigh`, `max`
  - OpenCode: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`
  - Antigravity: `low`, `high`
  - Jules does not render a thinking control
- Invocation routing at the provider-instance level, including instance pools and sparse per-instance overrides

Behavior:
- Empty provider key fields are valid.
- Runtime falls back to system auth/environment where supported.
- Multiple instances of the same CLI type are routed independently, so operators can weight several Codex or Gemini credentials differently inside one route pool.
- Legacy saved thinking values `SMALL`, `MEDIUM`, and `HIGH` continue to load and are normalized to the selected provider's supported value set before execution.

## CI Intelligence Settings

Settings group:
- `enabled`
- `enableLivePrMonitoring`
- `resolveAllCommentsBeforeMainMerge`
- `resolveAllCommentsBeforeFeatureMerge`
- `featurePrAutoMergeMode` (`OFF|CREATE_PR|WHEN_GREEN|ALWAYS`)

Effect:
- These settings influence protocol text generated by orchestrator.
- When `featurePrAutoMergeMode = WHEN_GREEN` (REMOTE mode), merge readiness is gated by real feature-PR checks (not instruction text only).
- `enableLivePrMonitoring` can disable live PR/CI polling gates entirely; in `LOCAL` git mode it is forced off.
- Jules-specific clarification and failed-CI feedback controls are shown under Settings -> Integrations -> Jules, including auto-answer clarifications, clarification answer mode/template, `waitForJulesCiAutofix`, and `julesCiAutofixMaxRetries`.
- `waitForJulesCiAutofix` controls only the Jules-specific failed-CI feedback path:
  - enabled: a Jules-managed task receives failed-check context in its existing Jules session before worker fallback.
  - disabled: Code UX skips the Jules session notification and dispatches worker-owned CI repair directly.
- `julesCiAutofixMaxRetries` sets how many CI-fix attempts are allowed before escalation. Escalation output includes exact task ids, PR links, failed check names, failed run summaries, and failed job names so no manual searching is needed.
- `featurePrAutoMergeMode = CREATE_PR` opens or reuses the feature PR and then stops before auto-merge, marking the task settled with `PR_ONLY`.
- `featurePrAutoMergeMode = WHEN_GREEN` executes feature-PR auto-merge once checks are green and review blockers are clear.
- `featurePrAutoMergeMode = ALWAYS` attempts auto-merge without waiting for CI, while still respecting merge conflicts and configured review-comment blockers.
- a successful feature-PR automerge now refreshes dependency readiness in the same loop pass, so downstream tasks can continue without forcing a manual resume
- Feature-PR CI wait/automerge matching uses worker branch first and falls back to the task `pr_url`, so tasks without a stored worker branch still remain gated correctly.
- Tasks that are still waiting on feature-PR CI now persist as `in_progress` in the dashboard task store instead of staying marked `completed` just because the provider session finished.
- Feature PRs already in GitHub `DIRTY` merge state are surfaced as merge conflicts before any CI wait, so branch-protection deadlocks do not leave the task stuck in perpetual pending-check state.
- If a matched feature PR has no checks, Code UX now consults local workflow definitions and only keeps waiting when a `pull_request` or `pull_request_target` workflow actually applies to that PR base branch; otherwise the task skips CI waiting and proceeds to merge readiness/review gating.
- Feature PR review gates ignore incidental comment counts when GitHub has no review decision, so Jules bot introduction comments do not appear as actionable review blockers.
- CI Runs in `Feature PR CI` tracking include recent runs from PR head branches targeting the feature implementation branch (plus feature branch runs), sorted newest-first; the panel shows the latest 5.
- Failed CI runs in tracking are enriched with failed job details and failed-job log excerpts (bounded) from Git host API/CLI data.
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
- In `REMOTE` mode, configured GitHub/GitLab tokens use host APIs and do not require local `gh`/`glab` binaries. Without a matching token, PR/CI tracking is unavailable unless a diagnostic CLI fallback is explicitly in use.
- Warnings include common conflict/CI trigger issues.
- Tracking scope is dynamic and shown in panel metadata:
  - `Feature PR CI` while sprint tasks are actively running and `featurePrAutoMergeMode = WHEN_GREEN`.
  - `Main Branch CI` outside active running-task windows (including final merge stage).
- PR comment counters are sourced from GitHub `comments` payloads in both object and numeric shapes. Feature PR merge readiness does not treat that counter alone as a blocker when GitHub reports no review decision.
- Recent merges list includes all fetched merges into feature-prefixed branches and the default branch.

## No-Key Startup Mode

Server startup no longer exits when Jules API key is missing. Code UX also performs startup availability checks for Gemini, Codex, and Claude Code, looking for API-key hints and stable local auth artifacts to prepare future onboarding decisions.

Behavior:
- MCP server and dashboard still start.
- Startup does not emit warning logs solely because the Jules API key is missing.
- API-backed tools return setup guidance until key is configured.
- Guidance points to:
  - `.env` (`JULES_API_KEY`)
  - `.code-ux/settings.json` (`julesApiKey`)
  - Dashboard settings (`http://localhost:4444` by default)

Runtime update:
- Saving a key in dashboard settings updates runtime API usage without restart.
- Leaving the dashboard key empty is supported; system-wide environment keys are used when present.

## Session Tracking and Live Feed

For provider-backed runs, session polling is now used to ingest durable runtime events into sqlite:
- Session IDs and states appear in task cards.
- Provider activity is mirrored into `task_run_events` and shown through the runtime feed.
- PR URL is shown once the workflow creates the PR.

## Provider Authentication Modes

Provider credentials and authentication modes support local auth-copy mounts, API keys, or dashboard-guided Docker logins.

### Provider Config Files
CLI provider instances also expose a **Provider Config** control that is independent from authentication mode:
- **None**: Do not copy a provider config file into the runtime. Use this when the provider should run from generated defaults, environment variables, API-key fields, or dashboard-auth state only.
- **Copy Host**: Copy the provider's standard host config file path when it exists, such as Codex `~/.codex/config.toml`, Gemini `~/.gemini/settings.json`, Claude Code `~/.claude.json`, Qwen Code `~/.qwen/settings.json`, OpenCode `~/.config/opencode/opencode.json`, or Antigravity `~/.gemini/antigravity-cli/mcp_config.json`. The path is shown as read-only context so users do not have to type it.
- **File**: Copy a specific local config file selected with the accessible file picker. Use this for alternate profiles, checked-out config files, or provider-specific runtime experiments that should not depend on the default host location.

Jules and the internal mock provider do not show Provider Config controls. Changing Provider Config does not clear API keys, local-auth paths, custom endpoints, or dashboard-login credentials.

### Mutual-Exclusion Contract
To prevent credential and runtime config conflicts, provider configurations enforce a strict mutual-exclusion contract between API keys and local mounting:
- **API Key mode**: API key input is rendered, and switching away from this mode dynamically clears the saved API key. Qwen Code and OpenCode authentication sub-modes (e.g. Alibaba Cloud Coding Plan, Custom model provider/endpoint options) are available only in API Key mode.
- **Local Copy mode / Dashboard Login mode**: Local auth paths (e.g., host paths like `~/.qwen` or `~/.config/gcloud`) or Dashboard Login paths (`~/.code-ux/credentials/{providerConfigId}`) are rendered only when selected. Switching to local copy or dashboard-guided login automatically clears runtime API keys, custom base URLs, and custom models to prevent coexistence conflicts.
- **Mode-Incompatible Controls**: Any mode-incompatible inputs (such as Claude/Codex custom base URLs and custom models) that remain visible in local copy mode are clearly disabled to reflect the active configuration state.

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
- The Sprints page uses a data/action/view-model split: `useSprintsPageData` coordinates state, `useSprintsPageActions` manages side effects and API calls, `useSprintsPageModals` manages transient UI state, and deterministic derived state is extracted into pure view-model helpers (`sprints-page-view-models.ts`).
- A shared dashboard resource layer manages resource keys, caching, and invalidation, deduplicating fetches and avoiding UI flashing during background updates.
- Heavy stats ledger views use a progressive list strategy (`useProgressiveList`) with an intersection observer to render items in batches and prevent main-thread blocking. The sprint ledger keeps full sprint data in memory for accurate filtering, sorting, selection, and task totals, then limits visible rows through its `Show` selector.
- Backend read-model optimizations efficiently project data to support the resource layer while leaving API routes and backend contracts entirely unchanged.
- Extensionless dashboard routes like `/sprints` are served by the SPA app shell on direct load or refresh. This routing behavior remains consistent even when Code UX itself is running inside a preview container.

- A "Live Preview" CTA link appears in the Live view header when the relevant sprint has an active (`running`) preview session with a resolved primary `hostPort`. The main action opens the primary preview origin at the `lastKnownPath`; sessions with multiple configured port mappings add a compact adjacent port picker whose routed options open the selected `previewPort` URL and whose pending mappings remain visibly disabled with their routing reason.


## Interaction Patterns

The dashboard relies on consistent interaction primitives across all v2 views. The canonical contracts live in [Interaction Patterns](./interaction-patterns.md), with shared control requirements in [Shared Primitive Design System](./design-system-shared-primitives.md).

- **Surface Contracts**: Quicksprint, Sprint Ledger, Live runtime, Browser Preview, Settings, Global Search, Memory, task cards, and shared async feedback surfaces use the shared motion tokens and accessibility contracts documented in Interaction Patterns.
- **Data Views**: Ledgers, lists, rails, search results, task cards, memory lists, preview logs, and live feeds preserve useful stale content during refresh/reconnect states, announce sort/filter/selection/result changes politely, and show honest empty states for committed queries with no matches.
- **Async Feedback & Loading**: Pending operations use visible status copy, `aria-busy` on the affected control or region, duplicate activation suppression, and stable icon/text slots. Blocking errors remain assertive and persistent until dismissed, retried, or cleared.
- **Reduced Motion**: Components use `useInteractionTokens`, `useGsapInteractionTokens`, `INTERACTION_CSS_VARIABLES`, or `buildInteractionTransition` from `dashboard/src/v2/lib/motion`. The global CSS guard also honors the explicit dashboard setting on `html[data-reduced-motion]`. Reduced motion snaps movement but keeps static cues such as badges, rings, count chips, progress text, disabled reasons, and live-region messages.
- **Overlays & Modals**: Dialogs, side panels, search overlays, menus, and confirmations close via explicit controls, Escape, or outside click where appropriate; they trap focus while open and restore focus to the trigger or a safe fallback when closed.
- **Destructive Actions & Flows**: Confirmed destructive actions use the shared `useConfirmDialog`/`ConfirmDialog` pattern when confirmation is required. Immediate destructive modes must use persistent danger copy that explains confirmation will not be shown before activation.
- **Verification**: Documentation-only interaction updates should run `pnpm run typecheck:dashboard` and link checks with `rg` as described in [Interaction Patterns](./interaction-patterns.md#verification-guidance). UI behavior changes should run focused component tests, `pnpm run test:dashboard`, and `pnpm run typecheck:dashboard`.
- **Global Search Verification**: Search overlay changes should include `pnpm exec vitest run dashboard/src/v2/components/search/__tests__/SearchOverlay.accessibility.test.tsx tests/dashboard/v2/global-search.test.tsx` plus `pnpm run typecheck:dashboard`. These focused checks cover focus restoration, active-descendant keyboard movement, stale refresh announcements, committed-query empty states, disabled-row activation suppression, and reduced-motion static feedback.


## Accessibility Patterns

This dashboard enforces accessibility best practices to ensure an inclusive experience:

- **Audit Source**: Use the [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md) before and after changing shell navigation, shared primitives, forms, async states, data displays, Browser Preview/File Browser, Tasks, Settings, Live telemetry, or Stats.
- **Landmarks & Skip Links**: The dashboard shell provides exactly one `main` landmark with `id="main-content"`. A visually hidden skip link (which becomes visible on focus) allows keyboard and screen reader users to bypass the primary navigation and jump directly to the main content area. Nested components like `PageContainer` should use a `div` tag (`as="div"`) instead of `main` to prevent duplicate landmarks.
- **Route Regions**: `TopNav.tsx`, `SettingsPage.tsx`, `TasksPage.tsx`, `BrowserPage.tsx`, live telemetry components, and Stats components should not introduce anonymous command surfaces when a heading, `aria-label`, or `aria-labelledby` can name the region.
- **Dialogs & Modals**: Implemented using proper ARIA roles (`role="dialog"` or `role="alertdialog"`). They must have explicit accessible names via `ariaLabel`, `ariaLabelledBy`, or a visible title id; generic fallback names are not enough when the surface has a visible title. They manage focus by trapping it within the overlay, defaulting initial focus appropriately, and restoring it to the trigger upon closing. Exit animations use `pointer-events-none` to ensure hidden elements cannot be reached by Tab navigation while closing. If a dialog has no focusable elements, the container itself uses `tabIndex={-1}` and an outline-removal class for programmatic focus.
- **Menus, Selectors & Tabs**: Use explicit ARIA roles such as `menu`, `menuitem`, `listbox`, `option`, `tablist`, `tab`, and `tabpanel` according to the interaction. Top-nav project/sprint selectors, task sprint scope, Browser rails, file/change selectors, and Stats ledgers support arrows, `Home`, `End`, `Enter`, `Space`, and `Escape`; closing restores focus to the trigger. Header project and sprint selectors keep their option lists bounded and internally scrollable, and the header sprint list contains only real sprints.
- **Forms**: All inputs must have associated labels (`<label>` or `aria-label`/`aria-labelledby`). Shared form fields must be understandable and recoverable by connecting labels, helper text, errors, required indicators, inherited/overridden settings context, and validation state through accessible relationships (e.g., using `aria-describedby`, `aria-errormessage`, and `aria-invalid`). Form submissions must guard against duplicate events via `isSubmitting` checks. Upon validation failure, focus should be programmatically restored to the first invalid field and scrolled within the owning modal or panel body. Dependency lists or complex toggles should visually and semantically (`aria-disabled`) expose their unselectable states (e.g., cycle prevention) rather than silently hiding options.
- **Accessible Names**: Icon-only controls, preview controls, task actions, command actions, settings toggles, provider-instance actions, telemetry rows, compact mobile controls, and Stats mode buttons must have explicit names that include the target when repeated. Decorative icons stay `aria-hidden`.
- **Live Regions**: Non-visual state changes (like toast notifications or saving states) are announced using `aria-live="polite"` or `aria-live="assertive"`. Loading spinners use `aria-hidden="true"` with a visually hidden fallback, while their containers use `aria-busy="true"`.
- **Async State Communication**: Loading, empty, low-data, success, pending, reconnecting, stale-data, and background-refresh states use polite `role="status"` or live regions. Blocking errors, failed saves, disconnected runtime transport, and unavailable preview containers use `role="alert"` or assertive live behavior. Controls that initiate async work expose `aria-busy` or disabled/`aria-disabled`.
- **Header Runtime Readiness**: The Docker status control consumes `GET /api/onboarding/readiness`. When required Docker or Git checks make `cluster.status` `not_ready`, the header renders a red `Runtime not ready` alert badge with a static exclamation marker plus motion-safe animation, and the trigger accessible name includes that the runtime is not ready. The popover remains the keyboard-accessible dependency detail surface and does not add another assertive live region during hover refreshes.
- **Tables & Ledgers**: Complex data displays like the Sprint Ledger, Stats ledgers, system invocation tables, and shared `Table` displays use semantic HTML (`<table>`, `<th>`, `<td>`) or explicit ARIA grid roles to support screen reader cell navigation. They preserve captions or labels, `aria-sort` on active sortable columns, and mobile labels when rows collapse into cards.
- **Charts**: Data visualizations are wrapped in a region with `role="region"` and an `aria-label`, providing an accessible name for the visual content.
- **Stats & Analytics**: Analytics controls (like visual mode tabs and time windows) use semantic `role="group"` with `aria-pressed` states. Charts and sparklines include `sr-only` descriptive summaries of their data, allowing non-visual users to understand distributions and trends.
- **Custom Date Ranges**: Date range inputs include clear `aria-label` attributes and use `aria-live="polite"` regions to announce validation errors (like end date before start date).
- **Runtime Telemetry States**: Live timelines, Git/CI panels, invocation feeds, attention queues, notification surfaces, and overview telemetry use named `region`/`log` containers with `aria-live="polite"` for ongoing updates. Blocking connection or Git tracking failures use `role="alert"` with assertive live behavior, while non-blocking empty/success/pending states remain polite to avoid repeated announcements during refresh cycles.
- **Responsive & Warm Void**: Narrow viewports and text zoom must keep shell selectors, Settings forms, Browser rails, task cards, tables, live telemetry, and Stats panels readable without page-level horizontal overflow. Theme-specific signal utilities are reserved for focus, active, primary, and healthy/running states; Ember/status tones are reserved for warning, error, danger, and intervention.
- **Reduced Motion**: Component animations using GSAP and Tailwind respect user preferences via the `prefers-reduced-motion` media query and the explicit dashboard reduced-motion root attribute. Features like the Kinetic Dock immediately snap indicator positions without transition. Decorative background loops (e.g., CanvasBackground) and GSAP ticker updates (e.g., Sprint Boat Race) instantly skip interpolations, disable hover magnetism, remove visual ripples, and substitute animated motion with immediate static state reflections such as rings, halos, badges, values, and selected states to preserve functional state comprehension.
- **Feedback Surfaces**: Feedback surfaces (like `ToastProvider` and `ActionFeedbackRegion`) separate polite status announcements (success, warning, info) from assertive error announcements. Action buttons (Dismiss, Retry) use concise accessible names without repeating the entire dynamic message. When a focused feedback control removes itself, focus is predictably restored to a sensible fallback (e.g., `[role="main"]` or `body`). Live regions for notifications and status banners are kept in the DOM to ensure reliable screen reader announcements when their text changes.
- **Task Board State Ownership:** To prevent lane mapping drift across views, `dashboard/src/v2/lib/task-board-state.ts` is the strict single source of truth for all task status to lane derivations (via `getTaskLane`). It correctly groups transient implementation statuses like `coding_completed` and `QA_REVIEW_FAILED` into the "in_progress" lane for consistent Kanban rendering.
- **Task Card Affordances:** Task cards visually represent task states cleanly without expensive 3D transformations. Dependency indicators provide distinct visual styles and full screen-reader readouts for missing, blocked (`QA_REVIEW_FAILED`), running (`in_progress`, `coding_completed`), and completed dependencies. Quick actions reveal visually on hover or keyboard focus while remaining keyboard accessible. Drag actions utilize explicit `cursor-grab` interactions, omit pointer-only helper chips from visible metadata, preserve screen-reader guidance, and gracefully degrade in reduced motion or disabled states.

- **Form Validation & Submission**: When a form submission fails due to validation errors, focus should be automatically shifted to the first invalid field to assist users (especially screen readers). When submission fails due to network or logic errors, a retry action should be presented via `ActionFeedbackRegion`. Also, ensure duplicate form submissions are prevented by verifying the `isSubmitting` state before processing the submit event. Dependencies should explicitly indicate if they cannot be selected due to cycle-prevention logic, rather than silently filtering them out.

- The PageContainer and Sidebar components use dynamic viewport-safe sizing (`dvh`) and `env(safe-area-inset-bottom)` to be resilient to mobile browser chrome and orientation changes. Padding scales smoothly across breakpoints (`sm`, `md`, `lg`, `xl`) to maximize readable content width on all devices.
