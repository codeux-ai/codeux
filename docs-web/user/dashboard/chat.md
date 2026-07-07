# Chat

The **Chat** page (`/chat`) is a thread-based conversation surface that lets you talk to agents — both for free-form Q&A and to inspect MCP tool invocations.

## Layout

- **Left rail** — Two tabs:
  - **Threads** — Conversation threads scoped to the active project.
  - **Invocations** — A historical log of MCP `CallTool` invocations, useful for debugging integrations.
- **Main panel** — The active thread (or invocation), rendered as a chat transcript with user, assistant, and tool messages. Markdown is rendered with `marked`, including code blocks.

## Threads

A *thread* is a persistent conversation with an agent. Each thread has:

- A **title** (editable inline).
- A **routing config** — which agent preset and provider answers when you post a message.
- A **session** — the underlying provider session. Sessions can be **compacted** (summarised) to fit within context limits.

To start a new thread, click **+ New thread**. To change the responding agent, open the thread header dropdown and pick from the list of agent presets defined for this project.

Each post is a runtime operation that honors the explicit route chosen (worker route, virtual provider route, automatic live-worker pickup, or fallback). The dashboard exposes in-flight state locally, allowing you to cancel active thread turns or invocations. Failed invocation restarts preserve the failed invocation transcript and expose the existing sanitized error message with a retry action.

## Compacting a thread

Long threads accumulate context cost. Click **Compact** to:

1. Summarise the thread transcript via the assigned provider.
2. Replace the prior session memory with the compacted summary.
3. Continue the conversation from a smaller starting point.

## Invocations

The **Invocations** tab is a structured log of every `CallTool` MCP invocation routed through this project:

- **Request** — tool name, arguments (truncated for readability), invoking connection.
- **Response** — output payload or error.
- **Timing** — start, end, duration.
- **Linked task / sprint** — when an invocation arose from sprint orchestration.

Use this for debugging your MCP client integrations — for example to see exactly what arguments your LLM is passing to tools like `manage_memory` or `manage_settings` (Note: The legacy unified `manage_code_ux` tool is deprecated).

## Posting messages

The composer at the bottom supports:

- **Multi-line input** with Enter to send, Shift+Enter for newline.
- **Slash commands** that invoke management actions inline.
- **Attachments** *(planned)*.

The active thread can be deleted from the **⋯** menu. Deletion is local (the underlying provider session is closed) and does not affect sprints or tasks. You can also cancel the currently running turn for a specific thread, which aborts only the matching in-flight thread turn.
