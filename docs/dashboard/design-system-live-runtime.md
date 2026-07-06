# Live Runtime Visual System

The dashboard's Live page and runtime components follow a distinct visual system optimized for an operational command surface. Under pressure, it is crucial that the interface provides high trust and fast scanability.

Live runtime implementation must also follow the bounded live snapshot, indexed execution history, and pure dashboard view-model contracts in [Code Quality And Performance Contracts](../architecture/code-quality-performance-contracts.md).

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
- **Execution Runtime Aggregation:** `ExecutionRuntimePanel` render-time aggregation belongs in `dashboard/src/v2/lib/live-session/execution-runtime-view-model.ts`. Keep active runs, active dispatches, active connections, pending inbox totals, visible row slices, attention and failure counters, and dispatch-event lookup derivations in that pure helper so the panel renders from a memoized view model instead of recalculating filters per row.
- **Live Task Card Derivation:** `dashboard/src/v2/lib/live-session-view-model.ts` owns the task-card runtime index for the Live Session page. Build per-derivation indexes over visible tasks, dispatches, runtime events, and invocations before constructing card props so `LiveTaskCard` stays visual/interactive and does not perform runtime collection lookups.

## Live Task Card Boundary

- `LiveTaskCard` owns task-level composition: status chrome, prompt expansion, runtime-feed toggles, PR links, rerun modal wiring, edit actions, and force-complete actions.
- `live-session/LiveTaskTiming.tsx` owns the reusable timing badges used by task cards and dispatch rows. `QuotaCountdown` parses retry-after metadata and preserves the polite quota live region; `TaskDuration` derives visible elapsed time and only starts a ticking interval while the display is live.
- `live-session/LiveTaskInvocationRow.tsx` owns the task-scoped invocation row visual language: purpose labels, provider/model fallbacks, token/duration chips, reduced-motion-safe running indicators, error snippets, and encoded transcript links.
- Keep `QuotaCountdown` and `TaskDuration` re-exported from `LiveTaskCard.tsx` until downstream imports have migrated, because runtime panels still consume those compatibility exports.

## Operational State Hierarchy

- **Idle**: Clean empty states with minimal animation, inviting the start of a sprint.
- **Active**: Crisp, clear execution feed and task cards. Focus is on data and controls.
- **Paused / Intervention**: Attention items and blocked states are clearly labeled but visually separated to not overwhelm.
- **Recovering / Stale / Error**: Reconnecting, background refresh, and stale snapshot states use polite status banners and keep cached runtime content visible. Disconnected transport and connection errors use restrained assertive alert styling (e.g., standard red/amber borders) rather than full-screen takeovers.
- **Stopped**: A stable final state reflecting the completed execution.

By adhering to these rules, the Live page remains a focused, professional workspace.

## Snapshot Preservation

- Runtime panels must preserve the last useful execution snapshot during reconnecting transport, first-snapshot recovery, stale snapshots, background refresh, and retryable load failures. Do not replace existing sprint runs, dispatches, invocations, connections, or attention items with spinner-only states while cached data exists.
- Each affected panel should show `RuntimeSnapshotSurfaceBadge` in the header and a visible `RuntimeSnapshotSurfaceNotice` near the panel content. The notice is a polite live region and should explain whether the panel is refreshing cached data or showing a stale snapshot.
- Set `aria-busy="true"` on affected runtime regions/logs while the snapshot surface is reconnecting, recovering, or stale. The busy state marks the surface as updating, but the useful cached rows remain readable and keyboard reachable.
- Initial loading copy is still valid when no execution snapshot exists. Once a snapshot has rendered, recovery and stale states are additive overlays, not replacements.

## Interaction And Notification Contracts

- Use `controlFeedback` for runtime action buttons, attention queue controls, connection controls, compact filter buttons, and local status icon/message changes.
- Use `enterExit` for transport banners, confirmation dialogs, popovers, dropdowns, and runtime notification panels entering or leaving the view.
- Use `selectionMovement` for filter selection, active runtime row emphasis, selected feed rows, and small status/detail refreshes that orient the operator without changing the reading order.
- Use `listReveal` when invocation, dispatch, attention, connection, or event-feed rows first appear. Reduced-motion mode should snap rows to the final state while retaining static rails, status dots, badges, and live-region copy.
- Use `listReorder` when queue/feed rows move after resolve, dismiss, filtering, sorting, or removal. Filtered task lists should preserve focus and use tokenized reorder timing rather than changing reading order through animation-only cues.
- Use `inlineValidation` for destructive-hold cancellation or validation-style nudges in runtime controls.
- Use `asyncFeedback` for non-blocking runtime notifications, reconnect progress, stale-snapshot messaging, and long-running operation results.
- `LiveTransportBanner` derives disconnected/recovering/error state from the live transport view model and adds UI-only stale-snapshot messaging from `snapshotUpdatedAt`. Refreshing and stale banners are polite and keep cached runtime panels visible. Disconnected transport and blocking connection errors are urgent and assertive.
- Runtime panels should not use animation as the only notification. Loading, running, stale, empty, reconnecting, and error states need visible text or badges plus live-region semantics.
- Runtime action buttons use `aria-disabled` for optimistic pending states when focus should remain stable, suppress activation while pending or unavailable, and expose the current reason through the visible label, `title`, or screen-reader status text.
- Runtime action buttons must also keep a text status inside the control for pending outcomes such as `Pausing in progress.`, `Cancelling in progress.`, or `Retrying in progress.`. The status text is a polite live region so progress is communicated even when motion is reduced or disabled.
- Reconnect, retry, claim, release/resolve, dismiss, filter, and invocation-detail controls must be target-specific. Accessible names should identify the sprint, dispatch, attention item, filter, or invocation; pending controls must suppress duplicate activation and expose `aria-busy`, `aria-disabled`, and a reason such as "already in progress."
- Cancel and force-cancel runtime controls are destructive and must request confirmation before invoking backend actions. Confirmation copy should name the target sprint run or dispatch using the user-facing sprint name, task key, or task title rather than an opaque runtime ID when that label is available.
- The action dispatcher must guard pending runtime actions with an immediate in-memory pending set, not only rendered disabled state, so rapid repeat activation cannot submit duplicate pause, cancel, retry, rerun, claim, resolve, dismiss, or force-cancel requests before the next render.
- Collapsible connection, execution, and invocation panels use `expansionCollapse` and keep their headings/buttons keyboard reachable. Collapsed content must have `aria-expanded`/`aria-controls`; reduced motion snaps height changes while preserving status rows and labels.
- Container-first image builds use the shared container build progress infobox. It consumes the backend progress contract (`kind`, `imageTag`, `baseImage`, `message`, optional `progressPercent`, optional `stepText`) from runtime events, invocation metadata, session activity, or interactive-login messages. Waiting and building states stay visible until superseded; `build_success` becomes a cached-image success state and `build_failure_fallback` becomes an amber fallback alert. Reused cached images do not render this infobox unless a progress object is present.
- The build infobox must include visible explanatory copy, the current step text or message, and `role="progressbar"`. Set bounded `aria-valuenow` only when `progressPercent` is known; otherwise omit it and show visible fallback text such as `Progress is not available yet.` Do not rely on color alone for build, success, or fallback state.

## Transport, Invocations, And Attention Queue

- Transport recovery is a page-level state. The banner announces disconnected transport and blocking connection errors assertively; reconnecting, refreshing, and stale states are polite and do not interrupt the operator's current task.
- Invocation feeds should keep existing rows during refresh, expose a polite feed summary, and use assertive copy only for operator-level blocking failures. Transcript links should include the invocation purpose and a shortened invocation ID so repeated transcript controls are distinguishable.
- Attention queues should keep open, claimed, resolved, and cleared counts visible through refresh. Claim, resolve/release, and dismiss actions stay focus-stable while pending and report outcome or in-progress feedback without causing repeated submissions.
- Force-complete task controls require destructive confirmation and then show both card-level pending copy and page-level async feedback. The task card keeps the current runtime snapshot readable while the completion request is in flight, suppresses repeated activation, and reports the named task on success or failure.
- Routine polling ticks should not create new announcements. Announce meaningful operator outcomes: disconnect, recovery state changes, failed invocation summaries, action pending/success/error states, and filter result changes.

## Accessibility Rules

- Event feeds and timelines should use `role="log"` or `role="region"` with clear `aria-label`s.
- Invocation, execution, connection, and attention panels should expose loading with polite `role="status"` and `aria-busy="true"`. Active runtime logs may set `aria-busy` while work is still running, but stale data and background refresh notices should remain polite and avoid replacing cached rows.
- Transient elements must handle focus properly.
- Action buttons (claim, resolve, dismiss, cancel, etc.) must include accessible labels specifying their target item.
- Runtime confirmation dialogs are portaled to `document.body`, use a viewport-fixed overlay, restore focus with `preventScroll`, and should not focus `document.body` when the originating action disappears after a resolve/dismiss mutation.
- Confirmation dialogs must preserve strong dark-mode contrast: title/body copy should use near-white slate tones on `void` surfaces, and toned header panels should remain readable without relying on low-opacity text.
- Attention item resolve confirmations use the success tone; dismiss confirmations use the neutral tone so operators can distinguish completion from clearing noise.
- Popover triggers should let the shared `Popover` own open/close toggling; child trigger handlers must not toggle the same state a second time.
- Dropdown menu content may wrap menu items in layout containers; nested `role="menuitem"` descendants are still enhanced for keyboard behavior and staggered entrance animation.
- Animations for spinners must be `motion-safe`.
- Error toasts and blocking runtime errors persist until dismissed, resolved, or superseded by a successful recovery. Non-blocking refresh/reconnect/stale notices remain polite so they do not interrupt the operator's current focus.
- Under reduced motion, transport banners, feed updates, duration flashes, row emphasis, and spinner states must snap to their final visual state while retaining static rails, badges, labels, `aria-busy`, and live-region text.
- Stale-data and first-snapshot recovery states must not hide cached execution data. If cached rows exist, keep them rendered and add polite stale/refreshing copy; use assertive alerts only for disconnected transport, blocking connection errors, or failed invocation summaries.

## Sidebar Row Rails
- The left rail is the primary distinction marker for dense sidebar feeds. Use `border-l-2` on compact rows rather than large icons, tall cards, or heavy colored backgrounds.
- Success/completed/online states use green, active/running/listening states use signal, queued/pending/paused/cancel-requested states use amber, and failed/blocked/cancelled states use red.
- Row containers should stay quiet (`bg-black/[0.015]` or `dark:bg-white/[0.015]`) with a subtle state hover. Avoid gradients and oversized type in sidebar feeds.

## Responsive Layouts
- Live Runtime panels enforce strict boundaries by adding `min-w-0` to large grid columns (e.g., `xl:col-span-8 flex flex-col gap-5 min-w-0`) to prevent blowout.
- Dense runtime data (like stat grids in ExecutionRuntimePanel and AttentionQueuePanel) switch from 2 columns to 3 or 4 columns at the `sm` or `md` breakpoints to avoid squeezing content.
- Header actions and connections labels natively `flex-wrap` to handle touch-friendly interactions on phones and constrained layouts without losing controls.
- Feeds and lists should be bounded with dynamic viewport max heights (e.g., `max-h-[50dvh] sm:max-h-96`) and dense data strings (like IDs and payloads) should wrap using `break-all` or `break-words` rather than expanding the page.

## Performance Constraints

- **Execution History Indexing**: To maintain linear performance over large execution sets (i.e. sprints with numerous tasks, dispatches, and runtime events), you must build a scoped index (keyed by task ID, dispatch ID, or run ID) of dispatches and runtime events *before* constructing per-task live timing summaries. Using simple `Array.prototype.filter` or scanning repeatedly for every task introduces $O(T \times (D + E))$ complexity, while leveraging indexed lookups ensures $O(T + D + E)$. When constructing sprint or batch-level dashboard summaries, always compute or pass down an `IndexedExecutionHistory`.

## Verification Notes

For documentation-only updates, run `pnpm run lint` and:

```bash
rg "interaction|reduced motion|aria-busy|asyncFeedback" docs/dashboard docs/index.md docs/SUMMARY.md
```

For Live Runtime UI changes, include focused tests for the touched panel or transport component where they exist, plus `pnpm run test:dashboard` when the change affects shared runtime feedback, toasts, or motion tokens.
