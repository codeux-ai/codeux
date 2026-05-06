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

Each post triggers a routed invocation: the dashboard records the request, dispatches it to the chosen provider via the worker assignment service, and streams the reply back. If the chosen worker is a remote MCP listener, the message is delivered via the listener's `listen` long-poll and the listener replies via `post_listen_reply`.

## Compacting a thread

Long threads accumulate context cost. Click **Compact** to:

1. Send the thread transcript to the assigned worker as a `compact_thread` request (via `generate_dashboard_reply` with `mode: "compact_thread"`).
2. Replace the prior session memory with the compacted summary.
3. Continue the conversation from a smaller starting point.

## Invocations

The **Invocations** tab is a structured log of every `CallTool` MCP invocation routed through this project:

- **Request** — tool name, arguments (truncated for readability), invoking connection.
- **Response** — output payload or error.
- **Timing** — start, end, duration.
- **Linked task / sprint** — when an invocation arose from sprint orchestration.

Use this for debugging your MCP client integrations — for example to see exactly what arguments your LLM is passing to `manage_code_ux`.

## Posting messages

The composer at the bottom supports:

- **Multi-line input** with Enter to send, Shift+Enter for newline.
- **Slash commands** that invoke management actions inline.
- **Attachments** *(planned)*.

The active thread can be deleted from the **⋯** menu. Deletion is local (the underlying provider session is closed) and does not affect sprints or tasks.
