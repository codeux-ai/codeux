# Interaction Patterns

The dashboard UI uses a set of shared interaction tokens to ensure standard easing, timing, and reduced-motion compliance across all functional views. This foundational approach avoids arbitrary delays and keeps the motion vocabulary unified.

## Overview

We export two sets of tokens to accommodate different styling approaches:

When components use standard interaction contracts, they dynamically apply durations and easings via inline `style` tags referencing `useInteractionTokens`.
- **`useInteractionTokens`** (from `tokens.ts`): Provides CSS transition durations (e.g., `"150ms"`) and CSS easings.
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
   - *Use Case:* Showing field-level validation errors, shake animations, or bouncy cues for invalid inputs.
   - *Pacing:* Fast with spring/bounce easing.

8. **`asyncFeedback`**
   - *Use Case:* Slower, deliberate reveal of asynchronous operation results (e.g., Toast notifications, `ActionFeedbackRegion`).
   - *Pacing:* Slow and linear to ensure visibility.

## Accessibility & Async Feedback

When announcing asynchronous feedback (e.g., via Toasts or ActionFeedbackRegion), motion is secondary to screen reader announcements.
- Ensure that the container uses proper ARIA attributes, typically `aria-live="polite"` or `aria-live="assertive"` with `aria-atomic="true"` so that the full context is announced when it appears.
- Visual movement (like a toast sliding in) must not interfere with the user's focus or block standard keyboard interaction.

## Reduced Motion

All interaction timings automatically respect the user's system preferences or dashboard settings for reduced motion (`prefers-reduced-motion: reduce`).

**How it works:**
- When a user prefers reduced motion, the aforementioned hooks (`useInteractionTokens`, `useGsapInteractionTokens`) automatically resolve all duration values to `0` or `"0ms"`.
- This ensures visual state changes happen instantly while preserving logical flows and React/Preact lifecycle events that depend on state transitions.
- Do not hardcode custom fallback logic for `duration`. Use the hooks, and the components will naturally skip the animation timing.
