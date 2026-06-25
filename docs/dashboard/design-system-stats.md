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

*   **Surfaces (`--stats-card-bg`)**: Uses `var(--surface-glass)` to seamlessly blend with the dashboard background, respecting light/dark mode.
*   **Borders (`--stats-card-border`)**: Uses `var(--border-hairline)` to create structure without overwhelming the data.
*   **Shadows (`--stats-card-shadow`)**: Standardized to `var(--elevation-base)` for typical cards and `var(--elevation-raised)` for interactive/hover states.
*   **Typography (`--stats-label-color`, `--stats-detail-color`)**: Maps to `var(--text-metadata)` to enforce consistent low-contrast metric headers and captions.

## Component Specific Rules

### Stats Cards
*   Follow the standard global Card rules: no hardcoded CSS box shadows in hover effects.
*   Use `var(--elevation-raised)` when a card is hovered.
*   Remove heavily animated effects (like fluid waves or tracing borders) if they conflict with the goal of a calm, professional analytics environment. Let the metrics do the talking.

### Charts & Controls
*   **Chart Backgrounds**: Should remain subtle (e.g., `bg-[var(--stats-card-bg)]`), avoiding faux-gradients or distracting "glassy" layers over the plot area.
*   **Tooltips & Menus**: Float above the chart using `var(--surface-glass)` and `var(--elevation-floating)`.
*   **Controls**: Use standard semantic focus rings (`var(--accent-focus-ring)`) rather than custom rings per button.

### Ledgers & Tables (Telemetry & System)
*   **Row Interactions**: Rows must rely on global `var(--fill-muted-hover)` patterns rather than arbitrary hardcoded highlights.
*   **Status Indicators**: Status chips (Completed, Running, Failed, Cancelled) should be distinct and legible, but avoid visually competing with actual data or error states.
