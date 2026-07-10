# Stats

The **Stats** page (`/stats`) is the analytics surface for the active project. It shows project execution, usage, cost, Git, provider/model, ledger, and invocation telemetry in one flat Analysis Studio with responsive layouts and light/dark mode support.

Stats metric cards, chips, filters, tables, and ledger rows use flat warm void surfaces, hairline borders, compact typography, and quiet selected states. Shared containers avoid gradients, glass blur, heavy shadows, and hover lift. Data colors are reserved for telemetry meaning such as chart series, status, source confidence, and token/churn breakdowns.

The top command band shows the selected project, generated snapshot time, sprint lens, time-window controls, and analysis mode controls before the mode-specific metric deck and workspace.

The top dashboard header also shows a compact app-wide token-throughput summary alongside running and queued task counts near the runtime controls. It uses a rolling 20-second live activity window, updates once per second, and renders a 20-point stats-card-style sparkline that rises on increases, slopes down on decreases, stabilizes near the 90% band while throughput remains nonzero, and drops to baseline when throughput reaches zero. Use it for a live pulse check; use the Stats page for detailed analysis.

## Time windows

A selector at the top lets you pick the analysis window:

- **Last 1 hour**
- **Last 24 hours**
- **Last 7 days**
- **Last 30 days**
- **All time**
- **Custom range** — pick start and end dates explicitly.

All charts, ledgers, and metrics respect the selected timeframe. Recent windows include the freshest available bucket: **Last 1 hour** includes the current 5-minute bucket, and **Last 24 hours** includes the current partial hour.

## Analysis Modes

Navigation across the top of the workspace controls the primary analysis lens: **Trend**, **Composition**, **Models**, **Providers**, **Ledgers**, and **System**.

### Trend
A full-width interactive **Usage Graph** displays usage over time for the series included in the project stats snapshot, such as token totals, active time, cost, telemetry source confidence, and Git activity when those series are present.
- Toggle series in the grouped switch band below the graph or from the graph filter menu. Groups show active/total counts, and each switch shows its color, label, signal type, and current On/Off state.
- **Reset** restores the snapshot defaults. **Enable defaults** turns the default series back on without hiding other series you selected.
- At least one series stays enabled. If you try to turn off the last visible series, the switch remains on and the page explains why.
- Hover, focus, or select a bucket to inspect exact values. Drag-to-zoom changes the visible graph range; it does not change the selected Stats time window.
- The latest visible bucket remains readable before you hover or focus the graph. Pointer focus, keyboard focus, slider pinning, drag zoom, minimap selection, and reset all feed the same inspection area.
- The graph frame, filter flyout, focused-bucket panel, tooltip, minimap, and series switches use neutral Stats surfaces; series colors remain reserved for chart lines and data markers.
- Hourly views reduce visible axis labels while preserving individual bucket inspection.

### Composition
Explains where usage comes from with provider share, token anatomy, cache behavior, source quality, purpose lanes, Git-blocker context, and low-data fallbacks.

Interactive donut charts slice by:
- Token anatomy
- Provider distribution
- Telemetry source mix

Charts keep data accent colors inside segments and token bars while compact badges remain neutral.

### Models
Ranks model activity by token volume and tracks invocation volume, latency, reliability, cache efficiency, reasoning share, pricing signals, output velocity, and low-data states for each model used during the active timeframe.

### Providers
Focuses on provider reliability, telemetry confidence, fallback usage, failure pressure, provider coverage, duration coverage, latency signals, pricing, provider-specific risk, and audit notes when the selected snapshot includes those fields.

### Ledgers
Provides tabbed telemetry tables for **Task Telemetry**, **Sprint Telemetry**, and **Git Telemetry**.
- Supports searching and sorting by recency, tokens, time, input/output volume, or name.
- Richer token and time breakdowns compared to standard views.
- Task and sprint rows include status, provider, purpose, recency, visible share, leader share, token-flow anatomy, and optional duration percentile chips.
- Git rows keep churn separate from token flow with insertion/deletion bars plus pull request, merge, file, conflict, visible-share, and leader-share context.

### System
Exposes administrative invocation telemetry without leaving Stats:
- Sprint state and health snapshot summaries.
- Classified external API activity.
- Error categories for recorded invocation failures.
- Search, status, purpose, provider, error-category, record-view, sort, and pagination controls.
- Filtered invocation records with expandable transcript details, sortable headers, loading states, and transcript recovery states.

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
- `GET /api/projects/:projectId/execution/invocations` — raw MCP invocation log.
