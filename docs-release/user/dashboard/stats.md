# Stats

The **Stats** page (`/stats`) is the analytics surface for the active project. It leverages the high-interaction **Analysis Studio UX** with a unified glass-panel system, providing detailed insights into project execution, performance, cost, and system-level metrics. It fully supports visual-mode navigation, responsive behavior across screen sizes, and seamless light/dark mode transitions.

## Time windows

A selector at the top lets you pick the analysis window:

- **Last 24 hours**
- **Last 7 days**
- **Last 30 days**
- **All time**
- **Custom range** — drag-to-zoom directly on the Usage Graph or pick start and end dates explicitly.

All charts, ledgers, and metrics respect the selected timeframe.

## Analysis Modes

Navigation across the top of the workspace controls the primary analysis lens:

### Trend
A full-width interactive **Usage Graph** displays usage over time for Tokens, Time, Cost, and Git activity.
- You can toggle specific series (e.g. prompt tokens vs completion tokens, additions vs deletions) via the right-side metrics rail.
- It includes hover bucket inspection for precise datapoints.
- Hourly views reduce visible axis labels to a three-hour rhythm while preserving single-hour hover targets.

### Composition
Visualizes structural breakdowns using interactive donut charts that slice by:
- Token anatomy
- Provider distribution
- Telemetry source mix
Charts feature hover emphasis, center-detail readouts, and are layered above cache efficiency and token-flight timing data, keeping the overall provider picture readable without tab switching.

### Models
Tracks specific model performance, invocation volume, and token throughput for each model used during the active timeframe.

### Providers / Reliability
Focuses on error rates, retry counts, latency percentiles, and overall success rates across your connected providers.

### Ledgers
Provides tabbed telemetry tables containing raw Task and Sprint data.
- Supports searching and sorting by recency, tokens, time, input/output volume, or name.
- Richer token and time breakdowns compared to standard views.

### System
Exposes deeper debugging and internal telemetry info:
- Internal cache hit rates.
- Pub/Sub connection stability and message volume.
- Background worker execution loops and active queue lengths.
- System error distribution and unhandled exception traces.

## Cost Metrics and Pricing

Cost data is visualized directly within the Usage Graph and Composition views, fueled by provider configurations.
- You can set `Token pricing` (input / output) on a per-provider-instance basis in **Settings -> Integrations**.
- The Stats page applies these settings retroactively to the raw token telemetry for the selected window.
- **Zero-price / No-pricing behavior:** If a provider has no pricing configured, or if the price is set to `$0.00`, invocations for that provider are tracked and visualized in token counts but will contribute $0.00 to aggregate cost series and cost-focused widgets.

## Underlying telemetry

The page remains live and uses project realtime invalidation channels to stay current during active sprint execution, falling back to background polling when websocket updates aren't available.

It is backed by:
- `GET /api/projects/:projectId/stats?window=...` — aggregated metrics for charts and summaries.
- `GET /api/projects/:projectId/execution/invocations` — raw MCP invocation log.
