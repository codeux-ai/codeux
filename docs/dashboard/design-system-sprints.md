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

### Sprint Ledger (Table/List)

*   **Responsive Ledger Pattern:** Uses the shared `Table` contract with `mobileLabel` mapping for narrow screens. Rows stack gracefully, ensuring that sprint name, status, completion, dates, selection, pin state, and row controls remain discoverable without horizontal scrolling. Row controls and bulk action bars use flexible, touch-friendly layouts that wrap cleanly to prevent text clipping. Fixed-position inline menus (like row actions) use viewport-clamping to remain usable near screen edges.
*   **Rows & Headers:** Refined row heights, consistent padding, and clear separators. Column headers must align perfectly with their corresponding data.
*   **Metadata Hierarchy:** Prioritize sprint names and status. Secondary metadata (dates, task counts) should be styled as supporting information (e.g., smaller text, muted colors).
*   **Interactive Elements:** Row action menus and bulk actions should have clear active/hover states, unified menu padding, and consistent icon scaling.
*   **Badges & Indicators:** Status badges, linked issue tags, and progress indicators should use consistent border radii, padding, and semantic color schemes.
*   **Selection, Sorting, And Bulk Actions:** Row selection uses visible check controls plus polite live-region summaries for selected counts. Select-all applies to the full filtered ledger result, not only the rendered window. Selected rows use `selectionMovement`; sort/filter/window changes use `listReorder`; the bulk action bar uses expansion/collapse motion and stays usable under reduced motion by retaining static selected-count and pending-action copy.
*   **Pending Actions:** Bulk start, pin, unpin, and delete controls disable duplicate submissions, keep their accessible names specific to the active operation, expose disabled reasons through visible status text/title, and keep row action triggers discoverable even when disabled by pending delete or row-level work.
*   **Focus And Confirmation:** Bulk delete opens the shared destructive `ConfirmDialog`, announces cancellation or deletion through the ledger live region, and restores focus to the initiating delete control or the ledger fallback if the control is no longer available. Pending row work sets row-level busy state and visible pending badges so reduced-motion users do not depend on spinners or row movement.

### Sprint Action State Management

*   **Async Operations:** For dashboard v2 asynchronous sprint actions (like starting, pausing, toggling showcase, or completing sprints), use the shared `SprintPageActionRunner` to handle pending states, optimistic UI updates, and data refresh cycles, preventing duplicated async state management.

### Quicksprint Panel

*   The panel should present templates clearly with a balanced layout.
*   Large template catalogs must use horizontally scrollable template rails grouped by purpose or source. Rails should preserve a two-row card layout by default and continue horizontally for additional templates instead of expanding into unbounded vertical lists.
*   Template cards should use stable dimensions across hover, focus, selected, and loading states. Icon, title, description, tag, and metadata content must wrap or truncate within the card without resizing neighboring cards.
*   Left and right rail controls should be icon buttons with accessible names, visible focus states, disabled states when no further scrolling is available, and hit targets appropriate for touch and pointer input.
*   Rails must not clip cards, focus rings, or scroll controls on desktop, tablet, or mobile. Horizontal overflow should be owned by the rail, not the page, so the rest of the Sprints layout remains fixed to the viewport width. The Quicksprint panel must not introduce a nested vertical scroll trap; vertical wheel input over the panel or rail must scroll the surrounding page instead of being consumed by the horizontal rail or an internal panel scroller.
*   Icons and template tags should adhere to the shared color palette and scale.
*   Focus and hover states should align with the global interaction patterns.
*   Phase movement between browse, configure, and editor states uses `enterExit`, `listReveal`, `selectionMovement`, and `controlFeedback`. Phase changes update a polite status region, configure headings receive focus with `preventScroll`, and selected/open states have static labels or borders when reduced motion resolves timing to zero.

### Sprint Composer

*   Visual alignment with the rest of the sprints workspace.
*   Consistent treatment for async feedback states, planning ETA indicators, and linked issue chips.
*   The expanded task append flows should transition smoothly and maintain context.
*   Planning, replan, append, and prompt-improvement requests use client request IDs and `ActionFeedbackRegion`. The composer form sets `aria-busy` while a request is active, disables duplicate controls, preserves current field values, and exposes a `PlanningProgressOverlay` with cancel and "New Sprint" recovery actions when available.
*   Pending planning uses polite live-region feedback and `asyncFeedback`; blocking request failures use persistent assertive errors with retry actions; operator cancellation uses a non-auto-dismissing warning. On validation failure, custom validation runs because native validation is disabled, and focus moves to the first missing required field.
*   Composer entry and field stagger use modal/list reveal timing and resolve to instant state changes under reduced motion. Reduced motion must not remove required progress, cancel, warning, or error copy.
*   Quicksprint planning buttons expose `aria-busy` for the active request, describe disabled controls through the visible busy status, and keep the combined prompt expansion available through `aria-expanded`/`aria-controls`.

### Task Cards And Active Streams

*   Kanban task cards use `controlFeedback` for hover/focus/action controls and `listReorder` for card drag/reorder movement. Status and drag GSAP feedback stays in the task-card motion helper.
*   Cards expose task ID, title, status, priority, dependency blockers, QA review state, session metadata, PR links, and live duration without hover-only disclosure. Status changes and live duration updates use polite announcements; exact text remains visible/static for reduced-motion users.
*   Overview Active Streams task rows keep a compact operational density: duration is visible at rest, row actions use icon-only controls with accessible names and titles, and desktop controls reveal on hover or keyboard focus without expanding into labeled pills. Mobile layouts may keep the compact icon group visible to preserve touch access.
*   Pointer drag is pointer-only. In reduced motion, draggable reordering is disabled and the card exposes static "drag disabled" copy instead of relying on movement.
*   Destructive task deletion opens `ConfirmDialog` before invoking delete callbacks and restores focus through the shared confirmation flow.

### Action Menus & Import Surfaces

*   **Shared Menu Styling:** Consistent padding, icon scale, and hover tones across all dropdowns and action menus.
*   **Accessibility:** Clear keyboard focus states and distinct disabled treatments (e.g., visual dimming combined with descriptive tooltips or explicit disabled attributes).
*   **Viewport Clamping:** Fixed and absolute menus must clamp to max-w-[calc(100vw-2rem)] to prevent horizontal scroll clipping on smaller screens.

## Sprint Page Async Action Pattern

All asynchronous sprint actions (such as starting, pausing, toggling showcase state, or marking as complete) MUST use the shared `SprintPageActionRunner`. This ensures:
*   **Preventing Duplicate Submissions:** Automatically filters out actions that are already pending using `pendingActionIds`.
*   **Optimistic UI:** Safely applies and reverts optimistic visual statuses.
*   **Error Handling and Cleanup:** Centralizes `try/catch/finally` blocks, ensuring data grids refresh (via `refresh()` and `refreshExecution()`) before surfaces display errors via `setError`, keeping the system state perfectly aligned with backend truth.

## Verification Notes

For documentation-only updates, run `pnpm run lint` and confirm discoverability with:

```bash
rg "interaction|reduced motion|aria-busy|asyncFeedback" docs/dashboard docs/index.md docs/SUMMARY.md
```

For Sprints UI changes, the focused dashboard coverage currently includes `dashboard/src/v2/components/ui/__tests__/SprintComposer.test.tsx`, `dashboard/src/v2/components/sprints/__tests__/SprintLedger.accessibility.test.tsx`, and `dashboard/src/v2/components/tasks/__tests__/KanbanTaskCard.integration.test.tsx`. Run those directly with `pnpm exec vitest run <files>` when changing those components, because `pnpm run test:dashboard -- <files>` runs the full `tests/dashboard` tree first.
