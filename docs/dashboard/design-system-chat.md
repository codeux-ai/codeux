# Chat Design System

## Overview
The chat and invocation design system for the Code UX dashboard defines the layout, visual hierarchy, and interaction patterns for conversational components. It aims to create a highly readable, coherent, and professional interface for users to interact with AI agents and inspect runtime transcripts.

## Layout and Hierarchy
- **Page Shell**: The `ChatPageShell` acts as the root container, orchestrating the global layout. On large screens (`lg`), it uses a CSS Grid structure with a fixed-width side rail (`360px`) and a fluid main conversation area. This prevents content shifting and maintains a stable rhythm. The shell, split pane, rail, and detail panel are height-bounded with internal scrolling so switching through invocation transcripts cannot grow the `/chat` page or create blank page-level overflow. Container panels use standard `rounded-3xl` for high-level structure and `rounded-2xl` for internal boundaries like the composer.
- **Side Rail (`ChatRail`)**: Houses lists of active threads or invocations, allowing quick navigation between contexts. Its width is consistent across views, and long lists scroll inside the rail rather than the browser/page viewport.
- **Message Area**: Displays the conversation stream. Messages are constrained to a maximum width (e.g., `max-w-[760px]`) to ensure comfortable reading lines and prevent horizontal spanning on ultra-wide displays. Long transcripts scroll inside the detail panel while the header and composer remain stable.

## Visual Patterns
- **Cards**: Threads and invocations in the side rail use rounded cards (`rounded-3xl`) with glassmorphism effects (`bg-white/70 backdrop-blur-2xl`, etc.) and subtle borders to separate them from the background. Active/selected states use a distinct accent border color (`signal-500`).
- **Bubbles**: Conversational messages are displayed in bubbles.
  - **User/Assistant**: Clear separation of user (right-aligned, solid background/border) and assistant (left-aligned, distinct background/border) messages.
  - **System**: Rendered distinctly (e.g., dashed borders, monospaced headers, truncated views) to separate internal instructions from standard dialogue.
  - **Tool Calls / Reasoning**: Presented as full-width, compact cards rather than standard bubbles to clearly differentiate them as structural operations or internal thoughts rather than user-facing dialogue.
- **Widgets**: specialized components (Routing, Planning, Container) embedded within the stream to provide rich status and execution context without cluttering the text transcript. They use a unified visual language (`ChatWidgetFrame`).
  - **Reasoning turns**: internal thinking output renders as a dedicated `ReasoningWidget`, not as a generic assistant bubble and not as a tool-call widget. It keeps the text plain and whitespace-preserving, adds provider/model/timing/token context in the header, and collapses long content behind an expand/collapse button with `aria-expanded` and `aria-controls`.
  - **Collapsed long content**: long reasoning stays readable by default through a short preview and expands in place. Short reasoning stays fully visible with no affordance churn, while the widget still keeps a stable region label for screen readers.
  - **Assistant vs. tool-call vs. reasoning**: assistant bubbles remain the normal markdown transcript surface, tool-call widgets summarize structured input/output/status for operations, and reasoning widgets are reserved for transcripted internal deliberation so the live session can be inspected without flattening every turn into the same bubble style.

## States
- **Loading**: Use `LoadingChat` for initial data fetches. Provide pulsating dots or skeleton lines.
- **Empty**: `EmptyChat` variants provide clear explanations and next steps (e.g., "Create a Thread") when no content exists. Empty state cards use standard utility classes (`rounded-3xl`, `rounded-2xl`, `rounded-xl`) for visual rhythm.
- **Pending/Working**: Animated indicators (e.g., `WorkingBubble`, pulsing dots, animated ships) signal active agent processing.

## Interaction
- Seamless mode switching between standard "Threads" (user-facing chat) and "Invocations" (runtime debugging transcript).
- Consistent padding and gap spacing to prevent layout jitter during these transitions.
- The invocation rail renders the first 40 newest invocations by default, then lazy-loads additional pages as the user scrolls near the bottom of the rail. The rail header and mode tab use the backend `totalCount`, not the number of loaded rows, so long-running projects show the real invocation total while keeping initial load lightweight.

## Accessibility
- **Tab Navigation**: The mode switcher is a `role="tablist"` with unique `id`s for `role="tab"` elements, matching `aria-controls` to the underlying `role="tabpanel"` and `aria-labelledby` back to the tab. Roving `tabIndex` and arrow-key navigation are supported.
- **Message History**: The message lists use `role="log"` mapped to `aria-live="polite"` only when newly loaded to avoid repeating the entire history on mount. Regions use clear `aria-label` names.
- **Screen Reader Clarity**: Status dots, metadata icons, and delivery status badges must be accompanied by visually hidden (`sr-only`) descriptive text (e.g., `Status: Replay Required`, `Error: Rate limit`) so screen readers provide complete context.
- **Interactive Widgets**: Bubbles, truncations, and expanding blocks must preserve clear semantic roles (`button`, `region`) and expansion states (`aria-expanded`).

## Data Flow and Polling
- **Active Invocation Polling**: When active invocations exist (running or optimistic), the dashboard actively polls for updates. This polling relies on a stable derived key (`activeInvocationKey`) representing the set of active IDs to prevent unnecessary interval resets when non-ID metadata updates. Stale refreshes are prevented by verifying that both the active project and the selected invocation remain identical to when the polling cycle started.
- **Invocation Pagination**: The chat page calls the paginated invocation query with `limit=40` for the initial rail load. After more pages are loaded, live refreshes request the currently loaded window size so scroll-expanded history remains present while active invocation metadata updates.
