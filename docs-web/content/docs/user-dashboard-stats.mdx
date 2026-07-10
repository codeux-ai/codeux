# Stats

The **Stats** page (`/stats`) is the analytics surface for the active project. It shows project execution, usage, cost, Git, provider/model, ledger, and invocation telemetry in one flat Analysis Studio with responsive layouts and light/dark mode support.

Stats metric cards, chips, filters, tables, and ledger rows use flat warm void surfaces, hairline borders, compact typography, and quiet selected states. Shared containers avoid gradients, glass blur, heavy shadows, and hover lift. Data colors are reserved for telemetry meaning such as chart series, status, source confidence, and token/churn breakdowns.

The top command band keeps orientation in one place: selected project, generated snapshot time, sprint lens, time window, and analysis mode. A single mode-specific metric deck follows it, then the active workspace. During a background refresh, cached values stay visible with an updating or error message instead of disappearing.

On phones the command controls wrap into compact rows. Tablet layouts place project context beside the title, desktop layouts place time and mode controls side by side, and wide layouts add breathing room without changing the reading order.

The top dashboard header also shows a compact app-wide token-throughput summary alongside running and queued task counts near the runtime controls. It uses a rolling 20-second live activity window, updates once per second, and renders a 20-point stats-card-style sparkline that rises on increases, slopes down on decreases, stabilizes near the 90% band while throughput remains nonzero, and drops to baseline when throughput reaches zero. Use it for a live pulse check; use the Stats page for detailed analysis.

## Time windows

A selector at the top lets you pick the analysis window:

- **Last 1 hour**
- **Last 24 hours**
- **Last 7 days**
- **Last 30 days**
- **All time**
- **Custom range** — pick start and end dates explicitly.

Snapshot-backed charts, metric cards, Composition, Models, Providers, and Ledgers respect the selected timeframe. Recent windows include the freshest available bucket: **Last 1 hour** includes the current 5-minute bucket, and **Last 24 hours** includes the current partial hour. The **System** workbench is project-scoped and uses its own invocation-record filters and pagination; the top time selector does not filter those records.

## Analysis Modes

Navigation across the top of the workspace controls the primary analysis lens: **Trend**, **Composition**, **Models**, **Providers**, **Ledgers**, and **System**.

### Trend
A full-width interactive **Usage Graph** comes first and displays the series present in the project snapshot, such as token totals, active time, cost, source confidence, and Git activity.
- Toggle series in the grouped switch band below the graph or from the graph filter menu. Groups show active/total counts, and each switch shows its color, label, signal type, and current On/Off state.
- **Reset** restores the snapshot defaults. **Enable defaults** turns the default series back on without hiding other series you selected.
- At least one series stays enabled. If you try to turn off the last visible series, the switch remains on and the page explains why.
- Hover, focus, or select a bucket to inspect exact values. Drag-to-zoom changes the visible graph range; it does not change the selected Stats time window.
- The latest visible bucket remains readable before you hover or focus the graph. Pointer focus, keyboard focus, slider pinning, drag zoom, minimap selection, and reset all feed the same inspection area.
- The graph frame, filter flyout, focused-bucket panel, tooltip, minimap, and series switches use neutral Stats surfaces; series colors remain reserved for chart lines and data markers.
- Hourly views reduce visible axis labels while preserving individual bucket inspection.

### Composition
Use Composition to answer where usage came from. Two donut panels show **Provider Share** and **Token Anatomy**; the sections below explain source confidence, cache efficiency, Git context, purpose activity, and provider activity in wrapping-safe rows.

Donuts and token bars keep data colors inside the visualization and repeat the meaning in text, so color is never the only cue. When a segment, provider, purpose, pricing signal, or Git activity is missing, the page says what is unavailable instead of drawing a zero-valued result as evidence.

### Models
Use Models to compare model volume and efficiency. The overview pairs model share with window highlights; the token-ranked rows show provider identity, invocations, available latency and outcome signals, cache and reasoning share, output velocity, pricing, and token flow. Sparse samples and missing duration or outcome telemetry remain labeled as low data.

### Providers
Use Providers to review operational reliability. This user-facing label opens the internal reliability mode, which orders provider rows by risk and then token volume. Review source confidence and fallback usage first, then provider coverage, failures, duration coverage, available latency and pricing signals, and audit notes. Missing outcome or source telemetry keeps low risk neutral rather than implying proven health.

### Ledgers
Provides tabbed telemetry tables for **Task Telemetry**, **Sprint Telemetry**, and **Git Telemetry**.
- Use the real tabs to switch workbenches, then search, sort, and progressively reveal dense task, sprint, or Git rows without losing the current selection.
- Task and sprint workbenches can sort by recency, tokens, time, input/output volume, or name and announce the current result and order.
- Task and sprint rows include status, provider, purpose, recency, visible share, leader share, token-flow anatomy, and optional duration percentile chips.
- Git rows keep churn separate from token flow with insertion/deletion bars plus pull request, merge, file, conflict, visible-share, and leader-share context.

### System
Use System to inspect administrative invocation telemetry without leaving Stats:

1. Scan **Sprint State**, **Health Snapshot**, classified external API activity, and error categories.
2. Choose **All**, **Errors**, or **System Msgs**, then narrow records by search, status, purpose, provider, or error category.
3. Sort or page through the invocation ledger and expand a record to inspect its transcript.
4. If transcript loading fails, use **Retry transcript** in that expanded record; the parent invocation row stays available.

System tables keep sortable header state for assistive technology and retain visible field labels when rows collapse on smaller screens. Empty summaries mean that no matching or classified records are present in the current data set; they do not prove that an integration never ran or that telemetry succeeded.

## Cost Metrics and Pricing

Cost data is visualized directly within the Usage Graph and Composition views, fueled by provider configurations.
- You can set `Token pricing` (input / output) on a per-provider-instance basis in **Settings -> Integrations**.
- The Stats page applies these settings retroactively to the raw token telemetry for the selected window.
- **Zero-price / No-pricing behavior:** If a provider has no pricing configured, or if the price is set to `$0.00`, invocations for that provider are tracked and visualized in token counts but will contribute $0.00 to aggregate cost series and cost-focused widgets.

## Underlying telemetry

The page remains live and uses project realtime invalidation channels to stay current during active sprint execution, falling back to background polling when websocket updates aren't available.

It is backed by:
- `GET /api/stats/header-throughput?projectId=...&window=...` — compact app and optional selected-project token throughput read model; the top dashboard header displays the app-wide value.
- `GET /api/projects/:projectId/stats?window=...` — aggregated metrics for charts and summaries.
- `GET /api/projects/:projectId/execution/invocations` — server-filtered, sorted, and paginated invocation records used by System, with transcript detail loaded per expanded record.

Telemetry source labels are evidence labels, not interchangeable numbers: **reported** comes from the provider, **estimated** is derived, **unavailable** means no usable counts could be obtained, and **unsupported** means the provider does not supply token telemetry. A displayed `0` is a measured or computed zero; an em dash or explicit no-data message means the value is missing or cannot be derived.
