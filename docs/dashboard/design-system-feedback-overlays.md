# Design System: Feedback & Overlays

## Core Principles

The Code UX dashboard relies on transient overlays (modals, dialogs, drawers, popovers) and feedback mechanisms (toasts, action feedback regions) to communicate state changes without losing context.

These surfaces share unified styling rules to ensure the dashboard feels cohesive, grounded, and consistent in both light and dark modes.

## Surfaces & Elevations

All floating surfaces in the application share a single elevated visual language.

### Standard Surface (Modals, Dialogs, Drawers, Skeletons)
Used for primary overlay surfaces that sit above the rest of the page layout.

- **Background:** `bg-white dark:bg-void-800`
- **Radius:** `rounded-2xl`
- **Border:** `border border-black/[0.08] dark:border-white/[0.08]`
- **Shadow:** `shadow-2xl`

### Floating Popups (Popovers, Menus, DropdownMenus)
Used for transient contextual interfaces anchored to a trigger.

- **Background:** `bg-white dark:bg-void-800`
- **Radius:** `rounded-2xl`
- **Border:** `border border-black/[0.08] dark:border-white/[0.08]`
- **Shadow:** `shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)]`

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

- **ActionFeedbackRegion / Toasts:** Must wrap contents in a consistent unified surface (e.g., standard background, border, shadow, and rounded radius) instead of relying on heavily saturated background colors, utilizing appropriate semantic text colors and faint borders to communicate status.

## Motion & Interaction

- All motion must respect the user's OS preference (`useReducedMotion`).
- Rely on shared constants from `INTERACTION_TOKENS` and `MODAL_MOTION` for unified entrance/exit easings and durations.
- Avoid bypassing or faking timers during unmounts unless directly tied to the GSAP lifecycle to avoid layout jank or incomplete exits.

## Accessibility

- Ensure overlays (`Dialog`, `Modal`, `ConfirmDialog`) manage focus properly using `useFocusTrap`.
- Maintain appropriate ARIA attributes for semantic landmarks: `role="dialog"`, `aria-modal="true"`.
- Action feedback and toasts must use `role="status"` for polite announcements and `role="alert"` or `aria-live="assertive"` exclusively for destructive errors.
