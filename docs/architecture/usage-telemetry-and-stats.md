# Usage Telemetry And Stats

This page describes the provider-usage telemetry model that powers token and time statistics across tasks, sprints, and projects.

For the metadata-first provider telemetry and bounded stats/projection invariants that should guide implementation changes, see [Code Quality And Performance Contracts](./code-quality-performance-contracts.md).

## Purpose

Code UX now tracks CLI-provider execution usage in a DB-native form so the dashboard can answer:

- how many tokens were used
- how much active provider time was spent
- which provider and model produced that usage
- whether counts were provider-reported or estimated
- how usage rolls up by task, sprint, project, provider, purpose, day, and week

This telemetry currently covers:

- virtual planning runs
- CLI task coding runs
- virtual worker CI-fix runs
- virtual worker merge-conflict runs
- clarification runs (prompt rewrites or operator clarification)
- QA coverage runs (automated verification sweeps)

## Storage Model

Usage is persisted in the `provider_invocations` table, which is tightly linked to `execution_invocations` (where the exact prompt and response history, i.e., the transcript, is stored as an invocation thread).

Each row represents one provider invocation and stores:

- project, sprint, task, sprint-run, dispatch, task-run, attention-item, and session scope
- provider, purpose, model, native session id
- started/finished timestamps and active duration
- prompt and transcript character counts
- normalized token counts
- `usage_source`
- provider-native raw usage payload when available

This makes usage first-class instead of trying to infer it from task status rows after the fact. Because usage rows map to an explicit invocation thread via `providerInvocationId`, Code UX preserves full-fidelity drill-downs for every tracked execution context.

## Normalized Usage Fields

The shared usage shape is:

- `inputTokens`
- `cachedInputTokens`
- `outputTokens`
- `reasoningOutputTokens`
- `totalTokens`
- `activeTimeMs`
- `wallTimeMs`
- `invocationCount`
- usage-source counters for `reported`, `estimated`, `unavailable`, and `unsupported`

`inputTokens` is the non-cached input bucket used for full-rate input pricing. `cachedInputTokens` is tracked separately for cache-hit/cache-write visibility and cached-rate pricing. `totalTokens` includes both non-cached input and cached input plus output, so dashboard volume matches the full provider token footprint without charging cached tokens as full-rate input.

Rollups are exposed in:

- task summaries
- sprint-run summaries
- project statistics snapshots

## Provider Collection Rules

### CLI Log Parser Contract

Provider log parsers normalize missing data before `provider-usage.ts` consumes
it. A parser that can read a log source but finds no conversation turns returns
`conversation: []`; it does not omit the field or return `undefined`. Usage
that is absent, malformed, or otherwise unavailable is represented as
`usage: null` and `rawUsageJson: null`. Downstream telemetry code decides
whether that becomes `estimated` or `unavailable` usage, preserving the
persisted provider invocation schema and dashboard API shape.

Malformed JSON fragments are classified by the shared parser utilities without
returning the raw fragment on failure, so synthetic or provider-specific errors
do not carry secret-like transcript content into telemetry diagnostics. Numeric
usage fields are normalized as non-negative counters; missing, zero, malformed,
or negative token fields become `0`, while recoverable mixed payloads continue
to preserve valid input, output, cached, reasoning, and total-token metadata.

Provider-specific usage inference remains intentionally narrow. Codex and Qwen
share the OpenAI-style usage adapter, OpenCode keeps its raw cumulative export
snapshot for resumed-session baselines, and Antigravity continues to document
its internal protobuf mapping as inferred rather than official.

### Gemini

Gemini CLI runs with structured JSON output enabled.

Code UX reads provider-reported token counts directly from the JSON response stats block and treats them as `reported`.
Gemini usage now passes through a shared normalization adapter that maps provider payloads into a canonical `prompt/completion/total` model before persistence. This keeps token accounting stable across `stats.tokens` variants (including partial fields and explicit total fields) while preserving `cached` and `thoughts` as separate tracked dimensions.
Gemini must keep `--output-format json` enabled even when native MCP settings are injected; current Gemini CLI versions still load MCP settings in JSON mode and include the authoritative `stats` block. The collector records model-level `input`, `cached`, `candidates`, and `thoughts` counts, mapping `thoughts` into `reasoningOutputTokens`.
When Gemini's JSON response includes a structured readable candidate transcript, Code UX also reconstructs conversation turns from those parts and surfaces visible thinking as `reasoning` turns. Plain text response blobs do not synthesize reasoning turns on their own.
Docker-backed Gemini invocations also carry the selected provider instance's `mountAuth` and `authPath` through task, QA, dashboard-chat, and compaction paths before the runner builds credential mounts. That keeps JSON-mode telemetry compatible with copied local Gemini OAuth credentials and prevents fallback to an unrelated Google Cloud project.
If a historical or failed run lacks the structured stats envelope, Code UX can still estimate from prompt and transcript text so Docker-backed runs do not remain `unavailable`.

### Codex

Codex runs with `codex exec --json`.

Code UX first looks for rollout JSONL usage, then `codex exec --json` stdout usage, then token estimation using `js-tiktoken` over the prompt plus captured transcript. The rollout parser handles session-cumulative `token_count` snapshots and direct `turn.completed` usage payloads; the exec parser handles current-invocation `turn.completed` payloads from stdout. Both paths normalize usage via the same shared `prompt/completion/total` adapter used by other providers. Codex/OpenAI-style prompt counters can include cached tokens while also reporting `cached_input_tokens` or `*_token_details.cached_tokens`; Code UX subtracts those cached tokens from `inputTokens`, records them in `cachedInputTokens`, and keeps them inside `totalTokens`. This prevents cached context from being double-priced as full-rate input while preserving total token volume. If Codex omits completion counts but provides prompt and total tokens, the parser can infer output from either all prompt tokens or non-cached prompt tokens depending on whether the provider total includes cache.
Codex conversation reconstruction is shared across rollout `response_item` payloads and exec `item.*` payloads. It preserves user and assistant messages, visible reasoning summaries, function and custom tool calls, shell command execution, and paired tool outputs. Developer/system scaffolding and duplicate `event_msg` transcript rows are excluded from canonical conversations; `event_msg` user/assistant rows are used only as a fallback when no canonical item stream is available. Visible Codex reasoning summaries are preserved as `reasoning` turns when the rollout JSONL or exec stream exposes them, but encrypted or empty reasoning blobs are skipped.

Codex token estimation keeps process-local caches bounded for long-running workers. Model encodings are cached with a small LRU cap, and estimated token counts are cached with a larger LRU cap keyed by model, text length, and a SHA-256 digest rather than the full prompt or transcript text. Repeated estimates for the same large text therefore avoid retokenizing without retaining the full content in memory. If a model-specific `js-tiktoken` encoding is unavailable, estimation falls back to the `gpt-4o` encoding; these estimates remain conservative fallback telemetry and never replace provider-native `reported` counts when Codex supplies usage events.

Codex's rollout file (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) is cumulative for the whole session and keeps accumulating across `codex exec resume --last` (used for follow-up/QA-reopened runs and multi-turn retries). `parseCodexRolloutJsonl` isolates each run's own usage by treating the last `total_token_usage` snapshot *before* the run's time window as a baseline and subtracting it from the final cumulative snapshot — otherwise a follow-up would re-report every earlier turn's tokens too, inflating that run's persisted usage.

### Qwen Code

Qwen Code runs via its OpenAI-compatible request/response logging (`enableOpenAILoggingDir`), written to a directory that is reset at the start of every run so usage aggregation only ever sums the current invocation's own log files — unlike Codex/OpenCode, there is no cross-run cumulative counter to isolate.

`src/infrastructure/providers/cli/provider-logs/qwen-log-parser.ts` sums `response.usage` (falling back to a bare top-level `usage` for older loggers) across every logged call in the run. Cached and reasoning token extraction delegates to the shared `parseUsageObject` adapter (also used by Codex), which checks OpenAI-style `prompt_tokens_details.cached_tokens` / `completion_tokens_details.reasoning_tokens` first, then falls back to Anthropic-style `cache_read_input_tokens` + `cache_creation_input_tokens` — relevant because Qwen Code can be configured with `qwenProtocol: "anthropic"` against an Anthropic-compatible backend, whose usage payload doesn't carry OpenAI's `*_details` shape. OpenAI-style cached tokens are subtracted from `inputTokens`; Anthropic-style cache counters are already separate and are not subtracted from `input_tokens`.

### Claude Code

Claude Code runs with a generated native `--session-id`.

Code UX now uses a dedicated parser (`src/infrastructure/providers/cli/provider-logs/claude-code-log-parser.ts`) to read the Claude session JSONL artifacts stored at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`.

The parser handles:
- **Token usage**: accumulates `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` across all unique assistant messages (deduplicated by `message.id` to avoid double-counting streaming fragments).
- **Full conversation transcript**: extracts ordered turns of all kinds:
  - `assistant` turns from `type: "text"` content blocks.
  - `reasoning` turns from `type: "thinking"` blocks and other visible thinking fields on assistant messages (only when non-empty; encrypted thinking blocks are silently skipped).
  - `tool_call` turns from `type: "tool_use"` blocks with tool name, id, and JSON-serialized input.
  - `tool_result` turns from user-entry `type: "tool_result"` content with output and error status.
  - `user` turns from plain user text entries.
- **Backwards compatibility**: legacy bare `{ message: { usage, content } }` entries (produced by older Claude Code versions and container artifact dumps) are handled as assistant turns.
- **Run-window isolation**: when `sinceMs` is provided, only entries at/after `sinceMs - 2000ms` are included, matching the Codex/Qwen convention.

If usage is absent or totals are zero, Code UX falls back to token estimation using `@anthropic-ai/tokenizer` over the prompt plus recovered transcript text.

For Docker-backed Claude Code runs, Code UX reads the same session JSONL from the paired provider runtime volume mounted at `/code-ux-runtime-home` before the Docker workspace and runtime volumes are cleaned up.

### Antigravity

Antigravity runs with `agy` CLI commands.

Code UX parses session data from two sources:
- **Token usage**: reads the conversation's SQLite database file (`~/.gemini/antigravity-cli/conversations/<id>.db` or fallback path `~/.gemini/antigravity/conversations/<id>.db`). It decodes the custom Protobuf data stored in **every** row of the `gen_metadata` table and sums across them to extract:
  - `inputTokens`
  - `outputTokens` (falling back to reasoning + candidates if output tokens are zero or missing, per row)
  - `reasoningTokens`
  - `cachedInputTokens` (inferred field mapping — see below)
- **Full conversation transcript**: reads the JSONL transcript file (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` or fallback path under `antigravity`). The transcript parser processes:
  - `user` turns from `USER_INPUT` entry types (stripping `<USER_REQUEST>` wrapper tags).
  - `reasoning`, `assistant`, and `tool_call` turns from `PLANNER_RESPONSE` entry types, keeping visible planner reasoning ahead of the response text and tool calls it produced.
  - `tool_result` turns from `RUN_COMMAND` or `TOOL_RESPONSE` entries, preserving any available correlation ids and tool names so the matching call/result pair stays traceable in the reconstructed transcript.
  - `reasoning` turns from `SYSTEM` source events.
  - Role/parts transcript rows and overview-style nested entry rows, including Gemini-style `functionCall` and `functionResponse` parts, when Antigravity emits those instead of the older entry-type names.

For Docker-backed Antigravity runs, the SQLite database is encoded to Base64 within the container first, and then decoded to a temporary file on the host before parsing to bypass Docker named volume permission issues.

## Live Watcher Polling

The live provider telemetry watcher polls once after startup and then at a 1.5 second cadence while the provider command is active. Each poll builds a cheap metadata signature first. That signature includes:

- provider and model
- resolved native session id when one is known
- stdout and stderr stream signatures
- provider-specific metadata for transcript/log sources
- Antigravity database metadata when the source conversation database can be statted before copying it

When the metadata signature matches the last successful telemetry emission, the watcher skips full transcript/log reads and skips Antigravity temporary database refreshes. This is the primary fast path for Claude Code JSONL, Codex rollout JSONL, Qwen Code OpenAI logs, and Antigravity log/transcript/database sources. When metadata helpers are unavailable, such as Docker reads or older tests/callers, the watcher falls back to the full read path so telemetry emissions are not dropped.

Provider metadata helpers must return a stable string that changes when the underlying source changes. Current helpers use file name, size, and integer mtime for single files or sorted directory entries. Missing-but-valid sources should return a sentinel such as `missing` or `none`; an unavailable helper is represented by omitting the helper entirely, which deliberately disables the metadata fast path for that provider. Antigravity performs one additional signature pass after the conversation id is parsed from the log so the resolved id, transcript metadata, and database metadata all participate before deciding whether to read the transcript or refresh the temporary database copy.

Repeated watcher read failures are logged at bounded checkpoints with provider/session context, and watcher shutdown clears active polling before removing any temporary Antigravity database copy once.

Each `gen_metadata` row is **one model call**, not a running session total — confirmed empirically against live conversation databases, where a single conversation can carry anywhere from a handful to several hundred rows and consecutive rows' input-token fields fluctuate rather than grow monotonically. The original implementation read only the *latest* row, which under-reported total usage by roughly the number of generations in the run (verified against real data: a 203-generation conversation showed 1,268 input tokens under the old logic vs. 2,372,421 actually used). `parseAntigravityDatabase` now sums every row instead.

There is no official schema for this internal protobuf, so the field mapping is inferred rather than documented: input/output/reasoning/candidates are the same fields the original implementation used, and a new field (proto field 5) is treated as **cached/reused-context tokens** — it's present only on some rows (consistent with proto3 omitting zero-valued fields, i.e. "no cache hit this turn"), and where present its value closely tracks the *previous* row's input tokens (that turn's context, now served from cache on the next one).

Because `agy --conversation=<id>` resumes the same conversation db across follow-up/retry invocations — accumulating `gen_metadata` rows across separate CLI runs just like Codex's rollout file or OpenCode's session store — a resumed run must not re-sum generations an earlier invocation already reported. There's no timestamp column to window by, so instead `ProviderRunner` peeks the db's current highest `idx` *before* a resumed run starts (a lightweight read-only query, self-contained to `provider-runner.ts`/`antigravity-log-parser.ts` — no cross-invocation baseline needs to be persisted or threaded through callers, unlike the OpenCode fix) and only sums rows past that cutoff afterward.

If the Antigravity database is missing, malformed, missing `gen_metadata`, or has no rows after the resume cutoff, `parseAntigravityDatabase` returns a structured result with `usage: null`, `rawUsageJson: null`, and `lastIdx: null` unless malformed rows were seen, in which case `lastIdx` records the highest inspected row. Transcript parsing separately returns `[]` for empty or malformed-only transcript files.

### OpenCode

OpenCode runs with `opencode run --format json`.

Code UX reads the JSON event stream for the transcript, structured conversation turns, and native `ses_...` session id. Because recent OpenCode builds expose authoritative token and cost totals through `opencode export <sessionID>`, Code UX captures that export after the run and stores `info.tokens` plus `info.cost` in `raw_usage_json`, including `cache.read` as `cachedInputTokens`. The normalized numeric columns subtract `cache.read` from `inputTokens`, but the stored `raw_usage_json` keeps the provider's cumulative raw `tokens.input` value so the next resumed run can subtract an accurate baseline.

The JSON stream parser accepts both flattened `run --format json` events and wrapped native event envelopes for `session.created`, text, reasoning, tool, step-finish, and assistant-message updates. The export parser still treats `opencode export` as authoritative when present, and also tolerates nested current payloads such as session data under `data.session` in noisy stdout.

`opencode export` reports totals **cumulative for the whole session**, and resuming a session (follow-up task runs, QA-reopened runs, provider retries, and dashboard chat replies that continue an earlier turn) all pass `--session <id>` to keep using it. Without correction this means every resumed invocation would re-report all of the session's prior tokens on top of its own, inflating that invocation's persisted usage each time it happens (compounding further on longer follow-up chains). `subtractOpenCodeBaseline` (`opencode-log-parser.ts`) corrects for this: callers that resume a session look up the previous invocation's raw `{ tokens, cost }` export snapshot for that same session/purpose and pass it through `collectProviderUsageTelemetry`'s `opencodeBaselineUsage`, which is subtracted from the freshly exported cumulative totals so only the current run's own tokens are recorded. The stored `raw_usage_json` itself is left as the fresh, unadjusted snapshot so it can serve as the baseline for the *next* follow-up. This baseline is threaded through every known session-resuming call path: `execute-provider-stage.ts` (task coding), `quality-assurance-service.ts` (QA follow-up implementation passes), the in-process retry loops inside `ProviderExecutionService.executeProvider` and `StructuredProviderResponseService.executeAndParse`, and dashboard chat continuations (`chat-thread-runtime-service.ts` → `chat-management-action-service.ts`).

Stats pricing still prefers configured model-pricing overrides and catalogue token rates. If those are unavailable for an OpenCode model, the stats aggregation falls back to the provider-reported `raw_usage_json.cost` total so OpenCode runs with gateway-specific or hosted model ids do not display as zero-cost when the provider reported a cost.

### Jules

Jules does not expose a compatible native token contract. Instead of excluding it, Code UX computes **estimated** tokens for Jules by accumulating input and output characters divided by 4 (the characters-per-token heuristic).

During live synchronization (`syncLiveInvocation`), expected 404 responses indicating that a session or activity stream is unavailable are handled gracefully: they are logged at the debug level and skipped to avoid spamming the logs with warnings. For terminal sync (`calculateAndSaveUsageForTask`), the system is conservative: if the session returns a 404, it skips creating a new usage record to prevent saving "fake" empty records unless an existing prompt or usage record is already present to allow safe estimation.

## OpenTelemetry Integration

Code UX provides a lightweight, dependency-free OpenTelemetry module at `src/infrastructure/providers/cli/otel-span-collector.ts` that:

1. **Configures CLI providers for OTLP export** via `buildOtelEnv(opts)` — returns an env-var fragment that enables Claude Code's native telemetry:

   ```
   CLAUDE_CODE_ENABLE_TELEMETRY=1
   OTEL_METRICS_EXPORTER=otlp
   OTEL_LOGS_EXPORTER=otlp
   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```

   Optional flags include `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_LOG_USER_PROMPTS`, and `OTEL_LOG_TOOL_DETAILS`.

2. **Collects spans via `OtelSpanCollector`** — a buffered HTTP/JSON OTLP exporter that:
   - Batches spans and logs and flushes them to `/v1/traces` and `/v1/logs`.
   - Operates as a no-op when no endpoint is configured (never breaks the agent path).
   - Supports auth headers, service-name resource attributes, and configurable batch size and export timeout.

3. **Builds provider spans via `buildProviderSpan(args)`** — creates OTLP spans aligned with the OpenTelemetry GenAI semantic conventions draft:
   - `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_creation_tokens`, `gen_ai.usage.cache_read_tokens`, `gen_ai.usage.reasoning_tokens`.
   - Provider extensions: `provider.session_id`, `provider.execution_mode`, `provider.cwd`, `provider.conversation_turns`, `provider.duration_ms`.

4. **Builds log records via `buildProviderLogRecord(args)`** — ties INFO/WARN/ERROR log records to a trace/span context.

The `OtelSpanCollector` is designed to be instantiated once per server process and reused across all provider invocations. The entire module has zero npm dependencies beyond Node.js built-ins.

## Usage Source Semantics

`usage_source` is one of:

- `reported`
  - provider gave authoritative counts
- `estimated`
  - Code UX calculated counts from the conversation text
- `unavailable`
  - the provider ran but no counts could be derived
- `unsupported`
  - provider intentionally does not participate in token telemetry

The dashboard must show these states explicitly and must not invent fake precision.

## Dashboard API Surface

Overview telemetry uses chunk-safe event loading, preventing the risk of hitting SQLite placeholder limits for large active sprint sets. The duration aggregation strategy still bounds memory usage by counting first and only materializing detailed samples when the result set is small enough to do so safely.

Usage data now appears in two read models:

- `GET /api/projects/:projectId/execution`
  - task and sprint execution summaries now include usage rollups
- `GET /api/stats/header-throughput?projectId=<id>&window=20s|1h|24h|7d|30d|all`
  - app-wide token-throughput snapshot for the dashboard header, with an optional selected-project section when `projectId` is supplied. The endpoint reads directly from `provider_invocations`, returns zero-filled numeric aggregates for empty windows, and rejects empty, unknown, or malformed `projectId` values instead of returning a misleading project subtotal. It is intentionally small: generated time, aligned range metadata, app totals, nullable project totals, token anatomy, invocation count, active provider time, and tokens per minute.
- `GET /api/projects/:projectId/stats?window=1h|24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - project-scoped statistics snapshot for the Stats page. Custom ranges must be parseable dates, where `from <= to`, and invalid or incomplete ranges fail with validation errors.

The header throughput endpoint is a compact read model for shell chrome, not a replacement for the project stats snapshot. It shares the same normalized token columns and preset semantics, but it avoids per-project fan-out by aggregating the whole app and optional selected-project totals in one backend call. The top navigation uses the `20s` preset and displays the app-wide value, so the backend reads the last four aligned 5-second telemetry buckets, including the current partial bucket. The live `20s` window is activity-based: it filters on `provider_invocations.updated_at`, then calculates `tokensPerMinute` from the selected invocations' active provider duration (`total_tokens / activeTimeMs`). That avoids treating a long-running invocation's cumulative token total as if it was all produced inside the last 20 seconds. Longer historical windows keep the existing `started_at` filter and the same active-provider-duration rate. The frontend polls the compact endpoint once per second, keeps a 20-point in-memory trace, and renders a stats-card-style sparkline by comparing the latest `tokensPerMinute` value with the previous snapshot: increases append a short rise above the 90% band, decreases append a dip below it, nonzero steady throughput settles back near 90%, and zero throughput falls to baseline. The sparkline morphs one stable green path forward as new points arrive instead of restarting a stroke-draw animation or remounting a differently colored shape on each tick. The endpoint itself does not return a sparkline series. Narrow `provider_invocations(updated_at DESC)` and `provider_invocations(started_at DESC)` indexes keep live and historical app-wide lookups bounded without adding a wide write-heavy covering index. The full project stats route remains the source for bucketed charts, task/sprint/provider/model ledgers, git rollups, pricing, status counts, custom date ranges, and Stats page behavior.

Historical Docker-backed CLI invocations that were persisted as `unavailable` before container telemetry fallback support are backfilled at startup when they have prompt or transcript character counts. The backfill marks them as `estimated` using the same conservative character heuristic, preserving rows that already have provider-reported or provider-specific estimated usage.

Historical provider-reported rows created before the v2 token-accounting contract are normalized once at startup via `provider_invocations.token_accounting_version`. Legacy Codex/OpenCode rows have cached tokens subtracted from `input_tokens` while leaving total token volume intact; legacy Gemini, Claude Code, and Antigravity rows have `total_tokens` raised to include their already-separate cached input bucket. Rows are marked version `2` after the migration so restart recovery never subtracts or adds the cached bucket twice.

The stats snapshot includes:

- project totals (including dynamic cost rollups based on typed token-pricing configurations which calculate non-cached input, output, and cached input costs in USD based on per-million token rates, defaulting to zero if unset or unconfigured. This relies on a per-snapshot pricing cache to prevent redundant provider/model lookups)
- total provider cost totals (e.g. `providerCost` map)
- total model cost totals (e.g. `modelCost` map)
- usage cost chart series for historical visualization (e.g. `core_total_cost`, `provider_cost_*`)
- model-pricing keys preserve canonical `provider/model` ids when a CLI runtime records one directly (for example `deepseek/...` or `google/...` through a local or gateway-backed provider), instead of forcing that model under the CLI provider's default catalogue namespace. Bare local model names still fall back to stable `custom/<model>` override keys, while legacy `custom/<provider>/<model>` override keys are treated as aliases for `<provider>/<model>`.
- Antigravity pricing uses explicit per-model aliases because Antigravity can route to different underlying model providers. Gemini Antigravity slugs map to Google catalogue ids, Claude thinking slugs map to Anthropic catalogue ids, and GPT OSS maps to the matching Google Vertex catalogue entry.
- active sprint metadata
- the original query (`window`, optional `from`, optional `to`)
- normalized range metadata (`label`, `resolution`, `resolutionLabel`, `from`, `to`, `bucketCount`, `isCustom`)
- preset ranges are half-open and bucket aligned while still including the latest current bucket: `1h` returns exactly twelve 5-minute buckets through the current 5-minute bucket, `24h` returns exactly twenty-four hourly buckets through the current partial hour, and daily presets include the current UTC day. The normalized `range.to` is the exclusive end of that latest bucket, so the existing `started_at >= from` and `started_at < to` query shape includes fresh partial-bucket telemetry without changing SQL predicate semantics.
- adaptive hourly, daily, or weekly buckets depending on the selected range
- `chartSeries` array configuring the graph-series data for the interactive usage chart, expanding the snapshot-contract to align with the shipped response shape (`color`, `signalLabel`, `formatter`)
- task rankings
- sprint rankings
- provider split
- execution-purpose split
- token-source mix
- the trend workspace now presents a compact toolbar for selected range, bucket count, resolution, active zoom, reset, and graph filters, plus an interactive plot and persistent control rail with grouped series switches and an accessible live summary for the focused bucket
- the usage chart summary surfaces selected-window peak tokens, peak active time, average tokens, peak invocations, invocation density, and total cost directly from bucket telemetry so the analysis surface reads like a telemetry panel instead of a single-scale line graph
- the focused-bucket panel shows date, cost, tokens, active time, invocations, and enabled-series values in wrapping rows so compact viewports preserve exact values without clipping labels or pushing the chart edge
- chart-series grouping and reset state are frontend view-model concerns: the full-width switch band and graph filter menu share ordered sections with active, total, and default-enabled counts. Reset restores snapshot defaults through the same enabled-series state used by individual switches, enable-defaults re-enables default series without hiding other selected series, and the last enabled series is guarded so the chart never collapses to an empty state.
- the stats refactor did not change the snapshot contract or route shape; it only changed how the frontend composes the same project stats payload

## PR Description Rollups

Automated task and sprint PR descriptions read from the same `provider_invocations` table as the dashboard stats surface. Task PRs must query usage by the persisted task record id (`Subtask.record_id`) when it is present, while continuing to render the human task key (`T01`, `T02`, etc.) in the markdown. Runtime rows are written with the DB task id, so querying by the display key would incorrectly show `unknown` model and "No usage data recorded" for task PRs even though the sprint aggregate has usage.

Billing labels in PR descriptions resolve usage against configured provider instances by provider family plus model before falling back to provider-family matches. This matters when multiple `codex`, `claude-code`, `qwen-code`, or `opencode` instances exist: a primary dashboard-login instance and a custom API/local gateway instance can share the same provider family. The PR composer compares the usage row's model with instance-level `model`, `customModel`, `qwenModelId`, and `openCodeModelId` so Gemma or other gateway-backed usage is not attributed to an unrelated subscription/login instance. Dashboard credential paths under `~/.code-ux/credentials/...`, mounted local auth, and Jules are treated as subscription/local-login usage.

`provider_invocations` currently stores provider family plus model, not the exact provider config id. If several same-family/same-model provider configs match a usage group and those configs mix API-key and dashboard/local-login auth, PR descriptions classify the group as subscription/local-login rather than claiming an API-billed charge that cannot be proven from the stored invocation row. The rendered cost lines separate estimated metered cost from included usage estimates, and any combined total is labeled as a reference total rather than an actual bill; automated PR descriptions do not add a separate non-billed invocation notice.

## UI Surface

The dashboard now has a dedicated `/stats` page.

The page focuses on:

- the hero keeps project, sprint, snapshot freshness, range resolution, and active-mode context visible, with wrap-first preset chips and explicit custom date inputs above the mode toggle
- the mode toggle exposes trend, composition, models, reliability, ledgers, and system as primary analysis surfaces
- trend mode uses a compact metric strip, an interactive usage chart, a persistent side rail, and a graph filter menu that only controls series visibility
- chart controls keep hover, keyboard focus, and drag zoom synchronized so the accessible summary and the plot always describe the same bucket
- composition mode emphasizes provider share, token anatomy, cache efficiency, purpose activity, and provider activity ledgers as grouped modules
- models mode emphasizes ranked model cards with consistent metric grids, provider identity, throughput, success rate, latency, cache efficiency, and model highlights
- reliability mode emphasizes provider health, telemetry confidence, reported/estimated/unavailable mix, and data-integrity notes before the provider breakdown
- ledgers mode uses sticky tabbed task, sprint, and git ledgers with roving focus, stable badge counts, unified controls, conditional git availability, dense row cards, visible/leader share metrics, token-flow bars, and git churn bars
- system mode uses a sprint-state overview, invocation-health snapshot, failure analysis, external API activity, and invocation records area so operational signals stay grouped by the action they support
- the system record area keeps search, status, purpose, provider, error-category chips, active record tabs, result counts, and pagination in a responsive toolbar that wraps instead of clipping controls
- the system invocation table preserves semantic column headers while using dense responsive rows, provider/model labels, token and duration columns, table-owned loading/error/empty states, and expandable transcript detail rows
- invocation transcripts render long prompts, system messages, and error text with copy-safe wrapping so details remain readable without horizontal scrolling
- loading, error, and empty states use semantic feedback regions and preserve the surrounding layout instead of collapsing the workspace
- the page uses the same stats snapshot contract as before; the sprint refactor only changed presentation and local client state, not the backend route shape or payload fields
- each visual mode opens with a balanced summary deck of compact executive cards. Trend emphasizes tokens, active time, cost, invocation health, cache rate, and token velocity; composition emphasizes provider, token, source, purpose, and git-blocker mix; models emphasizes active models, top model, latency, success, cache, and velocity highlights; reliability emphasizes provider health, telemetry confidence, failures, retry signals, and fallback quality; ledgers emphasizes task, sprint, pull request, diff, and conflict scope; system emphasizes invocation, provider, model, source, and outcome health.
- the top metric cards preserve the stats snapshot contract and use low-data labels such as "No data", "No tokens", "No runs", or "Low data" when telemetry is unavailable so empty windows do not imply meaningful zero performance.

This page is intentionally separate from the live execution view so the live dashboard can stay optimized for orchestration while the Stats page handles historical analysis.

The same telemetry bounds are also exposed through the `manage_telemetry` MCP tool, which mirrors the dashboard telemetry requests and allows programmatic inspection of execution snapshots, task dispatches, sprint runs, invocations, and individual execution invocation messages (via `list_execution_invocation_messages`).

## Realtime And Refresh

Project stats refresh on:

- project execution websocket invalidation
- project structure websocket invalidation
- polling fallback

That keeps the stats page current without coupling it to the high-frequency live timeline renderer.

## Design Constraints

The telemetry model is designed for future exact reporting across:

- per task
- per sprint
- per project
- per provider
- per execution purpose
- per day
- per week

Because the canonical source is per invocation, additional reporting surfaces can be added later without changing how usage is recorded.


### ProviderTelemetryWatcher

Live provider telemetry polling is extracted into `ProviderTelemetryWatcher`. This helper is responsible for the periodic read of provider log artifacts during an active session (e.g. while `provider-runner` waits for the CLI to complete). It handles the polling loop, background error swallowing, and temporary database cleanup without affecting the core completion result. Note that telemetry emitted by `ProviderTelemetryWatcher` is best-effort for live dashboarding; the final usage data collected by `ProviderRunner` after process exit remains authoritative.

Client-side chart state persistence (such as enabled chart series) is sanitized and reconciled client-side and is scoped per project id to prevent visual regressions when switching between projects.
