# Sprints

The **Sprints** page (`/sprints`) is where you plan, manage, and launch sprint runs.

## The sprint board

Each sprint is rendered as a *bubble* showing:

- **Status pill** — `idle`, `running`, `paused`, `completed`, `failed`, `cancelled`.
- **Task counters** — completed / total, plus failures.
- **Goal** — first line of the sprint goal.
- **Action buttons** — Plan / Orchestrate / Pause / Cancel as appropriate.

Sprints can be **showcase-pinned** to surface them on the Overview page; toggle this from the bubble menu.

## Creating a sprint

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

You can:

- **Edit** each subtask inline.
- **Reorder / delete / add** subtasks.
- **Re-plan** with a different prompt.
- **Cancel** an in-flight planning request via the cancel button (this aborts the underlying provider session).

The plan is persisted as markdown files at `<repo>/.code-ux/sprints/sprint-<n>/<task-id>.md`. See [Sprint format](../../developer/sprint-format.md).

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

Pausing / cancelling are also exposed as MCP actions (`manage_code_ux` → domain `sprints` → actions `pause`, `cancel`, `force_cancel`).

## Importing & exporting sprints

Sprints are portable as Markdown bundles:

- **Export** — Click **⋯ → Export markdown**. You receive a downloadable bundle: one file per subtask plus a `sprint.md` describing the sprint.
- **Import** — Click **+ → Import**. Drop a previously exported bundle (or a hand-written one). Code UX validates and creates the sprint.

Importing is the recommended way to template sprints across projects when [Quicksprints](../quicksprints.md) are not flexible enough.

## Sprint settings overrides

Each sprint can override project settings, which in turn override system settings. Open the **⚙ Sprint settings** panel from the sprint detail view to edit. Common overrides:

- Different `featurePrAutoMergeMode` for risky sprints.
- Different provider model for `task_coding` (e.g. force GPT-5 Codex for performance-critical work).
- Different `automationLevel` (set to `ALWAYS_ASK` for sensitive sprints).

Effective settings are inspectable at `GET /api/projects/:projectId/sprints/:sprintId/settings/effective`.

## Sprint deletion

Deleting a sprint requires explicit confirmation and removes its database state but leaves the on-disk markdown directory intact (so you can re-import later if you change your mind).
