# Tasks Page Design System

## Core Aesthetic: Refined Production Board

The Tasks page and Kanban board should feel like a 'Refined Production Board'. It prioritizes clear state scannability, exact layout, and reduced visual noise.

## 1. Board & Lanes
*   **Containers:** Use precise framing with subtle inner shadows and distinct but calm borders (e.g., `border-black/[0.06] dark:border-white/[0.06]`).
*   **Workbench Rhythm:** The sprint selector, filter strips, and list window selector should sit in a single quiet workbench bar. Controls must wrap as a unit on small screens rather than scattering around the page header.
*   **Headers:** Lane headers should establish hierarchy using a compact icon well, `font-display` for main titles, and monospace count chips. Keep lane headers low-profile so task cards remain the primary scan target.
*   **Counts:** Use restrained chips for counts (e.g., `bg-black/[0.03] dark:bg-white/[0.03]`) rather than bold solid colors, unless indicating a critical bottleneck.
*   **Empty States:** Empty lanes should be visually quiet, with dashed hairline borders, stable minimum height, and a single sentence describing whether the empty state comes from sprint/project scope or active filters.

## 2. Kanban Cards
*   **Structure:** Cards must have consistent internal spacing and an explicit hierarchy: task ID + status, priority, title, execution/agent metadata, source/assignee, dependencies, then duration/PR/age footer.
*   **Metadata Treatment:** Prefer labeled metadata rows or compact grids over many equivalent chips. Executor, agent, and session values should use the same subdued border/background language and preserve operational detail.
*   **Elevation:** Default to a flat appearance with a subtle hairline border (`border border-black/[0.06]`) and a narrow semantic status rail. Do not combine waves, traces, heavy borders, and stacked chips on the same idle card.
*   **State Emphasis:** Running, coding-completed, and QA-failed/review-adjacent cards may use a restrained border trace. Reduced-motion mode must disable animated trace/drag motion while preserving the status rail.
*   **Hover State:** On hover, elevate the card slightly (`translate-y-[-2px]`), increase shadow softly, and add only a very soft background tint (e.g., `bg-signal-500/[0.02]`).
*   **Typography:** Task titles (`h4`) should be highly legible, slightly condensed (`tracking-tight`), and robust (`font-bold`). To prevent unbroken strings from causing horizontal overflow in narrow components (e.g., task cards), apply `break-words` and `whitespace-normal` to multiline text elements like titles.
*   **Wrapping:** Do not truncate critical operational data such as task IDs, session IDs, source paths, assignees, agent names, PR labels, or action labels. Use `min-w-0`, `break-words`, `break-all` for path/ID-like values, and `flex-wrap` so long values wrap inside the card instead of expanding the lane.

## 3. Status & Execution Metadata
*   **Unified Status System:** All task-related metadata—priority, dependencies, and execution state—must share a consistent visual language.
*   **Dependencies:**
    *   Completed: Green accent (`bg-status-green/[0.08] text-status-green`).
    *   In Progress/Ready: Signal (cyan) accent (`bg-signal-500/[0.08] text-signal-500`).
    *   Blocked/Pending: Muted slate (`bg-slate-400/[0.08] text-slate-500`).
    *   Unknown dependencies should keep muted dashed borders and expose the missing task ID/title to assistive technology.
*   **Execution Meta:** Use distinct but subtle icons (Cpu, User), uniform spacing, and wrapping chips. Live duration badges should remain visible in the card footer and may flash only when live timing first appears or changes.

## 4. Compose & Edit Affordances (Modals/Composers)
*   **Surface:** Use glassmorphism (`backdrop-blur-2xl bg-white/78 dark:bg-void-800/72`) for the main composer surface.
*   **Fields:** Form fields should have clear hit areas, distinct borders that highlight on focus (`focus-visible:ring-signal-500`), and consistent typography.
*   **Validation:** Error states must be visually distinct but non-disruptive, using red accents (`text-red-500`) and clear iconography (AlertCircle) below or beside the field. Ensure text does not cause layout jumping.

## 5. General Rules
*   **Accessibility:** Preserve `focus-visible` styles on all interactive elements. Use `sr-only` text for screen readers where visual data is primarily conveyed via color or icons. Task cards must use `aria-live="polite"` regions to announce status changes (optimistic, pending, QA review). Keyboard reordering is not currently supported; if draggable elements are pointer-only, this must be explicitly stated in `.sr-only` text. All hover-revealed action controls must become visible and reachable on keyboard focus (`focus-within`). For row-level action controls, always include the specific item's name or identifier in the `aria-label` and `title` attributes.
*   **Layout Constraints:** When configuring responsive grids for dense content like Kanban boards, default to a single-column layout on mobile and delay switching to multiple columns until larger viewports (e.g., `lg:` or `xl:` breakpoints) to ensure individual columns remain wide enough to be readable.
*   **Motion:** Respect `isReducedMotion` or `prefers-reduced-motion` for hover elevations and transitions.
*   **Responsiveness:** Use responsive wrapping (`flex-wrap`) on control bars and footers to ensure labels, metadata, controls, and PR links do not overlap or break layout on narrow viewports. Ensure dropdowns and text elements use `min-w-0` and `truncate` or `break-words` safely so they don't blow out the viewport or board layout. Kanban columns should collapse to a single column on phones and only switch to two columns on larger viewports when readable (e.g. `lg:grid-cols-2`).
*   **Architecture (View Models):** Maintain a clear view-model boundary for task board rendering (e.g., using `buildTaskBoardViewModel`). Ensure filtering, enrichment, column counts, and card view-model construction are extracted into pure helpers rather than recalculating them piecemeal inside `TasksPage` components.
