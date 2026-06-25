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

### 3. Unified Focus Rings
All interactive components inside the shell layer must follow exactly the same focus rules.

- **Class Rule:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50`
- **Application:** Applies universally to top-nav dropdowns, global search inputs, sidebar navigation links, tooltips, and notification buttons.

### 4. Responsiveness and Truncation
Stable layouts on narrow widths (especially mobile or multi-panel layouts).

- **Project & Sprint Menus:** Should enforce strict text truncation using `truncate` and dynamic maximum widths (e.g., `max-w-[140px] md:max-w-[200px]`) rather than letting content dictate unbounded flex-growth.
- **Search and Telemetry Layout:** Components should gracefully hide text or collapse altogether instead of overflowing the flex container.

### 5. Hover and Active Indicators
- **Interactions:** Hover backgrounds for triggers follow `hover:bg-black/[0.05] dark:hover:bg-white/[0.05]`. Active routes in the Sidebar use the primary `signal-500` marker tone.
- **Tooltips:** Minimized sidebar items expose semantic `aria-label`s on their links and keep visual tooltips explicitly mapped via `aria-hidden="true"` styled to mimic standard dropdown glass panels (`shadow-2xl rounded-2xl`).
