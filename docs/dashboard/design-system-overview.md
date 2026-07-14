# Overview Dashboard Design System

This document outlines the architectural and stylistic guidelines for the Dashboard's primary Overview command surface.

## Goal
The overview page acts as a centralized "Polished Operational Command Surface." It is a dense, responsive workspace intended for real-time monitoring and routing, avoiding the loose, airy feel of a marketing landing page. The active UI runs on v2 pages (`/` Overview, `/projects`, `/sprints`, `/tasks`, `/agents`, `/stats`, `/scheduler`, `/memory`, `/knowledge`, `/browser`, `/files`, `/live`, `/chat`, and `/config`).

## Layout Hierarchy

- **Header Section**: Typography uses deliberate scale. H1 elements should not exceed `text-3xl md:text-5xl` (e.g., `text-5xl font-bold tracking-tight mb-2 font-display leading-[0.95]`). Subtitles are restrained to `text-sm md:text-base`.
- **Main Grid Container**: The grid holds operational sections (Sources, Tasks, etc.). The sections sit directly on the page background — no wrapping surface/card chrome — so the operational content reads cleanly without a framing panel. The left column is a plain layout container (`xl:col-span-8 flex flex-col gap-16`); structural unity comes from the shared `SectionHeader` treatment on each section, not an outer card. Responsive ordering pushes the Live Telemetry aside below the primary content on narrow viewports.
- **Gaps**: Use `gap-16` between major vertical sections to prevent sprawling, and keep inner grid/card gaps constrained (e.g., `gap-4` for stat grids, `gap-8 md:gap-10 lg:gap-12` for source tile flex wraps).
- **Page Structure**: Secondary pages and nested views must use standardized wrappers like `PageContainer` and `PageHeader` from `dashboard/src/v2/components/layout/` to ensure unified padding and responsive behavior, while loading states should leverage `SkeletonLoader`.
- **Telemetry Attention Queue**: When a project is selected and the selected live snapshot includes active attention items, `OverviewTelemetry` renders a compact selected-sprint queue above the cross-project intervention block. Keep it read-only, internally scrollable, and visually aligned with the Live sidebar queue rows so the telemetry rail does not overflow.

## Decorative Ambient Framing

- Do not use large, visually noisy "glows" (like raw `radial-gradient` backgrounds that obscure data).
- The identity is maintained via precise touches (e.g., small shadow blurs behind status indicators, or structural glassmorphism) rather than wide background color washes.

## Empty and Sparse Data States

- Use the standardized `EmptyState` component for unified typography and iconography placement when a primary list or grid is empty (e.g. "No Active Streams"). Avoid custom dashed borders and ad-hoc layouts.
- For structural sidebar panels (like Telemetry) that lack data, ensure padding remains consistent (`p-8`) with other surfaces and maintain the unified height and styling of the component as if it were full.

## Accessibility And Runtime State Contracts

- Overview pages must preserve a named route landmark and named operational regions for metric cards, primary work sections, and live telemetry. `HeaderStats` and `OverviewTelemetry` are the reference source areas for overview metric and telemetry semantics.
- Loading metric decks use polite `role="status"` with `aria-busy`; loaded metric groups use named `region` containers. Avoid announcing decorative counters or background animation as separate content.
- Overview telemetry distinguishes urgency: loading, empty, pending, running, and timeline updates are polite, while project/transport failures that block trust in the telemetry rail are alerts. Timeline feeds use a named `role="log"` so updates are discoverable without replacing the whole page context.
- The selected-sprint attention queue in Overview must use the shared attention row presentation from the Live runtime surface. It should inherit status/severity tones, markdown summary rendering, and list semantics from that shared component, while omitting claim/resolve/dismiss actions.
- Dense runtime labels such as project names, sprint keys, provider/model labels, branch names, workflow names, and event snippets must wrap inside their cards or rails. Do not rely on hover-only truncation for operational values.
- Overview-authored copy and accessibility labels use the route-owned English/German catalog. Counts, percentages, dates, costs, and times use the active dashboard locale, while runtime-authored names, attention descriptions, execution text, and server errors remain verbatim.
- The Warm Void visual language remains restrained: neutral glass surfaces for Overview structure, theme-specific signal utilities for primary active/focus/running states, and Ember/status tones only for intervention, warning, error, and destructive states. Stats uses a stricter solid-surface Warm Void variant for dense analytics and System administration; see [Stats & Analytics Design System](./design-system-stats.md).

For repeatable page-level checks, use the [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md).
