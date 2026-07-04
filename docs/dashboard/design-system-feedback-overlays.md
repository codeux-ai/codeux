# Design System: Feedback & Overlays

## Core Principles

The Code UX dashboard relies on transient overlays (modals, dialogs, drawers, popovers) and feedback mechanisms (toasts, action feedback regions) to communicate state changes without losing context.

These surfaces share unified styling rules to ensure the dashboard feels cohesive, grounded, and consistent in both light and dark modes.

## Surfaces & Elevations

All floating surfaces in the application share a single elevated visual language.

### Standard Surface (Modals, Dialogs, Drawers, Search)
Used for primary overlay surfaces that sit above the rest of the page layout.

- **Background:** `bg-white dark:bg-void-800`
- **Radius:** `rounded-2xl`
- **Border:** `border border-black/[0.08] dark:border-white/[0.08]`
- **Shadow:** `shadow-[0_24px_80px_rgba(15,23,42,0.22)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)]`
- **Viewport:** Use `max-w-[calc(100vw-2rem)]` and `max-h-[calc(100dvh-2rem)]` or tighter `min()` constraints so long titles, error text, and action labels cannot escape the screen.
- **Scrolling Behavior:** For modals requiring independent scrolling of body content (like long forms), override the `Modal` default overflow by adding `!overflow-hidden flex flex-col` to its `className`. Structure the inner modal with fixed headers/footers using `shrink-0` and make the content body scrollable with `flex-1 overflow-y-auto min-h-0`. In dialog or modal footers, use `flex flex-col-reverse sm:flex-row sm:flex-wrap items-stretch sm:items-center` to stack action buttons vertically on mobile and wrap them on narrow widths.

### Floating Popups (Popovers, Menus, DropdownMenus)
Used for transient contextual interfaces anchored to a trigger.

- **Background:** `bg-white dark:bg-void-800`
- **Radius:** `rounded-2xl`
- **Border:** `border border-black/[0.08] dark:border-white/[0.08]`
- **Shadow:** `shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)]`
- **Mobile Viewport Clamping:** Fixed and absolute positioned menus (like action dropdowns or import surfaces) must use viewport clamping (e.g., `max-w-[calc(100vw-2rem)]`) to prevent horizontal clipping on narrow mobile screens. Dropdowns and popovers should keep `overflow-hidden` on the shell and put any intentionally scrollable content inside the popup body.

### Minimal Floating (Tooltips)
Used for quick, un-interactable labels.

- **Background:** `bg-slate-900 dark:bg-black`
- **Text:** `text-white`
- **Radius:** `rounded-xl`
- **Shadow:** `shadow-xl`

## Backdrops

Any interface that blocks interaction with the rest of the application (e.g. `Modal`, `Dialog`, `Drawer`, `PlanningProgressOverlay`) must use the standard unified backdrop overlay:

- **Style:** `bg-void-900/50 backdrop-blur-sm`

## Feedback

Feedback surfaces indicate system status or asynchronous progress.

- **ActionFeedbackRegion / Toasts:** Must wrap contents in a consistent unified surface (white or `void-800`, `rounded-2xl`, faint semantic border, elevated shadow) instead of relying on heavily saturated background colors.
- **Semantic Hierarchy:** Pending and informational states use signal coloring; success uses green; warnings use amber; errors use red. Icons sit inside subtle semantic icon surfaces while body text remains neutral for legibility.
- **Async Recovery:** Pending states expose `aria-busy`; errors use assertive live regions and retain retry/clear actions until the user dismisses or resolves them. Success and warning states may auto-dismiss, but they still announce politely.
- **Disabled Recovery:** Disabled or unavailable actions should use opacity and cursor states with `aria-disabled` or `disabled`, not color alone. Recovery controls should remain keyboard reachable and large enough for touch.
- **Toast Stacking:** Non-error toasts stack at the bottom-right on desktop and are capped to three active items. Error toasts use their own assertive stack at the bottom-left on desktop and the top edge on small screens to avoid overlapping normal feedback.

## Search & Notifications

- **Search Overlay:** Search uses the same blocking backdrop and elevated surface as dialogs. The input remains a combobox with `aria-activedescendant`, the result grid remains a listbox, and selected rows expose `aria-selected`.
- **Search Rows:** Result rows use calm selected states, subtle semantic metadata, and wrapping title/metadata text so long project, sprint, task, agent, or container names do not overflow.
- **Search Empty States:** Empty, no-results, and project-data-unavailable states use polite live regions, neutral body text, semantic icon surfaces, and breakable message text.
- **Notification Panel:** Notification rows wrap titles, details, times, and action labels. The panel header and rows use the same elevated popup language as dropdowns, with visible focus rings on row focus and actions.

## Motion & Interaction

- All motion must respect the user's OS preference (`useReducedMotion`).
- Rely on shared constants from `INTERACTION_TOKENS` and `MODAL_MOTION` for unified entrance/exit easings and durations.
- Avoid bypassing or faking timers during unmounts unless directly tied to the GSAP lifecycle to avoid layout jank or incomplete exits.

## Accessibility

- Ensure overlays (`Dialog`, `Modal`, `ConfirmDialog`) manage focus properly using `useFocusTrap`.
- Maintain appropriate ARIA attributes for semantic landmarks: `role="dialog"`, `aria-modal="true"`.
- Every dialog primitive must have an accessible name via `ariaLabel`, `ariaLabelledBy`, or `titleId`.
- `aria-describedby` must only be added if there is meaningful help or body text.
- All dialogs must use `useFocusTrap` to trap focus, restore focus on close, and allow `Escape` key dismissal even if backdrop clicks are disabled (unless the dialog represents a fully blocking workflow).
- Action feedback and toasts must use `role="status"` for polite announcements and `role="alert"` or `aria-live="assertive"` exclusively for destructive errors.
- All badges, status dots, and live timing indicators must include visually hidden text (`<span className="sr-only">`) to provide explicit status and severity announcements, ensuring they do not rely purely on color or motion.
- Spinning or pinging indicators must respect reduced motion by using `motion-reduce:animate-none` or `motion-safe` variants.
- Contextual menus must keep `aria-haspopup`, `aria-expanded`, and `aria-controls` wired to their trigger, support Escape dismissal, and restore focus to the trigger when they close.
