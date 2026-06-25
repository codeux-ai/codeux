# Chat Design System

## Overview
The chat and invocation design system for the Code UX dashboard defines the layout, visual hierarchy, and interaction patterns for conversational components. It aims to create a highly readable, coherent, and professional interface for users to interact with AI agents and inspect runtime transcripts.

## Layout and Hierarchy
- **Page Shell**: The `ChatPageShell` acts as the root container, orchestrating the global layout. On large screens (`lg`), it uses a CSS Grid structure with a fixed-width side rail (`360px`) and a fluid main conversation area. This prevents content shifting and maintains a stable rhythm. Container panels use standard `rounded-3xl` for high-level structure and `rounded-2xl` for internal boundaries like the composer.
- **Side Rail (`ChatRail`)**: Houses lists of active threads or invocations, allowing quick navigation between contexts. Its width is consistent across views.
- **Message Area**: Displays the conversation stream. Messages are constrained to a maximum width (e.g., `max-w-[760px]`) to ensure comfortable reading lines and prevent horizontal spanning on ultra-wide displays.

## Visual Patterns
- **Cards**: Threads and invocations in the side rail use rounded cards (`rounded-3xl`) with glassmorphism effects (`bg-white/70 backdrop-blur-2xl`, etc.) and subtle borders to separate them from the background. Active/selected states use a distinct accent border color (`signal-500`).
- **Bubbles**: Conversational messages are displayed in bubbles.
  - **User/Assistant**: Clear separation of user (right-aligned, solid background/border) and assistant (left-aligned, distinct background/border) messages.
  - **System**: Rendered distinctly (e.g., dashed borders, monospaced headers, truncated views) to separate internal instructions from standard dialogue.
  - **Tool Calls / Reasoning**: Presented as full-width, compact cards rather than standard bubbles to clearly differentiate them as structural operations or internal thoughts rather than user-facing dialogue.
- **Widgets**: specialized components (Routing, Planning, Container) embedded within the stream to provide rich status and execution context without cluttering the text transcript. They use a unified visual language (`ChatWidgetFrame`).

## States
- **Loading**: Use `LoadingChat` for initial data fetches. Provide pulsating dots or skeleton lines.
- **Empty**: `EmptyChat` variants provide clear explanations and next steps (e.g., "Create a Thread") when no content exists. Empty state cards use standard utility classes (`rounded-3xl`, `rounded-2xl`, `rounded-xl`) for visual rhythm.
- **Pending/Working**: Animated indicators (e.g., `WorkingBubble`, pulsing dots, animated ships) signal active agent processing.

## Interaction
- Seamless mode switching between standard "Threads" (user-facing chat) and "Invocations" (runtime debugging transcript).
- Consistent padding and gap spacing to prevent layout jitter during these transitions.
