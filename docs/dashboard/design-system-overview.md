# Overview Dashboard Design System

This document outlines the architectural and stylistic guidelines for the Dashboard's primary Overview command surface.

## Goal
The overview page acts as a centralized "Polished Operational Command Surface." It is a dense, responsive workspace intended for real-time monitoring and routing, avoiding the loose, airy feel of a marketing landing page.

## Layout Hierarchy

- **Header Section**: Typography uses deliberate scale. H1 elements should not exceed `text-3xl md:text-5xl` (e.g., `text-5xl font-bold tracking-tight mb-2 font-display leading-[0.95]`). Subtitles are restrained to `text-sm md:text-base`.
- **Main Grid Container**: The grid holds operational sections (Sources, Tasks, etc.). The sections sit directly on the page background — no wrapping surface/card chrome around the full overview grid — so the operational content reads cleanly without a framing panel. The left column is a plain layout container (`xl:col-span-8 flex flex-col gap-10 md:gap-12`); structural unity comes from shared alignment, named regions, and restrained section headers rather than an outer card. Responsive ordering pushes the Live Telemetry rail below the primary content on narrow viewports.
- **Gaps**: Use `gap-10 md:gap-14` for the page stack, `gap-10 xl:gap-8 2xl:gap-10` for the main grid, and keep inner grid/card gaps constrained (`gap-4` to `gap-5`) so metrics, source tiles, task rows, and telemetry scan as one workbench.
- **Metric Rhythm**: Overview metric cards use `grid-cols-[repeat(auto-fit,minmax(220px,1fr))]`, a stable minimum height, and wrapped monospace detail rows. Long project names and operational labels must wrap or balance instead of truncating into unreadable chips.

## Accent and Status Usage

- **Signal** is the active/running focus accent for overview metrics, active counts, controls, and live execution emphasis.
- **Ember** is the secondary or warning-like emphasis for open work, merge pressure, and attention panels when the state is advisory rather than a raw machine state.
- **Status colors** (`status-green`, `status-amber`, `status-red`) are reserved for machine states such as completed, paused/intervention, failed, and event outcomes.

## Decorative Ambient Framing

- Do not use large, visually noisy "glows" (like raw `radial-gradient` backgrounds that obscure data).
- The identity is maintained via precise touches (e.g., small shadow blurs behind status indicators, low-opacity glass surfaces, or a single hairline divider) rather than wide background color washes, pulsing empty-state rings, or heavy hover movement.

## Empty and Sparse Data States

- Use the standardized `EmptyState` component for unified typography and iconography placement when a primary list or grid is empty (e.g. "No Active Streams"). Avoid custom dashed borders and ad-hoc layouts.
- For structural sidebar panels (like Telemetry) that lack data, maintain the unified height and styling of the component as if it were full. Empty telemetry should be calm and explicit (`Awaiting Runtime`) rather than animated as a decorative radar surface.
- Loading, empty, and sparse overview states must expose polite `role="status"` regions with useful accessible names, such as `Loading overview metrics`, `Loading project sources`, `Loading active task streams`, `Loading live telemetry`, and `No active runtime telemetry`.
- Preserve named overview landmarks: `Overview metrics`, `Project sources`, `Active task streams`, and `Live telemetry rail`.
