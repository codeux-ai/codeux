# Memory Workspace Design System
## Objective
Make the Memory page feel like a focused knowledge graph tool.

## Category Colors
The Memory UI relies on specific hex colors that match existing app accents:
- **Architecture:** Signal (Teal) `#00E0A0` -> `r: 0, g: 224, b: 160`
- **Codebase:** Ember (Orange) `#FFB800` -> `r: 255, g: 184, b: 0`
- **Context:** Violet `#8B5CF6` -> `r: 139, g: 92, b: 246` (Updated from previous green)
- **Preferences:** Slate `#94A3B8` -> `r: 148, g: 163, b: 184`
- **Patterns:** Amber/Ember variant `#F59E0B` -> `r: 245, g: 158, b: 11`
- **Decision:** Slate/Alternative `#64748B` -> `r: 100, g: 116, b: 139` (Updated to keep it aligned, or another accent)
- **Error:** Rose `#F43F5E` -> `r: 244, g: 63, b: 94` (Updated from simple red)
- **Learning:** Cyan/Teal `#33FFB8` -> `r: 51, g: 255, b: 184`

## Accessibility Rules
- **Memory Tier Tabs:** The tier controls use `role="tablist"` with `aria-label="Memory Tier"`. Keyboard navigation should fully support Arrow, Home, and End keys, and visually track `aria-selected` status.
- **Danger Mode:** Destructive toggles like "Lobotomize" use `aria-pressed` and include explicit visually hidden or text-visible labels (e.g. `aria-label="Toggle Danger Delete Mode"`) indicating the destructive nature.
- **Memory Cards:** Memory cards must not be pointer-only. They should announce context, including scope and origin (e.g., via visually hidden instructional text like "Press Enter to open details" and explicitly mentioning the scope in the card's accessible label).
- **Search & Filtering:** Escape to clear behavior in the search box should update `aria-live` regions ("Search cleared") without unexpectedly blurring focus.

## Camera Contract
- **Overview Zoom:** The canvas opens at the default overview zoom and uses a lower entry zoom only for the initial entrance animation.
- **Selection Zoom:** Clicking a node or choosing it from the list recenters the map on that node at a readable focus zoom, while preserving the current zoom if the user has already zoomed in further.
- **Deep Readability:** The zoom buttons and wheel can reach a much deeper zoom than the old `2.5` cap so an individual memory can be read on dense 200+ node maps.
- **Pointer Zoom:** Wheel zoom should preserve the world point under the cursor instead of always scaling around the viewport center.
- **Focused Labels:** High-zoom canvas labels should prefer a single focused, wrapped label for the hovered or selected node instead of rendering full text for every node at once.

## Responsive Layout Guidelines
- **Main Canvas:** Uses dynamic viewport height `h-[calc(100dvh-12rem)] min-h-[500px]` to prevent clipping and scrolling issues.
- **Sidebar & Details:** The memory sidebar starts collapsed as a narrow rail/tab so the canvas stays available by default. When expanded, it stacks to the bottom on mobile and anchors to the side on desktop.
- **Filters & Search:** Wraps flex items cleanly using `flex-wrap` (without hardcoded `w-full`) and applies `min-w-0` for select wrappers to prevent overflow.
- **Truncation:** Metadata limits string lengths gracefully utilizing `truncate` and `break-words` along with `min-w-0`.

## Sidebar Contract
- The memory search UI only appears in the expanded sidebar. Closing the sidebar clears the active search query so the filter state does not linger invisibly behind the rail.
- The collapse/expand toggle must remain visible in both states and the arrow should point toward the next action, not the current state.
