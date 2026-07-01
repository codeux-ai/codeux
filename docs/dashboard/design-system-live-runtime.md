# Live Runtime Visual System

The dashboard's Live page and runtime components follow a distinct visual system optimized for an operational command surface. Under pressure, it is crucial that the interface provides high trust and fast scanability.

## Core Principles

1. **Calmer Operational Command Surface**: The live runtime avoids excessive visual noise. Surfaces and panels prioritize clear, calm presentation of status and controls without heavy decorative backgrounds.
2. **Standardized Containers**: Component wrappers (like task cards, panels, event feeds) use a unified semantic container style rather than bespoke styling.
   - Standard background: `bg-white dark:bg-void-800` (often represented by semantic `--surface-glass` in overarching design tokens).
   - Standard borders: `border border-black/[0.08] dark:border-white/[0.08]` (or `--border-hairline`).
   - Standard shadows: `shadow-sm` (or `--elevation-base`).
   - We avoid heavy glassmorphism (`backdrop-blur-2xl`), large shadows, and colored gradient backgrounds.
3. **No Heavy Effects**: Decorative animations and SVGs like `WaveFluid` or `BorderTrace` are removed from the live runtime. State changes (active, paused, idle, error) are communicated through restrained visual cues (e.g., standard status color dots, labels, or badges) rather than intense background shifts.
4. **Accessible Status Language**: Information density is balanced. Event feeds, idle states, error banners, and attention ledgers have distinct, well-spaced empty/loading/error treatments that don't compete with active controls.
5. **High-Trust Queue Rows**: Attention queue, invocation feed, sprint run, dispatch, and connection rows use the same compact row language: `text-xs` primary labels, `text-[10px]` mono metadata, rounded-right rows, and a narrow left rail colored by severity or status.
6. **Runtime-First Hierarchy**: Execution Runtime panels present compact summary tiles first, then bounded Sprint Runs and Dispatch Queue sections with status chips, clear empty states, and scroll-contained lists.

## Data & Performance Constraints

- **Indexed Execution History:** To maintain linear performance in dashboard live runtime metrics over large execution sets, construct and pass down an `IndexedExecutionHistory` instead of repeatedly scanning full arrays with `Array.prototype.filter` ($O(T \times (D + E))$ vs $O(T + D + E)$). When retrieving records from the index, return an empty array if an entry doesn't exist rather than falling back to the unindexed array.

## Operational State Hierarchy

- **Idle**: Clean empty states with minimal animation, inviting the start of a sprint.
- **Active**: Crisp, clear execution feed and task cards. Focus is on data and controls.
- **Paused / Intervention**: Attention items and blocked states are clearly labeled but visually separated to not overwhelm.
- **Recovering / Error**: Disconnects or errors use restrained alert styling (e.g., standard red/amber borders) rather than full-screen takeovers.
- **Stopped**: A stable final state reflecting the completed execution.

By adhering to these rules, the Live page remains a focused, professional workspace.

## Accessibility Rules

- Event feeds and timelines should use `role="log"` or `role="region"` with clear `aria-label`s.
- Transient elements must handle focus properly.
- Action buttons (claim, resolve, dismiss, cancel, etc.) must include accessible labels specifying their target item.
- Runtime confirmation dialogs are portaled to `document.body`, use a viewport-fixed overlay, restore focus with `preventScroll`, and should not focus `document.body` when the originating action disappears after a resolve/dismiss mutation.
- Confirmation dialogs must preserve strong dark-mode contrast: title/body copy should use near-white slate tones on `void` surfaces, and toned header panels should remain readable without relying on low-opacity text.
- Attention item resolve confirmations use the success tone; dismiss confirmations use the neutral tone so operators can distinguish completion from clearing noise.
- Popover triggers should let the shared `Popover` own open/close toggling; child trigger handlers must not toggle the same state a second time.
- Dropdown menu content may wrap menu items in layout containers; nested `role="menuitem"` descendants are still enhanced for keyboard behavior and staggered entrance animation.
- Animations for spinners must be `motion-safe`.

## Sidebar Row Rails
- The left rail is the primary distinction marker for dense sidebar feeds. Use `border-l-2` on compact rows rather than large icons, tall cards, or heavy colored backgrounds.
- Success/completed/online states use green, active/running/listening states use signal, queued/pending/paused/cancel-requested states use amber, and failed/blocked/cancelled states use red.
- Row containers should stay quiet (`bg-black/[0.015]` or `dark:bg-white/[0.015]`) with a subtle state hover. Avoid gradients and oversized type in sidebar feeds.

## Responsive Layouts
- Live Runtime panels enforce strict boundaries by adding `min-w-0` to large grid columns (e.g., `xl:col-span-8 flex flex-col gap-5 min-w-0`) to prevent blowout.
- Dense runtime data (like stat grids in ExecutionRuntimePanel and AttentionQueuePanel) switch from 2 columns to 3 or 4 columns at the `sm` or `md` breakpoints to avoid squeezing content.
- Header actions and connections labels natively `flex-wrap` to handle touch-friendly interactions on phones and constrained layouts without losing controls.

## Performance Constraints

- **Execution History Indexing**: To maintain linear performance over large execution sets (i.e. sprints with numerous tasks, dispatches, and runtime events), you must build a scoped index (keyed by task ID, dispatch ID, or run ID) of dispatches and runtime events *before* constructing per-task live timing summaries. Using simple `Array.prototype.filter` or scanning repeatedly for every task introduces $O(T \times (D + E))$ complexity, while leveraging indexed lookups ensures $O(T + D + E)$. When constructing sprint or batch-level dashboard summaries, always compute or pass down an `IndexedExecutionHistory`.
