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
- `createAppQuickaction`: Durable thread-scoped state for active chat app-creation quickactions, including the sprint id, app kind, planning status, progress widget message id, request ids, and queued follow-up messages.

### Connected vs Virtual Chat Routing

Threads can dynamically shift their underlying execution backend:
- **Connected MCP Routing (`worker`)**: The conversation maps to an external worker process connected via MCP. `workerEndpointId` binds the thread to that exact worker.
- **Virtual Routing (`virtual`)**: When no MCP connection is available or a specific provider is chosen, the thread uses the internal virtual worker scheduler. The scheduler reads the `virtualProvider` and model preferences directly from the thread's runtime state and launches short-lived backend processes to handle the chat turn.

For Docker or remote virtual provider runs, dashboard chat turns and chat compaction use the current remote default-branch snapshot for the project. The runtime resolves the project's saved default branch first, then the dashboard default, then `main`, and passes that checkout contract into provider execution so chat answers inspect the latest upstream baseline while preserving the thread's conversation state.

Automatic worker pickup occurs seamlessly. If a project has an inherited worker mode (`VIRTUAL` or `CONNECTED_MCP`), new chat threads inherit this routing configuration automatically.

### UI State Contracts

UI interactions like invocation stats visibility (`code-ux:invocation-stats-visible`) and optimistic feedback states (e.g., `ActionFeedbackRegion` for refresh/errors and `role='status'` for working bubbles) are explicitly managed and durable across navigation to preserve a responsive, readable chat experience. The Threads/Invocations mode switch is a keyboard-accessible tablist with arrow/Home/End navigation, visible selected-state cues, count/status copy, and static reduced-motion indicators so selection does not depend on animated movement.

Thread title edits use the same durable thread record contract as routing updates. The dashboard sends `PATCH /api/conversations/threads/:threadId` with `{ title }`, blocks empty titles before dispatch, and replaces the returned `ChatThread` in the active thread snapshot and cached rail list so title-only changes are reflected without forcing a transcript reload.

Route resolution now follows this precedence on each posted message:
- honor an explicit thread-level worker route when the targeted worker endpoint is still live
- otherwise honor an explicit thread-level virtual provider route using the stored provider plus current `dashboard_reply` provider settings for model, API key, and thinking mode
- otherwise fall back to automatic live-worker pickup (`connectionId`, primary assignment, then overflow assignment)
- finally resolve the `dashboard_reply` invocation route and require a CLI-capable provider

This keeps the chat page's explicit route selector authoritative for new-thread first messages instead of accidentally re-resolving through the global provider default.

Message posting is an awaited runtime operation. `POST /api/projects/:projectId/conversations/messages` waits for the chat runtime to finish routing the dashboard turn before returning the stored dashboard message, so provider/runtime errors are handled inside the same request lifecycle instead of continuing as detached background work.

The dashboard can also cancel the currently running turn for a specific thread through `POST /api/conversations/threads/:threadId/cancel`. That aborts only the matching in-flight thread turn and leaves other thread executions alone.

Thread and invocation controls expose their in-flight state locally. Sending a message, cancelling an active turn, compacting a thread, deleting a thread, cancelling an invocation, and restarting/continuing a failed invocation disable duplicate submissions, announce busy status through button labels/`aria-busy`, and keep retryable feedback in `ActionFeedbackRegion` when the server returns an error. Failed message sends keep the draft restored in the composer; failed invocation restarts preserve the failed invocation transcript and expose the existing sanitized error message with a retry action.

The project-backed composer draft is durable but separate from conversation messages. The dashboard assigns each browser user a stable local draft user id and stores draft rows in SQLite by user id, project id, and chat context key (`new-thread` or `thread:<thread-id>`). The UI also writes the active typed value to a scoped browser-local fallback on each input update, so full page refreshes restore recent keystrokes even if the debounced SQLite write was still in flight. Remounts and thread navigation restore only the matching user/project/context draft, blank drafts are recorded as empty locally while the saved row is removed, and successful sends clear the composer through the same path used before. A project transition may retain the previous selection for one render, so thread-scoped draft hydration is gated on the current thread snapshot containing that thread with the selected project id; until then, the context is `new-thread`.

Virtual chat failures are terminal for that dashboard turn:
- the dashboard message is moved from `pending`/`delivered` to `failed`
- a visible system message is appended with the worker execution error
- the thread pending count is cleared because only `pending` and `delivered` dashboard messages are actionable inbox work
- the execution invocation and provider usage rows are linked through `ProviderExecutionService`, keeping Chat and Stats pages replayable for dashboard replies

Structured dashboard replies parse provider output defensively. Some CLI providers emit bootstrap logs around a JSON envelope and place the requested strict JSON inside an envelope field such as `response`. The chat runtime extracts fenced JSON, bare JSON, and nested provider-envelope `response` payloads before deciding a parse retry is required. While structured parsing is still pending, provider execution does not mark the parent execution invocation completed; the chat management layer finalizes it only after the structured reply is accepted or the retry flow has failed.

### Create-App Quickaction Runtime

Create-app dashboard quickactions are the narrow exception to normal routed provider replies. The dashboard posts a short visible user message first, then attaches structured metadata:

- `metadata.quickaction.type = "create_app"`
- canonical `kind` of `web_app`, `desktop_app`, `online_shop`, `portfolio`, or `game` (legacy Web/Desktop aliases remain accepted)
- stable `requestId`
- quicksprint `templateId`
- optional ID-only `designGuidance` selection
- optional task count, stack summary, and suggestion tags

`DashboardCreateAppQuickactionMetadata` is the typed detached protocol. Its `quickaction` payload is discriminated by `type: "create_app"`; `kind` is one of `DashboardCreateAppQuickactionKind`, and the remaining fields are validated against the shared catalog rather than trusted as arbitrary client planning input. The catalog contract is:

| Kind | Display/app label | Template id | Tech stack guidance | Style guidance |
| --- | --- | --- | --- | --- |
| `web_app` | Create Web App / Web app | `qs-create-web-app` | `code-ux-product-stack` | `code-ux-award-winning` |
| `desktop_app` | Create Desktop App / Desktop app | `qs-create-desktop-app` | `electron-desktop-app` | `code-ux-award-winning` |
| `online_shop` | Create Onlineshop / Online shop | `qs-create-online-shop` | `code-ux-product-stack` | `ecommerce` |
| `portfolio` | Create Portfolio / Portfolio | `qs-create-portfolio` | `code-ux-product-stack` | `marketing-site` |
| `game` | Create Game / Game | `qs-create-game` | `code-ux-product-stack` | `game-experience` |

The dashboard builds the stack summary and suggestion tags from the selected project's effective settings before posting the message. It uses the assigned techstack catalog entry when present, falls back to the catalog default when the project is unassigned, and forwards the stack item labels as suggestion tags so detached planning and the `app_progress` widget start from the same context the dashboard displays.

`ChatThreadRuntimeService.postMessage` detects this metadata after the message is stored and before the normal in-flight provider turn is created. The runtime resolves the action through the create-app catalog and rejects mismatched template or guidance IDs. Missing guidance metadata from older clients is normalized to the catalog selection. Web App and Desktop App additionally re-check initial-project eligibility at this runtime boundary: the project must have persisted `new-local` or `new-remote` provenance and still be the clean one-commit Code UX seed containing only the generated `README.md` and supported `.gitignore`. Existing/imported provenance, setup artifacts, repository changes, missing repositories, and inspection errors all fail closed. Online Shop, Portfolio, and Game remain available on normal project-scoped chat paths and rely on the existing project/thread ownership checks instead of the initial-repository restriction.

Valid create-app quickactions do not ask for confirmation, do not route through the dashboard reply provider, and do not create a `dashboard_reply` invocation. Instead, the runtime launches `QuicksprintService.launchDetachedQuicksprint` with `submitMode: "plan_and_start"`, passes the quickaction `requestId` as the planning `clientRequestId`, and forwards the catalog selection as an ID-only planning override. `PlanningAgentService` resolves those IDs against the effective design-guidance catalog and overlays them only for the prompt sent to `PlanningPromptBuilder`. It never accepts instruction Markdown through this override and never writes the selection back to project settings.

The detached launch creates the sprint synchronously and returns the planning request plus a completion promise while the planner continues in the background. The chat runtime then marks the quickaction message processed, posts an `app_progress` system message, and stores this slice on the thread:

- `activeSprintId`
- `appKind`
- `planningStatus`
- `quickactionRequestId`
- `clientRequestId`
- `activePlanningRequestId`
- `progressMessageId`
- `queuedFollowUps`
- optional completion, failure, and error fields

That state lives under `runtimeState.createAppQuickaction` and remains durable until it is superseded by another app-creation quickaction. The progress widget metadata carries the app kind, sprint identity, stack summary, planning stage statuses, suggestion tags, and request ids. Planning completion updates the widget status to `completed` or `failed` and clears only the matching active planning request marker.

Plain chat messages posted in the same thread while create-app planning is running are treated as follow-up direction for the sprint. If the sprint has no tasks yet, the runtime stores those messages in `runtimeState.createAppQuickaction.queuedFollowUps`, marks them processed, and posts a system acknowledgement. When detached planning completes successfully, queued follow-ups are appended to the sprint-level goal under `## Additional direction from chat`; generated task prompts and already-created subtasks are not rewritten. If tasks already exist when a follow-up arrives, the same sprint-goal append happens immediately and the thread receives a confirmation. Failed planning keeps queued follow-up text in runtime state for recovery instead of discarding it.

Because `ConnectionChatRepository.updateThread` replaces the whole `runtimeState` payload, create-app state updates re-read the latest thread before writing nested quickaction fields. Follow-up queue writes and planning-completion writes merge concurrent `queuedFollowUps`, `planningStatus`, and `activePlanningRequestId` changes rather than overwriting them with stale snapshots. After a follow-up is queued, the runtime re-checks sprint task count so direction posted as tasks materialize is flushed to the sprint immediately.
JSON-mode dashboard replies may also include prompt suggestions for quick next steps. The accepted reply envelope remains backward compatible with `{ replyMarkdown, action }` and optionally accepts either `suggestions` or `promptSuggestions`, where each suggestion has `label`, `prompt`, and optional stable string `icon`/`id` fields. The management parser trims string fields, drops entries without non-empty labels and prompts, caps the stored list to six, and persists valid suggestions on the visible assistant/system message as `metadata.promptSuggestions`. Plain markdown MCP-native replies are not parsed for suggestions.

### First-Message Replay & Worker Switching

A thread's conversation history is independent of the provider processing it. If a user switches the active worker mid-conversation (e.g., from a Claude CLI to a connected Gemini MCP worker), the `ChatThreadRuntimeService` marks the `runtimeState.replayRequired` flag as `true`.

On the next message, the orchestration engine intercepts the request, concatenates all prior messages into a unified prompt history, and delivers it to the newly assigned worker. This mechanism prevents the new worker from losing context, even though it possesses a fresh, blank provider session.

### External Chat Provider Metadata

External chat provider messages enter the same thread runtime only after authenticated ingress succeeds. The ingress route verifies the provider connection, bridge credential, timestamp freshness, and replay window before `ChatProviderIngressService` normalizes the payload and resolves a channel binding.

Inbound deliveries are recorded before chat posting so the external message id becomes the idempotency boundary. Provider retries with the same external message id return the existing delivery record instead of creating another conversation message. When channel routing succeeds, `ChatThreadRuntimeService.postMessage` stores the user message with metadata such as:

- `source: "chat_provider"`
- provider kind
- external channel id
- external sender id/name
- inbound delivery id
- `suppressRichWidgets: true`

If raw payload metadata or routing hints include a conversation thread id, the existing thread is reused. Otherwise the runtime follows the normal project chat path and persists the resulting conversation thread and message ids back onto the delivery record.

Outbound replies are also delivery records. When a system or assistant reply is persisted in a thread whose triggering message has an inbound delivery id, `ChatProviderOutboundService` creates an outbound `chat_provider_message_deliveries` row linked to the reply conversation message. The adapter updates that row through `pending`, `sending`, `delivered`, `retryable_failure`, or `failed`, with attempts, redacted errors, bridge response metadata, and retry timing visible through dashboard and MCP inspection.

Dashboard-only rich widgets are suppressed for external channels because chat bridges receive plain markdown, not dashboard component instructions. Chat-provider-sourced prompts omit the `codeux:*` widget instruction block, replay/compaction inputs use the same suppression rules, and outbound delivery strips or downgrades any remaining dashboard-only widget fences before sending externally.

Dashboard replies may also carry a bounded `agentEffect` in assistant-message metadata. JSON-mode replies accept it as an optional peer of `replyMarkdown`, `action`, and `suggestions`/`promptSuggestions`. MCP-native replies accept the same object inside a line-starting `codeux:agent` markdown fence. A valid result is persisted on the visible assistant/system message as `metadata.agentEffect` with exact fields `emotion`, `animation`, optional `caption`, and `durationMs`.

`emotion` must be one of `happy`, `sad`, `angry`, `sleepy`, `bored`, `curious`, `thinking`, `excited`, `surprised`, or `proud`. `animation` must be one of `hyped`, `shake_head`, `nod`, `laughing`, `wink`, or `dance`. `durationMs` must be a safe integer in the inclusive range 500–10000. If present, `caption` must be a string, must remain non-empty after trimming, and its trimmed form must contain no more than 120 characters. Any invalid required field, bound, or caption rejects the entire effect; extra properties do not enter the persisted object.

Native markdown parsing removes valid effect fences from `replyMarkdown`, records the first valid effect, collapses excess blank lines, and preserves surrounding prose. Invalid JSON or an invalid shape is not silently deleted: the fence info string is downgraded from `codeux:agent` to `json`, leaving the payload visible. JSON-envelope parsing simply omits an invalid top-level effect and preserves the reply, suggestions, management action, approval behavior, and provider session. The dashboard revalidates untrusted persisted metadata; valid `metadata.agentEffect` wins over a backward-compatible valid native fence, and an invalid metadata value falls back to the first valid fence rather than partially coercing fields.

The cinematic consumer selects the latest reply by `direction !== "dashboard_to_connection"`, not `authorType`, because dashboard replies can be stored with `authorType: "system"`. Only that latest Project Manager reply can own the bounded effect. Runtime errors, outgoing routing, and the selected Project Manager's awaited or matching active reply invocation take precedence; unrelated invocations remain background cues and cannot select the avatar expression, caption, thought bubble, or work tool.

External chat prompts set `suppressRichWidgets: true`, do not advertise the avatar-only contract, and strip/downgrade all `codeux:*` fences in replay and outbound delivery. A valid `codeux:agent` fence becomes no external text; a malformed or invalid one becomes a readable ordinary JSON fence. `metadata.agentEffect` is not serialized into the external reply payload: outbound metadata is rebuilt from redacted routing/delivery context, while `replyText` comes from the sanitized markdown.

### Compact Conversation Behavior

Long-running conversations accumulate large prompt histories, risking context window exhaustion or unbounded token costs. The chat runtime introduces a compact-conversation action (`compactThreadSession`).

When triggered on a virtual CLI chat route for non-Jules providers, the system runs a `chat_compaction` execution invocation against the selected provider's active native session. The provider runner keeps the Code UX logical session id as the thread id, passes the saved native session id as `continueSessionId` when one exists, and sends the CLI's native compact command through the normal resume/continue path (`/compact` or `/compress`, depending on provider). It does not create a separate `<thread-id>:compaction` summarization session or replay the full transcript for compaction.

If persisted runtime state has no saved native session id, only providers with a documented logical continuation fallback use the thread id as the continuation handle. Providers that require a concrete native session id fail the compact action with an actionable error instead of starting an unrelated fresh compaction session.

When triggered on a connected MCP chat route, the dashboard now sends a hidden control message to the selected live worker, waits for that worker to answer with a hidden compaction result, and then stores the returned markdown as the thread handoff summary. Those internal control messages are excluded from visible thread history, badge counts, previews, and sidebar pending totals.

The compact action then:
- stores the provider's compaction output in `runtimeState.compactionSummary`
- preserves the resolved native provider `sessionIds` for virtual CLI routes after native compaction, including the active native session id when one exists and the logical continuation fallback session id when the provider resumes through the thread id
- refreshes virtual route metadata (`routeKind`, `virtualProvider`, and `modelLabel`) to match the provider that performed compaction
- leaves `sessionIds` empty and keeps `replayRequired` enabled only when no compacted provider session can be continued
- sets `replayRequired` only when a route needs to restart from a stored handoff

The original visible `ConversationMessageRecord` history remains intact in the dashboard. Virtual CLI routes continue from the compacted provider-native session, while any route that must start fresh can replay from the compacted summary plus only the messages created after that summary was generated.


### Repository Read Optimizations

To prevent scanning entire thread collections or loading full message arrays into memory during isolated runtime actions, `ConnectionChatRepository` exposes targeted read operations:
- `getThread` accesses a single thread state immediately (e.g. for single-thread reload scenarios).
- `getFirstReplyAfterMessage` queries exactly one row representing the chronologically first reply after a specific message.

Conversation read SQL is owned by focused helper modules under `src/repositories/connection-chat/`:
- `conversation-thread-query.ts` owns thread lookup and project-scoped thread list queries, including message count, pending dashboard-message count, and visible last-message preview aggregation.
- `conversation-message-query.ts` owns message lookup and thread-scoped message list queries, including hidden-message filtering and first-reply lookup.
- `conversation-query-utils.ts` owns shared row mapping, visibility predicates, and pagination normalization.

`ConnectionChatRepository` remains the compatibility facade for services and routes. It validates project/thread existence, handles write-side behavior and realtime notifications, and delegates read-only thread/message list SQL to the helper modules.

Thread and message list queries use explicit bounded pagination even when callers use the facade's default methods. Thread pages are ordered by newest visible activity, then thread creation time, then thread id for deterministic tie-breaking. Message pages are ordered chronologically by `created_at` and then message id. Hidden internal control messages remain excluded from visible lists, counts, and previews unless a caller explicitly opts into hidden messages; processed dashboard messages remain visible in history but are excluded from pending inbox counts.

### Virtual Provider Management Actions

When operating in virtual provider mode, management actions follow a structured execution path. The `ChatManagementActionService` leverages `StructuredProviderResponseService` to prompt the virtual provider for a strict JSON payload containing `{ replyMarkdown, action }` plus optional prompt suggestions.

If an action is proposed, it is evaluated through the shared `ManagementToolHandler`, aligning the virtual chat's business logic exactly with the connected MCP workers. If the action is approval-gated (e.g., destructive actions), the service returns a non-mutating confirmation result alongside the serialized payload, awaiting user confirmation without altering project state. All exchanges—prompts, JSON parsing results, and execution envelopes—are durably recorded in the invocation history.

### Performance and Metrics Aggregation

To ensure real-time responsiveness on the chat dashboard and maintain thread/connection lists optimally under high scale, we perform aggregation directly inside single query payloads using Common Table Expressions (CTEs).

When querying threads (`listThreads`) or connections (`listConnections`), instead of executing per-row correlated subqueries (like running independent count queries for `message_count` or `pending_message_count` for every single thread returned), the system:
- calculates summary metrics in a `GROUP BY` scope bounded to the active `project_id`.
- joins those aggregate results back to the primary row selection.
- utilizes `ROW_NUMBER() OVER (PARTITION BY thread_id ...)` to effortlessly pull the most recent visible preview text and timestamp alongside these stats.

This keeps index alignments strict, avoids full table scans on global message tables, and ensures O(1) query complexity scaling relative to the number of returned threads or connections in the current project context.

### Invocation Rail Optimistic State

The dashboard invocation rail now inserts an optimistic `dashboard_reply` invocation immediately when a user sends a chat turn, before the server round-trip finishes. Optimistic records use temporary IDs and a pending visual treatment so users can see that execution has started without requiring a page refresh.

After the send request resolves, the client refreshes project invocations and reconciles/removes the optimistic record by its temporary ID. Failed sends remove the optimistic entry to avoid stale phantom records.

To keep long-running invocation statuses current even when realtime events are delayed, the chat page also runs a bounded polling loop (3s interval) while active/pending invocations exist. The loop is cleaned up on unmount and merges refreshed statuses through the existing invocation snapshot pipeline.

Background refreshes preserve the active detail surface whenever a snapshot is already available. Thread and invocation transcripts remain visible while refreshes run, with a lightweight live status message instead of replacing the region with a spinner-only state. Spinner-only loading is reserved for the initial case where no selected-thread or selected-invocation snapshot exists yet.
