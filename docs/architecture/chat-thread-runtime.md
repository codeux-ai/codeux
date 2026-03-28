# Chat Thread Runtime

## Overview

The chat thread runtime architecture provides a unified conversation model for both connected MCP workers and ephemeral virtual providers. It introduces durable state management, dynamic worker routing, explicit invocation tracking, and state-preserving context compaction for long-running project conversations.

## Core Concepts

### Stored Route & Session State

Conversations in Sprint OS are stored as `ConversationThreadRecord` entities. The core enhancement to chat threads is the introduction of `runtimeState`, a persistent route and session tracker associated with a thread.

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
