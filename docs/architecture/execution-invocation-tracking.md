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

Failed invocations can be explicitly preserved with `preserved_at`. Preservation is used for high-value transcripts such as quota-expensive planning runs that should remain available for operator review. Preserved sprint-scoped invocation rows block sprint deletion through the repository boundary so their transcripts are not removed by a foreign-key cascade.

For supported models, tracking relies on provider-reported usage. For Jules integrations, we compute **estimated** tokens by accumulating input and output characters divided by 4 (the characters-per-token heuristic), keeping it accounted for without inventing authoritative native counts.

### `execution_invocation_messages`
This table records each granular interaction loop in an invocation, preserving the exact sequence of \`system\`, \`user\`, \`assistant\`, and \`tool\` messages. It persists markdown content and parsed JSON arguments for tool calls, serving as a replayable log of an agent's reasoning process.

Before being written to the database, provider-specific conversation turns are normalized and mapped into a standard message format within `src/services/provider-conversation-message-mapper.ts`. This ensures that specialized kinds like reasoning and tool interactions are mapped to correct unified schema values (e.g. keeping reasoning distinct without changing core DB schemas).

Invocation persistence applies a narrow hygiene sanitizer for one known noisy bootstrap case: lines matching `fatal: your current branch 'code-ux-bootstrap-*' does not have any commits yet` are removed before chat-facing invocation message content is written. Other `fatal:` lines and unrelated stderr/stdout remain unchanged so real failures still surface.

## Chat Thread Usage
Execution invocations are heavily used by the Chat page to track activity.
When chat conversations take place (routed to either connected workers or virtual providers), those discrete operations and interactions generate `execution_invocations` with `type === "chat"`.
This provides a clear audit log of the agent's work and prompt history separate from the user-facing `ConversationThreadRecord` and `ConversationMessageRecord` items.
User-facing chat threads show up with `scope === "project"`, while agent background logs and execution runs appear with `scope === "connection"`.

The Chat -> Invocations detail view exposes same-session recovery actions for failed planning invocations. **Restart** preserves the original failed transcript, creates a new invocation row, and resends the full planning prompt while passing the failed provider row's native session id as `continueSessionId` (Claude Code uses `--resume <nativeSessionId>`). **Continue** uses the same native-session resume path but sends only a compact continuation prompt asking the provider to finish and output the complete JSON plan. The replacement invocation has its own provider usage trail; the failed row remains immutable evidence of the quota/error history.

Running invocations can also be cancelled from the same detail header. Cancellation is available for every running invocation type, not just planning. The dashboard posts to `/api/execution/invocations/:invocationId/cancel`; the server requests any registered active dispatch to stop, finds Docker containers by the existing `code-ux.session-id` label from the linked provider/task runtime, kills those containers, marks the provider usage row `cancelled`, and appends a system cancellation message to the invocation transcript. Provider finalizers check the current invocation state before writing terminal status so a cancelled row is not overwritten by a late provider failure while the process unwinds.

## Realtime Synchronization

When an invocation or its messages are created/updated, the server emits a project-scoped realtime event.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: true })\`: Triggered on major state changes like creation and status updates.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: false })\`: Triggered when appending messages to avoid heavy recalculations if only appending content.
- Burst writes are coalesced in \`ExecutionRepository\` per project on the next tick. If any write in the burst requires overview refresh, the coalesced dispatch escalates to \`includeOverview: true\`.

The Live dashboard consumes invocation records through the same project execution snapshot used for runtime events. `getProjectExecutionSnapshot(projectId, { selectedSprintId })` merges three slices into `recentInvocations`: the latest project-wide records, all invocation records for expanded active/paused/queued sprint runs, and all invocation records for the selected sprint. This keeps the Live invocation feed available for stopped or paused sprints even when other sprints have newer activity, while still letting active multi-sprint sessions stream through the existing `project.live.updated` websocket flow. The page-level feed is intentionally summary-level and scoped to the selected sprint when one is selected: status, provider/model, task/sprint context, message count, timing, tokens, and latest error. Task cards filter the same records by task id/task key plus current dispatch and task-run ids to show local invocation activity on the card. Full invocation messages remain loaded on demand from the Chat invocation view.

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

On Code UX restart, runtime recovery reconciles any still-`running` CLI provider invocations before the dashboard rehydrates:
- tracked background CLI sessions recovered from `session-tracking.db` are marked failed because the original owning process exited
- session recovery covers every local CLI provider (`gemini`, `codex`, `claude-code`, `qwen-code`, `opencode`, and `antigravity`) so dashboard session state does not stay `RUNNING` for a provider whose owning process is gone
- Docker-backed invocations are checked against active Docker containers using the `code-ux.session-id` label; if no active container remains, the provider invocation and linked execution invocation are failed and annotated with a recovery message
- stale task-coding execution audit rows also close their linked `session-tracking.db` session when startup recovery reconciles the provider invocation, so the live dashboard does not keep showing a recovered container run as still running

This prevents stale `qa_review` or worker invocations from remaining indefinitely `running` after the underlying container or host process has already exited.

## Relationships

Execution invocations cascade when their parent \`project_id\`, \`sprint_id\`, or \`task_id\` are deleted. They optionally reference \`task_run_id\` or \`dispatch_id\` but function independently to track planning sweeps, conflict resolution, or ad-hoc agent activity.

Additionally, every execution invocation explicitly links to a `provider_invocations` usage row. The execution transcripts stored in `execution_invocation_messages` serve as the replayable prompt history corresponding to the exact token and time consumption recorded in the usage row, allowing the dashboard Stats page to drill down into the exact sequence that generated specific costs.

## Provider Slot Waiting Semantics

When a provider's global concurrency limit is reached, ready tasks are deferred rather than blocked with a failure:
1. The task status remains `PENDING` in memory, allowing the task to be rescheduled and retried on subsequent sprint cycles.
2. A `task_run` record is created or updated to have a `state` of `"PENDING"`, and a linked `task_dispatch` is created with a status of `"queued"`.
3. A durable event of type `"provider_concurrency_wait"` is appended to the `task_run_events` table carrying the `provider`, `currentCount`, and `limit` in its payload. This allows the dashboard to display the slot waiting status and show the usage (e.g., `2/2` waiting for slot) without inventing run-failure or code-execution attempts.
4. During concurrent capacity checks, stale provider reconciliation scans (e.g., checking Docker container availability) are throttled and duplicate forced checks coalesce into a single shared scan to avoid excessive external resource calls.
