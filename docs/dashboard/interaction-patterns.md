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
   - *Use Case:* Immediate responsive interactions on form controls (e.g., hover/focus states, active scale, toggle switches).
   - *Pacing:* Fast.

2. **`enterExit`**
   - *Use Case:* Standard surfacing of overlay elements, modals, dialogs, and large popovers.
   - *Pacing:* Base/Standard.

3. **`expansionCollapse`**
   - *Use Case:* Accordions, collapsible sections, drop-down menus revealing content inline.
   - *Pacing:* Base/Standard with smooth easing.

4. **`selectionMovement`**
   - *Use Case:* Animating active indicators (like moving an active tab background) or micro-movements of selected items.
   - *Pacing:* Fast.

5. **`listReveal`**
   - *Use Case:* Staggered or simple unhiding of list items when a group of content loads or expands.
   - *Pacing:* Base/Standard.

6. **`listReorder`**
   - *Use Case:* Fluidly animating the repositioning of items in a drag-and-drop list or sorted table.
   - *Pacing:* Fast.

7. **`inlineValidation`**
   - *Use Case:* Showing field-level validation errors, shake animations, or bouncy cues for invalid inputs. To ensure accessible validation recovery on failed form submissions, automatically shift focus to the first invalid field (e.g., querying for `[aria-invalid="true"]`).
   - *Pacing:* Fast with spring/bounce easing.

8. **`asyncFeedback`**
   - *Use Case:* Slower, deliberate reveal of asynchronous operation results (e.g., Toast notifications, `ActionFeedbackRegion`, `NotificationPanel`).
   - *Pacing:* Slow and linear to ensure visibility.

## Accessibility & Async Feedback

When announcing asynchronous feedback (e.g., via Toasts, ActionFeedbackRegion, or NotificationPanel), motion is secondary to screen reader announcements.
- Ensure that the container uses proper ARIA attributes, typically `aria-live="polite"` or `aria-live="assertive"` with `aria-atomic="true"` so that the full context is announced when it appears.
- Visual movement (like a toast sliding in) must not interfere with the user's focus or block standard keyboard interaction.
- Use polite announcements for loading, empty, success, pending, background refresh, reconnect attempts that do not block the current view, and stale-data notices. Use assertive announcements only for blocking errors, failed saves, unavailable preview containers, disconnected live transport, and destructive confirmations that require immediate operator attention.
- `aria-busy` belongs on the control or region affected by async work. Keep stale content visible during background refresh whenever the source area already owns cached data, such as Stats, Tasks, Sprints, Overview telemetry, and Live runtime panels.

## Shared Control States

Shared dashboard controls use `SHARED_INTERACTION_CLASSES`, `useInteractionTokens`, and the dashboard focus ring variables for hover, focus-visible, active, disabled, pending, and selected feedback. Button-like controls suppress click handlers whenever native `disabled`, `aria-disabled`, or pending state is active, while loading controls expose `aria-busy` and keep static icons or colors visible when motion is reduced. Select triggers expose stable expanded, selected, disabled, and listbox relationship state through ARIA attributes.

Pending and success feedback must not resize controls. Shared buttons and icon buttons keep fixed feedback slots for spinners and status icons, and select triggers preserve their trigger dimensions while overlays animate independently with interaction tokens.

## Reduced Motion

All interaction timings automatically respect the user's system preferences or dashboard settings for reduced motion (`prefers-reduced-motion: reduce`).

**How it works:**
- When a user prefers reduced motion, the aforementioned hooks (`useInteractionTokens`, `useGsapInteractionTokens`) automatically resolve all duration values to `0` or `"0ms"`.
- This ensures visual state changes happen instantly while preserving logical flows and React/Preact lifecycle events that depend on state transitions.
- Do not hardcode custom fallback logic for `duration`. Use the hooks, and the components will naturally skip the animation timing.
- Decorative or continuous animations (e.g., GSAP, SVG `<animate>`, Tailwind flow) must be explicitly disabled. State-communicating animations must be replaced with static visual equivalents (like badges or colored shadows) rather than simply being removed, to preserve state comprehension.
- Shared visual primitives use tokenized static cues in reduced motion: status dots retain semantic halos, active wave fills remain visible without drifting, sparklines render as static lines, and live duration flashes use an instant inset Signal Jade highlight.
- Browser rails, task cards, Stats charts, telemetry feeds, and shell navigation may still change state under reduced motion, but they must snap to the new state and keep visible static cues for selection, focus, warning, progress, and connection state.

## Overlay Transitions & Focus Management

All standard overlays (Dialog, DropdownMenu, Popover, Tooltip, ConfirmDialog) adhere to specific rules for transitions and accessibility:

1. **Transitions:** Overlays must use the `enterExit` or `controlFeedback` tokens (via `useInteractionTokens()` or `useGsapInteractionTokens()`) rather than hardcoded durations (e.g., `150ms`). These hooks ensure that `prefers-reduced-motion` settings automatically disable CSS transitions or set GSAP durations to 0.
2. **Focus Restoration:** Dialogs, DropdownMenus, and Popovers must reliably restore focus to the element that triggered them when they close. This relies on caching the `document.activeElement` during the `isOpen` state change and using `.focus({ preventScroll: true })` after closing to prevent unexpected page jumps.
3. **Menu Keyboard Navigation:** Dropdown menus and lists utilizing arrow key navigation should use standard roles (e.g., `role="menuitem"`) and ensure their querying logic explicitly ignores `disabled` or `aria-disabled="true"` elements to ensure users do not become trapped on non-interactive items.
4. **Focus Trapping:** Active focus traps must gracefully handle empty containers or containers with dynamically hidden content. If no valid focusable descendants exist, the container itself receives focus. Traps must filter out hidden, disabled, inert, or `aria-hidden="true"` elements when calculating focus boundaries. Furthermore, if the original trigger is removed from the DOM, focus safely falls back to the document body.
5. **Scroll Management:** When native `element.scrollIntoView()` triggers unwanted whole-page layout shifts or window bouncing in nested `overflow-y-auto` panels, replace it by calculating bounding client rects (`element.getBoundingClientRect()`) against the container and adjusting `container.scrollTop` manually.

## Menu & Popover Keyboard Expectations
DropdownMenus and Popovers are expected to be fully keyboard accessible:
- Triggers cloned into these components preserve caller's `ref`, `onClick`, `onKeyDown`, `aria-label`, and disabled behavior while augmenting `aria-haspopup`, `aria-expanded`, and `aria-controls`.
- Menus open via `Enter`, `Space`, `ArrowDown`, or `ArrowUp`. Opening via `ArrowDown`, `Enter`, or `Space` focuses the first item, while `ArrowUp` focuses the last item.
- Arrow navigation inside the menu works in a looping fashion (ArrowDown goes down, ArrowUp goes up) and skips disabled items. `Home` and `End` keys jump to the first and last enabled items respectively.
- Popovers that act as dialogs trap focus inside themselves. Popovers acting as tooltips do not trap focus. Both close on `Escape` and restore focus to their trigger.

## Shell, Selector, And Workbench Controls

- Top-nav project and sprint selectors, the Tasks page sprint scope selector, Browser session controls, and file/change selectors use listbox-style keyboard behavior: trigger opens with `Enter`, `Space`, `ArrowDown`, or `ArrowUp`; options move with arrows; `Home`/`End` jump; `Escape` closes and restores focus.
- Tabbed workspaces such as Stats ledgers and Git telemetry leaderboards use `tablist` semantics with arrow-key movement and `tabpanel` relationships. Pressed button groups such as Stats visual modes may use `aria-pressed` when the behavior is a command-style view toggle rather than a tab panel.
- Dialog and destructive confirmation flows must keep focus trapped while open, expose a stable accessible name, and restore focus after close. Hold-to-confirm progress should be described with stable `aria-describedby` text instead of noisy live updates.
- Route changes triggered by shell links, task links, Browser controls, or sprint/task selectors must leave the destination with a named page landmark. If focus is programmatically moved, use `preventScroll` where possible to avoid jumping fixed shell chrome.
- Keyboard-only users must be able to operate Browser chrome, session rail actions, settings forms, task/sprint selectors, stats filters, command menus, and compact mobile controls without hover-only disclosure.
- Task cards and active stream rows keep status, dependency blockers, QA review state, PR/live duration metadata, drag limitations, and inline actions readable without requiring hover. Pointer drag remains pointer-only; reduced-motion users receive static drag-disabled messaging instead of keyboard drag-and-drop.

See the [Dashboard Accessibility Quality Audit](./accessibility-quality-audit.md) for verification expectations.
