# Dashboard Design System: Stats & Analytics

## Purpose

This page defines the visual and interaction standards for the dashboard’s `/stats` surface. The Stats page is a dense analytics workspace, but it should still feel calm, legible, and operationally focused.

## Information Architecture

The final Stats page is organized into four layers:

1. Hero
   - Project and window context live at the top of the page.
   - Time-window chips and custom date inputs stay visible regardless of the selected mode.
   - The hero also exposes summary metrics and the analysis mode toggle.
2. Mode navigation
   - The page supports `trend`, `composition`, `models`, `reliability`, `ledgers`, and `system`.
   - Modes are treated as first-class analysis surfaces, not as hidden subpages.
3. Analysis studio
   - Trend mode combines summary cards, the interactive usage chart, a persistent side rail, and the graph filter menu.
   - Composition, models, and reliability modes use compact metric cards and supporting charts or summaries.
   - Ledgers mode uses tabbed task, sprint, and git views.
   - System mode uses a controlled filter bar and a dense invocation table.
4. Feedback states
   - Loading, empty, error, and reduced-data states must preserve layout and keep the page usable.

## Visual Standards

### Density

- Prefer compact cards and stacked panels over large empty containers.
- Keep the hero dense enough to communicate scope, but not so crowded that the mode switcher becomes hard to scan.
- Use the shared `PANEL_CLASS`, `SUBPANEL_CLASS`, and `CHIP_CLASS` primitives instead of ad-hoc one-off shells.

### Typography

- Use small uppercase labels for metric headers and control groups.
- Reserve large text for key values, chart titles, and table summaries.
- Keep labels concise. If a metric needs a long explanation, put the explanation in a subordinate detail line.

### Spacing

- Use consistent vertical rhythm between the hero, the mode cards, and the analysis studio.
- Keep control clusters tight enough to read as a single system, but separate them enough that keyboard focus remains obvious.
- Preserve panel height across loading and empty states so the layout does not jump.

### Color

- Use signal colors to encode state, not decoration.
- Status chips, tab pills, and legend switches should remain legible in both light and dark themes.
- Avoid introducing new color tokens when existing semantic tokens already describe the same intent.

## Interaction Rules

### Hero and Window Controls

- Time-window presets should remain visible in the hero.
- Custom ranges must validate immediately and display an inline error when the range is missing or inverted.
- The custom range action should stay keyboard accessible and should not rely on another control elsewhere in the app.

### Mode Navigation

- Use a single accessible grouped toggle for the mode switcher.
- Mode buttons should expose pressed state and should remain stable in label order.
- Do not rename modes casually; the page and regression tests rely on these labels as part of the public UI contract.

### Charts

- Chart regions must expose an accessible name, a readable summary, and a non-visual alternative for exact values.
- Use a three-part layout for the trend workspace: summary cards, SVG plot, and persistent side rail.
- Graph filters should control series visibility only. The time window belongs to the hero.
- Series toggles must be implemented as `button role="switch"` controls with `aria-checked`.
- Keep at least one series enabled so the plot never collapses into an empty chart by accident.
- Hover, keyboard focus, and drag zoom should all feed the same active-bucket summary.

### Ledgers

- Tabbed ledgers should use roving focus and expose numeric badge counts.
- Keep the tab labels short: `Task Telemetry`, `Sprint Telemetry`, and `Git Telemetry`.
- Rows should keep status, context, and token columns readable without forcing the operator to expand every entry.
- Expanded rows should preserve the ledger footprint and only add detail beneath the active record.

### System Tables

- The system view should keep its filters and table separate so counts remain understandable at a glance.
- Search, status, purpose, provider, and error filters must be controlled explicitly and should not be hidden inside the table.
- Table headers should stay sortable and preserve header relationships for assistive tech.
- Result counts should stay visible while the list is filtered or paginated.

## Motion and Reduced Motion

- Use subtle entrance motion for page sections and mode transitions.
- Honor `prefers-reduced-motion` by disabling chart and tab animation while keeping state changes clear.
- Do not depend on animation to reveal essential information.

## Accessibility Requirements

- Every analysis mode must remain reachable by keyboard.
- Chart summaries should be available to screen readers even when the plot is visually dense.
- Tabs, switches, and result counters must expose their state through standard ARIA patterns instead of custom text alone.
- Loading, empty, and error states must use semantic status or alert roles.
- Decorative chart substructure should be hidden from assistive tech when a parent element already provides the meaningful summary.

## Implementation Notes

- The design system assumes the shared stats primitives stay in place, especially the panel shells, chips, legend switches, and metric cards.
- Keep the visual language consistent across modes so the page feels like one analytics workspace, not six separate pages.
