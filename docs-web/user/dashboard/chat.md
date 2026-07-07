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

New dashboard chat threads derive an 8-word-or-less title from the first visible user message. Code UX stores the title in sqlite and mirrors it to `.code-ux/conversations/<thread-id>/session-title.md` inside the project checkout; manual title edits update both places. Prompt preparation also includes a title-refresh instruction every 20 provider invocations so long-running conversations can update their title from current context.

To rename a thread, use the edit control beside the active thread title. The inline editor supports pointer and keyboard workflows: Enter saves, Escape cancels, explicit save/cancel buttons are available, and empty titles are rejected before the request is sent. Successful renames update the active header and left rail from the returned backend thread record without reloading the transcript. Long titles wrap or truncate inside the header, while rail titles clamp to two readable lines.

To start a new thread, click **+ New thread**. To change the responding agent, open the thread header dropdown and pick from the list of agent presets defined for this project.

Each post is a runtime operation that honors the explicit route chosen (worker route, virtual provider route, automatic live-worker pickup, or fallback). The dashboard exposes in-flight state locally, allowing you to cancel active thread turns or invocations. Failed invocation restarts preserve the failed invocation transcript and expose the existing sanitized error message with a retry action.

In 3D Chat, idle quick actions send project-scoped prompts directly through the active thread. **Web App** and **Desktop App** set up the currently selected project using its current techstack setting; an unassigned existing project stays `None`. They do not create or import a new Code UX project.

Planning messages can include a rich sprint status card. When Code UX can match the message to loaded live project data, the card is backed by the current task records and execution snapshot, so it updates as tasks move from queued to running, completed, failed, blocked, or quota-waiting. It shows the sprint key/name, request/task/run materialization, overall progress such as `0/7 · 0%`, queued task count, and a compact task list. If either task records or the execution snapshot are still loading, the chat keeps the generic planning status card until both live records are available for the active project.

## Compacting a thread

Long threads accumulate context cost. Click **Compact** to:

1. Ask the assigned non-Jules CLI provider to run its native compact command inside the current provider session.
2. Store the provider's compaction output on the thread for audit and recovery.
3. Continue the conversation in the same compacted provider session with a smaller context.

Code UX does not create a separate `:compaction` chat session for CLI providers. If a thread has no saved active session, providers with a logical continue/resume fallback can still compact through that same thread session; providers that require a concrete native session ask you to send a message in the thread before compacting.

## Invocations

The **Invocations** tab is a structured log of every `CallTool` MCP invocation routed through this project:

- **Request** — tool name, arguments (truncated for readability), invoking connection.
- **Response** — output payload or error.
- **Timing** — start, end, duration.
- **Linked task / sprint** — when an invocation arose from sprint orchestration.

Use this for debugging your MCP client integrations — for example to see exactly what arguments your LLM is passing to tools like `manage_memory` or `manage_settings`.

Invocation transcripts use the same live sprint status card as thread messages when planning metadata links them to a sprint. This means a planning invocation and its related chat message should show consistent task progress without a separate refresh control.

Planning and QA self-reflection messages appear as structured cards instead of raw system text. Each card shows whether the reflection passed, needed improvement, or hit an error; the final decision; the attempt number; and each criterion's 5-star rating, numeric score, threshold, rationale, and improvement instructions when available.

## Posting messages

The composer at the bottom supports:

- **Multi-line input** with Enter to send, Shift+Enter for newline.
- **Slash commands** that invoke management actions inline.
- **Attachments** *(planned)*.

The active thread can be deleted from the **⋯** menu. Deletion is local (the underlying provider session is closed) and does not affect sprints or tasks. You can also cancel the currently running turn for a specific thread, which aborts only the matching in-flight thread turn.
