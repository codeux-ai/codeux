# Design System: Shell Navigation

This document defines the rules and standardized styling for the dashboard shell chrome (Sidebar, Top Navigation, page intros, and mobile dock) to maintain a cohesive operational interface.

## Core Visual Attributes

### 1. Glass Surfaces
Shell elements utilize glassmorphism to blend with the underlying dashboard space softly, preserving a sense of depth without distraction.

- **Standard Backdrop:** `bg-[#F9F8F4]/80 dark:bg-void-900/80 backdrop-blur-xl`
- **Dropdown Overlays:** `bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl`
- **Border Treatment:** A unified exact delicate border is maintained across shell containers using `border-black/[0.06] dark:border-white/[0.06]`. For overlays, use `border-black/[0.08] dark:border-white/[0.08]`.

### 2. Page Intro Rhythm
Pages start from one visual baseline below the sticky top nav. The standard page container uses consistent horizontal padding (`px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16`) and a restrained top offset (`pt-7 sm:pt-8 md:pt-10`) so page headers do not crowd mobile chrome or drift between sections.

- **Header Structure:** `PageHeader` owns the intro stack: compact eyebrow, restrained title, optional subtitle, and optional action row.
- **Action Wrapping:** Header actions use `flex-wrap` and become full-width on compact viewports before returning to right-aligned utility controls on desktop.
- **No Hero Treatment:** Shell page intros stay operational. Do not use oversized marketing hero typography, decorative cards, or full-bleed promotional layouts in shell headers.

### 3. Compact Control Height
Header dropdowns, searches, telemetry, and related shell controls are standardized to a single compact height to ensure clean horizontal alignment.

- **Height Utility:** Use `h-9` or `min-h-[40px]`.
- **Vertical Padding:** Avoid aggressive internal vertical padding inside flex items; rely on the fixed height `h-9` + `items-center` for perfect centering.
- **Header Container:** The primary nav container uses `min-h-[60px]` instead of fixed `h-[60px]` to allow clustering elements to wrap on constrained viewports if needed.

### 4. Unified Focus Rings
All interactive components inside the shell layer must follow exactly the same focus rules.

- **Class Rule:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50`
- **Application:** Applies universally to top-nav dropdowns, global search inputs, sidebar navigation links, tooltips, and notification buttons.

### 5. Responsiveness and Truncation
Stable layouts on narrow widths (especially mobile or multi-panel layouts) must maintain access to controls without triggering horizontal overflow.

- **Wrapping:** Top-level header layouts should use `flex-wrap md:flex-nowrap` to gracefully wrap clusters on very small viewports instead of hiding them or clipping. To safely reflow UI headers and action button rows in narrow responsive containers (like flyouts), use `flex flex-wrap` alongside `shrink-0` on fixed elements to prevent horizontal overflow.
- **Dropdown Anchoring:** Dropdowns (e.g., project and sprint selectors) must use layout-aware positioning (such as `absolute top-full` inside a `relative` wrapper) instead of fixed top pixel coordinates so they anchor below the button regardless of header wrapping.
- **Scroll Ownership:** For bounded responsive UI panels (like top-nav flyouts) with scrolling content, use a root container with `flex flex-col overflow-hidden` and a dynamic max height (e.g., `max-h-[calc(100dvh-5rem)]`), and assign `flex-1 min-h-0 overflow-y-auto` to the internal content container to manage scroll ownership without double scrollbars.
- **Project & Sprint Menus:** Must remain visible on compact screens. Enforce strict text truncation using `truncate` and responsive maximum widths (e.g., `max-w-[80px] sm:max-w-[140px] md:max-w-[200px]`) rather than letting content dictate unbounded flex-growth. Compact action clusters should use `min-w-0` to allow safe text truncation without shrinking icon buttons (which should retain `shrink-0`).
- **Search and Telemetry Layout:** Components should gracefully hide text or collapse altogether (e.g. icon-only triggers) instead of overflowing the flex container. Telemetry reads as compact utility status, not as a separate card or badge family.

### 6. Hover and Active Indicators
- **Radius:** Sidebar rows, settings/collapse controls, dock items, top-nav utilities, mobile menu triggers, and minimized tooltips use `rounded-xl`. Shell containers may use `rounded-2xl` when they frame a group, such as the mobile dock.
- **Interactions:** Hover backgrounds for triggers follow `hover:bg-black/[0.05] dark:hover:bg-white/[0.05]`. Avoid colorful hover fills for routine shell utilities.
- **Active Routes:** Active navigation uses Signal treatment: `bg-signal-500/[0.10]` for the row/dock fill, `text-signal-600 dark:text-signal-400` for the icon, and a precise `bg-signal-500` rail or dock marker. Do not use per-route accent colors for active shell navigation.
- **Indicator Alignment:** Active indicators must be measured from the active DOM item and refreshed after route changes, sidebar collapse transitions, Browser nav visibility changes, and viewport resizing. Hidden routes should remove the indicator rather than pinning it to a stale item.
- **Tooltips:** Minimized sidebar and dock items expose semantic `aria-label`s on their links and keep visual tooltips explicitly mapped via `aria-hidden="true"` styled to mimic standard dropdown glass panels (`bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl shadow-2xl rounded-xl`).
