# Execution invocation tracking

Code UX records provider work in `execution_invocations` and `execution_invocation_messages` so the dashboard can show prompt history, live agent transcripts, tool activity, token usage, and terminal status for each provider-backed run.

Asynchronous planning guidance uses a shared, side-effect-free domain projection. ETA samples come from the ten most recently started, completed planning invocations for the project; active, unsuccessful, paused, non-planning, and malformed samples are ignored, and no usable history falls back to three minutes. The initial check is scheduled at the calculated ETA. If the invocation is still running when checked, the next check is exactly one minute later even after that ETA has elapsed. Elapsed time alone never changes status or justifies duplicate planning; only completed, failed, cancelled, or paused invocation records produce terminal guidance, always without a next check.

## CLI task-coding lifecycle

CLI task coding uses two durable records with different responsibilities:

- The execution invocation covers the complete Code UX workflow, including cancellable workspace/provider preparation, provider execution, Git finalization, and pull-request finalization. It becomes visible after cancellation registration and before preparation begins, so an early running row means “workflow in progress,” not “provider usage started.”
- The provider invocation is created and linked only when Code UX atomically claims provider capacity. Its `started_at`, duration, concurrency occupancy, and token/tool telemetry begin at claim/run time. Preparation never creates a provider usage placeholder.

The workflow remains truthful on every exit path. Preparation failures close the execution invocation without provider usage. Pre-claim cancellation aborts preparation or capacity waiting and records no provider duration or tokens; post-claim cancellation closes the linked provider usage independently. Runtime shutdown preserves eligible workspace state for startup reconciliation instead of inventing a provider result.

A resumed preserved workspace receives a new workflow execution record. When recovery proves provider work already completed in that workspace, Code UX skips a second provider call and resumes Git/PR finalization without duplicating usage. Otherwise the resumed attempt claims a new provider row. Each actual provider claim has its own usage record; the execution link is absent before claim, never represents preparation, and is not shared as unrelated execution accounting. Distinct retried claims keep distinct provider usage history.

Provider completion does not finish the workflow row by itself. The CLI workflow owns the execution invocation's terminal state because Git and PR work can continue after provider capacity and usage accounting have ended.

Provider transcript parsing is intentionally provider-specific at the edge and normalized before persistence. The shared boundary is `ParsedConversationTurn` from `src/infrastructure/providers/cli/provider-logs/provider-conversation-types.ts`, and persistence maps those turns through `src/services/provider-conversation-message-mapper.ts`.

That mapper keeps the existing message-role contract: readable reasoning becomes an assistant message marked with `metadata.kind = "reasoning"`, injected context becomes a system message, and tool calls/results become tool messages with capped payloads. Provider/model identity, call ids, status, timestamps, and per-turn token evidence remain in message metadata when available.

## Structured provider parsers

All local CLI providers with agent transcripts have structured parser coverage:

| Provider | Parser source | Structured transcript sources | Usage isolation contract |
| --- | --- | --- | --- |
| Gemini CLI | `gemini-log-parser.ts` | Structured stdout candidate parts and stats. | Per invocation stdout is process-scoped; missing structured stats fall back to estimated telemetry. |
| Codex | `codex-log-parser.ts` | Rollout JSONL session files first, then `codex exec --json` stdout as a fallback. | Rollout token snapshots are cumulative, so Code UX subtracts the last pre-window baseline before reporting current-run usage. |
| Claude Code | `claude-code-log-parser.ts` | Session JSONL from the active native session on the host or paired Docker runtime volume. | Session reads are filtered by invocation start time, and duplicate assistant message ids replace earlier content and usage snapshots so streamed updates are counted once. |
| Qwen Code | `qwen-log-parser.ts` | OpenAI- or Anthropic-shaped log records from host-visible or Docker workspace log data. | Timestamped records proven to predate the invocation are excluded, valid untimestamped records remain eligible, and usage parsing accepts both provider token shapes. |
| OpenCode | `opencode-log-parser.ts` | `run --format json` stdout for conversation, `opencode export <sessionID>` for authoritative tokens. | Exported usage is cumulative for a resumed session, so Code UX subtracts the previous raw export snapshot. |
| Antigravity | `antigravity-log-parser.ts` | Transcript JSONL plus the resolved conversation database. | Database usage rows are cumulative, so resumed runs sum only rows with `idx` greater than the stored baseline. |

Parser memory is bounded at the provider edge. Codex and Claude consume JSONL incrementally and
reject oversized records; Qwen projects oversized or excess host records to usage-only objects;
Antigravity copies its database in chunks and scans only the known token fields without recursively
materializing unrelated Protobuf payloads. Shared conversation limits truncate display fields and
retain the newest 2,048 turns without changing provider-reported numeric usage.

The normalized turn kinds are:

- `user`: provider-visible user prompts and recovered historical prompt records.
- `assistant`: assistant text.
- `reasoning`: readable reasoning, thinking, or summary text explicitly exposed by the provider.
- `tool_call`: tool/function/shell/MCP/web-search calls with names, ids, and arguments when available.
- `tool_result`: tool/function/shell/MCP outputs with ids, names, output text, and status when available.
- `injected_context`: harness-injected context such as system reminders.

Readable reasoning must be evidence-based. Parsers emit `reasoning` only from explicit provider reasoning/thinking/summary fields. Plain assistant output, encrypted reasoning blobs, and token-only reasoning counts remain assistant text or token telemetry; Code UX does not fabricate reasoning transcript turns.

Codex item lifecycle records are keyed by their provider item or call id. Repeated `item.started`, `item.updated`, `item.completed`, and rollout `response_item` records replace the earlier state at its first-seen position, so live transcripts remain ordered without duplicating tools or messages. Item-level usage is normalized onto the resulting turn when Codex reports it; session-level cumulative snapshots remain the source for invocation totals.

Gemini accepts both clean JSON stdout and a balanced response object surrounded by startup or cleanup text. Its parser normalizes Gemini CLI stats and standard `usageMetadata`, and preserves request/candidate roles, timestamps, per-turn token evidence, tool metadata, and statuses when those fields are present. Missing usage remains unavailable so the collector can estimate safely; plain response strings remain text-only and never become inferred reasoning.

Across all six parsers, malformed records are isolated: a bad JSON fragment, wrong-shaped payload, unreadable artifact, or malformed database row does not suppress neighboring valid turns or usage. If reported usage is absent, parsing returns unavailable usage rather than authoritative zeroes so the collector can select an estimate where supported. Parsers do not expose raw malformed fragments in diagnostics and never manufacture transcript content from opaque data.

## Persistence behavior

`ProviderExecutionService` rewrites invocation messages from structured `ProviderUsageTelemetry.conversation` turns while the provider is running for planning, QA, dashboard/worker replies, setup, remediation, CI and merge repair, task follow-up, and task coding. It clears and rewrites only when structured turns exist, using the JSON representation of the complete mapped message payload as the duplicate-skip signature. Changes to reasoning or assistant text, tool arguments or output, status, timestamps, tokens, or other metadata therefore refresh the transcript even when message counts stay constant, while an identical final payload does not repeat the last live rewrite.

Structured rewrites honor `trackPromptInInvocation` and `trackAssistantInInvocation`. When prompt tracking is disabled, parser-supplied user turns are omitted and caller-owned user messages remain in place. Caller-owned system routing, retry, and audit messages also survive transcript refreshes, while parsed injected context is replaced with the current provider payload. This lets dashboard worker replies stream structured activity without duplicating their pre-seeded prompt.

When a provider or failure mode exposes only final text, Code UX uses a text-only fallback: it appends the sanitized assistant output at completion instead of clearing prior messages. This keeps retry prompts, system audit messages, and manually appended context intact.

## Live telemetry performance

Live provider telemetry is metadata-first. `provider-telemetry-watcher.ts` checks provider/model identity, native session id, stdout/stderr fingerprints, and provider-specific metadata such as session file size/mtime, Qwen log metadata, and Antigravity transcript/database metadata before reading full transcripts or copying provider databases. Unchanged signatures skip full reads, and repeated read failures use bounded backoff until source metadata changes. Antigravity live polls use the same pre-invocation database row cutoff as final collection, so resumed conversations report only current-run usage throughout execution.

Final post-process usage collection remains authoritative. Live telemetry is best effort for dashboard freshness; final collection reconciles the persisted provider usage row when the provider finishes.

Claude Code JSONL polling is append-only. The watcher retains parser state and an incomplete-line
tail, feeds each appended record through `ClaudeCodeLogAccumulator` once, and persists only the
changed conversation suffix. It does not concatenate and reparse the full growing session on every
poll. Codex similarly ignores fallback `event_msg` user/assistant rows after canonical item records
exist, preventing the same turn from being retained twice.

Jules remains outside this local CLI parser and watcher path. Its remote session synchronizer records its transcript separately and derives estimated usage from accumulated input/output characters; Code UX does not describe those estimates as provider-native token telemetry.

## Dashboard and recovery behavior

Chat's Invocations rail is server-authoritative. It reads the paginated `GET /api/projects/:projectId/execution/invocations` projection; `project.execution.updated` and `snapshot_required` trigger REST refetches for the list and selected transcript instead of creating browser-only invocation rows.

The cinematic feedback model is separate from whichever invocation is selected in that rail. Only the latest running `dashboard_reply` or `worker_reply` for the resolved Project Manager preset is eligible, with `startedAt` and invocation id providing deterministic precedence. The model loads the persisted transcript through the existing invocation-message endpoint and exposes only non-empty normalized assistant prose. User/system turns, injected context, reasoning, tool arguments, and tool output are never promoted into stage copy.

Logical tool activity is deduplicated by normalized `metadata.toolCallId`; a stable message id is the fallback only when no call id exists. The frontend refreshes this projection when the active invocation or its `messageCount`, `lastMessageAt`, or `updatedAt` changes, preserves same-invocation feedback during refresh, and aborts or generation-invalidates stale work after project/invocation changes. Terminal or missing invocations clear the feedback. A transcript request failure remains a local, non-fatal state and does not replace the normal chat transcript or make unrelated work foreground activity.

Startup recovery reconciles stale workflow and provider rows from durable task-run, sprint-run, dispatch, process, and Docker-container evidence. Preparation-only rows can fail without provider linkage, terminal provider rows are reconciled without extending their usage window, and a recovered completed provider attempt may continue from its preserved workspace without a duplicate provider run. Interrupted sprint-planning requests preserve their complete durable options and continue the exact recorded provider conversation in the stable planning workspace; a missing recorded conversation fails closed instead of becoming a fresh session. Only pre-provider interruptions are reissued from durable input because no provider conversation existed yet.

## Focused verification

Use focused tests for parser, telemetry, and persistence changes:

```bash
pnpm exec vitest run tests/backend/infrastructure/providers/cli/codex-log-parser.test.ts tests/backend/infrastructure/providers/cli/claude-code-log-parser.test.ts tests/backend/infrastructure/providers/cli/gemini-log-parser.test.ts tests/backend/infrastructure/providers/cli/qwen-log-parser.test.ts tests/backend/infrastructure/providers/cli/opencode-log-parser.test.ts tests/backend/infrastructure/providers/cli/antigravity-log-parser.test.ts
pnpm exec vitest run tests/backend/infrastructure/providers/cli/provider-usage.test.ts tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts
pnpm exec vitest run tests/backend/services/provider-conversation-message-mapper.test.ts tests/backend/services/provider-execution-service.test.ts
```
