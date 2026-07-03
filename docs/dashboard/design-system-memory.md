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
- **Immediate Delete Warning:** When Lobotomize is active, the visible warning copy must say that single-click graph deletion is active and that inspector/sidebar single-memory delete controls do not show a confirmation dialog.
- **Memory Cards:** Memory cards must not be pointer-only. They should announce context, including scope and origin (e.g., via visually hidden instructional text like "Press Enter to open details" and explicitly mentioning the scope in the card's accessible label).
- **Search & Filtering:** Escape to clear behavior in the search box should update `aria-live` regions ("Search cleared") without unexpectedly blurring focus.

## Camera Contract
- **Overview Zoom:** The canvas opens at the default overview zoom and uses a lower entry zoom only for the initial entrance animation.
- **Selection Zoom:** Clicking a node or choosing it from the list recenters the map on that node at a readable focus zoom, while preserving the current zoom if the user has already zoomed in further.
- **Deep Readability:** The zoom buttons and wheel can reach a much deeper zoom than the old `2.5` cap so an individual memory can be read on dense 200+ node maps.
- **Pointer Zoom:** Wheel zoom should preserve the world point under the cursor instead of always scaling around the viewport center.
- **Screen-Space Labels:** Canvas node and category labels should use inverse-zoom sizing so graph geometry scales while text remains visually stable.
- **Focused Labels:** High-zoom canvas labels should prefer a single focused, wrapped label for the selected node instead of rendering full text for every node at once. Hover should only highlight nodes and update cursor state, not create card-like overlays.

## Responsive Layout Guidelines
- **Main Canvas:** Uses dynamic viewport height `h-[calc(100dvh-12rem)] min-h-[500px]` to keep the graph stable without clipping the page chrome.
- **Sidebar & Details:** The memory sidebar starts collapsed as a narrow rail so the canvas stays available by default. When expanded, it becomes a mobile drawer with an internal scrolling list and a desktop side rail.
- **Inspector Dock:** The inspector is a bottom sheet on mobile and a fixed right dock on desktop. Its scroll area is internal, the close button is always labeled, and the panel never blocks the ability to dismiss it.
- **Overlay Safety:** Zoom controls, legend, and node count live inside the canvas wrapper with safe offsets that move away from the inspector on desktop and stay reachable on mobile.
- **Filters & Search:** Filter controls wrap into multiple rows with `flex-wrap`, `min-w-0`, and `max-w-full` so tier tabs, sprint selectors, agent selectors, model catalog, add memory, and danger actions never force horizontal scrolling.
- **Truncation:** Metadata limits string lengths gracefully using `truncate`, `break-words`, and compact badges for connected-memory details.

## Model Catalog
- The embedding model catalog uses one Warm Void panel instead of a plain grid. The panel header summarizes available, downloaded, stale, and active model state before the card grid.
- Model cards keep model name, status, description, dimension, size, language, progress, stale count, and action controls in stable regions so one-column mobile and two-column desktop layouts remain scannable.
- Signal Jade is reserved for download, activate, active, downloaded-progress, and re-embedding progress states. Ember is only used when stale embeddings need re-embedding. Status red is reserved for unavailable/error state and delete affordances.
- The delete control is an icon-only quiet destructive action with an explicit accessible name. It remains keyboard reachable, has a visible focus ring, and is disabled for the active model.

## Sidebar Contract
- The memory search UI only appears in the expanded sidebar. Closing the sidebar clears the active search query so the filter state does not linger invisibly behind the rail.
- The collapse/expand toggle must remain visible in both states and the arrow should point toward the next action, not the current state.
- The sidebar list should own the scrolling region; nested scroll containers inside the drawer cause clipped results and poor touch behavior on mobile.
