# Code UX Projects Design System

This document outlines the design system for the Projects page and related components.

## Goals

*   **Gallery Feel:** Treat the projects view as a deliberate gallery, not just a list of independent effects.
*   **Clear Hierarchy:** Ensure selection, setup, health, and action states have a clear, readable visual hierarchy.
*   **Restrained Atmosphere:** Maintain the Code UX atmosphere (signal and ember accents) but tone down competing visual noise (excessive waves, glows, watermarks).

## Project Cards

### Layout & Density

*   Use appropriate grid spacing to allow cards to breathe while maintaining density.
*   Truncate long text (like project names or paths) cleanly using `min-w-0` correctly on card columns to avoid pushing elements off edge.
*   Align footers consistently at the bottom of the card.
*   Ensure stat tiles have balanced proportions.

### Responsive Design

*   **Grid Sizing:** Use `minmax(min(100%,320px),1fr)` instead of a rigid `320px` to prevent overflow on very narrow viewports.
*   **Mobile Headers:** Stack the page header and status pills vertically on narrow screens, switching to horizontal on tablet/desktop.
*   **Action Wrapping:** Allow card actions, filter tabs, page actions, and setup dialog buttons to wrap (`flex-wrap` or `flex-col-reverse sm:flex-row`) to prevent horizontal overflow or clipping.
*   **Dialogs:** Ensure inline dialogs (like Setup) have a maximum height (`max-h-[calc(100vh-2rem)]`) with internal scrolling (`overflow-y-auto`) and stack their primary actions (`flex-col-reverse`) on small viewports.

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
*   **Validation Timing:** Required-field validation should appear after blur or invalid submit, not while the user is still choosing a source. Invalid submit uses one announced summary, moves focus to the first invalid field, and scrolls within the modal body using reduced-motion-aware behavior. Inline errors stay visually adjacent and are wired through `aria-errormessage` without creating duplicate alert announcements.
*   **Source & Setup Motion:** Source-type changes, init-mode changes, and setup-scope reveals use shared interaction motion tokens (`listReveal`/related tokenized transitions). Reduced-motion mode must snap instantly while keeping the same selected states and live status text.
*   **Directory Picker Feedback:** The directory browser must show and politely announce loading, current path changes, empty child-directory lists, failed loads, and selected-path confirmation without stealing focus from Browse, navigation, refresh, or directory buttons.
*   **Submit Outcomes:** While project creation is pending, close/cancel/submit controls expose a disabled or busy reason. Failed submissions keep the modal open and present retryable feedback; retries submit the same form contract without changing backend request shapes.

## Page Composition

*   Build filter labels, counts, and visible-project state through `projects-page-view-model.ts`; intervention projects remain part of the All total without appearing in Running, Idle, or Failed.
*   Render loading, load-error, collection-empty, and filtered-empty surfaces inside the named project-card region. Keep New Project in the page header and Add Project reachable from the grid or blocking error surface.
*   Use the shared `ProjectCard` and `AddProjectCard` components in an auto-filling grid sized with `minmax(min(100%, 320px), 1fr)` so the page cannot force horizontal overflow.
*   Keep setup dialogs bounded to the viewport, place setup choices in an internally scrolling body, and stack footer actions on narrow screens.
