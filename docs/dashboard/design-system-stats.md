# Dashboard Design System: Stats & Analytics

## Objective

This document defines the visual system and guidelines specifically for the Stats & Analytics surfaces (e.g., the root `/stats` page, hero elements, interactive charts, and ledgers) in the Code UX dashboard.

The goal is to maintain a unified "polished operational command surface" that feels both dense with data but visually calm, respecting the global dashboard variables while providing the required specialized analytics tools.

## Core Design Principles

1.  **Dense but Calm**: Analytics surfaces often present an overwhelming amount of information (metrics, charts, complex filters, telemetry logs). Do not combat density with excessive whitespace. Instead, rely on subdued visual containers, precise typography, semantic boundaries, and clear hierarchy. Avoid purely decorative presentation.
2.  **Harmonized Primitives**: Do not reinvent components or use ad-hoc Tailwind colors (e.g., `bg-white/68` or `border-black/[0.05]`) for standard layout elements. Use the shared primitive semantic tokens (e.g., `--surface-glass`, `--border-hairline`, `--elevation-base`).
3.  **Data First**: Chart surfaces and table records should minimize Chrome (heavy gradients, loud backgrounds, overly energetic borders) so that the data itself stands out.

## Local Theme Tokens

Analytics components draw from `stats-theme.css`, which maps specifically back to the global semantic design language:

*   **Surfaces (`--stats-panel-bg`, `--stats-subpanel-bg`, `--stats-chip-bg`, `--stats-input-bg`)**: Use the Warm Void surface stack for panels, nested chart/table cards, metadata chips, and form controls. Panels should not invent white/slate glass backgrounds outside these tokens.
*   **Borders (`--stats-card-border`)**: Uses `var(--border-hairline)` to create structure without overwhelming the data.
*   **Shadows (`--stats-card-shadow`, `--stats-floating-shadow`)**: Standardized to `var(--elevation-base)` for normal analytics surfaces and `var(--elevation-floating)` for tooltips and menus.
*   **Typography (`--stats-label-color`, `--stats-detail-color`, `--stats-value-color`)**: Labels and supporting metadata map to `var(--text-metadata)` while metric values map to the global primary text token.
*   **Quiet chrome (`--stats-row-hover-bg`, `--stats-divider`, `--stats-muted-track`, `--stats-grid-line`)**: Rows, dividers, minimap tracks, and chart grid lines use neutral Warm Void tokens so only data series and status colors carry saturated accents.

## Component Specific Rules

### Stats Cards
*   Follow the standard global Card rules: no hardcoded CSS box shadows in hover effects.
*   Use `var(--elevation-raised)` when a card is hovered.
*   Remove heavily animated effects (like fluid waves or tracing borders) if they conflict with the goal of a calm, professional analytics environment. Let the metrics do the talking.
*   Metric values are the strongest hierarchy inside cards. Labels and descriptions remain metadata-weight, and accent color should appear on icons, data dots, or semantic status only.

### Charts & Controls
*   **Chart Backgrounds**: Should remain subtle (e.g., `bg-[var(--stats-panel-bg)]` or `bg-[var(--stats-subpanel-bg)]`), avoiding faux-gradients or distracting "glassy" layers over the plot area.
*   **Legends**: Series controls are visible, keyboard reachable, and exposed as switch-style controls. Preserve each data series color in dots/lines, but keep legend pill chrome neutral unless selected.
*   **Tooltips & Menus**: Float above the chart using `var(--stats-panel-bg)` and `var(--stats-floating-shadow)`.
*   **Controls**: Use standard semantic focus rings (`var(--accent-focus-ring)`) rather than custom rings per button.
*   **Minimaps and Empty States**: Overview strips, loading states, empty states, and error states should be framed as subpanels with tokenized dashed borders, muted copy, and accessible status/alert roles.

### Ledgers & Tables (Telemetry & System)
*   **Row Interactions**: Rows must rely on global `var(--fill-muted-hover)` patterns rather than arbitrary hardcoded highlights.
*   **Status Indicators**: Status chips (Completed, Running, Failed, Cancelled) should be distinct and legible, but avoid visually competing with actual data or error states.
*   **Tabs & Filters**: Ledger tabs, system filters, and sort controls use `--stats-chip-bg` plus hairline borders. Active filters may use semantic status or data colors, while inactive filters stay neutral.
*   **Tables**: Sticky headers, loading skeletons, empty states, and expanded rows remain within the same panel/subpanel hierarchy as metric cards. Token columns can retain data colors for input, cached, output, and total distinction.

### Accessibility Rules
*   **Charts**: Chart regions must provide accessible names, descriptions, and keyboard-reachable summaries. Provide data-table or text alternatives for usage trends. For SVG sparklines or micro-charts, avoid hiding them completely with `aria-hidden="true"`. Instead, set `role="img"` and provide an `aria-label` that describes the overall computed trend (e.g., 'increasing', 'decreasing', or 'stable'). When composing dense metric cards with multiple visual elements (labels, values, trends), apply `aria-hidden="true"` to the internal visual components and provide a single coherent `aria-label` on the parent container to prevent fragmented screen reader announcements.
*   **Legends**: Legends and series toggles must expose pressed/selected state and series names via visually hidden text. When building series toggle controls (e.g., chart legends or sidebars), implement them as interactive `<button role="switch">` elements using the `aria-checked` attribute.
*   **Tables**: Ensure invocation tables preserve header relationships (`scope="col"`).
*   **Motion**: Respect reduced motion for chart transitions and animated loading states. Provide non-motion status text.

## Data & State Management

*   **Server-Driven Metrics**: Always prefer using server-provided metrics, totals, and available filter lists (like purposes and providers) when fetching data over computing them on the client. This ensures the dashboard accurately reflects system state even when paginated.
*   **Request Cancellation**: Active network requests must be cancellable (e.g., using `AbortController`) to support fast query, filter, and sort state changes without race conditions or overwriting new data with stale responses.
*   **Legacy Fallbacks**: If an endpoint supports a legacy unpaginated array response, isolate the client-side filtering, sorting, and aggregation calculations into dedicated standalone legacy helper functions, ensuring they only run if server aggregates are explicitly missing.
