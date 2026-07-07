# Design System: Shell Navigation

This document defines the rules and standardized styling for the dashboard shell chrome (Sidebar and Top Navigation) to maintain a cohesive, premium, and unified interface.

## Core Visual Attributes

### 1. Glass Surfaces
Shell elements utilize glassmorphism to blend with the underlying dashboard space softly, preserving a sense of depth without distraction.

- **Standard Backdrop:** `bg-[#F9F8F4]/80 dark:bg-void-900/80 backdrop-blur-xl`
- **Dropdown Overlays:** `bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl`
- **Border Treatment:** A unified exact delicate border is maintained across shell containers using `border-black/[0.06] dark:border-white/[0.06]`. For overlays, use `border-black/[0.08] dark:border-white/[0.08]`.

### 2. Compact Control Height
Header dropdowns, searches, and related shell controls are standardized to a single compact height to ensure clean horizontal alignment.

- **Height Utility:** Use `h-9` or `min-h-[40px]`.
- **Vertical Padding:** Avoid aggressive internal vertical padding inside flex items; rely on the fixed height `h-9` + `items-center` for perfect centering.
- **Header Container Container:** The primary nav container uses `min-h-[60px]` instead of fixed `h-[60px]` to allow clustering elements to wrap on constrained viewports if needed.
- **Global Search Trigger:** The top-nav search trigger belongs in the left header cluster beside the brand. It should use the same compact visual rhythm as project, sprint, and worker selectors, collapse toward an icon-led affordance on tight widths, and avoid forcing sibling controls to overflow.

### 3. Unified Focus Rings
All interactive components inside the shell layer must follow exactly the same focus rules.

- **Class Rule:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50`
- **Application:** Applies universally to top-nav dropdowns, global search inputs, sidebar navigation links, tooltips, and notification buttons.

### 4. Responsiveness and Truncation
Stable layouts on narrow widths (especially mobile or multi-panel layouts) must maintain access to controls without triggering horizontal overflow.

- **Wrapping:** Top-level header layouts should use `flex-wrap md:flex-nowrap` to gracefully wrap clusters on very small viewports instead of hiding them or clipping. To safely reflow UI headers and action button rows in narrow responsive containers (like flyouts), use `flex flex-wrap` alongside `shrink-0` on fixed elements to prevent horizontal overflow.
- **Dropdown Anchoring:** Dropdowns (e.g., project and sprint selectors) must use layout-aware positioning (such as `absolute top-full` inside a `relative` wrapper) instead of fixed top pixel coordinates so they anchor below the button regardless of header wrapping.
- **Scroll Ownership:** For bounded responsive UI panels with scrolling content, use a root container with overflow clipping and assign vertical scrolling to the internal content container to avoid double scrollbars. Top-nav project and sprint selector option panes use fixed responsive caps (`max-h-64 sm:max-h-72 md:max-h-80`) with `overflow-y-auto` so long lists remain compact instead of extending toward the bottom of the page.
- **Project & Sprint Menus:** Must remain visible on compact screens. Enforce strict text truncation using `truncate` and responsive maximum widths (e.g., `max-w-[80px] sm:max-w-[140px] md:max-w-[200px]`) rather than letting content dictate unbounded flex-growth. Compact action clusters should use `min-w-0` to allow safe text truncation without shrinking icon buttons (which should retain `shrink-0`).
- **Search and Telemetry Layout:** Components should gracefully hide text or collapse altogether (e.g. icon-only triggers) instead of overflowing the flex container.

### 5. Standardized Components
The shell relies on reusable layout components from `dashboard/src/v2/components/layout/` (such as `Sidebar` and `NavItem`) and top navigation components from `dashboard/src/v2/components/top-nav/` (such as `BrandSection`, `GlobalSearch`, and `TelemetryStats`).

### 6. Hover and Active Indicators
- **Motion Tokens:** Shell navigation must use the interaction contracts in `dashboard/src/v2/lib/motion`. Use `controlFeedback` for hover, focus, icon color, and label feedback; `selectionMovement` for active route backgrounds, vertical markers, and minimized/expanded label reveal; and `enterExit` for mobile drawer and backdrop transitions.
- **Interactions:** Hover backgrounds for triggers follow `hover:bg-black/[0.05] dark:hover:bg-white/[0.05]`. Active routes in the Sidebar use the primary `signal-500` marker tone and must remain visibly marked by semantic `aria-current="page"`, active label weight/color, and the persistent Signal Jade indicator.
- **Minimized Tooltips:** Minimized primary sidebar navigation items expose semantic `aria-label`s on their links and keep visual tooltips explicitly mapped via `aria-hidden="true"` styled to mimic standard dropdown glass panels (`shadow-2xl rounded-2xl`). Tooltips must appear on both hover and `focus-visible`, so keyboard users receive the same label confirmation without pointer hover. Footer actions such as Settings and the sidebar collapse/expand control follow the same minimized tooltip pattern.
- **Unavailable Routes:** Disabled or unavailable shell destinations remain keyboard reachable as disabled link semantics (`role="link"`, `aria-disabled="true"`) and expose a concise visible or screen-reader-accessible explanation through `aria-describedby`. Do not rely on hover-only text for unavailable reasons.

## Accessibility Contracts

### Top Navigation

- The shell header owns a persistent `role="status"` live region for route changes, project and sprint loading states, selector empty states, and completed project/sprint switches. Keep this region visually hidden with `sr-only` so announcements do not add visible chrome.
- Project and sprint selectors use a listbox contract. Triggers expose stable names, real `aria-expanded`, `aria-busy`, and `aria-controls` only while their listbox is mounted. Options use `role="option"` and update `aria-selected`; keyboard navigation supports `Enter`, `Space`, `ArrowDown`, `ArrowUp`, `Home`, `End`, and `Escape`. The header sprint list contains only real sprints; `All Sprints` may remain a trigger-label fallback for a null persisted scope, but it is not a selectable header option.
- Escape closes open selector menus and returns focus to the trigger. Disabled selector states, such as a project with no sprints, announce the empty state without opening an empty listbox.
- Global Search uses an overlay combobox/listbox pattern. The trigger must expose a stable accessible name, opening the overlay should focus the search input and trap focus inside the surface, and closing with Escape, backdrop, or selection must restore focus to the trigger.
- Search result focus is represented with `aria-activedescendant`, not by moving DOM focus between rows. The combobox input stays the DOM focus owner while Arrow keys, Home, and End move the active result. Enter selects only an available active result, Escape closes the overlay, and pointer selection must follow the same route contract as keyboard selection.
- Search refreshes may keep previous results visible only while a background refresh is pending. During that state, the result list exposes `aria-busy`, a visible stale-results status chip, and a live-region announcement. Empty states after refresh completes must use the committed query, not an in-flight typed value.
- Disabled or unavailable search rows stay visible so users understand why a result is present but inert. They expose `aria-disabled`, a persistent visible reason, and an `aria-describedby` explanation; keyboard movement skips unavailable rows when an available row exists, and activation remains inert when every row is unavailable.
- Search overlays own their own result scroller. Active-row movement must scroll the bounded results container, not the document page, so route chrome and page scroll position stay stable.
- Result rows can include sprint keys, task ids, agent names, and preview session labels. These operational values must wrap or truncate inside the row boundary without changing overlay width, and sprint result routes must use the explicit `sprintKey` payload supplied by the search item.
- Notification and browser-session flyouts use disclosure/menu semantics with truthful `aria-expanded` and bounded `aria-busy` states. Escape, outside click, blur close, action completion, and item removal restore focus to the trigger when possible, otherwise to the page fallback.
- Notification refresh, mark-all-read, and per-notification mark-read operations suppress duplicate activation while pending. Pending work must expose `aria-busy`, visible status text, and a polite live-region announcement; disabled controls must explain whether they are already complete or currently busy.
- Browser session menus keep stale sessions visible during refresh and show a polite inline status when refresh fails. Session rows that cannot open a preview remain in the menu as disabled menu items with a visible unavailable reason and are skipped by arrow, Home, and End keyboard movement.

### Sidebar And Dock

- Desktop and mobile sidebar landmarks must have distinct accessible names. Mobile sidebars use dialog semantics only while open, with the inner workspace navigation named separately from the outer dialog.
- Every shell route link keeps a stable accessible name even when rendered icon-only or visually minimized. Active route links use `aria-current="page"`; hidden tooltip labels remain `aria-hidden`.
- Mobile sidebar drawers close through the backdrop, route selection, and Escape. Closing must restore focus to the opener when it is still connected and usable, otherwise to the route page fallback.
- Page route containers that need route-change or overlay-close focus recovery must provide a specific accessible name through `aria-label` or `aria-labelledby`. `PageContainer` only applies the named `region`, `data-focus-fallback`, and fallback `tabIndex=-1` when that name is present; unlabeled layout wrappers must stay out of the landmark list instead of exposing a generic "Page content" region.
- Fixed bottom dock containers must stay inside their own horizontal scroll boundary, account for `env(safe-area-inset-bottom)`, and preserve visible Signal Jade focus rings at the viewport edges.

### Reduced Motion

- Reduced motion removes movement by resolving interaction durations to `0ms`; it must not remove active route indicators, focus rings, tooltip text, unavailable explanations, or page-region focus targets.
- Active sidebar and dock state must remain understandable without animation. Preserve `aria-current`, active marker color, active label treatment, and visible focus rings even when transforms and animated movement are disabled.
