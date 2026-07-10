# Execution invocation tracking

Code UX records provider work in `execution_invocations` and `execution_invocation_messages` so the dashboard can show prompt history, live agent transcripts, tool activity, token usage, and terminal status for each provider-backed run.

Provider transcript parsing is intentionally provider-specific at the edge and normalized before persistence. The shared boundary is `ParsedConversationTurn` from `src/infrastructure/providers/cli/provider-logs/provider-conversation-types.ts`, and persistence maps those turns through `src/services/provider-conversation-message-mapper.ts`.

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

## Persistence behavior

`ProviderExecutionService` rewrites invocation messages from structured `ProviderUsageTelemetry.conversation` turns while the provider is running for planning, QA, dashboard/worker replies, setup, remediation, CI and merge repair, task follow-up, and task coding. It clears and rewrites only when structured turns exist, using the JSON representation of the complete mapped message payload as the duplicate-skip signature. Changes to reasoning or assistant text, tool arguments or output, status, timestamps, tokens, or other metadata therefore refresh the transcript even when message counts stay constant, while an identical final payload does not repeat the last live rewrite.

Structured rewrites honor `trackPromptInInvocation` and `trackAssistantInInvocation`. When prompt tracking is disabled, parser-supplied user turns are omitted and caller-owned user messages remain in place. Caller-owned system routing, retry, and audit messages also survive transcript refreshes, while parsed injected context is replaced with the current provider payload. This lets dashboard worker replies stream structured activity without duplicating their pre-seeded prompt.

When a provider or failure mode exposes only final text, Code UX uses a text-only fallback: it appends the sanitized assistant output at completion instead of clearing prior messages. This keeps retry prompts, system audit messages, and manually appended context intact.

## Live telemetry performance

Live provider telemetry is metadata-first. `provider-telemetry-watcher.ts` checks provider/model identity, native session id, stdout/stderr fingerprints, and provider-specific metadata such as session file size/mtime, Qwen log metadata, and Antigravity transcript/database metadata before reading full transcripts or copying provider databases. Unchanged signatures skip full reads, and repeated read failures use bounded backoff until source metadata changes. Antigravity live polls use the same pre-invocation database row cutoff as final collection, so resumed conversations report only current-run usage throughout execution.

Final post-process usage collection remains authoritative. Live telemetry is best effort for dashboard freshness; final collection reconciles the persisted provider usage row when the provider finishes.

## Focused verification

Use focused tests for parser, telemetry, and persistence changes:

```bash
pnpm exec vitest run tests/backend/infrastructure/providers/cli/codex-log-parser.test.ts tests/backend/infrastructure/providers/cli/claude-code-log-parser.test.ts tests/backend/infrastructure/providers/cli/gemini-log-parser.test.ts tests/backend/infrastructure/providers/cli/qwen-log-parser.test.ts tests/backend/infrastructure/providers/cli/opencode-log-parser.test.ts tests/backend/infrastructure/providers/cli/antigravity-log-parser.test.ts
pnpm exec vitest run tests/backend/infrastructure/providers/cli/provider-usage.test.ts tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts
pnpm exec vitest run tests/backend/services/provider-conversation-message-mapper.test.ts tests/backend/services/provider-execution-service.test.ts
```
