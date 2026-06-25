# Code UX Projects Design System

This document outlines the design system for the Projects page and related components.

## Goals

*   **Gallery Feel:** Treat the projects view as a deliberate gallery, not just a list of independent effects.
*   **Clear Hierarchy:** Ensure selection, setup, health, and action states have a clear, readable visual hierarchy.
*   **Restrained Atmosphere:** Maintain the Code UX atmosphere (signal and ember accents) but tone down competing visual noise (excessive waves, glows, watermarks).

## Project Cards

### Layout & Density

*   Use appropriate grid spacing to allow cards to breathe while maintaining density.
*   Truncate long text (like project names or paths) cleanly.
*   Align footers consistently at the bottom of the card.
*   Ensure stat tiles have balanced proportions.

### Visual Style

*   **Backgrounds:** Use subtle translucency (glassmorphism) with appropriate contrast for light and dark modes.
*   **Borders:** Use delicate borders (`border-black/[0.06]` or `border-white/[0.06]`).
*   **Accents:** Reserve strong accents (like Ember and Signal) for interactive elements, selection states, and active status indicators.
*   **Noise Reduction:** Minimize large background watermarks, persistent wave animations, and excessive glows unless representing a critical active state (like `running`).

### State Management

*   **Default:** Subtle styling, clean lines.
*   **Hover:** Gentle lift or border highlight. Show contextual actions.
*   **Selected:** Clear visual indicator (e.g., active border or ring).
*   **Running/Active:** Distinctive but restrained pulsing or color shift to indicate background activity.
*   **Status Indicators:** Use small, consistent dots or icons to represent health (running, failed, idle).

## Add Project Modal & Setup Surfaces

*   **Consistency:** Align forms, field styling, segmented options, directory browsers, and CTAs across the Add Project modal and any other setup overlays.
*   **Hierarchy:** Keep form sections clearly separated.
