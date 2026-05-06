# Stats

The **Stats** page (`/stats`) is the analytics surface for the active project. It aggregates execution telemetry into trends, success rates, and per-sprint breakdowns.

## Time windows

A selector at the top lets you pick:

- **Last 24 hours**
- **Last 7 days**
- **Last 30 days**
- **Custom range** — pick start and end dates explicitly.

All charts and counters update to the selected window.

## Headline metrics

The hero strip shows:

- **Sprints completed** in window.
- **Tasks completed** in window.
- **Success rate** — `completed / (completed + failed)`.
- **Average task duration** (median + p95).
- **Active providers** — which providers handled work in this window.

## Sprint stats deck

Below the hero, each sprint that ran in the window gets a card:

- Status pill, run count.
- Per-status counts (running / completed / failed / blocked).
- Median duration.
- Total task time vs wall-clock time (parallelism factor).

Click a card to open the sprint's run history.

## Charts

A series of stacked-area / line charts track:

- **Tasks per status over time** (stacked area).
- **Success rate over time** (line).
- **Provider distribution** (donut).
- **Activity volume** (line, MCP invocations per hour).

Charts respect the selected time window and update live as new data arrives.

## Underlying telemetry

The page is backed by:

- `GET /api/projects/:projectId/stats?window=...` — aggregated metrics.
- `GET /api/telemetry/overview` — homepage overview metrics.
- `GET /api/projects/:projectId/execution/invocations` — raw MCP invocation log (used by the Chat → Invocations tab).

For the data model, see [Architecture → data model](../../architecture/data-model.md).
