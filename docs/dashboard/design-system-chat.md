# Chat Design System

## Overview
The chat and invocation design system for the Code UX dashboard defines the layout, visual hierarchy, and interaction patterns for conversational components. It aims to create a highly readable, coherent, and professional interface for users to interact with AI agents and inspect runtime transcripts.

## Layout and Hierarchy
- **Page Shell**: The `ChatPageShell` acts as the root container, orchestrating the global layout. On large screens (`lg`), it uses a CSS Grid structure with a fixed-width side rail (`360px`) and a fluid main conversation area. This prevents content shifting and maintains a stable rhythm. The shell, split pane, rail, and detail panel are height-bounded with internal scrolling so switching through invocation transcripts cannot grow the `/chat` page or create blank page-level overflow. The shell header actions, mode tabs, pending indicator, rail, and detail panel share the same glass-surface rule: translucent white or void surfaces, subtle borders, restrained shadow depth, and no decorative backgrounds beyond the chat-specific background layer.
- **Side Rail (`ChatRail`)**: Houses lists of active threads or invocations, allowing quick navigation between contexts. Its width is consistent across views, and long lists scroll inside the rail rather than the browser/page viewport. Rail cards should expose one clear left accent or background state for selected, pending/running, replay-required, and failed rows instead of stacking multiple chips and heavy borders.
- **Message Area**: Displays the conversation stream. Messages are constrained to a maximum width (e.g., `max-w-[760px]`) to ensure comfortable reading lines and prevent horizontal spanning on ultra-wide displays. Long transcripts scroll inside the detail panel while the header and composer remain stable.

## Visual Patterns
- **Cards**: Threads and invocations in the side rail use compact glass cards with `backdrop-blur-2xl`, subtle borders, and reserved border width in all states to prevent layout shift. Active/selected states use `signal-500` as a left-edge accent and light signal tint. Pending/running rows may use signal or amber accents depending on semantics. Failed rows use status red. IDs, timestamps, counts, tokens, and status values use monospace metadata treatment and must remain visible for debugging.
- **Bubbles**: Conversational messages are displayed in bubbles.
  - **User/Assistant**: Clear separation of user (right-aligned, signal-tinted) and assistant (left-aligned, neutral glass) messages. Bubbles render as `article` elements with sender, provider/model metadata, timestamp, and delivery/invocation status before the markdown body.
  - **System**: Rendered distinctly with dashed amber treatment or the truncated system bubble to separate internal instructions from standard dialogue.
  - **Tool Calls / Reasoning**: Presented as full-width, compact cards rather than standard bubbles to clearly differentiate them as structural operations or internal thoughts rather than user-facing dialogue.
- **Widgets**: specialized components (Routing, Planning, Container) embedded within the stream to provide rich status and execution context without cluttering the text transcript. They use a unified glass visual language (`ChatWidgetFrame` or matching inline frame classes), named regions/status roles, compact metadata rows, and overflow-safe labels.
- **Markdown and overflow**: Message bodies must allow long model/provider labels, inline code, and code blocks to wrap or scroll without pushing the detail panel horizontally. Use `min-w-0`, truncation on metadata, `[overflow-wrap:anywhere]` for prose, and horizontal scrolling on `<pre>` blocks.

## States
- **Loading**: Use `LoadingChat` for initial data fetches. Provide pulsating dots or skeleton lines.
- **Empty**: `EmptyChat` variants provide clear explanations and next steps (e.g., "Create a Thread") when no content exists. Empty state cards use the same glass surface, a single status label, a restrained icon tile, and compact metadata cells. Avoid additional decorative rings or background art.
- **Pending/Working**: Animated indicators (e.g., `WorkingBubble`, pulsing dots, animated ships) signal active agent processing.

## Interaction
- Seamless mode switching between standard "Threads" (user-facing chat) and "Invocations" (runtime debugging transcript).
- Consistent padding and gap spacing to prevent layout jitter during these transitions.

## Accessibility
- **Tab Navigation**: The mode switcher is a `role="tablist"` with unique `id`s for `role="tab"` elements, matching `aria-controls` to the underlying `role="tabpanel"` and `aria-labelledby` back to the tab. Roving `tabIndex` and arrow-key navigation are supported.
- **Message History**: The message lists use `role="log"` mapped to `aria-live="polite"` only when newly loaded to avoid repeating the entire history on mount. Regions use clear `aria-label` names.
- **Screen Reader Clarity**: Status dots, metadata icons, and delivery status badges must be accompanied by visually hidden (`sr-only`) descriptive text (e.g., `Status: Replay Required`, `Error: Rate limit`) so screen readers provide complete context.
- **Message Semantics**: Standard chat and invocation bubbles render as `article` elements. Dashboard-authored messages expose a visible delivery status and an accessible label such as `Delivery status: Pending`; the existing hidden announcement remains the canonical full sender/time/status sentence. Invocation messages must not duplicate hidden announcements.
- **Interactive Widgets**: Bubbles, truncations, and expanding blocks must preserve clear semantic roles (`button`, `region`) and expansion states (`aria-expanded`).

## Data Flow and Polling
- **Active Invocation Polling**: When active invocations exist (running or optimistic), the dashboard actively polls for updates. This polling relies on a stable derived key (`activeInvocationKey`) representing the set of active IDs to prevent unnecessary interval resets when non-ID metadata updates. Stale refreshes are prevented by verifying that both the active project and the selected invocation remain identical to when the polling cycle started.
