# Dashboard Design System: Stats & Analytics

## Purpose

The `/stats` page is Code UX's project-scoped analytics workspace. It turns `ProjectExecutionStatsSnapshot` data, Git rollups, and invocation records into a dense operational surface for usage trends, composition, model performance, provider reliability, task and sprint ledgers, Git telemetry, and system invocation inspection.

Stats should feel aligned with the broader dashboard design system, but it is intentionally denser than the chat and overview surfaces. Chat remains a conversation workspace, Overview remains a cross-project operations summary, and Stats is the place for repeated measurement, comparison, filtering, and audit-style review. For adjacent visual language, see [Chat Design System](./design-system-chat.md), [Dashboard Design System Overview](./design-system-overview.md), and [Usage Telemetry And Stats](../architecture/usage-telemetry-and-stats.md).

## Data Contract

Stats presentation must stay within the implemented snapshot and invocation contracts:

- `GET /api/projects/:projectId/stats?window=1h|24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD` returns the project snapshot.
- The snapshot includes project identity, active sprint metadata, query and normalized range metadata, generated time, usage totals, status counts, adaptive buckets, chart series, task/sprint/provider/purpose/model summaries, Git totals and buckets, and optional merge-conflict count.
- Usage totals include invocation count, active and wall time, input/cached/output/reasoning/total tokens, cost fields, optional tool-call count, and usage-source counters for `reported`, `estimated`, `unavailable`, and `unsupported`.
- System mode uses `useSystemViewData(projectId)` and invocation APIs for records, server-projected filters, sort state, pagination, summaries, and transcript expansion.

Do not document or render speculative metrics. Missing telemetry is a first-class state and must remain visibly different from a meaningful zero.

## Page Structure

The redesigned Stats page uses a stable top-to-bottom shell:

1. Header command band
   - The hero names the Stats workspace, selected project, sprint lens, generated time, freshness, telemetry source quality, range resolution, time window, and active visual mode.
   - Time presets are `1h`, `24h`, `7d`, `30d`, `All time`, and `Custom`.
   - Choosing `Custom` opens start and end date fields. The selected range changes only after `Apply` succeeds.
   - Invalid or incomplete custom ranges keep focusable controls visible, set `aria-invalid`, connect `aria-errormessage`, and announce inline error text.
2. Mode navigation
   - The mode rail is a wrapped segmented control with icon-first buttons and stable accessible labels: `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, and `System`.
   - The visible `Providers` label maps to the internal reliability mode. Keep user-facing copy and tests aligned if this mapping changes.
   - The rail uses `role="group"` and `aria-pressed`; it is not a tablist because mode changes replace the whole analysis workspace.
3. KPI runway
   - The hero KPI runway summarizes tokens, active time, invocations, success rate, models/providers, and selected range.
   - Mode-specific top cards follow the workspace context strip. They use `StatsCard` and should put the most actionable metric first for the selected mode.
   - Cards expose title, value, and string description as the analytics article name. Long values must wrap inside stable card slots.
4. Workspace context strip
   - The context strip repeats only the orientation facts needed while scrolling: active mode, selected window, freshness, range resolution, and sprint scope.
   - It remains present for selected-project, loading, error, empty, and low-data paths.
5. Analysis studio
   - Every mode starts with the shared studio header pattern: icon, eyebrow, title, short description, and `Ready`/`Refreshing`/`Waiting` status.
   - Studio bodies may differ substantially, but they should share the same page-scoped panel, chip, input, ledger row, focus, and motion tokens.
6. Feedback states
   - No-project, first-load loading, first-load error, empty, refresh, and reduced-data states preserve the shell rhythm.
   - Loading states use polite status semantics. Error states use alert semantics and expose retry when recovery is available.

## Visual Modes

Mode-specific implementations live under `dashboard/src/v2/pages/stats/components/`. Keep reusable primitives in `stats-ui-primitives.tsx` and the `StatsShared.tsx` compatibility barrel; add mode-specific behavior in the relevant studio file.

### Trend

Trend is the chart-first workspace for time-series telemetry.

- Lead with throughput, runtime, cost, invocations, cache rate, and token velocity.
- Keep chart state centralized through `use-usage-chart-state.ts`; chart filters change series visibility, not the selected time window.
- The chart header keeps filter access and zoom reset visible near the graph title. The toolbar summarizes selected range, bucket count, resolution, and active zoom.
- Series controls use `role="switch"` and `aria-checked`; at least one series remains enabled.
- Hover, keyboard focus, minimap selection, drag zoom, and active bucket controls all update the same focused-bucket summary.
- The visible SVG, readable chart summary, and screen-reader-only table must agree on peak tokens, peak active time, average tokens, invocation peak, active series, and zoom range.

### Composition

Composition explains where usage comes from.

- Lead with provider share, token mix, cache rate, output/reasoning proportions, source mix, purpose lanes, and available Git-blocker context.
- Token anatomy can show input, cached input, output, reasoning, cache-hit rate, output ratio, and total cost when `totalCostUsd` is greater than zero.
- Provider and purpose donuts rank visible segments, handle long labels with wrapping, and render explicit empty states when segment data is absent.
- Purpose lanes show invocation count, active time, token share, and dominant purpose without creating a second conflicting purpose summary.
- Source-confidence cards distinguish reported, estimated, unavailable, unsupported, and defensive unknown buckets without inventing alternate totals.
- Donuts, ribbons, and flow bars need nearby text or `role="img"` labels so color is never the only signal.

### Models

Models compares model activity, latency, reliability, and efficiency.

- The overview balances model-share distribution, efficiency highlights, total window volume, and low-data states.
- The leaderboard ranks by `usage.totalTokens` descending with label tie-breaks.
- Rows surface success tone, p50/p95 latency, tokens per call, output velocity, cache-hit rate, reasoning share, provider identity, and token-flow anatomy when those fields are present.
- Missing model arrays, zero model usage, zero duration samples, and low invocation counts render as explicit low-data states.
- Long model and provider names must wrap within stable cards and rows; chips and metrics cannot force horizontal page overflow.

### Providers

Providers is the reliability studio.

- The visible mode label is `Providers`; the studio title may describe reliability.
- Start with confidence, fallback usage, failure pressure, and provider coverage before detailed rows.
- Source mix explicitly shows reported, estimated, unavailable, unsupported, and unknown invocation-source counts. Estimated data is usable but lower precision.
- Provider cards sort by computed risk first and token volume second, then show failure count, success-rate tone, token volume, active time, duration coverage, and source confidence.
- Provider status and latency details may be derived from matching model summaries, but health must not be fabricated when model/status telemetry is absent.
- Empty provider or source segments use shared Stats panels and explain what data is missing.

### Ledgers

Ledgers contains operational records for tasks, sprints, and Git.

- Task Telemetry, Sprint Telemetry, and Git Telemetry are real tabs with accessible tab semantics, stable labels, and count badges.
- Task and sprint rows expose status, provider, purpose, calls, active time, cost, recency, visible-total share, leader share, token-flow anatomy, and p50/p95 chips when percentile fields are present.
- Git rows keep churn separate from token flow. Use `ChurnFlowBar` for insertions and deletions, and keep pull requests, merges, files, conflicts, visible share, and leader share readable.
- Search, sort, and progressive rendering preserve the `useProgressiveList` flow: visible items, scroll container, and sentinel stay wired together.
- Sort controls use buttons with `aria-pressed` when they represent local ordering choices.

### System

System is the invocation workbench.

- `useSystemViewData(projectId)` owns filters, sorting, summaries, pagination, request cancellation, and the legacy array fallback used by older tests.
- Summary sections are Sprint State, Invocation Health, External API Activity, and Error Categories.
- The record view control is a wrapped button group for `All`, `Errors`, and `System Msgs`.
- `SystemFilterBar` groups search, status, purpose, provider, error-category, clear-all, active-filter count, result count, and pagination controls into responsive panels.
- Invocation tables preserve semantic headers with `scope="col"` and per-cell header relationships while allowing mobile rows to expose dense labels.
- Expand controls name the target invocation, point at the transcript panel, and remain keyboard-accessible.
- Transcript detail surfaces role, created time, token totals, optional message metadata, errors, and long content with safe wrapping.

## Telemetry Semantics

Stats copy and visuals should teach operators how trustworthy a number is without overstating precision:

- `reported` means the provider supplied authoritative usage.
- `estimated` means Code UX derived usage from prompt/transcript text or provider-adjacent artifacts.
- `unavailable` means the provider ran but no usable counts could be derived.
- `unsupported` means the provider intentionally does not participate in token telemetry.
- `unknown` may appear only as a defensive frontend bucket when known source counters do not account for all invocations in the current snapshot.

Cost values come from snapshot cost fields and should only be presented when configured data makes them meaningful. Do not imply a free run from a zero cost when pricing may be unavailable.

## Primitives And Styling

Use page-scoped Stats primitives instead of one-off analytics chrome:

- `stats-theme.css` defines Stats-specific aliases for panel surfaces, subpanels, chips, inputs, focus rings, status fills, borders, shadows, and motion.
- `PANEL_CLASS`, `SUBPANEL_CLASS`, `CHIP_CLASS`, `INPUT_CLASS`, `LEDGER_ROW_CLASS`, and `LEDGER_ROW_MODERN_CLASS` provide the shell vocabulary.
- `StatsCard`, `StudioHeader`, `SignalMetricCard`, `DonutCard`, `PurposeRibbon`, `TokenChip`, `TokenFlowBar`, `ChurnFlowBar`, `SortButton`, `ViewToggle`, and `SeriesLegendButton` cover repeated Stats patterns.
- Typed view-model helpers should own reusable derivations for trend, chart, model, provider, and ledger projections. Avoid recalculating meaningful bucket or efficiency summaries directly in JSX.

Dense analytics layouts should stay calm: restrained contrast, low-opacity fills, semantic color, stable grids, and short labels. Avoid nested decorative cards; repeated cards, ledger rows, modals, and tool panels may be framed, while page sections should read as workspaces.

## Responsive Behavior

- The hero uses a two-zone command band on wide screens and stacks project context, time controls, mode navigation, and KPI runway on narrow screens.
- Fixed or sticky header-adjacent navigation must wrap before it clips. Use `min-w-0`, bounded grids, and component-local overflow only when wrapping can no longer preserve button labels.
- Metric decks collapse from desktop multi-column grids to two-column and single-column layouts without changing order.
- Trend places focused-bucket and series context below the chart on narrow screens.
- Ledgers and system rows include mobile labels when the header row is visually unavailable.
- Tables, chart summaries, filter bars, date validation messages, pagination, and transcript panels must not create page-level horizontal scrolling.
- Touch targets and keyboard focus order remain usable at phone widths.

See [Mobile Responsiveness](./mobile-responsiveness.md) for dashboard-wide constraints.

## Accessibility

- The page root is a named statistics region and marks itself busy during first-load telemetry.
- Mode navigation, time presets, filter chips, sort buttons, and invocation view controls expose selected state through ARIA attributes.
- Ledger navigation uses actual tab semantics. Keyboard focus should move from the active tab into the tabpanel controls and rows in DOM order.
- Charts expose a region name, readable summary, keyboard-reachable bucket targets, and a screen-reader-only table for exact values.
- Chart refresh indicators use semantic status text in addition to animation.
- Microvisuals such as sparklines, donuts, ribbons, token flow bars, churn bars, and status bars either expose a concise `role="img"` label or are paired with nearby text that communicates the same data.
- Date inputs have visible labels, programmatic labels, validation state, and inline alert text for invalid custom ranges.
- Focus rings use `--stats-focus-ring` or shared dashboard focus tokens and remain visible in light and dark themes.
- Repeated visible labels are acceptable when they reflect real UI structure. Tests should disambiguate by role, group name, region, or scoped queries.

## Motion

Motion is for orientation only: shell entrance, mode transitions, chart updates, hover feedback, and tab changes should be subtle. Respect `prefers-reduced-motion` by disabling nonessential GSAP, Tailwind entrance, chart, and tab animation. Never rely on motion to reveal validation errors, filter state, table content, or chart values.

## Verification Guidance

For documentation-only Stats changes, run dashboard typecheck when requested by the task and manually verify markdown links:

```bash
pnpm run typecheck:dashboard
rg -n "design-system-stats|dashboard-guide|mobile-responsiveness|usage-telemetry-and-stats" docs/index.md docs/SUMMARY.md docs/dashboard/*.md docs/architecture/usage-telemetry-and-stats.md
```

For Stats UI changes, run focused tests first. `pnpm run test:dashboard` covers `tests/dashboard`; source-adjacent Stats tests under `dashboard/src/v2/pages/stats/__tests__/` should be run directly when those components change:

```bash
pnpm exec vitest run dashboard/src/v2/pages/stats/__tests__ dashboard/tests/dashboard/stats
pnpm run test:dashboard
pnpm run typecheck:dashboard
```

Run `pnpm run build` when changes touch shared contracts, routing, CSS token boundaries, dashboard imports, or production bundling behavior. Do not record a check as passed unless it was run for the current change.
