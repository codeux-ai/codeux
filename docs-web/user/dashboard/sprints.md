# Sprints

The **Sprints** page (`/sprints`) is where you plan, manage, and launch sprint runs.

## The sprint gallery and ledger

Sprints are viewed either in a visual organic cell gallery or a dense ledger format. Each sprint cell/row shows:

- **Status pill** — `idle`, `running`, `paused`, `completed`, `failed`, `cancelled`.
- **Task counters** — completed / total, plus failures.
- **Goal** — first line of the sprint goal.
- **Action buttons** — Plan / Orchestrate / Pause / Cancel as appropriate, with inactive pause guidance kept out of the visible row to preserve ledger density.

Completion keeps one decimal when needed across sprint cards, ledger rows, active task streams, and sprint selectors: `7.5%` stays `7.5%`, while whole values such as `5.0%` display as `5%`. Progress bars and accessible values use the same completion number and remain bounded from `0%` to `100%`.

Sprints can be **showcase-pinned** to surface them on the Overview page; toggle this from the cell menu or bulk actions.

Each sprint row and showcase card has separate **Tasks** and **Live** actions. These are in-app router links carrying both `projectId` and `sprintId`, so opening a sprint switches the dashboard to that sprint's project before loading the task board or live view without reloading the dashboard shell.

## How sprint progress is calculated

The progress percentage is a weighted view of every task's lifecycle, not the completed-task counter:

- A task begins at 0% and can advance through the first 50% while coding is active. Code UX uses coding `provider_invocations.tool_call_count` telemetry for this band: each tool call adds 0.5 percentage points, up to a 100-call cap. Calls after the first 100 do not increase the coding contribution beyond 50%.
- After coding, a task contributes 75% while CI, QA, merge, or another post-coding gate is still settling.
- A task contributes 100% only after final settlement.

The sprint percentage is the average of its task contributions, rounded to one decimal percentage point. The completed / total task counter remains a separate raw count, so it does not need to match the weighted percentage. When CI is disabled, a task jumps directly from its final coding contribution to 100% at completion; it does not pause at the 75% CI/post-coding stage.

Sprint summaries refresh on both project-structure changes and execution-telemetry updates. This means progress can move as coding tool-call telemetry arrives during an active provider run, before the task changes lifecycle stage.

## Creating a sprint

You can create a sprint from the Sprints page or directly from the top-bar sprint selector.

From the top bar, open the sprint selector and click **Add Sprint**. This compact flow asks only for a name and goal, creates an idle sprint, refreshes the sprint collection, and selects the new sprint. The selector stays enabled even when the project has no sprints so this action remains available for first-sprint creation. Click **Manage Sprints** in the same selector to open the full Sprints page.

From the Sprints page:

1. Click **+ New sprint**.
2. Enter:
   - **Name** (required)
   - **Goal** (recommended — used by the AI planner as context)
   - **Feature branch override** (optional — auto-derived from the prefix otherwise)
   - **Start / end dates** (optional — informational, used by Stats)
3. Save. The sprint appears on the board with status `idle`.

## AI sprint planning

Open a sprint and click **AI plan**. You provide:

- **Sprint prompt** — A description of what you want done. The planner accepts long, prose-style input.
- **Improvement option** *(optional)* — Click **Improve** to have the planner rewrite your prompt for clarity before planning.

Click **Plan sprint**. The planner agent (typically a Gemini, Codex or Claude session — see [Provider routing](../providers-and-models.md)) returns a tree of subtasks with:

- A title and prompt for each.
- Inferred `depends_on` edges.
- A best-effort `is_independent` flag.

While planning is in flight, the dashboard shows a shared planning overlay for normal sprints and quicksprints. It includes ETA and elapsed timers, request-specific status copy, a vessel that travels across the course and respawns smoothly, and minimize, cancel, and new sprint/quicksprint recovery actions when they are available. The ETA is a visual planning estimate; it does not change how the backend planner runs.

The vessel can also be activated as a small coffee reminder. Planning continues normally, and the minimize, new sprint/quicksprint, and cancellation controls remain available.

You can:

- **Edit** each subtask inline.
- **Reorder / delete / add** subtasks.
- **Re-plan** with a different prompt.
- **Cancel** an in-flight planning request via the cancel button (this aborts the underlying provider session).

The plan is persisted as markdown files at `<repo>/.code-ux/sprints/sprint-<n>/<task-id>.md`. See [Sprint format](../../developer/sprint-format.md).

## Chat-created app sprints

The Chat page can create app-building sprints through **Create Web App** and **Create Desktop App** quickactions. Those quickactions start a detached `Plan & Start` quicksprint from the selected project and show planning progress in the chat transcript while the sprint appears here like any other sprint.

If you send more direction in the same chat thread while planning is still running, Code UX applies that text to the sprint goal under `Additional direction from chat` after planning finishes. Once the sprint already has tasks, new chat follow-ups are appended to the sprint goal immediately. The generated task prompts are left unchanged, so use the sprint goal as the record of later direction and re-plan only when you want subtasks regenerated.

## The sprint DAG view

Sprints with multiple subtasks display a **DAG** (directed acyclic graph) of dependencies. This view is lazy-loaded and is the fastest way to validate that you have correct parallelism. Independent tasks float free; chained tasks render with explicit edges.

There is also an animated **Boat Race** visualisation that shows tasks as boats progressing along a track — fun and surprisingly informative when many tasks run in parallel.

## Running a sprint

Click **Orchestrate**. Code UX:

1. Creates a new **sprint run** record (a unique execution attempt).
2. Acquires a heartbeat lease so other instances cannot also pick up this run.
3. Hands control to the [watch loop](../sprint-orchestration.md#watch-loop) which begins cycling.
4. Switches the dashboard view to **Live Session**.

You can run any sprint multiple times. Each run has its own ID and its own row in stats and telemetry.

## Pausing & cancelling

- **Pause** — The sprint enters `paused`. The watch loop exits cleanly at the next checkpoint. Active worker sessions are *not* killed; you can resume later.
- **Cancel** — The sprint enters `cancel_requested` and is cancelled gracefully. Active dispatches are signalled to stop.
- **Force cancel** — Skips graceful steps. Use only if a normal cancel hangs.

Pausing / cancelling are also exposed as MCP actions via the `manage_sprints` tool (actions `pause`, `cancel`, `force_cancel`).

## Importing & exporting sprints

Sprints support importing issues directly from external providers, as well as being portable as Markdown bundles:

- **Issue Import** — Click **+ → Import** and choose **GitHub Issues**, **GitLab Issues**, or **Jira Issues**. You can search by text, labels, status, assignees, or exact issue keys (e.g., `#42` or `OPS-42`). Jira status filters use the active Jira project's workflow labels and include `All statuses`; if those labels cannot be loaded, the modal falls back to the broader category filters. Imported issues are attached as linked contexts, with Jira cards showing concise previews while the imported prompt context keeps the full Jira description. Linked issue records preserve imported body text, selected conversation context, author, timestamps, and non-secret metadata across sprint reloads and updates. Sprint updates that carry linked-issue metadata without body or conversation text preserve the existing linked-issue prompt text. Jira issues can optionally be converted directly into security or quality tasks. Code UX attempts to auto-transition or auto-close linked issues when the sprint completes.
- **Export** — Click **⋯ → Export markdown**. You receive a downloadable bundle: one file per subtask plus a `sprint.md` describing the sprint.
- **Import Bundle** — Click **+ → Import**. Drop a previously exported bundle (or a hand-written one). Code UX validates and creates the sprint.

Importing bundles is the recommended way to template sprints across projects when [Quicksprints](../quicksprints.md) are not flexible enough.

## Sprint settings overrides

Each sprint can override project settings, which in turn override system settings. Open the **⚙ Sprint settings** panel from the sprint detail view to edit. Common overrides:

- Different `featurePrAutoMergeMode` for risky sprints.
- Different provider model for `task_coding` (e.g. force GPT-5 Codex for performance-critical work).
- Different `automationLevel` (set to `ALWAYS_ASK` for sensitive sprints).

Effective settings are inspectable at `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`.

## Sprint deletion and bulk actions

The Sprints ledger supports multi-select for bulk starting, pinning, or deleting sprints.

Sorting, filtering, search, list-window changes, row selection, and bulk actions announce concise result-count updates without moving focus back through the table. Sortable headers expose their current direction, rows show selected/pending/deleting/bulk-disabled states directly, and pending bulk buttons switch to static progress labels such as **Starting** or **Deleting** for reduced-motion users.

Deleting a sprint (single or bulk) requires explicit confirmation in a destructive dialog and removes its database state but leaves the on-disk markdown directory intact (so you can re-import later if you change your mind).
