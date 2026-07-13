# Code UX Sprints Design System

This document outlines the design system for the Sprints page and related planning components.

## Goals

*   **Coherent Information Architecture:** Planning, gallery browsing, sprint ledger management, imports, and quicksprint actions must share a unified visual structure.
*   **Premium Visual Rhythm:** Elements should have consistent density, shared spacing scales, and deliberate typographical hierarchy to feel like a single workspace.
*   **Clear Primary Actions:** Primary planning actions (creating sprints, browsing templates) should be obvious and prominent, without crowding out secondary actions (import, export, settings).

## Component Guidelines

### Sprints Page Header & Layout

*   The header should establish the workspace context clearly.
*   Gallery visibility controls should be easily accessible but not dominate the primary actions. The gallery toggle belongs at the far left of the top header action row, before the sprint summary pills, while import/quicksprint/new commands sit in the lower command row on narrow screens.
*   Empty states and placeholders must guide users toward the next logical step (e.g., selecting a project, creating a sprint) with a polished, on-brand visual treatment.
*   Organic sprint gallery cells use the same shared ambient shadow underlay as dashboard project cells: `ORGANIC_CELL_SHADOW_CLASS` from `dashboard/src/v2/components/ui/organic-cell-styles.ts`. Keep the underlay animated with the same organic motion class as the cell body so the sprint and project gallery cells keep identical background depth.
*   Organic sprint cell action rails may reveal on hover, but they must also reveal on `focus-within` and remain visible when reduced motion resolves animation timing to zero. Status, intervention, review, blocked, running, and completion cues need static text, borders, badges, or icons so motion is never the only signal.
*   Sprint gallery start/stop controls use `controlFeedback` for hover/focus changes and `asyncFeedback` for pending loaders. Pending controls expose target-specific labels such as "Start sprint <name> is pending", set `aria-busy`, suppress duplicate clicks, and keep fixed icon/button slots while the loader replaces the icon.

### Sprint Ledger (Table/List)

*   **Responsive Ledger Pattern:** Uses the shared `Table` contract with `mobileLabel` mapping for narrow screens. Rows stack gracefully, ensuring that sprint name, status, completion, dates, selection, pin state, and row controls remain discoverable without horizontal scrolling. Row controls and bulk action bars use flexible, touch-friendly layouts that wrap cleanly to prevent text clipping. Fixed-position inline menus (like row actions) use viewport-clamping to remain usable near screen edges.
*   **Rows & Headers:** Refined row heights, consistent padding, and clear separators. Column headers must align perfectly with their corresponding data.
*   **Metadata Hierarchy:** Prioritize sprint names and status. Secondary metadata (dates, task counts) should be styled as supporting information (e.g., smaller text, muted colors).
*   **Interactive Elements:** Row action menus and bulk actions should have clear active/hover states, unified menu padding, and consistent icon scaling.
*   **Scoped Navigation:** Card and ledger **Tasks** / **Live** actions use router links rather than document-level anchors. Both `projectId` and `sprintId` travel as search state so the destination can activate the project before resolving the sprint without reloading the dashboard shell.
*   **Badges & Indicators:** Status badges, linked issue tags, and progress indicators should use consistent border radii, padding, and semantic color schemes. Gallery cells, ledger rows, active streams, task-board selectors, and chat sprint cards share the same completion display contract: clamp to `0..100`, round to at most one decimal, omit a trailing `.0`, and use that same numeric value for visible text, bar width, accessible descriptions, and `aria-valuenow` where a semantic progressbar is present.
*   **Completion Source:** Sprint completion is the average of task lifecycle weights and task-coding `provider_invocations.tool_call_count`, while completed / total copy remains a raw task-status count. Planning, CI-fix, QA, and other non-coding invocation telemetry must not affect completion.
*   **Selection, Sorting, Filtering, And Bulk Actions:** Row selection uses visible check controls plus a single polite parent ledger status region for selected counts and specific select-all, deselect-all, filter-pruning, search, sort, list-window, bulk-start, bulk-completion, and destructive-confirmation outcomes. Result announcements must summarize the changed operation, rendered count, filtered result count when windowed, and selected count without re-announcing the table. Header counters and the bulk action bar may keep static visible count copy, but they must not create competing live announcements for the same operator action. Select-all applies to the full filtered ledger result, not only the rendered window. Sort headers always expose explicit `aria-sort` values (`ascending`, `descending`, or `none`), keep stable column labels, describe the current and next sort direction with button descriptions, and use fixed-size visible direction text/icons that remain legible without hover. Selected rows use `selectionMovement`; sort/filter/window changes use `listReorder`; the bulk action bar uses expansion/collapse motion and stays usable under reduced motion by retaining static selected-count and pending-action copy.
*   **Pending Actions:** Bulk start, pin, unpin, and delete controls disable duplicate submissions, keep fixed label/icon slots while showing `aria-busy`, expose disabled reasons through visible status text/title/descriptions, and switch visible labels to non-motion progress verbs such as "Starting" or "Deleting" while work is pending. Row action triggers remain discoverable even when disabled by pending delete or row-level work. Row selection, pin, menu, start/stop, and pause/resume disabled states must set `aria-disabled` when unavailable and keep visible badges or reason copy such as "Delete pending", "Bulk action pending", or "Wait for the current sprint action to finish." Disabled row controls should share a stable described-by reason so assistive technology receives the same state users can see. Row start/stop and pause/resume controls keep their action labels stable, add visible pending reason text, set `aria-busy` on the target button, and leave sprint status/progress badges visible while work is pending. Row mark-complete/delete/pin work uses row-level busy state plus static pending badges so reduced-motion users do not depend on spinner movement.
*   **Focus And Confirmation:** Single-row and bulk delete open the shared destructive `ConfirmDialog`, name the target sprint or selected count, list the affected selected sprint names before confirmation, suppress duplicate pending activation, support Escape/cancel, announce confirmed deletion or cancellation through the ledger live region, and restore focus after dialog teardown to the initiating delete control or the ledger fallback if the control is no longer available. Destructive cancellation copy must explicitly state that the sprint or selected sprints were not deleted; confirmation copy must state that deletion has been confirmed and is in progress.

### Sprint Action State Management

*   **Rollback identity:** Completed standard sprints expose **Rollback Sprint** in their action menu. The assessment modal explains whether the rollback can run automatically or requires an agent and provides an optional instruction textarea; any non-empty instruction forces the agent path. Rollback sprints use an orange gallery surface, border, badge, and ledger-row treatment with visible `Rollback` text, so color is not the only distinction. The orange identity does not replace normal status, progress, CI, review, or attention semantics.

*   **Sprint Attention Indicator:** `SprintAttentionIndicator` gives gallery cells and ledger rows one attention-state contract derived from the effective sprint status presentation. Failed sprint execution takes precedence and uses a red-bordered outer treatment plus a pulsing exclamation indicator. Eligible human-owned intervention uses the same red outer treatment plus a compact person/`zZZ` waiting indicator. Both states retain the normal status, progress, review, links, and actions. Worker- and system-owned transient pauses must not be presented as human intervention.
*   **Semantic Labels:** The indicator is a semantic status named `Sprint execution failed` or `Sprint waiting for human intervention`; its icon and decorative `zZZ` text are hidden from assistive technology. Do not replace these labels with color, border, animation, or icon-only meaning.
*   **Motion And Density:** Attention animation uses the shared motion timing and `motion-safe`/`motion-reduce` contract. Reduced-motion mode removes the failure pulse and waiting bounce while keeping the red border, indicator, visible copy, and semantic status mounted. The ledger variant remains compact, and desktop attention borders continue across every table cell while mobile preserves the complete row border and `mobileLabel` semantics.

*   **Async Operations:** For dashboard v2 asynchronous sprint actions (like starting, pausing, toggling showcase, or completing sprints), use the shared `SprintPageActionRunner` to handle pending states, optimistic UI updates, and data refresh cycles, preventing duplicated async state management.
*   **Delete Flow Ownership:** Sprint card and ledger action menus do not own their own destructive delete confirmation. The menu item closes the menu and delegates to the page-owned sprint delete dialog so the user sees one shared destructive confirm flow per delete action.
*   **Interaction Contracts:** Sprint cards and ledger controls use `controlFeedback` for hover/focus/button transitions, `selectionMovement` for row and select-all selection changes, `listReorder` for sort/filter/window changes, `expansionCollapse` for bulk action bar disclosure, and `asyncFeedback` for pending loaders and busy-state transitions. Do not introduce one-off timing constants for these surfaces.

### QA Review And CI Workflow Badges

*   **Independent Signals:** Lifecycle, QA, CI, and human-attention treatments remain independently readable. Neither the blue requested-change QA badge nor a CI failure replaces the sprint's running, paused, completed, or failed status.
*   **QA State Contract:** A pass uses a green check; a running review uses signal-colored progress; completed `changes_requested` uses a blue pencil and **QA edits** semantics; provider/runtime `failed`, `errored`, or `cancelled` uses a red X and **QA failed** semantics. Requested changes are an actionable verdict and must never be styled or announced as provider failure.
*   **QA Details:** `SprintReviewBadge` opens its named, viewport-level region on hover, focus, or activation. It exposes outcome, summary, findings, fix instructions, target task key, reviewer, reviewed time, and follow-up specifications when present. Keep it open while pointer or focus remains in the trigger/card pair; dismiss on outside pointer/touch or pointer departure without contained focus; close on `Escape` and restore trigger focus.
*   **Follow-Up Disclosure:** Generated follow-up specifications start collapsed. Each **Follow-up task N** button owns `aria-expanded` and `aria-controls`; expansion reveals title, description, priority, dependency task keys, and the full Markdown prompt. Clamp the card to the viewport, bound prompt/card scrolling, use one column on constrained widths, and preserve all text, focus rings, and disclosure state when reduced motion removes pulse, spin, rotation, and transition movement.
*   **CI Steps:** `CiStatusBadge` always describes Pull request, Checks, and Merge. Pending uses a neutral clock, in-progress uses signal progress, successful uses a green check, and failed uses a red X. Sprint aggregation applies failed > in-progress > pending > successful across the newest state for every task workflow and the final main-merge workflow.
*   **Failure Semantics:** Red X is limited to failed checks, merge conflicts, or failed merge attempts. Review blockers stay pending as **Waiting for review** after passed checks. Merge conflicts fail Merge and retain the **Merge conflict** label; QA provider failure remains in the separate QA badge.
*   **Durable Projection:** Sprint CI derives from the newest persisted `ci_gate_status` event per task and `main_merge_gate_status` event for the final merge, ordered by creation time and event ID, plus active open/claimed CI-repair attention. Persisted merge metadata is fallback evidence. Project snapshots rehydrate this state after restart/reconnect; newer settled events and resolved attention clear stale failures instead of allowing historical events to reappear.

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
*   Planning, replan, append, and prompt-improvement requests use client request IDs and `ActionFeedbackRegion`. The composer form sets `aria-busy` while a request is active, disables duplicate controls, preserves current field values, and exposes a `PlanningProgressOverlay` with cancel and "New Sprint" recovery actions when available. The overlay renders ETA/elapsed telemetry with the shared planning feedback ship-visual contract, using transform-based offscreen entry/exit phases and a static midpoint course under reduced motion.
*   The shared sprint/quicksprint ETA overlay should keep ETA and elapsed timers legible, visually separate, and stable while the progress vessel moves. The vessel may exit the right side of the course and respawn offscreen on the left, but the progressbar label, staged status copy, and control row must remain static enough to scan during the loop.
*   Reduced-motion mode must remove continuous travel and decorative SVG animation while preserving the static course, ETA/elapsed timers, progressbar semantics, visible status copy, and all cancel/minimize/recovery controls. Motion can clarify state, but it must never be the only indication that planning is active or cancellable.
*   Interactive visual affordances inside the ETA overlay, including the coffee reminder easter egg, must use real button semantics, explicit accessible labels, visible focus rings, `aria-pressed` or status copy when state changes, and event handling that does not trigger backdrop dismissal. Activating the affordance must not hide `Minimize`, `New Sprint` / `New Quicksprint`, or request cancellation controls.
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
