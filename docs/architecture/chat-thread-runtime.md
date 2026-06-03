# Chat Thread Runtime

## Overview

The chat thread runtime architecture provides a unified conversation model for both connected MCP workers and ephemeral virtual providers. It introduces durable state management, dynamic worker routing, explicit invocation tracking, and state-preserving context compaction for long-running project conversations.

## Core Concepts

### Stored Route & Session State

Conversations in Code UX are stored as `ConversationThreadRecord` entities. The core enhancement to chat threads is the introduction of `runtimeState`, a persistent route and session tracker associated with a thread.

The `ConversationRuntimeState` captures:
- `routeKind`: Whether the thread is routed to a `worker` (Connected MCP) or a `virtual` (Internal CLI) provider.
- `virtualProvider`: The specific AI provider (e.g., `gemini`, `codex`, `claude-code`) handling the conversation when operating in virtual mode.
- `modelLabel`: The specific model selected for the provider.
- `workerEndpointId`: The identifier for the targeted live MCP worker when operating in connected mode.
- `sessionIds`: An array of provider-native session IDs that track active context windows for the current worker.
- `replayRequired`: A boolean indicating whether the active worker needs the entire thread history replayed on its next turn.

### Connected vs Virtual Chat Routing

Threads can dynamically shift their underlying execution backend:
- **Connected MCP Routing (`worker`)**: The conversation maps to an external worker process connected via MCP. `workerEndpointId` binds the thread to that exact worker.
- **Virtual Routing (`virtual`)**: When no MCP connection is available or a specific provider is chosen, the thread uses the internal virtual worker scheduler. The scheduler reads the `virtualProvider` and model preferences directly from the thread's runtime state and launches short-lived backend processes to handle the chat turn.

Automatic worker pickup occurs seamlessly. If a project has an inherited worker mode (`VIRTUAL` or `CONNECTED_MCP`), new chat threads inherit this routing configuration automatically.

Route resolution now follows this precedence on each posted message:
- honor an explicit thread-level worker route when the targeted worker endpoint is still live
- otherwise honor an explicit thread-level virtual provider route using the stored provider plus current `dashboard_reply` provider settings for model, API key, and thinking mode
- otherwise fall back to automatic live-worker pickup (`connectionId`, primary assignment, then overflow assignment)
- finally resolve the `dashboard_reply` invocation route and require a CLI-capable provider

This keeps the chat page's explicit route selector authoritative for new-thread first messages instead of accidentally re-resolving through the global provider default.

Message posting is an awaited runtime operation. `POST /api/projects/:projectId/conversations/messages` waits for the chat runtime to finish routing the dashboard turn before returning the stored dashboard message, so provider/runtime errors are handled inside the same request lifecycle instead of continuing as detached background work.

The dashboard chat bubbles now use paired light and dark surface tokens so message bodies, sender labels, and metadata remain legible in both themes while preserving the existing dark-mode visual treatment.

Virtual chat failures are terminal for that dashboard turn:
- the dashboard message is moved from `pending`/`delivered` to `failed`
- a visible system message is appended with the worker execution error
- the thread pending count is cleared because only `pending` and `delivered` dashboard messages are actionable inbox work
- the execution invocation and provider usage rows are linked through `ProviderExecutionService`, keeping Chat and Stats pages replayable for dashboard replies

Structured dashboard replies parse provider output defensively. Some CLI providers emit bootstrap logs around a JSON envelope and place the requested strict JSON inside an envelope field such as `response`. The chat runtime extracts fenced JSON, bare JSON, and nested provider-envelope `response` payloads before deciding a parse retry is required. While structured parsing is still pending, provider execution does not mark the parent execution invocation completed; the chat management layer finalizes it only after the structured reply is accepted or the retry flow has failed.

### First-Message Replay & Worker Switching

A thread's conversation history is independent of the provider processing it. If a user switches the active worker mid-conversation (e.g., from a Claude CLI to a connected Gemini MCP worker), the `ChatThreadRuntimeService` marks the `runtimeState.replayRequired` flag as `true`.

On the next message, the orchestration engine intercepts the request, concatenates all prior messages into a unified prompt history, and delivers it to the newly assigned worker. This mechanism prevents the new worker from losing context, even though it possesses a fresh, blank provider session.

### Compact Conversation Behavior

Long-running conversations accumulate large prompt histories, risking context window exhaustion or unbounded token costs. The chat runtime introduces a compact-conversation action (`compactThreadSession`).

When triggered on a virtual chat route, the system runs a dedicated execution invocation against the selected virtual chat worker and asks it to produce a compacted markdown handoff of the full thread history.

When triggered on a connected MCP chat route, the dashboard now sends a hidden control message to the selected live worker, waits for that worker to answer with a hidden compaction result, and then stores the returned markdown as the thread handoff summary. Those internal control messages are excluded from visible thread history, badge counts, previews, and sidebar pending totals.

The compact action then:
- stores that generated handoff in `runtimeState.compactionSummary`
- resets the native provider `sessionIds` to empty
- sets `replayRequired` to `true`

The original visible `ConversationMessageRecord` history remains intact in the dashboard, but the next fresh session, whether virtual or connected, replays from the compacted summary plus only the messages created after that summary was generated.


### Repository Read Optimizations

To prevent scanning entire thread collections or loading full message arrays into memory during isolated runtime actions, `ConnectionChatRepository` exposes targeted read operations:
- `getThread` accesses a single thread state immediately (e.g. for single-thread reload scenarios).
- `getFirstReplyAfterMessage` queries exactly one row representing the chronologically first reply after a specific message.

These precise reads are separated into read-query helper modules (`conversation-thread-query.ts`, `conversation-message-query.ts`, `conversation-query-utils.ts`), which keeps repository files clean and side-effect free. These methods are now actively utilized by the ChatThreadRuntimeService and PlanningAgentService to eliminate full-collection rescans.

### Virtual Provider Management Actions

When operating in virtual provider mode, management actions follow a structured execution path. The `ChatManagementActionService` leverages `StructuredProviderResponseService` to prompt the virtual provider for a strict JSON payload containing `{ replyMarkdown, action }`.

If an action is proposed, it is evaluated through the shared `ManagementToolHandler`, aligning the virtual chat's business logic exactly with the connected MCP workers. If the action is approval-gated (e.g., destructive actions), the service returns a non-mutating confirmation result alongside the serialized payload, awaiting user confirmation without altering project state. All exchanges—prompts, JSON parsing results, and execution envelopes—are durably recorded in the invocation history.

### Performance and Metrics Aggregation

To ensure real-time responsiveness on the chat dashboard and maintain thread/connection lists optimally under high scale, we perform aggregation directly inside single query payloads using Common Table Expressions (CTEs).

When querying threads (`listThreads`) or connections (`listConnections`), instead of executing per-row correlated subqueries (like running independent count queries for `message_count` or `pending_message_count` for every single thread returned), the system:
- calculates summary metrics in a `GROUP BY` scope bounded to the active `project_id`.
- joins those aggregate results back to the primary row selection.
- utilizes `ROW_NUMBER() OVER (PARTITION BY thread_id ...)` to effortlessly pull the most recent visible preview text and timestamp alongside these stats.

This keeps index alignments strict, avoids full table scans on global message tables, and ensures O(1) query complexity scaling relative to the number of returned threads or connections in the current project context.
