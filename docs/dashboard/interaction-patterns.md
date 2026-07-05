# Interaction Patterns

The dashboard UI uses a set of shared interaction tokens to ensure standard easing, timing, and reduced-motion compliance across all functional views. This foundational approach avoids arbitrary delays and keeps the motion vocabulary unified.

## Overview

We export two sets of tokens to accommodate different styling approaches:

When components use standard interaction contracts, they dynamically apply durations and easings via inline `style` tags referencing `useInteractionTokens`.
- **`useInteractionTokens`** (from `tokens.ts`): Provides CSS transition durations (e.g., `"150ms"`) and CSS easings.
- **`INTERACTION_CSS_VARIABLES`** and **`buildInteractionTransition`** (from `tokens.ts`): Provide CSS custom-property based contracts such as `--interaction-control-feedback-duration` and a helper for composing transition strings without hardcoded timing.
- **`useGsapInteractionTokens`** (from `constants.ts`): Provides GSAP-compatible numeric durations (e.g., `0.15`) and string easings suitable for GSAP tweens.

## Interaction Contracts

Use the standard interaction definitions when designing animations:

1. **`controlFeedback`**
   - *Use Case:* Immediate responsive interactions on form controls, button overlays, icon feedback, select triggers, hover/focus/active states, toggle switches, and short message swaps inside an existing feedback surface.
   - *Pacing:* Fast.

2. **`enterExit`**
   - *Use Case:* Standard surfacing and removal of overlay elements, modals, dialogs, popovers, preview/browser window states, transport banners, and feedback containers.
   - *Pacing:* Base/Standard.

3. **`expansionCollapse`**
   - *Use Case:* Accordions, collapsible sections, drop-down menus revealing content inline.
   - *Pacing:* Base/Standard with smooth easing.

4. **`selectionMovement`**
   - *Use Case:* Animating active indicators, selected ledger rows, session cards, tab indicators, Stats mode details, and micro-movements where a selected item changes state without changing layout.
   - *Pacing:* Fast.

5. **`listReveal`**
   - *Use Case:* Staggered or simple unhiding of list items when content loads, filters expand, menus reveal grouped items, or a feed receives an initial batch.
   - *Pacing:* Base/Standard.

6. **`listReorder`**
   - *Use Case:* Repositioning items in sorted ledgers, toast stacks, task cards, drag surfaces, or virtualized windows after filtering, sorting, or removal.
   - *Pacing:* Fast.

7. **`inlineValidation`**
   - *Use Case:* Showing field-level validation errors, cancellation nudges, invalid submit cues, and bouncy validation recovery. To ensure accessible validation recovery on failed form submissions, automatically shift focus to the first invalid field.
   - *Pacing:* Fast with spring/bounce easing.

8. **`asyncFeedback`**
   - *Use Case:* Slower, deliberate reveal of asynchronous operation results, progress bars, toast entrance, `ActionFeedbackRegion`, planning progress, preview operation feedback, and live/runtime notifications.
   - *Pacing:* Slow and linear to ensure visibility.

## Implemented Surface Contracts

Current refined dashboard surfaces use the interaction contracts as follows:

| Surface | Motion contracts | State communication |
| --- | --- | --- |
| Shared primitives (`Button`, `Select`, `DropdownMenu`, `ConfirmDialog`, `ActionFeedbackRegion`) | `controlFeedback`, `enterExit`, `expansionCollapse`, `inlineValidation`, `asyncFeedback` | Native `disabled` where possible; normalized `aria-disabled`; fixed feedback icon slots; `aria-busy` on pending controls or regions; status/alert live regions for async results. |
| Quicksprint panel | `enterExit`, `listReveal`, `selectionMovement`, `expansionCollapse`, `controlFeedback`, `asyncFeedback` | Browse, edit, and configure phases announce through a shared polite status region; picker controls expose expanded/selected state; planning suppresses duplicate requests; destructive template removal uses confirmation; cancel/status copy remains visible under reduced motion. |
| Sprint ledger | `controlFeedback`, `selectionMovement`, `listReorder`, `expansionCollapse`, `asyncFeedback` | Sort, filter, selection, and bulk-action changes are composed into one polite live-region message; selected and pending rows retain static badges; bulk delete uses `ConfirmDialog`; focus returns to the delete trigger or a ledger fallback after dialog teardown. |
| Live runtime | `controlFeedback`, `enterExit`, `expansionCollapse`, `selectionMovement`, `listReveal`, `listReorder`, `asyncFeedback` | Reconnect, stale, refreshing, and recovering states keep the last runtime snapshot visible with polite live regions; disconnected transport and blocking errors are assertive; pending runtime actions remain focus-stable with `aria-disabled` plus activation suppression. |
| Browser preview, file, and diff workbench | `controlFeedback`, `enterExit`, `selectionMovement`, `listReveal`, `listReorder`, `asyncFeedback` | Preview launch/rebuild/stop/navigation/script/log operations expose visible async status; unavailable links remain keyboard reachable as disabled link controls with persistent reasons; stale iframe/log content remains mounted during refresh when useful content exists. |
| Settings workspace | `controlFeedback`, `selectionMovement`, `enterExit`, `inlineValidation`, `asyncFeedback` | Scope/category changes expose selected, pending, inherited, overridden, and disabled-reason text; saves use active-panel `aria-busy` plus `ActionFeedbackRegion`; provider removals use inline confirmation with cancel and focus restoration; fields preserve current draft values while loading or saving. |
| Global search | `enterExit`, `listReveal`, `controlFeedback`, `selectionMovement` | The input remains the combobox focus owner with `aria-activedescendant`; stale results remain available with `aria-busy`; unavailable rows expose a visible disabled reason and suppress pointer and keyboard activation; active rows are scrolled within the result container only. |
| Memory workspace | `controlFeedback`, `selectionMovement`, `listReveal`, `listReorder`, `expansionCollapse`, `inlineValidation`, `asyncFeedback` | Search/filter/selection changes announce counts and selected state; background refresh or failed refresh keeps the last useful list visible; batch delete uses confirmation, optimistic feedback, retry, and focus restoration; reduced motion keeps badges, rings, and live-region copy for selected graph/list state. |
| Task cards and active streams | `controlFeedback`, `selectionMovement`, `listReorder`, `asyncFeedback` | Status, dependency blockers, no-review/in-progress/failed QA states, PR/live metadata, edit/delete actions, pending dispatch, optimistic saving, and pointer-only drag limitations are visible without hover-only disclosure; repeated controls keep task-specific accessible names while disabled reasons are exposed through descriptions, stable badges, fixed metadata slots, `aria-busy`, and reduced-motion-safe copy. |

## Cross-Surface Interaction Rules

- Preserve stale data when a surface already has a useful snapshot or list and the new request is a refresh, reconnect, retryable load failure, or transient stale state. Mark the affected region with `aria-busy` when it is actively updating, add polite status copy, and visually dim or badge the stale content without blocking valid actions.
- Show an honest empty state when the committed query or filter set has no results. Do not keep stale content for a new committed search that legitimately returns no matches.
- Disabled or unavailable controls need a durable reason. Use visible helper text, a status badge, `aria-describedby`, or `title`; do not depend on click-time announcements from native disabled controls.
- Destructive dashboard actions use `useConfirmDialog` and `ConfirmDialog` when confirmation is required. The dialog must name the destructive target, trap focus, support Escape/cancel, expose pending progress when applicable, and restore focus to the initiating control or a safe page fallback.
- Focus restoration applies to overlays, menus, destructive confirmations, async feedback controls that remove themselves, and route-changing controls. If the original trigger has disappeared or become unusable, move focus to a named route region, ledger/list fallback, `[data-focus-fallback]`, `[role="main"]`, or `body`.
- Reduced motion is not reduced information. When token durations resolve to `0` or `"0ms"`, keep static state cues such as borders, rings, badges, count chips, progress text, `aria-busy`, disabled-reason copy, and live-region messages.
- Data interactions should announce the result of the operator action, not every visual frame. Sort changes, committed filters, selection counts, bulk-operation starts/completions, active search result changes, memory list changes, and runtime invocation-count summaries should use concise polite live-region text. Blocking errors and disconnected live transport remain assertive.
- Repeated async controls must include target-specific accessible names, suppress duplicate activation while pending, and keep stable icon/text slots so labels and hit targets do not jump when spinners or result icons appear.

## Accessibility & Async Feedback

When announcing asynchronous feedback (e.g., via Toasts, ActionFeedbackRegion, or NotificationPanel), motion is secondary to screen reader announcements.
- Ensure that the container uses proper ARIA attributes, typically `aria-live="polite"` or `aria-live="assertive"` with `aria-atomic="true"` so that the full context is announced when it appears.
- Visual movement (like a toast sliding in) must not interfere with the user's focus or block standard keyboard interaction.
- Use polite announcements for loading, empty, success, pending, background refresh, reconnect attempts that do not block the current view, and stale-data notices. Use assertive announcements only for blocking errors, failed saves, unavailable preview containers, disconnected live transport, and destructive confirmations that require immediate operator attention.
- `aria-busy` belongs on the control or region affected by async work. Keep stale content visible during background refresh whenever the source area already owns cached data, such as Stats, Tasks, Sprints, Overview telemetry, and Live runtime panels.
- `ActionFeedbackRegion` announces pending states politely, exposes pending progress with `aria-busy`, announces blocking errors assertively, and leaves success states with `aria-live="off"` after the pending announcement. Error feedback persists until dismissed or cleared; do not auto-dismiss a blocking error. Retry, dismiss, and clear-error controls keep stable slots, target-specific labels, focus fallback, and duplicate retry suppression while a retry is pending.
- Toasts use `asyncFeedback` for entrance, `enterExit` for dismissal, and `listReorder` when the non-error stack compacts. Non-error toast overflow may dismiss older items, but error toasts remain in the dedicated error stack until the user or caller removes them. Retry actions remain visible, suppress duplicate activation while pending, and do not dismiss a blocking error toast by themselves.
- Cancellation that the operator requested, such as sprint planning cancellation, is warning feedback rather than error feedback. Keep it visible until the operator dismisses it or starts another action.
- Stale-data and background-refresh states must preserve the last useful content when cached data exists. Use a polite status message, `aria-busy` on the updating region when applicable, and visible copy such as "Refreshing", "Updating", or "Stale Data" rather than replacing the surface with a spinner-only state.
- Pending actions must suppress duplicate activation and expose the blocked reason through visible status text, `title`, or `aria-describedby`. Do not rely on click-time announcements from disabled controls.
- Destructive confirmations must use a named dialog, focus trap, explicit confirm/cancel controls, and progress semantics for hold-to-confirm. Reduced motion may remove progress animation timing, but visible percent text, progressbar attributes, and cancellation copy remain required.
- No critical action or state may be disclosed by hover alone. Hover-revealed affordances must also be reachable by keyboard focus, or the action must remain persistently visible.

## Shared Control States

Shared dashboard controls use `SHARED_INTERACTION_CLASSES`, `useInteractionTokens`, and the dashboard focus ring variables for hover, focus-visible, active, disabled, pending, and selected feedback. Button-like controls suppress click handlers whenever native `disabled`, `aria-disabled`, or pending state is active, while loading controls expose `aria-busy` and keep static icons or colors visible when motion is reduced. Select triggers expose stable expanded, selected, disabled, and listbox relationship state through ARIA attributes.

Pending and success feedback must not resize controls. Shared buttons and icon buttons keep fixed feedback slots for spinners and status icons, and select triggers preserve their trigger dimensions while overlays animate independently with interaction tokens.

Disabled native buttons do not fire activation handlers. Disabled reasons therefore belong in visible status text, `aria-describedby`, `title`, or persistent badges, not only in click-time announcements.

## Reduced Motion

All interaction timings automatically respect the user's system preferences or dashboard settings for reduced motion (`prefers-reduced-motion: reduce`).

**How it works:**
- When a user prefers reduced motion, the aforementioned hooks (`useInteractionTokens`, `useGsapInteractionTokens`) automatically resolve all duration values to `0` or `"0ms"`.
- This ensures visual state changes happen instantly while preserving logical flows and React/Preact lifecycle events that depend on state transitions.
- Do not hardcode custom fallback logic for `duration`. Use the hooks, and the components will naturally skip the animation timing.
- Decorative or continuous animations (e.g., GSAP, SVG `<animate>`, Tailwind flow) must be explicitly disabled. State-communicating animations must be replaced with static visual equivalents (like badges or colored shadows) rather than simply being removed, to preserve state comprehension.
- Shared visual primitives use tokenized static cues in reduced motion: status dots retain semantic halos, active wave fills remain visible without drifting, sparklines render as static lines, and live duration flashes use an instant inset Signal Jade highlight.
- Browser rails, task cards, Stats charts, telemetry feeds, and shell navigation may still change state under reduced motion, but they must snap to the new state and keep visible static cues for selection, focus, warning, progress, and connection state.
- Avoid animation-only communication. Every spinner, pulse, drag movement, chart transition, progress change, or status flash must have a static text, badge, color, outline, `aria-busy`, live-region, or label equivalent that remains available when reduced motion resolves durations to `0` or `0ms`.

## Overlay Transitions & Focus Management

All standard overlays (Dialog, DropdownMenu, Popover, Tooltip, ConfirmDialog) adhere to specific rules for transitions and accessibility:

1. **Transitions:** Overlays must use the `enterExit` or `controlFeedback` tokens (via `useInteractionTokens()` or `useGsapInteractionTokens()`) rather than hardcoded durations (e.g., `150ms`). These hooks ensure that `prefers-reduced-motion` settings automatically disable CSS transitions or set GSAP durations to 0.
2. **Focus Restoration:** Dialogs, DropdownMenus, and Popovers must reliably restore focus to the element that triggered them when they close through Escape, outside click, cancel/action buttons, or controlled state changes. Close handlers cache the `document.activeElement` during the `isOpen` state change and restore with `.focus({ preventScroll: true })` so fixed dashboard chrome does not jump.
3. **Safe Fallback Focus:** If the original trigger is removed, disabled, hidden, inert, or otherwise unusable when an overlay closes, focus must move to a safe page fallback such as `[data-overlay-focus-fallback]`, `[data-focus-fallback]`, `main`, `[role="main"]`, `#root`, or finally `document.body`. Fallback targets may receive `tabindex="-1"` programmatically so keyboard users are not left with focus on a removed overlay node.
4. **Menu Keyboard Navigation:** Dropdown menus and lists utilizing arrow key navigation should use standard roles (e.g., `role="menuitem"`) and ensure their querying logic explicitly ignores `disabled` or `aria-disabled="true"` elements to ensure users do not become trapped on non-interactive items. `Home` and `End` move to the first and last enabled item; Escape must prevent default key handling, close the overlay, and restore focus without page scroll jumps.
5. **Focus Trapping:** Active focus traps must gracefully handle empty containers or containers with dynamically hidden content. If no valid focusable descendants exist, the container itself receives focus. Traps must filter out hidden, disabled, inert, or `aria-hidden="true"` elements when calculating focus boundaries.
6. **Scroll Management:** When native `element.scrollIntoView()` triggers unwanted whole-page layout shifts or window bouncing in nested `overflow-y-auto` panels, replace it by calculating bounding client rects (`element.getBoundingClientRect()`) against the container and adjusting `container.scrollTop` manually.

Global search follows the same overlay rules. Its open/close GSAP timeline uses `enterExit`, `listReveal`, and `controlFeedback` interaction tokens; the result list keeps stale matches visible during background refresh with `aria-busy`, a polite live status, and visual dimming. Arrow-key navigation updates the combobox `aria-activedescendant`, skips unavailable rows when an activatable option exists, and keeps the active row visible by adjusting the overlay result scroller, not the page scroll position. If every result is disabled or unavailable, navigation keeps a deterministic inactive row referenced so the combobox never points at `-1`, while Enter remains non-activating. Disabled or unavailable rows stay visible with a persistent reason badge, `aria-disabled`, and activation suppression for pointer and keyboard selection.

## Menu & Popover Keyboard Expectations
DropdownMenus and Popovers are expected to be fully keyboard accessible:
- Triggers cloned into these components preserve caller's `ref`, `onClick`, `onKeyDown`, `aria-label`, and disabled behavior while augmenting `aria-haspopup`, `aria-expanded`, and `aria-controls`.
- Menus open via `Enter`, `Space`, `ArrowDown`, or `ArrowUp`. Opening via `ArrowDown`, `Enter`, or `Space` focuses the first item, while `ArrowUp` focuses the last item.
- Arrow navigation inside the menu works in a looping fashion (ArrowDown goes down, ArrowUp goes up) and skips disabled items. `Home` and `End` keys jump to the first and last enabled items respectively.
- Popovers that act as dialogs trap focus inside themselves. Popovers acting as tooltips do not trap focus. Both close on `Escape` and restore focus to their trigger.

## Shell, Selector, And Workbench Controls

- Top-nav project and sprint selectors, the Tasks page sprint scope selector, Browser session controls, and file/change selectors use listbox-style keyboard behavior: trigger opens with `Enter`, `Space`, `ArrowDown`, or `ArrowUp`; options move with arrows; `Home`/`End` jump; `Escape` closes and restores focus.
- Tabbed workspaces such as Stats ledgers and Git telemetry leaderboards use `tablist` semantics with arrow-key movement and `tabpanel` relationships. Pressed button groups such as Stats visual modes may use `aria-pressed` when the behavior is a command-style view toggle rather than a tab panel.
- Dialog and destructive confirmation flows must keep focus trapped while open, expose a stable accessible name, and restore focus after close. Hold-to-confirm progress should be described with stable `aria-describedby` text instead of noisy live updates; cancellation, completion, and loading states should be visible on the control itself for pointer and keyboard users.
- Route changes triggered by shell links, task links, Browser controls, or sprint/task selectors must leave the destination with a named page landmark. If focus is programmatically moved, use `preventScroll` where possible to avoid jumping fixed shell chrome.
- Keyboard-only users must be able to operate Browser chrome, session rail actions, settings forms, task/sprint selectors, stats filters, command menus, and compact mobile controls without hover-only disclosure.
- Task cards and active stream rows keep status, dependency blockers, QA review state, PR/live duration metadata, drag limitations, and inline actions readable without requiring hover. Pointer drag remains pointer-only; reduced-motion users receive static drag-disabled messaging instead of keyboard drag-and-drop.
- Kanban task cards keep Edit/Delete actions persistently reachable with fixed hit targets. Dependency chips distinguish blocked, resolved, in-progress, QA-failed, and unknown dependencies inline; task cards also expose PR pending/ready, live runtime, QA review, optimistic saving, focus, pressed, dragging, and reduced-motion states through static text, borders, badges, and accessible labels.

See the [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md) for verification expectations.

## Verification Guidance

For documentation-only changes to dashboard interaction guidance, run the dashboard typecheck and verify entrypoint links and anchors:

```bash
pnpm run typecheck:dashboard
rg "Interaction Patterns|Shared Primitive Design System|Dashboard Interaction Contracts" docs/index.md docs/SUMMARY.md
rg "stale data|disabled|ConfirmDialog|reduced motion|aria-busy|asyncFeedback" docs/dashboard/interaction-patterns.md docs/dashboard/design-system-shared-primitives.md docs/dashboard/dashboard-guide.md
```

For dashboard UI changes, run focused component tests for the touched surface first, then the repository dashboard suite and dashboard typecheck:

```bash
pnpm exec vitest run <focused dashboard test files>
pnpm run test:dashboard
pnpm run typecheck:dashboard
```

Run `pnpm run build` when changes touch shared contracts, routing, CSS token boundaries, imports, or production bundling behavior. Do not record a check as passed unless it was run for the current change.
