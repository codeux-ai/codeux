# Tasks Page Design System

## Core Aesthetic: Refined Production Board

The Tasks page and Kanban board should feel like a 'Refined Production Board'. It prioritizes clear state scannability, exact layout, and reduced visual noise.

## 1. Board & Lanes
*   **Containers:** Use precise framing with subtle inner shadows and distinct but calm borders (e.g., `border-black/[0.06] dark:border-white/[0.06]`).
*   **Headers:** Lane headers should establish hierarchy using `font-display` for main titles and monospace text (`font-mono`) for metadata (like counts or tags).
*   **Counts:** Use restrained chips for counts (e.g., `bg-black/[0.03] dark:bg-white/[0.03]`) rather than bold solid colors, unless indicating a critical bottleneck.
*   **Empty States:** Empty lanes should be visually quiet, with dotted borders or subtle backgrounds to indicate they are active but empty, avoiding heavy text.

## 2. Kanban Cards
*   **Structure:** Cards must have consistent internal spacing. Align title, priority, status, dependency, execution metadata, assignee/agent, and progress information cleanly.
*   **Elevation:** Default to a flat appearance with a subtle hairline border (`border border-black/[0.06]`).
*   **Hover State:** On hover, elevate the card slightly (`scale-102` or `translate-y-[-2px]`), increase shadow (`shadow-[0_4px_24px_rgba(0,0,0,0.12)]`), and potentially add a very soft background tint (e.g., `bg-signal-500/[0.02]`).
*   **Typography:** Task titles (`h4`) should be highly legible, slightly condensed (`tracking-tight`), and robust (`font-bold`).
*   **Truncation:** Ensure long text in tags (like source, agent name, dependency titles) properly truncates without breaking layout (`truncate max-w-[...]`).

## 3. Status & Execution Metadata
*   **Unified Status System:** All task-related metadata—priority, dependencies, and execution state—must share a consistent visual language.
*   **Dependencies:**
    *   Completed: Green accent (`bg-status-green/[0.08] text-status-green`).
    *   In Progress/Ready: Signal (cyan) accent (`bg-signal-500/[0.08] text-signal-500`).
    *   Blocked/Pending: Muted slate (`bg-slate-400/[0.08] text-slate-500`).
*   **Execution Meta:** Use distinct but subtle icons (Cpu, User) and uniform spacing.

## 4. Compose & Edit Affordances (Modals/Composers)
*   **Surface:** Use glassmorphism (`backdrop-blur-2xl bg-white/78 dark:bg-void-800/72`) for the main composer surface.
*   **Fields:** Form fields should have clear hit areas, distinct borders that highlight on focus (`focus-visible:ring-signal-500`), and consistent typography.
*   **Validation:** Error states must be visually distinct but non-disruptive, using red accents (`text-red-500`) and clear iconography (AlertCircle) below or beside the field. Ensure text does not cause layout jumping.

## 5. General Rules
*   **Accessibility:** Preserve `focus-visible` styles on all interactive elements. Use `sr-only` text for screen readers where visual data is primarily conveyed via color or icons.
*   **Motion:** Respect `isReducedMotion` or `prefers-reduced-motion` for hover elevations and transitions.
