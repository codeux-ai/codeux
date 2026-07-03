# Dashboard Design System: Stats & Analytics

## Purpose

The `/stats` page is the telemetry command surface for a selected project. Its design language is the warm void: quiet dark and light canvases, warm amber emphasis, compact operational density, and restrained status treatment. The page should read as one analytics workspace across Trend, Composition, Models, Reliability, Ledgers, and System modes.

## Information Architecture

The Stats surface has six persistent layers:

1. Hero command band
   - Project, sprint, generated-at, freshness, source quality, time window, custom range, analysis mode, and executive summary stay visible before the workspace changes.
   - The hero owns all time-window decisions. Downstream charts and tables respond to the selected range; they do not duplicate range controls.
2. Workspace context strip
   - A lightweight strip follows the hero and names the active workspace, current window, freshness, resolution, and sprint scope without duplicating the hero's controls.
   - The strip stays visible for selected-project, no-project, loading, and error paths so the page never falls into an unanchored empty state.
3. Mode summary cards
   - Each mode renders a compact top-card deck tuned to the active analysis question.
   - Metric cards show a primary value, supporting detail, signal badge, optional sparkline, and a compact quality hint so each deck reads as an executive summary instead of a raw KPI list.
   - Trend focuses on throughput, runtime, cost, invocations, cache rate, and token velocity.
   - Composition, Models, Reliability, Ledgers, and System use their own mode-specific card taxonomy while preserving the same card density and explicit low-data fallbacks.
4. Analysis studio header
   - Every mode starts with a warm-void header band containing the mode icon, mode name, short description, and loading state.
   - The header keeps operators oriented when switching between dense workspaces.
5. Mode workspace
   - Trend renders the KPI band, chart workspace, active bucket rail, graph filters, minimap, and purpose activity ledger.
   - Composition, Models, and Reliability render secondary studio panels for mix, performance, telemetry confidence, and provider health. These studios should expose comparable insight bands before detailed rows so operators can compare provider/source concentration, model efficiency, and telemetry quality without relying on the chart workspace.
   - Ledgers renders tabbed Task Telemetry, Sprint Telemetry, and Git Telemetry.
   - System renders the invocation workbench with summaries, controlled filters, and the invocation table.
6. Feedback states
   - No-project, loading, error, empty, and reduced-data states preserve the hero → context → state rhythm and use semantic `status` or `alert` roles.

## Warm-Void Visual Language

### Surfaces

- Use `stats-theme.css` variables as the source of truth for Stats-specific surfaces: `--stats-card-bg`, `--stats-card-border`, `--stats-surface-chip`, `--stats-detail-color`, `--stats-label-color`, and `--stats-focus-ring`.
- Use shared primitives (`PANEL_CLASS`, `SUBPANEL_CLASS`, `CHIP_CLASS`, `INPUT_CLASS`, `LEDGER_ROW_MODERN_CLASS`, `StatsCard`) instead of one-off panel shells.
- Outer panels should feel soft and atmospheric; inner panels should be quieter and flatter so dense data remains scan-friendly.
- Avoid nested decorative cards. A repeated metric, ledger row, modal, or tool panel can be carded; page sections should stay as full-width bands or unframed layouts.

### Spacing And Density

- Keep vertical rhythm tight: hero, context strip, top cards, studio header, and workspace sections use consistent `gap-5` to `gap-8` spacing depending on viewport.
- Metric cards are compact and stable. Values, badges, secondary detail, sparklines, quality hints, and loading content must not resize the card footprint unexpectedly.
- Summary rows should wrap cleanly instead of overflowing horizontally. Use `min-w-0`, truncation, and responsive grid tracks for long project names, model names, and custom date labels.
- Sticky controls in ledgers and system workbench should use warm-void subpanel styling with backdrop blur and semantic borders.

### Typography

- Use small uppercase labels for metric headings, control groups, badges, table context labels, and ledger metadata.
- Reserve large bold type for metric values, mode titles, chart summaries, and table result counts.
- Keep explanatory copy short and subordinate. Long implementation notes do not belong in the page UI.
- Do not scale font size with viewport width. Use responsive layout changes rather than viewport-based typography.

### Color

- Use warm amber for primary Stats emphasis, selected mode controls, and command context.
- Use semantic status colors only for state: green/signal for healthy or running, amber for warning or in-progress, rose/red for failures, and muted slate/void for neutral detail.
- Chart colors must come from named semantic Stats color tokens. Do not pass arbitrary saturated hex colors through renderers.
- Area fills, grid lines, minimap overlays, tooltip surfaces, and table row rails should be low-opacity and warm-muted. Avoid glow-heavy chart styling.

## Controls

### Hero Controls

- Time presets are a grouped set of buttons with `aria-pressed`.
- `Custom` reveals date fields without applying a range. The guarded Apply action is the only custom-range apply path.
- Custom date inputs use explicit labels, `aria-invalid`, `aria-errormessage`, and an inline `role="alert"` message when dates are missing or inverted.
- The analysis mode rail is a grouped toggle with stable labels: `Trend`, `Composition`, `Models`, `Providers`, `Ledgers`, and `System`. The `Providers` label maps to reliability mode and should not be renamed casually.

### Chart Controls

- Graph filters control series visibility only. They should never change the selected time window.
- Series controls are switches (`role="switch"`, `aria-checked`) with text labels that remain understandable without color.
- At least one series must remain enabled so the chart does not collapse into an accidental empty state.
- Hover, keyboard focus, slider exploration, minimap selection, and drag zoom all update the same active-bucket summary.

### Ledger And System Controls

- Ledger tabs use standard tab semantics, roving focus, `aria-controls`, and stable count badges.
- System filters are explicit controlled inputs and chip groups for search, status, purpose, provider, and error category.
- Invocation table sort controls live in column headers and preserve `scope="col"` relationships.
- Expand controls name the target invocation and preserve keyboard access on desktop and mobile layouts.

## Ledgers

- Task, sprint, and git ledgers are dense operational records, not report cards.
- Rows should show status, context, usage, recency, and source detail without requiring expansion for basic triage.
- Search, sort, and progressive rendering must keep large ledgers responsive.
- Expanded rows add detail beneath the selected record without changing the surrounding ledger vocabulary.

## Accessibility

- The page root is a named Statistics region and marks itself busy while first-load telemetry is pending.
- No-project and loading states use polite `status` regions; error states use `alert`.
- Chart workspaces expose a readable summary, focusable bucket targets, keyboard exploration, and a screen-reader-only data table for exact values.
- Mode navigation, time presets, tabs, switches, filter chips, and sort buttons expose state through standard ARIA attributes.
- Focus rings use `--stats-focus-ring` or the dashboard focus-ring token and must remain visible in light and dark themes.

## Motion

- Use subtle section and mode-transition motion for orientation only. Page shell entrance animation should target only stable section containers like the hero wrapper, context strip, metric deck, studio shell, and first-load state panels.
- Honor `prefers-reduced-motion` by disabling entrance, chart, and tab animation while preserving state changes.
- Never depend on motion to reveal essential information, validation errors, or table content.

## Responsive Behavior

- The hero uses a two-zone layout on wide screens and stacks on smaller screens. Time presets and mode controls may scroll horizontally inside their rails, but the page must not produce horizontal overflow.
- Trend mode uses a chart-first column with a persistent focused-bucket/series rail on desktop; the rail moves below the plot on narrow screens.
- Mode cards collapse from five-column desktop decks to two-column and single-column layouts while preserving card order.
- Tables and ledgers expose mobile labels inside rows when column headers are visually hidden.
- All controls must remain reachable by keyboard and touch at mobile widths.

## Implementation Notes

- Keep Stats visuals aligned with `dashboard/src/v2/pages/stats/styles/stats-theme.css` and the shared primitives re-exported by `StatsShared.tsx`.
- Composition should make token anatomy, provider lanes, source confidence, purpose distribution, and low-data fallbacks visible in one flow. Donut and ribbon visuals must have a single coherent accessible label that summarizes the data instead of fragmenting SVG or decorative segment output.
- Models should compare the same dimensions across aggregate highlights and each ranked model card: latency, success rate, token volume, cache efficiency, output velocity, and reasoning share.
- Reliability should lead with an actionable source-quality status, then show reported/estimated/unavailable/unsupported coverage, provider confidence, duration sample coverage, and provider-level reliability notes.
- Documentation and tests should describe the integrated behavior: hero command band, mode card taxonomy, studio header, trend chart workspace, secondary studios, ledgers, system workbench, and realtime/polling refresh states.
- Small visual fixes are acceptable only when needed to keep tests or docs truthful; redesign changes belong in dedicated UI tasks.
