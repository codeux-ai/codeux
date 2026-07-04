# Code UX Sprints Design System

This document outlines the design system for the Sprints page and related planning components.

## Goals

*   **Coherent Information Architecture:** Planning, gallery browsing, sprint ledger management, imports, and quicksprint actions must share a unified visual structure.
*   **Premium Visual Rhythm:** Elements should have consistent density, shared spacing scales, and deliberate typographical hierarchy to feel like a single workspace.
*   **Clear Primary Actions:** Primary planning actions (creating sprints, browsing templates) should be obvious and prominent, without crowding out secondary actions (import, export, settings).

## Component Guidelines

### Sprints Page Header & Layout

*   The header should establish the workspace context clearly.
*   Gallery visibility controls should be easily accessible but not dominate the primary actions.
*   Empty states and placeholders must guide users toward the next logical step (e.g., selecting a project, creating a sprint) with a polished, on-brand visual treatment.
*   The empty-project placeholder, composer stage, gallery add-card, import affordances, and ledger shell should use the same structural depth: `--surface-glass`, `--border-hairline`, `--elevation-base`, and restrained `backdrop-blur-2xl`. Avoid bespoke heavy shadows or standalone translucent fills for one section when an adjacent planning section uses shared glass tokens.
*   Metadata chips in the page header and placeholder panels should use `--text-metadata`, compact uppercase tracking, and small icon scales so they read as planning context rather than competing calls to action.

### Sprint Ledger (Table/List)

*   **Responsive Ledger Pattern:** Uses the shared `Table` contract with `mobileLabel` mapping for narrow screens. Rows stack gracefully, ensuring that sprint name, status, completion, dates, selection, pin state, and row controls remain discoverable without horizontal scrolling. Row controls and bulk action bars use flexible, touch-friendly layouts that wrap cleanly to prevent text clipping. Fixed-position inline menus (like row actions) use viewport-clamping to remain usable near screen edges.
*   **Rows & Headers:** Refined row heights, consistent padding, and clear separators. Column headers must align perfectly with their corresponding data and inherit the shared table glass header treatment instead of introducing route-specific header panels.
*   **Metadata Hierarchy:** Prioritize sprint names, the single status/attention label, and progress. Secondary metadata (dates, task counts, short IDs) uses `--text-metadata` and inline text treatments instead of multiple pill backgrounds.
*   **Selection State:** Selected rows must remain visible through `aria-selected`, a Signal border/ring treatment, and a subtle desktop left rail. Do not rely only on icon changes to communicate selection.
*   **Interactive Elements:** Row action menus, row controls, and bulk actions should use the same rounded-xl control language, focus rings, icon sizing, disabled opacity, and pending spinners. Destructive actions keep status-red text/focus accents.
*   **Badges & Indicators:** Status badges, linked issue tags, review badges, human-intervention badges, and progress indicators should use consistent border radii and semantic colors. Merge, CI, and intervention attention states should map into the existing Status, Signal, and Ember language rather than adding new blue/purple hues.
*   **Mobile Row Readability:** The ledger wrapper should only force desktop table width at large breakpoints. Mobile card rows should preserve `mobileLabel` text, allow long sprint names to break naturally, and keep action buttons `whitespace-nowrap` inside wrapping control rows.

### Sprint Action State Management

*   **Async Operations:** For dashboard v2 asynchronous sprint actions (like starting, pausing, toggling showcase, or completing sprints), use the shared `SprintPageActionRunner` to handle pending states, optimistic UI updates, and data refresh cycles, preventing duplicated async state management.

### Quicksprint Panel

*   The panel should present templates clearly with a balanced layout.
*   Icons and template tags should adhere to the shared color palette and scale.
*   Focus and hover states should align with the global interaction patterns.

### Sprint Composer

*   Visual alignment with the rest of the sprints workspace.
*   Consistent treatment for async feedback states, planning ETA indicators, and linked issue chips.
*   The expanded task append flows should transition smoothly and maintain context.
*   Composer transitions should feel attached to the gallery and ledger surface. When the composer replaces the gallery, keep surrounding glass depth and metadata typography consistent rather than switching to a modal-like visual layer.

### Action Menus & Import Surfaces

*   **Shared Menu Styling:** Consistent padding, icon scale, and hover tones across all dropdowns and action menus.
*   **Accessibility:** Clear keyboard focus states and distinct disabled treatments (e.g., visual dimming combined with descriptive tooltips or explicit disabled attributes).
*   **Viewport Clamping:** Fixed and absolute menus must clamp to max-w-[calc(100vw-2rem)] to prevent horizontal scroll clipping on smaller screens.
*   **Pending/Destructive States:** Showcase and delete menu actions must retain `aria-busy` or disabled states when pending. Delete actions should remain visibly destructive even when a caller passes a custom menu item class.

## Sprint Page Async Action Pattern

All asynchronous sprint actions (such as starting, pausing, toggling showcase state, or marking as complete) MUST use the shared `SprintPageActionRunner`. This ensures:
*   **Preventing Duplicate Submissions:** Automatically filters out actions that are already pending using `pendingActionIds`.
*   **Optimistic UI:** Safely applies and reverts optimistic visual statuses.
*   **Error Handling and Cleanup:** Centralizes `try/catch/finally` blocks, ensuring data grids refresh (via `refresh()` and `refreshExecution()`) before surfaces display errors via `setError`, keeping the system state perfectly aligned with backend truth.
