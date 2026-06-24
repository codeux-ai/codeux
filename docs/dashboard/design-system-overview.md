# Overview Dashboard Design System

This document outlines the architectural and stylistic guidelines for the Dashboard's primary Overview command surface.

## Goal
The overview page acts as a centralized "Polished Operational Command Surface." It is a dense, responsive workspace intended for real-time monitoring and routing, avoiding the loose, airy feel of a marketing landing page.

## Layout Hierarchy

- **Header Section**: Typography uses deliberate scale. H1 elements should not exceed `text-3xl md:text-5xl` (e.g., `text-5xl font-bold tracking-tight mb-2 font-display leading-[0.95]`). Subtitles are restrained to `text-sm md:text-base`.
- **Main Grid Container**: The grid holds operational sections (Sources, Tasks, etc.). Structural unity is achieved via a shared wrapper with restrained ambient framing:
  - `p-8 rounded-[2rem] border border-black/[0.04] dark:border-white/[0.04] bg-white/40 dark:bg-void-800/40 backdrop-blur-md`
- **Gaps**: Use `gap-16` between major vertical sections to prevent sprawling, and keep inner grid/card gaps constrained (e.g., `gap-4` for stat grids, `gap-8 md:gap-10 lg:gap-12` for source tile flex wraps).

## Decorative Ambient Framing

- Do not use large, visually noisy "glows" (like raw `radial-gradient` backgrounds that obscure data).
- The identity is maintained via precise touches (e.g., small shadow blurs behind status indicators, or structural glassmorphism) rather than wide background color washes.

## Empty and Sparse Data States

- Use the standardized `EmptyState` component for unified typography and iconography placement when a primary list or grid is empty (e.g. "No Active Streams"). Avoid custom dashed borders and ad-hoc layouts.
- For structural sidebar panels (like Telemetry) that lack data, ensure padding remains consistent (`p-8`) with other surfaces and maintain the unified height and styling of the component as if it were full.
