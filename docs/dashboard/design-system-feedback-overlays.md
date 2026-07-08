# Design System: Feedback & Overlays

## Core Principles

The Code UX dashboard relies on transient overlays (modals, dialogs, drawers, popovers) and feedback mechanisms (toasts, action feedback regions) to communicate state changes without losing context.
These components map to current Preact implementations in `dashboard/src/v2/components/ui/`, such as `Modal`, `Dialog`, `ConfirmDialog`, and `ActionFeedbackRegion`.

These surfaces share unified styling rules to ensure the dashboard feels cohesive, grounded, and consistent in both light and dark modes.

## Surfaces & Elevations

All floating surfaces in the application share a single elevated visual language.

### Standard Surface (Modals, Dialogs, Drawers, Skeletons from `dashboard/src/v2/components/ui/`)
Used for primary overlay surfaces that sit above the rest of the page layout.

- **Background:** `bg-white dark:bg-void-800`
- **Radius:** `rounded-2xl`
- **Border:** `border border-black/[0.08] dark:border-white/[0.08]`
- **Shadow:** `shadow-2xl`
- **Scrolling Behavior:** For modals requiring independent scrolling of body content (like long forms), override the `Modal` default overflow by adding `!overflow-hidden flex flex-col` to its `className`. Structure the inner modal with fixed headers/footers using `shrink-0` and make the content body scrollable with `flex-1 overflow-y-auto min-h-0`. In dialog or modal footers, use `flex flex-col-reverse sm:flex-row items-stretch sm:items-center` to stack action buttons vertically on mobile.

### Floating Popups (Popovers, Menus, DropdownMenus from `dashboard/src/v2/components/ui/`)
Used for transient contextual interfaces anchored to a trigger.

- **Background:** `bg-white dark:bg-void-800`
- **Radius:** `rounded-2xl`
- **Border:** `border border-black/[0.08] dark:border-white/[0.08]`
- **Shadow:** `shadow-[0_16px_36px_rgba(15,23,42,0.14)] dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)]`
- **Mobile Viewport Clamping:** Fixed and absolute positioned menus (like action dropdowns or import surfaces) must use viewport clamping (e.g., `max-w-[calc(100vw-2rem)]`) to prevent horizontal clipping on narrow mobile screens.

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
- **Async state semantics:** Pending and progress updates use polite `role="status"` announcements with `aria-busy` on the affected feedback region. Blocking errors use `role="alert"` and assertive live behavior only when the user must recover before continuing. Clear-error controls should not create nested alert regions.
- **Result announcements:** Warning feedback should remain polite. Success feedback may be polite when it is the first announcement for an operation, but shared inline feedback should avoid repeating success messages when a pending state already announced the operation and the visible success state is sufficient.
- **Progress equivalents:** Visual progress bars require text equivalents that remain available under reduced motion. Pending inline feedback should include percent-complete text when progress is known; hold-to-confirm controls should include visible percent text, progressbar values, and non-motion status copy.
- **Toast behavior:** Toast entrance, exit, and stack reordering motion uses shared `asyncFeedback`, `enterExit`, and `listReorder` tokens. Non-error overflow toasts may dismiss automatically to keep stacks bounded, but error toasts remain visible until dismissed or acted on. Retry controls expose pending state with `aria-busy`, suppress duplicate activation, and keep their accessible name stable.

## Motion & Interaction

- All motion must respect the user's OS preference (`useReducedMotion`).
- Rely on shared constants from `INTERACTION_TOKENS`, `useGsapInteractionTokens`, `GSAP_INTERACTION_TOKENS`, and `MODAL_MOTION` for unified entrance/exit easings, durations, destructive hold progress, and reduced-motion-safe resets.
- Avoid bypassing or faking timers during unmounts unless directly tied to the GSAP lifecycle to avoid layout jank or incomplete exits.

## Accessibility

- Ensure overlays (`Dialog`, `Modal`, `ConfirmDialog`) manage focus properly using `useFocusTrap`.
- Maintain appropriate ARIA attributes for semantic landmarks: `role="dialog"`, `aria-modal="true"`.
- Every dialog primitive must have an accessible name via `ariaLabel`, `ariaLabelledBy`, or `titleId`.
- `aria-describedby` must only be added if there is meaningful help or body text.
- All dialogs must use `useFocusTrap` to trap focus, restore focus on close, and allow `Escape` key dismissal even if backdrop clicks are disabled (unless the dialog represents a fully blocking workflow).
- Action feedback and toasts must use `role="status"` for polite announcements and `role="alert"` or `aria-live="assertive"` exclusively for destructive errors.
- Dismiss, retry, and clear-error controls must not leave keyboard focus on a removed element. If the original focused control is removed, restore focus to `[data-feedback-focus-fallback]`, `[data-focus-fallback]`, a main landmark, `#root`, or blur safely when no connected fallback exists; use `preventScroll` where supported.
- All badges, status dots, and live timing indicators must include visually hidden text (`<span className="sr-only">`) to provide explicit status and severity announcements, ensuring they do not rely purely on color or motion.
- Spinning or pinging indicators must respect reduced motion by using `motion-reduce:animate-none` or `motion-safe` variants.
- Destructive hold-to-confirm buttons must communicate progress textually as well as visually. Releasing, pointer-cancelling, pointer-leaving, or key-up cancellation must reset progress immediately in reduced motion and must not call the destructive handler before the tokenized hold completes.
