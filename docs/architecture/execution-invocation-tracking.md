# Execution Invocation Tracking

## Overview

The `ExecutionRepository` manages `execution_invocations` and `execution_invocation_messages`, a first-class model for tracking context, prompt flows, tool calls, and LLM responses. This architecture provides robust observability, historical context per sprint, and dashboard tracing capabilities without tying invocation solely to single provider usage records.

## Key Structures

### `execution_invocations`
This table represents the high-level LLM request or agent session. It holds metadata such as provider, model, status, and associated task context (if any). It can also point back to native token reporting in `provider_invocations` via `provider_invocation_id`. It keeps a rolled up `message_count` and `last_message_at` for sorting dashboard displays.

Execution invocations span various purposes:
- **Coding & Virtual Planning**: Core orchestration loops.
- **Clarification**: Prompt rewrites or operator clarification flows.
- **QA Coverage**: Automated verification and quality assurance sweeps.
- **Node Flows**: Repeatable node-flow runs and externally observable node steps.

Failed invocations can be explicitly preserved with `preserved_at`. Preservation is used for high-value transcripts such as quota-expensive planning runs that should remain available for operator review. Preserved sprint-scoped invocation rows block sprint deletion through the repository boundary so their transcripts are not removed by a foreign-key cascade.

Planning callers share a pure MCP guidance projection in `src/domain/planning/mcp-planning-guidance.ts`. It derives ETA from the ten most recently started, completed planning invocations for the project and ignores running, failed, cancelled, paused, non-planning, and malformed duration samples. With no usable sample it retains the three-minute composer fallback. Initial guidance schedules its first check at the calculated completion estimate; later checks for a still-running invocation schedule exactly one minute from the explicit check time, even when the estimate has elapsed. Only persisted invocation status determines completion: completed, failed, cancelled, and paused projections are terminal and have no next check, while elapsed ETA alone never implies failure or authorizes a duplicate planning submission.

For supported local CLI models, tracking prefers provider-reported usage. Jules retains a separate remote-session synchronization path that computes **estimated** tokens by accumulating input and output characters divided by 4 (the characters-per-token heuristic), keeping it accounted for without inventing authoritative native counts.

### CLI task-coding lifecycle

A CLI task-coding run deliberately uses two records with different clocks and ownership:

- The long-lived `execution_invocations` row represents the complete Code UX workflow. It is created after cancellation registration and before cancellable workspace/provider preparation, so Chat and Live can truthfully show that preparation is in progress. Its `started_at` is a workflow-observability timestamp, not evidence that a provider is consuming capacity.
- The linked `provider_invocations` row represents only a claimed provider attempt. Code UX creates it atomically when `ProviderConcurrencyService.waitForSlotAndClaim` obtains capacity (or immediately at the equivalent no-limit claim), links it to the existing execution row, and only then starts provider accounting. Provider `started_at`, duration, concurrency occupancy, and token/tool telemetry therefore begin at claim/run time; preparation never manufactures provider activity.
- The workflow owns the execution row's terminal status because Git commit/push and pull-request finalization can continue after the provider has finished. Provider completion releases and closes provider usage, but the execution invocation remains `running` until the whole workflow completes, fails, or is cancelled.

The lifecycle remains truthful across non-happy paths:

- A preparation failure closes the execution invocation as `failed` with the preparation error and creates no provider usage row.
- Cancellation can stop preparation or a provider-capacity wait through the registered dispatch. If cancellation wins before the atomic claim, the execution invocation becomes `cancelled` and no provider row or concurrency/token usage is recorded. If the provider already claimed capacity, the linked provider row is cancelled independently while the workflow row retains the cancellation transcript.
- Runtime shutdown preserves the workspace and leaves recovery to startup reconciliation rather than reporting an invented provider result. Recovery resolves stale workflow/provider state from the durable task run, dispatch, provider row, tracked process, and Docker-container evidence.
- A resumed preserved workspace creates a new workflow execution record. If startup recovery proves that provider work already completed in that same workspace, the new workflow skips a second provider call and continues Git/PR finalization; it does not create duplicate provider usage or attribute the earlier provider's tokens to preparation. Otherwise, a new provider claim creates a new usage row for the resumed attempt.

For each actual provider claim, the execution row's `provider_invocation_id` links to that claim's one usage record. The link is absent before claim, is never a preparation placeholder, and a provider usage row is never shared as the accounting record for unrelated execution invocations. If the provider layer makes a distinct retried claim, that attempt receives its own durable usage row and the execution row is relinked to the current attempt while prior usage history remains intact.

### `execution_invocation_messages`
This table records each granular interaction loop in an invocation, preserving the exact sequence of `system`, `user`, `assistant`, and `tool` messages. It persists markdown content and parsed JSON arguments for tool calls, serving as a replayable log of an agent's reasoning process.

Provider log parsers emit normalized turns in the shared `ParsedConversationTurn` shape. Visible reasoning is represented as `ParsedConversationTurn.kind === "reasoning"` when the provider exposes readable structured transcript data; encrypted, opaque, or summary-free reasoning is not invented from final text alone. Providers may still contribute reasoning token counts to telemetry even when no readable reasoning text exists.

Before being written to the database, provider-specific conversation turns are normalized and mapped into a standard message format within `src/services/provider-conversation-message-mapper.ts`. User turns are persisted verbatim and are not storage-truncated, so long planning prompts remain auditable from the invocation transcript. Reasoning turns remain `role: "assistant"` messages and are distinguished only by `metadata.kind === "reasoning"`, so the existing database schema does not need to change.

During live telemetry, `ProviderExecutionService` rewrites invocation messages from parsed provider conversation turns for every provider-backed invocation type that carries an agent transcript. That includes planning, QA review, dashboard/chat replies, CI repair, merge-conflict repair, memory remediation, setup, task follow-up, and task coding. The rewrite signature is derived from the complete mapped message payload, so changes in reasoning or assistant text, tool arguments, tool output, status, timestamps, tokens, or other persisted metadata trigger a refresh even when the transcript length does not change. An identical final payload does not repeat the last live rewrite.

Structured rewrites honor the caller tracking flags. With prompt tracking disabled, parser-supplied user turns are omitted and caller-owned user messages are retained; caller-owned system routing, retry, and audit messages are also retained while parsed injected context is refreshed with the provider transcript. Dashboard worker replies use this path for live reasoning and tool activity while keeping their pre-seeded user prompt. When a provider only exposes final text, the service falls back to appending the sanitized assistant text instead of replacing earlier retry/history messages.

Provider telemetry uses the richest data the provider actually exposes. Readable reasoning is captured only when the structured parser can reconstruct it; if a provider exposes only token-level reasoning counts or opaque encrypted reasoning, the invocation keeps the token telemetry but does not fabricate a transcript turn.

CLI provider parsers share side-effect-free JSON helpers in `src/infrastructure/providers/cli/provider-logs/usage-parse-utils.ts`. The helpers provide strict JSON object/array parsing for JSONL records and balanced object/array extraction for noisy wrapper output, such as Docker bootstrap lines before a Qwen log array, incidental stdout around `opencode export` payloads, or Gemini startup/cleanup text around a valid response record. Gemini structured stdout is parsed in `provider-logs/gemini-log-parser.ts`; when the CLI exposes request contents or candidate parts, Code UX persists ordered user, assistant, explicit reasoning, tool-call, and tool-result turns together with reported timestamps, per-turn tokens, tool metadata, and statuses. Plain response strings remain assistant transcript text without fabricated reasoning turns. Gemini CLI stats and standard `usageMetadata` are normalized at that parser boundary, including removal of cached tokens from standard prompt totals before mapping them into the shared telemetry fields. Malformed records and wrong-shape payloads are non-fatal: parsers skip the bad record or return `null` for unavailable usage while preserving provider-specific normalization for valid records. Missing usage fields likewise produce `null` usage rather than zeroed reported telemetry, so Code UX does not convert absent provider data into authoritative token counts.

## Provider Parser Contract

All local CLI providers with agent transcripts have structured parser coverage in `src/infrastructure/providers/cli/provider-logs/`:

| Provider | Parser source | Structured transcript sources | Usage isolation contract |
| --- | --- | --- | --- |
| Gemini CLI | `gemini-log-parser.ts` | Structured stdout candidate parts and stats. | Per invocation stdout is already scoped to the process; missing structured stats fall back to estimated telemetry. |
| Codex | `codex-log-parser.ts` | Rollout JSONL session files first, then `codex exec --json` stdout as a fallback. | Rollout token snapshots are cumulative, so parser logic subtracts the last pre-window baseline from later in-window cumulative counts. |
| Claude Code | `claude-code-log-parser.ts` | Session JSONL from the active native session on the host or paired Docker runtime volume. | Session reads are filtered by invocation start time; duplicate assistant message ids replace earlier content and usage snapshots so streamed updates are counted once. |
| Qwen Code | `qwen-log-parser.ts` | OpenAI- or Anthropic-shaped log records read from host-visible or Docker workspace log data. | Timestamped records proven to predate the invocation are excluded, valid untimestamped records remain eligible, and usage parsing accepts both provider token shapes. |
| OpenCode | `opencode-log-parser.ts` | `run --format json` stdout for conversation, `opencode export <sessionID>` for authoritative tokens. | Exports are cumulative for a resumed session, so Code UX subtracts the previous raw export snapshot before persisting current-run usage. |
| Antigravity | `antigravity-log-parser.ts` | Transcript JSONL plus the resolved conversation database. | Database usage rows are cumulative, so `parseAntigravityDatabase` sums only rows with `idx > antigravitySinceIdx` for resumed runs. |

The normalized boundary is `ParsedConversationTurn` from `provider-conversation-types.ts`. Provider parsers should emit only these turn kinds:

- `user`: provider-visible user prompts, including recovered historical prompt records.
- `assistant`: final or streaming assistant text.
- `reasoning`: readable structured reasoning, thinking, or summary fields that the provider exposed as text.
- `tool_call`: tool/function/shell/MCP/web-search calls with `toolName`, `toolCallId`, and `toolArguments` when available.
- `tool_result`: tool/function/shell/MCP outputs with `toolCallId`, `toolName`, `toolOutput`, and provider status when available.
- `injected_context`: harness-injected context such as system reminders that should remain visible without being treated as a user prompt.

Readable reasoning must stay evidence-based. A parser may emit a `reasoning` turn only from provider fields that are explicitly reasoning/thinking/summary content. Plain assistant prose, final answer text, encrypted reasoning blobs, and token-only reasoning counts must not be converted into reasoning transcript turns. Token-level reasoning still belongs in `reasoningOutputTokens` when the provider reports it.

Codex item lifecycle records are keyed by their provider item or call id. Repeated `item.started`, `item.updated`, `item.completed`, and rollout `response_item` records replace the earlier state at its first-seen position, so live transcripts remain ordered without duplicating tools or messages. Item-level usage is normalized onto the resulting turn when Codex reports it; session-level cumulative snapshots remain the source for invocation totals.

`src/services/provider-conversation-message-mapper.ts` is the compatibility boundary from normalized turns into `execution_invocation_messages`. It preserves the existing role union by mapping reasoning to `role: "assistant"` with `metadata.kind = "reasoning"`, injected context to `role: "system"` with `metadata.kind = "injected_context"`, and tool calls/results to `role: "tool"` with `metadata.kind`, tool metadata, capped payload JSON, per-turn tokens, statuses, and timestamps when available. Parser changes must preserve those metadata fields because `ProviderExecutionService` uses the JSON representation of persisted messages as the live rewrite signature.

Text-only fallback is intentionally narrower than structured parsing. When `ProviderUsageTelemetry.conversation` has turns, `ProviderExecutionService` clears and rewrites invocation messages from the normalized transcript. When no structured turns are available and only final text exists, it appends the sanitized assistant output at completion instead of clearing prior messages. That preserves retry prompts, system audit messages, and manually appended context for providers or failure modes that only expose plain text.

Live telemetry follows a metadata-first performance contract in `src/infrastructure/providers/cli/provider-telemetry-watcher.ts`. The watcher checks provider/model identity, native session id, stdout/stderr fingerprints, and provider-specific metadata such as session file size/mtime, Qwen log metadata, and Antigravity transcript/database metadata before reading full transcripts or copying provider databases. Repeated unchanged signatures skip full reads; repeated read failures use bounded backoff until the cheap source signature changes. Antigravity live polls receive the same pre-invocation database row cutoff as final collection, so a resumed conversation never flashes whole-session cumulative usage while it is running.

Focused verification for parser, telemetry, and persistence changes:

```bash
pnpm exec vitest run tests/backend/infrastructure/providers/cli/codex-log-parser.test.ts tests/backend/infrastructure/providers/cli/claude-code-log-parser.test.ts tests/backend/infrastructure/providers/cli/gemini-log-parser.test.ts tests/backend/infrastructure/providers/cli/qwen-log-parser.test.ts tests/backend/infrastructure/providers/cli/opencode-log-parser.test.ts tests/backend/infrastructure/providers/cli/antigravity-log-parser.test.ts
pnpm exec vitest run tests/backend/infrastructure/providers/cli/provider-usage.test.ts tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts
pnpm exec vitest run tests/backend/services/provider-conversation-message-mapper.test.ts tests/backend/services/provider-execution-service.test.ts
```

Invocation persistence applies a narrow hygiene sanitizer for one known noisy bootstrap case: lines matching `fatal: your current branch 'code-ux-bootstrap-*' does not have any commits yet` are removed from provider-output message content before chat-facing invocation messages are written. User prompt content bypasses this sanitizer and is stored exactly. Other `fatal:` lines and unrelated stderr/stdout remain unchanged so real failures still surface.

## Chat Thread Usage
Execution invocations are heavily used by the Chat page to track activity.
When chat conversations take place (routed to either connected workers or virtual providers), those discrete operations and interactions generate `execution_invocations` with `type === "chat"`.
This provides a clear audit log of the agent's work and prompt history separate from the user-facing `ConversationThreadRecord` and `ConversationMessageRecord` items.
User-facing chat threads show up with `scope === "project"`, while agent background logs and execution runs appear with `scope === "connection"`.
The dashboard Chat -> Invocations rail renders only `execution_invocations` returned by the paginated `GET /api/projects/:projectId/execution/invocations` server endpoint. Invocation rows are created by the backend when the routed operation starts or is persisted. Sending a chat message still updates the thread transcript from the returned conversation message immediately, but the invocation rail waits for the persisted backend invocation row instead of inserting a frontend-only optimistic invocation placeholder. `project.execution.updated` and `snapshot_required` are invalidation signals: Chat refetches the authoritative invocation page and selected transcript instead of accepting or manufacturing invocation rows from realtime payloads in the browser.

The 3D Chat cinematic feedback model is independent from the invocation selected in that rail. It considers only the latest running `dashboard_reply` or `worker_reply` owned by the resolved Project Manager preset, ordered by `startedAt` and then invocation id, and loads that invocation's persisted messages through the existing invocation-message endpoint. Its interim copy is restricted to non-empty normalized assistant prose; user/system turns, injected context, reasoning, tool arguments, and tool output never become stage prose. Tool activity is counted by normalized `metadata.toolCallId`, with the stable message id used only when no call id exists, so call/result pairs and repeated refreshes remain one logical count.

`useCinematicInvocationFeedback` refreshes when the foreground invocation changes or its `messageCount`, `lastMessageAt`, or `updatedAt` summary changes. Same-invocation copy remains visible during a refresh, while project/invocation changes abort and generation-invalidate older requests. Terminal or missing invocations clear the projection immediately. Transcript fetch errors stay local and non-fatal; they do not replace the normal chat transcript or activate unrelated project work.

The Chat -> Invocations detail view exposes same-session recovery actions for failed or cancelled planning invocations. **Restart** preserves the original terminal transcript, creates a new invocation row, and resends the full planning prompt while passing the terminal provider row's native session id as `continueSessionId` (Claude Code uses `--resume <nativeSessionId>`). **Continue** uses the same native-session resume path and asks the provider to finish the previous planning attempt; the continuation prompt also embeds the complete original planning instructions. Docker-backed planning runs use a stable project/sprint snapshot workspace and preserve its paired provider runtime volume while the run is failed, cancelled, or incomplete. Restart and Continue reuse that workspace so provider-local session files remain available; they fail closed if the recorded provider conversation is missing and never silently replace it with a fresh planning conversation. Fresh planning invocations in `REMOTE` git mode still refresh `origin` and build a new snapshot from `origin/<branch>`, using the explicit sprint feature branch when present or the effective runtime git default branch otherwise. Successful planning cleans up that workspace and paired runtime volume. The replacement invocation has its own provider usage trail; the terminal row remains immutable evidence of the quota/error/cancellation history.

Startup applies the same contract automatically when a sprint-planning process is interrupted. The original invocation is preserved, the complete request/options are loaded from its durable user-message metadata, and a correlated replacement continues the same logical/native session. A planning request interrupted before any provider row was linked may be reissued from that metadata because there was no previous provider conversation to replace.

Running invocations can also be cancelled from the same detail header. Cancellation is available for every running invocation type, not just planning. The dashboard posts to `/api/execution/invocations/:invocationId/cancel`; the server requests any registered active dispatch to stop, finds Docker containers by the existing `code-ux.session-id` label from the linked provider/task runtime, kills those containers, marks the provider usage row `cancelled`, and appends a system cancellation message to the invocation transcript. Provider finalizers check the current invocation state before writing terminal status so a cancelled row is not overwritten by a late provider failure while the process unwinds.

Invocations waiting on provider usage limits expose a **Reset timer** action when they are still active, have `last_retry_after_iso`, and carry `last_error_category = QUOTA_EXHAUSTED` or `RATE_LIMITED`. The dashboard posts to `/api/execution/invocations/:invocationId/reset-usage-limit`; the server clears the retry timestamp and records a transcript audit message. The provider retry loop watches that persisted timestamp while sleeping, so clearing it wakes the active wait and lets the same invocation retry immediately instead of waiting for the original reset time.

## Node Flow Usage

Node-flow execution uses `execution_invocations` as the dashboard-observable audit surface while keeping graph and run details in the node-flow tables.

Runtime behavior:

- `NodeFlowRuntimeService.runFlow` creates one parent invocation with `type = "node_flow"` and links it from `node_flow_runs.execution_invocation_id`.
- The parent invocation starts as `running`, receives a system start message with `flowId` and flow version metadata, and is updated to `completed`, `failed`, or `cancelled` when the run finishes.
- Externally observable node types create separate invocation rows with `type = "node_flow_node"` and link them from `node_flow_node_runs.execution_invocation_id`.
- Current externally observable node types are `provider_prompt` and `http_request`. Deterministic nodes such as `input`, `set_fields`, `template`, and `output` only create `node_flow_node_runs` rows.
- Provider prompt nodes pass the existing `node_flow_node` invocation id into `ProviderExecutionService` and disable raw prompt/assistant transcript capture for that node-flow prompt.
- HTTP nodes append a redacted request summary to the node invocation. Secret-shaped query keys are redacted before they are written.

The run tables remain the source for node order, node status, flow input/output, trigger payload, and per-node JSON payloads. Those payloads are masked for secret-shaped keys before persistence and before MCP/dashboard responses.

## Realtime Synchronization

When an invocation or its messages are created/updated, the server emits a project-scoped realtime event.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: true })\`: Triggered on major state changes like creation and status updates.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: false })\`: Triggered when appending messages to avoid heavy recalculations if only appending content.
- Burst writes are coalesced in \`ExecutionRepository\` per project on the next tick. If any write in the burst requires overview refresh, the coalesced dispatch escalates to \`includeOverview: true\`.

The Live dashboard consumes invocation records through the same project execution snapshot used for runtime events. `getProjectExecutionSnapshot(projectId, { selectedSprintId })` merges three slices into `recentInvocations`: the latest project-wide records, all invocation records for expanded active/paused/queued sprint runs, and all invocation records for the selected sprint. This keeps the Live invocation feed available for stopped or paused sprints even when other sprints have newer activity, while still letting active multi-sprint sessions stream through the existing `project.live.updated` websocket flow. The REST project execution endpoint returns the full bounded feeds, while the realtime `project.execution.updated` channel remains feed-less for payload size. The page-level feed is intentionally summary-level and scoped to the selected sprint when one is selected: status, provider/model/execution mode, task/sprint context, message and prompt/transcript character counts, timing, tokens, and latest error. Task cards filter the same records by task id/task key plus current dispatch and task-run ids to show local invocation activity on the card. Full invocation messages remain loaded on demand from the Chat invocation view.

Stats does not depend on the heavier Live snapshot for freshness. Its aggregate snapshot and independent System invocation ledger treat `project.execution.updated` and `snapshot_required` as invalidations and refetch their REST sources. The System ledger continues to use the paginated project invocation endpoint, while `project.live.updated` retains its five-second minimum publish interval for the heavier Live snapshot.

SQLite startup schema and migrations both maintain scalar indexes for these live snapshot slices: project/sprint/run invocation recency, provider fallback sprint/run recency for legacy rows, active invocation status recency, task dispatch recency, runtime event recency, and attention item status/update ordering. These indexes intentionally avoid prompt, transcript, markdown, JSON, and other large text fields so dashboard polling stays read-efficient without making provider writes heavy.

The Chat invocation pane force-refreshes the selected running transcript whenever the invocation summary changes its `message_count`, `last_message_at`, `updated_at`, or `status` fields. That keeps live reasoning, tool, and assistant updates visible without navigating away and back, while the message equality check also considers content, tool-call payloads, and metadata so in-place transcript edits do not get collapsed into stale cache entries.

Jules-backed task dispatch now creates a running `execution_invocations` row immediately after the task dispatch/task-run rows are created and the Jules provider slot is claimed. The row is linked to the placeholder `provider_invocations` usage record, then re-keyed to the real Jules session id when the API returns. Live and terminal Jules usage syncs reuse that provider-linked execution invocation, rebuild its transcript, and update estimated usage instead of creating a late duplicate. This makes Jules tasks visible in the Live feed and Chat invocation tab as soon as they are dispatched, while still replacing the initial dispatch placeholder message with the authoritative Jules conversation when available.

Older Jules rows may have task/sprint/run metadata only on their linked `provider_invocations` row because the transcript sync created the `execution_invocations` row after dispatch. Invocation read queries therefore project missing sprint, task, dispatch, and task-run scope from the linked provider usage row. Jules live/terminal sync also backfills that scope when it updates an existing row, so legacy records become physically repaired over time.

## Analytics Projection
The `queryProjectInvocations` query powers paginated dashboard analytics, returning matching invocations alongside a computed summary.
Instead of loading all matching invocation rows into memory to compute metrics (which becomes a bottleneck for large projects),
Code UX computes basic summaries, P95 durations, sprint state aggregations, external API metrics, and errors directly through
bounded SQL queries with typed helpers inside `execution-invocations-query-analytics.ts`. This SQL-side projection ensures high
scalability without compromising filter integrity.

## Startup Recovery

CLI-backed provider invocations now persist their workflow execution mode alongside the session id used to launch the worker.

On Code UX restart, runtime recovery reconciles any still-`running` CLI workflow and provider invocations before the dashboard rehydrates:
- tracked background CLI sessions recovered from `session-tracking.db` are marked failed because the original owning process exited
- session recovery covers every local CLI provider (`gemini`, `codex`, `claude-code`, `qwen-code`, `opencode`, and `antigravity`) so dashboard session state does not stay `RUNNING` for a provider whose owning process is gone
- Docker-backed invocations are checked against active Docker containers using the `code-ux.session-id` label; if no active container remains, the provider invocation and linked execution invocation are failed and annotated with a recovery message
- stale task-coding execution audit rows also close their linked `session-tracking.db` session when startup recovery reconciles the provider invocation, so the live dashboard does not keep showing a recovered container run as still running
- preparation-only task-coding rows without provider linkage are reconciled from their task run, sprint run, and dispatch state; only rows that remain stale without active evidence are failed, so startup does not invent provider usage for preparation
- a preserved workspace with a durably completed provider attempt can resume at Git/PR finalization without claiming capacity or recording the same provider work twice

This prevents stale `qa_review` or worker invocations from remaining indefinitely `running` after the underlying container or host process has already exited.

## Relationships

Execution invocations cascade when their parent \`project_id\`, \`sprint_id\`, or \`task_id\` are deleted. They optionally reference \`task_run_id\` or \`dispatch_id\` but function independently to track planning sweeps, conflict resolution, or ad-hoc agent activity.

Node-flow run rows reference execution invocations with `ON DELETE SET NULL`. Deleting an invocation should not delete the node-flow run history, and deleting a node flow cascades its versions, attachments, run rows, and node-run rows through the node-flow table relationships.

Provider-backed execution invocations link to `provider_invocations` only after a provider claim exists. The execution transcript covers the broader workflow, while the linked usage row covers the exact provider capacity, token, and time consumption for that claim. Preparation-only failures and cancellations legitimately have no provider link and contribute no provider duration, concurrency, or token usage.

`ExecutionRepository` remains the public persistence facade for both sides of this relationship. The table-specific write ownership is split behind that facade: `execution-invocation-writes.ts` owns invocation and transcript mutations, while `provider-invocation-usage-writes.ts` owns provider usage creation, slot-claim creation, provider session association, runtime row association, and usage updates. Both modules preserve the facade's validation behavior, timestamps, returned DTO shapes, and project realtime refresh semantics.

## Provider Slot Waiting Semantics

When a provider's global concurrency limit is reached, ready tasks are deferred rather than blocked with a failure:
1. The task status remains `PENDING` in memory, allowing the task to be rescheduled and retried on subsequent sprint cycles.
2. A `task_run` record is created or updated to have a `state` of `"PENDING"`, and a linked `task_dispatch` is created with a status of `"queued"`.
3. A durable event of type `"provider_concurrency_wait"` is appended to the `task_run_events` table carrying the `provider`, `currentCount`, and `limit` in its payload. This allows the dashboard to display the slot waiting status and show the usage (e.g., `2/2` waiting for slot) without inventing run-failure or code-execution attempts.
4. During concurrent capacity checks, stale provider reconciliation scans (e.g., checking Docker container availability) are throttled and duplicate forced checks coalesce into a single shared scan to avoid excessive external resource calls.
