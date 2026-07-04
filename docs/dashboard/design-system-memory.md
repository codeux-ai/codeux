# Memory Workspace Design System
## Objective
Make the Memory page feel like a focused knowledge graph tool.

## Surface Hierarchy
- **Graph shell:** The canvas, list sidebar, inspector drawer, model catalog, and category summary use the same translucent surface family: low-alpha white/void backgrounds, `border-black/[0.08]` or `dark:border-white/[0.08]`, and restrained shadows. This keeps graph exploration, list filtering, and model management visually connected.
- **Cards and controls:** Memory cards, model cards, metadata tiles, and action controls use compact `rounded-lg` surfaces. Selection is reserved for Signal rings and soft Signal backgrounds; category hues appear as badges, dots, graph labels, and progress fills.
- **Metadata typography:** Labels use small uppercase text with relaxed tracking, while IDs, counts, dimensions, and percentages use compact mono text inside subtle chips. Long memory content should wrap inside content panels rather than force the inspector or card layout wider.

## Category Colors
Category colors are identity accents, not product-state indicators. They should be applied at low alpha for badges, halos, graph labels, and summary progress so they do not compete with Signal, Ember, or status-red states.

- **Architecture:** Knowledge teal `#00C8A0` -> `r: 0, g: 200, b: 160`
- **Codebase:** Code amber `#F59E0B` -> `r: 245, g: 158, b: 11`
- **Context:** Violet `#8B5CF6` -> `r: 139, g: 92, b: 246`
- **Preferences:** Slate `#94A3B8` -> `r: 148, g: 163, b: 184`
- **Patterns:** Sky `#38BDF8` -> `r: 56, g: 189, b: 248`
- **Decision:** Blue-green `#14B8A6` -> `r: 20, g: 184, b: 166`
- **Error:** Rose `#F43F5E` -> `r: 244, g: 63, b: 94`
- **Learning:** Lime `#A3E635` -> `r: 163, g: 230, b: 53`

## Inspector Layout
- The inspector is organized into **Content**, **Metadata**, **Related memories**, and optional **Destructive memory actions** sections.
- Content is shown in a bounded, scrollable panel with preserved whitespace and word wrapping.
- Metadata includes category, scope, strength, and truncated memory ID. The full ID should remain available through the element title rather than taking over the layout.
- Related memories use compact rows with category dots, two-line excerpts, and similarity percentages. Sparse graphs show an explicit "No related memories in the current graph view" empty state.
- Delete mode must remain visually and semantically separate from regular inspection, using status-red styling and the existing confirmation dialog.

## Empty, Loading, And Sparse States
- The list distinguishes a truly empty memory view from search/filter misses.
- The graph distinguishes zero memories from sparse graphs that contain nodes but no similarity edges.
- The model catalog shows a loading panel when model metadata has not arrived, per-card download progress while files are downloading, and a re-embedding progress banner while stale embeddings are being refreshed.

## Accessibility Rules
- **Memory Tier Tabs:** The tier controls use `role="tablist"` with `aria-label="Memory Tier"`. Keyboard navigation should fully support Arrow, Home, and End keys, and visually track `aria-selected` status.
- **Danger Mode:** Destructive toggles like "Lobotomize" use `aria-pressed` and include explicit visually hidden or text-visible labels (e.g. `aria-label="Toggle Danger Delete Mode"`) indicating the destructive nature.
- **Memory Cards:** Memory cards must not be pointer-only. They should announce context, including scope and origin (e.g., via visually hidden instructional text like "Press Enter to open details" and explicitly mentioning the scope in the card's accessible label).
- **Search & Filtering:** Escape to clear behavior in the search box should update `aria-live` regions ("Search cleared") without unexpectedly blurring focus.

## Responsive Layout Guidelines
- **Main Canvas:** Uses dynamic viewport height `h-[calc(100dvh-12rem)] min-h-[500px]` to prevent clipping and scrolling issues.
- **Sidebar & Details:** Stacks to the bottom on mobile (`h-[50vh]`) and anchors to the side on desktop.
- **Filters & Search:** Wraps flex items cleanly using `flex-wrap` (without hardcoded `w-full`) and applies `min-w-0` for select wrappers to prevent overflow.
- **Truncation:** Metadata limits string lengths gracefully utilizing `truncate` and `break-words` along with `min-w-0`.
