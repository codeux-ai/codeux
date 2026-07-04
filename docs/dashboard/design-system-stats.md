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
   - The hero names the Stats workspace with a Stats-native command masthead rather than the generic dashboard page header. It uses solid Warm Void panel, subpanel, chip, and input primitives, a compact current-state pill, and active lens chips for the selected time window and mode.
   - The command controls are flat administrative rows inside the subpanel surface. Avoid nested framed glass panels, decorative gradients, or extra wrappers around the preset, custom range, and mode controls.
   - Keep only selected project, sprint lens, time window, and active visual mode controls visible in the command band.
   - Time presets are `1h`, `24h`, `7d`, `30d`, `All time`, and `Custom`.
   - Choosing `Custom` opens start and end date fields. The selected range changes only after `Apply` succeeds.
   - Invalid or incomplete custom ranges keep focusable controls visible, set `aria-invalid`, connect `aria-errormessage`, and announce inline error text.
2. Mode navigation
   - The mode rail is a responsive segmented grid with icon-first buttons and stable accessible labels: `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, and `System`.
   - The visible `Providers` label maps to the internal reliability mode. Keep user-facing copy and tests aligned if this mapping changes.
   - The rail uses `role="group"` and `aria-pressed`; it is not a tablist because mode changes replace the whole analysis workspace.
   - The active mode also has a screen-reader-only polite status so compact controls communicate selected-state changes without changing their pressed-button semantics.
3. Metric deck
   - The hero remains a command header only: page title, selected project, sprint lens, time-window controls, and mode navigation.
   - Mode-specific top cards are the single primary metric deck for the selected analysis surface. They use `StatsCard` and should put the most actionable metric first for the selected mode.
   - Cards expose title, value, and string description as the analytics article name. Long values must wrap inside stable card slots.
4. Workspace body
   - Mode content starts directly after the metric deck without an extra studio header, readiness chip, duplicated KPI strip, summary-card deck, or duplicated workspace context card.
   - Workspace bodies may differ substantially, but each component must consume the shared Stats panel, chip, input, ledger row, status tone, chart track, focus, and motion tokens directly.
5. Feedback states
   - No-project, first-load loading, first-load error, empty, refresh, and reduced-data states preserve the shell rhythm.
   - Loading states use polite status semantics. Error states use alert semantics and expose retry when recovery is available.
   - Refresh states keep existing analytics visible where cached data exists. Mark the affected chart, table, transcript, or page region with `aria-busy` and add visible/polite status text instead of using animation alone.

## Visual Modes

Mode-specific implementations live under `dashboard/src/v2/pages/stats/components/`. Keep reusable primitives in `stats-ui-primitives.tsx` and the `StatsShared.tsx` compatibility barrel; add mode-specific behavior in the relevant studio file.

### Trend

Trend is the chart-first workspace for time-series telemetry.

- Lead with throughput, runtime, cost, invocations, cache rate, and token velocity.
- Do not render a second Trend KPI band inside the studio. The mode metric deck owns total tokens, invocations, active time, cost, and cache-rate summaries; the Trend studio starts with compact secondary signal cards and then the chart.
- Keep chart state centralized through `use-usage-chart-state.ts`; chart filters change series visibility, not the selected time window.
- The chart header keeps filter access and zoom reset visible near the graph title. The toolbar summarizes selected range, bucket count, resolution, and active zoom.
- The primary plot should use a tall, viewport-bounded canvas area so the graph remains the dominant element in Trend mode.
- Avoid visible chart-summary card decks above the plot. Keep chart summary text in the screen-reader summary and expose exact values through focused-bucket inspection.
- Short daily windows show compact bucket labels under the overview strip so the minimap carries its own context without relying only on the main x-axis labels.
- Series controls sit in a full-width band under the usage graph, grouped into readable categories such as totals, token details, source confidence, providers, models, purposes, and Git. Controls use `role="switch"` and `aria-checked`; at least one series remains enabled.
- Hover, keyboard focus, minimap selection, drag zoom, and active bucket controls all update the same focused-bucket summary; avoid a second live-values panel that repeats those values. The focused-bucket card fills the height of its chart-side column, caps to the graph height, and scrolls internally when the graph is tall.
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
- Rows surface success tone, p50/p95 latency, tokens per call, output velocity, cache-hit rate, reasoning share, provider identity, pricing stats, and token-flow anatomy when those fields are present.
- Model pricing stats use `usage.totalCostUsd` and should show total cost, cost per invocation, and blended cost per million tokens only when a positive cost signal exists.
- Missing model arrays, zero model usage, zero duration samples, and low invocation counts render as explicit low-data states.
- Long model and provider names must wrap within stable cards and rows; chips and metrics cannot force horizontal page overflow.

### Providers

Providers is the reliability studio.

- The visible mode label is `Providers`; the studio title may describe reliability.
- Start with confidence, fallback usage, failure pressure, and provider coverage before detailed rows.
- Source mix explicitly shows reported, estimated, unavailable, unsupported, and unknown invocation-source counts. Estimated data is usable but lower precision.
- Provider cards sort by computed risk first and token volume second, then show failure count, success-rate tone, token volume, pricing stats, active time, duration coverage, and source confidence.
- Provider pricing stats use `usage.totalCostUsd` and should show total cost, cost per invocation, and blended cost per million tokens only when a positive cost signal exists.
- Provider status and latency details may be derived from matching model summaries, but health must not be fabricated when model/status telemetry is absent.
- Empty provider or source segments use shared Stats panels and explain what data is missing.

### Ledgers

Ledgers contains operational records for tasks, sprints, and Git.

- Task Telemetry, Sprint Telemetry, and Git Telemetry are real tabs with accessible tab semantics, stable labels, and count badges.
- Task and sprint rows expose status, provider, purpose, calls, active time, cost, recency, visible-total share, leader share, token-flow anatomy, and p50/p95 chips when percentile fields are present.
- Git rows keep churn separate from token flow. Use `ChurnFlowBar` for insertions and deletions, and keep pull requests, merges, files, conflicts, visible share, and leader share readable.
- Search, sort, and progressive rendering preserve the `useProgressiveList` flow: visible items, scroll container, and sentinel stay wired together.
- Sort controls use buttons with `aria-pressed` when they represent local ordering choices.
- Ledger tab indicators and selected records use `selectionMovement`; progressive rendering, sorting, and visible-row changes use `listReveal` or `listReorder` depending on whether rows are entering or moving. Reduced motion snaps these changes while leaving count badges, selected states, and row labels visible.

### System

System is the invocation workbench.

- `useSystemViewData(projectId)` owns filters, sorting, summaries, pagination, request cancellation, and the legacy array fallback used by older tests.
- Summary sections are Sprint State, Invocation Health, External API Activity, and Error Categories.
- The record view control is a connected, non-sticky segmented button group for `All`, `Errors`, and `System Msgs`; count slots stay visually quiet and width-stable while accessible names include exact record counts.
- `SystemFilterBar` presents search and status as the primary row, then groups purpose, provider, and error-category chips below inside one composed Warm Void administrative control surface with quiet result, active-filter, clear-all, and pagination metadata.
- Invocation tables preserve semantic headers with `scope="col"` and per-cell header relationships while allowing mobile rows to expose dense labels.
- Expand controls name the target invocation, point at the transcript panel, and remain keyboard-accessible.
- Transcript detail surfaces role, created time, token totals, optional message metadata, errors, and long content with safe wrapping. The expanded transcript panel uses the shared Warm Void Stats primitives for its header, compact invocation summary row, status chips, role records, copy control, loading, empty, and error states.
- Transcript loading uses `aria-busy` on the transcript region and polite loading status. Transcript errors use alert semantics and keep the expand control keyboard-accessible for recovery.
- System feedback states use compact Warm Void subpanels with semantic icons, short operational copy, and named `status` or `alert` regions. Loading and empty/reduced-data states are polite and include visible text beyond motion, while blocking invocation and transcript failures use alert semantics. Copy must distinguish no classified activity or unavailable metrics from proven zero usage.

## Telemetry Semantics

Stats copy and visuals should teach operators how trustworthy a number is without overstating precision:

- `reported` means the provider supplied authoritative usage.
- `estimated` means Code UX derived usage from prompt/transcript text or provider-adjacent artifacts.
- `unavailable` means the provider ran but no usable counts could be derived.
- `unsupported` means the provider intentionally does not participate in token telemetry.
- `unknown` may appear only as a defensive frontend bucket when known source counters do not account for all invocations in the current snapshot.

Cost values come from snapshot cost fields and should only be presented when configured data makes them meaningful. Do not imply a free run from a zero cost when pricing may be unavailable.

Cost displays use two fractional digits for scanability, rounding values such as `$55.4093` to `$55.41`.

## Primitives And Styling

Use page-scoped Stats primitives instead of one-off analytics chrome:

- `stats-theme.css` defines Stats-specific aliases for panel surfaces, subpanels, chips, inputs, focus rings, status fills, borders, shadows, and motion.
- `PANEL_CLASS`, `SUBPANEL_CLASS`, `CHIP_CLASS`, `INPUT_CLASS`, `LEDGER_ROW_CLASS`, `LEDGER_ROW_MODERN_CLASS`, `STATUS_TONE_CLASS`, `TAB_ACTIVE_CLASS`, `TAB_IDLE_CLASS`, `DASHED_EMPTY_CLASS`, and `TRACK_CLASS` provide the shell vocabulary.
- `StatsCard`, `StudioHeader`, `SignalMetricCard`, `DonutCard`, `PurposeRibbon`, `TokenChip`, `TokenFlowBar`, `ChurnFlowBar`, `SortButton`, `ViewToggle`, and `SeriesLegendButton` cover repeated Stats patterns.
- Typed view-model helpers should own reusable derivations for trend, chart, model, provider, and ledger projections. Avoid recalculating meaningful bucket or efficiency summaries directly in JSX.
- New or touched Stats surfaces should use semantic Stats variables for backgrounds, borders, text, status tones, focus rings, chart tracks, selection fills, and scrims instead of raw slate/white/black light-dark utility pairs.
- Stats panels, subpanels, chips, inputs, cards, ledger rows, tabs, and inactive legend controls use solid Warm Void surface tokens with hairline borders and restrained shadows. Do not reintroduce shared glass tokens or backdrop blur as the dominant material for these primitives.
- Do not fix design drift with broad page-root `:global()` color or spacing overrides. Tokenize the owning component or extend the shared primitive vocabulary so Trend, Composition, Models, Providers, Ledgers, and System stay consistent without hidden CSS bridges.
- Metric cards with sparkline micrographs use the standard card surface, not a separate muted graph background. The sparkline must fit its own stable slot so hover glow and line geometry are not cut off by card overflow. Populated sparklines expose a concise `role="img"` summary with point count and high/low values; empty sparkline slots show a static `No sparkline data` label and an explicit no-data `role="img"` description.

Dense analytics layouts should stay calm: restrained contrast, low-opacity fills, semantic color, stable grids, and short labels. Avoid nested decorative cards; repeated cards, ledger rows, modals, and tool panels may be framed, while page sections should read as workspaces.

## Responsive Behavior

- The hero uses a two-zone command band on wide screens and stacks project context, time controls, and mode navigation on narrow screens.
- Fixed or sticky header-adjacent navigation must wrap before it clips. Header preset and mode controls should use bounded grids that move from compact multi-row layouts to a single row only when the command column has enough width; use `min-w-0`, wrapping labels, and component-local overflow only when wrapping can no longer preserve button labels.
- Metric grids collapse from desktop multi-column layouts to two-column and single-column layouts without changing order.
- Trend places focused-bucket and series context below the chart on narrow screens.
- Ledgers and system rows include mobile labels when the header row is visually unavailable.
- Tables, chart summaries, filter bars, date validation messages, pagination, and transcript panels must not create page-level horizontal scrolling.
- Touch targets and keyboard focus order remain usable at phone widths.

See [Mobile Responsiveness](./mobile-responsiveness.md) for dashboard-wide constraints.

## Accessibility

- The page root is a named statistics region and marks itself busy during first-load telemetry.
- Mode navigation, time presets, filter chips, sort buttons, and invocation view controls expose selected state through ARIA attributes. Compact mode and invocation-view controls keep stable accessible names, visible focus rings, and arrow/Home/End keyboard navigation.
- Ledger navigation uses actual tab semantics. Keyboard focus should move from the active tab into the tabpanel controls and rows in DOM order.
- Charts expose a region name, readable summary, keyboard-reachable bucket targets, minimap bucket text, and a screen-reader-only table for exact values.
- Chart refresh indicators use semantic status text in addition to animation.
- Microvisuals such as sparklines, donuts, ribbons, token flow bars, churn bars, and status bars either expose a concise `role="img"` label or are paired with nearby text that communicates the same data.
- Date inputs have visible labels, programmatic labels, validation state, and inline alert text for invalid custom ranges.
- Invocation tables provide captions, active `aria-sort` only on the sorted column, explicit sort button labels, mobile cell labels, and wrapping-safe cells for long provider, model, error, and transcript text.
- Focus rings use `--stats-focus-ring` or shared dashboard focus tokens and remain visible in light and dark themes.
- Repeated visible labels are acceptable when they reflect real UI structure. Tests should disambiguate by role, group name, region, or scoped queries.
- Custom date range validation uses visible labels, `aria-invalid`, `aria-errormessage`, and inline alert text. Invalid or incomplete ranges keep the controls visible and focusable until corrected.
- Stats loading, empty, low-data, reduced-data, and background-refresh states use polite live-region copy. Blocking API failures and unrecoverable transcript errors use alert semantics. Numeric metric values remain static text; surrounding detail or micrograph containers may animate but must never obscure exact values from assistive technology.

## Motion

Motion is for orientation only: shell entrance, mode transitions, card detail refreshes, chart updates, hover feedback, and tab changes should be subtle. Respect `prefers-reduced-motion` by disabling nonessential GSAP, Tailwind entrance, card, chart, and tab animation. Never rely on motion to reveal validation errors, filter state, table content, or chart values, and never animate numeric text in a way that obscures exact values for assistive technology.

- Use `controlFeedback` for time presets, filters, sort buttons, series switches, pagination buttons, and expand controls.
- Use `selectionMovement` for mode detail movement, active tab indicators, selected ledger views, metric-card detail refreshes, and small micrograph emphasis.
- Use `listReveal` for progressive ledger and invocation row entrance.
- Use `listReorder` when sorting or filtering repositions existing rows.
- Use `inlineValidation` for custom date range errors.
- Use `asyncFeedback` for chart refresh overlays and `ActionFeedbackRegion` states in usage graph loading/error/empty surfaces.

## Verification Guidance

For documentation-only Stats changes without TypeScript or TSX examples, run repository lint/typecheck and verify discoverability:

```bash
pnpm run lint
rg "interaction|reduced motion|aria-busy|asyncFeedback" docs/dashboard docs/index.md docs/SUMMARY.md
```

For Stats UI changes, run focused tests first. `pnpm run test:dashboard` covers `tests/dashboard`; source-adjacent Stats tests under `dashboard/src/v2/pages/stats/__tests__/` should be run directly when those components change:

```bash
pnpm exec vitest run dashboard/src/v2/pages/stats/__tests__ tests/dashboard/stats
pnpm run test:dashboard
pnpm run typecheck:dashboard
```

Run `pnpm run build` when changes touch shared contracts, routing, CSS token boundaries, dashboard imports, or production bundling behavior. Do not record a check as passed unless it was run for the current change.
