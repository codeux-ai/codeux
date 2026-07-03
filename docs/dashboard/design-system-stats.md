# Dashboard Design System: Stats & Analytics

## Purpose

The `/stats` page is the project-scoped analytics workspace for Code UX telemetry. It turns the project stats snapshot and invocation records into a calm, data-first surface for trend review, provider and model analysis, task and sprint ledgers, Git churn, and system invocation inspection.

Stats is not a marketing view or a decorative dashboard. It should remain dense enough for repeated operational use, but every control, card, chart, and ledger must preserve clear hierarchy, accessible names, and responsive wrapping.

## Page Structure

The redesigned Stats page follows a stable top-to-bottom rhythm:

1. Header and command band
   - The hero names the selected project and sprint context, shows generated-at and freshness metadata, and owns all time-window changes.
   - Time presets include `24h`, `7d`, `30d`, `All`, and `Custom`. `Custom` reveals date fields, but the range changes only after the guarded `Apply` action succeeds.
   - The visual mode control is a grouped button rail with stable labels: `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, and `System`. `Providers` maps to reliability analysis and should not be renamed without updating tests and copy together.
2. Workspace context strip
   - The strip repeats the minimum context needed to stay oriented: active mode, selected window, freshness, resolution, and sprint scope.
   - It appears for selected-project, no-project, loading, error, and low-data paths so the page never drops into an unanchored state.
3. Top cards
   - Each visual mode renders a compact summary deck before the deeper workspace.
   - Cards use the shared `StatsCard` primitive and expose the title, value, and description as one named analytics article.
   - Empty or partial telemetry must use explicit labels such as `No data`, `No tokens`, `No runs`, or `Low data` instead of presenting zero as a meaningful measurement.
4. Analysis studio
   - Every mode starts with the shared studio header pattern: eyebrow, icon, title, short description, and loading or refresh state when relevant.
   - The studio body changes by mode, but the shell should preserve the same warm-void panel vocabulary and spacing.
5. Feedback states
   - No-project, first-load loading, first-load error, empty, reduced-data, and refresh states keep the same Stats shell rhythm.
   - Loading states use polite status semantics. Error states use alert semantics and expose a retry path when the page can recover.

## Visual Modes

### Trend

Trend mode is the chart-first workspace for time-series telemetry.

- The top deck summarizes throughput, runtime, cost, invocations, cache rate, and token velocity.
- The trend chart shows enabled series from the same selected time window; chart filters never change the time window.
- The chart header is the single action toolbar for range context, zoom reset, and filter access.
- Series toggles use `role="switch"` with `aria-checked`; at least one series must remain enabled.
- Hover, keyboard focus, minimap selection, drag zoom, and active bucket controls all update the same focused-bucket summary.
- The chart must keep its nonvisual summary and screen-reader-only data table in sync with the visible SVG.

### Composition

Composition mode explains where usage comes from.

- Use source mix, purpose mix, token flow, provider share, and confidence summaries derived from the existing stats snapshot.
- Source-confidence cards should distinguish reported, estimated, unavailable, and unsupported telemetry without inventing alternate totals in the browser.
- Donuts, ribbons, and flow bars must be paired with concise text summaries or `role="img"` labels so color is not the only signal.

### Models

Models mode compares model activity and efficiency.

- Surface active model counts, token distribution, cost, cache behavior, latency, and top contributors.
- Missing model arrays or empty model usage should render low-data states rather than failing or implying all models are idle.
- Keep long model names wrapped or truncated inside stable cards and rows with `min-w-0`.

### Providers

Providers mode is the reliability studio.

- The visible label is `Providers`; the internal mode may still be reliability-oriented.
- Summaries should cover provider share, status distribution, latency, duration, source confidence, and error or failure pressure where data exists.
- Provider-derived status and latency cards must tolerate partial snapshots and fixtures, but should not fabricate health data when telemetry is missing.

### Ledgers

Ledgers mode contains tabbed operational records.

- Task Telemetry, Sprint Telemetry, and Git Telemetry use accessible tab semantics with stable tab labels and count badges.
- Task and sprint rows should expose status, usage, cost, duration, recency, source quality, and top contributor context without requiring expansion for basic triage.
- Git rows should keep churn visually separate from token flow. Use `ChurnFlowBar` for insertions and deletions instead of reusing token-flow metaphors.
- Search, sort, and progressive rendering must preserve the `useProgressiveList` flow: visible items, scroll container, and sentinel stay wired together.
- Sort controls use buttons with `aria-pressed` where they represent local ordering choices.

### System

System mode is the invocation workbench.

- `useSystemViewData(projectId)` owns server-projected pagination, filters, sort state, summaries, and the legacy array fallback used by older mocks.
- Summary panels cover invocation totals, status counts, purpose and provider mix, latency, duration, token and cost totals, and error categories where present.
- The record view control is a wrapped button group for `All`, `Errors`, and `System Msgs`.
- `SystemFilterBar` groups search, status, purpose, provider, error-category, clear, count, and pagination controls into responsive panels.
- Invocation tables preserve table headers with `scope="col"` while allowing mobile row content to become dense, labeled, and non-clipping.
- Expand controls must name the target invocation and remain keyboard-accessible.

## Stats Primitives

Use the page-scoped Stats primitives instead of building one-off analytics chrome:

- `stats-theme.css` for Stats-specific tokens, including card backgrounds, borders, chips, labels, detail text, focus rings, and status fills.
- `PANEL_CLASS`, `SUBPANEL_CLASS`, `CHIP_CLASS`, `INPUT_CLASS`, and `LEDGER_ROW_MODERN_CLASS` for shells, inner panels, command chips, inputs, and dense rows.
- `StatsCard` for top-deck metric cards and reusable metric summaries.
- `StudioHeader`, `SignalMetricCard`, `DonutCard`, `PurposeRibbon`, `TokenChip`, `TokenFlowBar`, `ChurnFlowBar`, `SortButton`, `ViewToggle`, and `SeriesLegendButton` for repeated Stats-specific visual patterns.
- Typed view-model helpers for trend, model, provider, chart, and ledger projections. Keep telemetry derivation out of JSX when it is reused or has meaningful edge cases.

Dense analytics layouts should stay calm:

- Favor restrained contrast, low-opacity fills, and semantic color over saturated chart decoration.
- Avoid nested decorative cards. Repeated metric cards, ledger rows, modals, and tool panels may be carded; page sections should read as full-width workspaces.
- Reserve the largest type for page titles, mode titles, metric values, chart summaries, and result counts.
- Keep explanatory UI copy short. Implementation rationale belongs in docs and tests, not in the interface.

## Navigation And Controls

Navigation controls must never be clipped or require page-level horizontal scrolling.

- Wrap command groups before allowing horizontal overflow. Use `flex-wrap`, `min-w-0`, stable button dimensions, and grid tracks such as `minmax(0, 1fr)`.
- The hero command panel, visual mode rail, chart toolbar, ledger tabs, ledger sort bars, system filters, and pagination controls should all remain reachable at mobile widths.
- Avoid overflow-hidden ancestors around controls that can wrap, open popovers, or show validation messages.
- Keep button accessible names stable. Current tests and users rely on labels such as `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, `System`, `Custom`, `Apply`, and `Filters`.
- Use `role="group"` plus `aria-pressed` for local visual modes, filter chips, and sort choices. Use tab semantics only for actual tabbed ledgers.
- Date inputs require visible labels, `aria-invalid`, `aria-errormessage`, and an inline alert when the custom range is incomplete or inverted.

## Low-Data And Empty States

Stats often renders during active work, after a fresh project import, or against historical snapshots with partial telemetry.

- Keep the previous snapshot visible during refresh when possible, and mark the studio as refreshing rather than replacing the whole workspace.
- Use explicit low-data copy when series, providers, models, costs, durations, or Git rows are missing.
- Do not infer success, failure, cost, model share, or provider health from absent data.
- Preserve layout footprint for empty top cards and studio panels so mode switches do not jump.
- Loading copy that existing tests and accessibility checks depend on should change only with the tests and docs in the same task.

## Accessibility

- The page root is a named statistics region and marks itself busy while first-load telemetry is pending.
- No-project and loading states use polite `status` regions; error states use `alert`.
- Mode navigation, time presets, chart switches, ledger tabs, filter chips, sort buttons, and invocation view controls expose state through standard ARIA attributes.
- Charts expose a readable summary, focusable bucket targets, keyboard exploration, and a screen-reader-only table for exact bucket values.
- Chart refresh indicators use semantic status in addition to animation.
- Micro-visuals such as sparklines, donuts, ribbons, token flow bars, churn bars, and status bars must either expose a concise `role="img"` label or be covered by nearby text that communicates the same data.
- Focus rings use `--stats-focus-ring` or the shared dashboard focus token and must remain visible in light and dark themes.
- Repeated labels are acceptable when they reflect real UI structure. Tests should disambiguate repeated labels with roles, accessible names, regions, or `getAllByText` rather than forcing unique visible copy.

## Responsive Behavior

- Wide layouts use a two-zone hero, top-card deck, chart with side rail, and dense studios.
- Tablet and mobile layouts stack command zones and studio panels while preserving control order.
- Metric decks collapse from desktop multi-column grids to two-column and single-column layouts without changing card order.
- Trend mode places the focused-bucket and series context below the chart on narrow screens.
- Ledgers and system rows include mobile labels when table headers are visually unavailable.
- Touch targets, keyboard focus order, and validation messages must remain usable on narrow screens.

## Motion

- Motion is for orientation only: shell entrance, mode transitions, chart updates, and tab changes should be subtle.
- Respect `prefers-reduced-motion` by disabling nonessential entrance, chart, and tab animation.
- Never rely on motion to reveal validation errors, table content, filter state, or chart values.

## Verification Guidance

For documentation-only Stats changes, verify links and page references with:

```bash
rg -n "design-system-stats" docs/index.md docs/SUMMARY.md docs/dashboard/design-system-stats.md
```

For Stats UI changes, run focused tests first. The dashboard script targets `tests/dashboard`, so source-adjacent Stats tests should be run directly when changed:

```bash
pnpm exec vitest run dashboard/src/v2/pages/stats/__tests__ dashboard/tests/dashboard/stats
pnpm run test:dashboard
```

Run dashboard typecheck for any TS or TSX change:

```bash
pnpm run typecheck:dashboard
```

Run the full build when a change touches shared contracts, routing, build configuration, dashboard imports, CSS token boundaries, or behavior that can affect production bundling:

```bash
pnpm run build
```

Do not record a check as passed in docs, release notes, or PR text unless it was actually run for that change.
