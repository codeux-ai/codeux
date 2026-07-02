# Usage Telemetry And Stats

This page describes the provider-usage telemetry model that powers token and time statistics across tasks, sprints, and projects.

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
- `cachedInputTokens` (tracked separately; does not count toward `totalTokens` usage surfaced in the dashboard)
- `outputTokens`
- `reasoningOutputTokens`
- `totalTokens`
- `activeTimeMs`
- `wallTimeMs`
- `invocationCount`
- usage-source counters for `reported`, `estimated`, `unavailable`, and `unsupported`

Rollups are exposed in:

- task summaries
- sprint-run summaries
- project statistics snapshots

## Provider Collection Rules

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

Code UX first looks for `token_count` JSONL events, then normalizes the usage payload via the same shared `prompt/completion/total` adapter used by other providers. This includes safe fallback handling when Codex payloads omit completion counts but provide prompt and total tokens. If JSONL usage is missing, Code UX falls back to session JSON usage, then token estimation using `js-tiktoken` over the prompt plus captured transcript.
Visible Codex reasoning summaries are also preserved as `reasoning` turns when the rollout JSONL or exec stream exposes them, but encrypted or empty reasoning blobs are skipped.

Codex's rollout file (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) is cumulative for the whole session and keeps accumulating across `codex exec resume --last` (used for follow-up/QA-reopened runs and multi-turn retries). `parseCodexRolloutJsonl` isolates each run's own usage by treating the last `total_token_usage` snapshot *before* the run's time window as a baseline and subtracting it from the final cumulative snapshot — otherwise a follow-up would re-report every earlier turn's tokens too, inflating that run's persisted usage.

### Qwen Code

Qwen Code runs via its OpenAI-compatible request/response logging (`enableOpenAILoggingDir`), written to a directory that is reset at the start of every run so usage aggregation only ever sums the current invocation's own log files — unlike Codex/OpenCode, there is no cross-run cumulative counter to isolate.

`src/infrastructure/providers/cli/provider-logs/qwen-log-parser.ts` sums `response.usage` (falling back to a bare top-level `usage` for older loggers) across every logged call in the run. Cached and reasoning token extraction delegates to the shared `parseUsageObject` adapter (also used by Codex), which checks OpenAI-style `prompt_tokens_details.cached_tokens` / `completion_tokens_details.reasoning_tokens` first, then falls back to Anthropic-style `cache_read_input_tokens` + `cache_creation_input_tokens` — relevant because Qwen Code can be configured with `qwenProtocol: "anthropic"` against an Anthropic-compatible backend, whose usage payload doesn't carry OpenAI's `*_details` shape.

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

For Docker-backed Antigravity runs, the SQLite database is encoded to Base64 within the container first, and then decoded to a temporary file on the host before parsing to bypass Docker named volume permission issues.

Each `gen_metadata` row is **one model call**, not a running session total — confirmed empirically against live conversation databases, where a single conversation can carry anywhere from a handful to several hundred rows and consecutive rows' input-token fields fluctuate rather than grow monotonically. The original implementation read only the *latest* row, which under-reported total usage by roughly the number of generations in the run (verified against real data: a 203-generation conversation showed 1,268 input tokens under the old logic vs. 2,372,421 actually used). `parseAntigravityDatabase` now sums every row instead.

There is no official schema for this internal protobuf, so the field mapping is inferred rather than documented: input/output/reasoning/candidates are the same fields the original implementation used, and a new field (proto field 5) is treated as **cached/reused-context tokens** — it's present only on some rows (consistent with proto3 omitting zero-valued fields, i.e. "no cache hit this turn"), and where present its value closely tracks the *previous* row's input tokens (that turn's context, now served from cache on the next one).

Because `agy --conversation=<id>` resumes the same conversation db across follow-up/retry invocations — accumulating `gen_metadata` rows across separate CLI runs just like Codex's rollout file or OpenCode's session store — a resumed run must not re-sum generations an earlier invocation already reported. There's no timestamp column to window by, so instead `ProviderRunner` peeks the db's current highest `idx` *before* a resumed run starts (a lightweight read-only query, self-contained to `provider-runner.ts`/`antigravity-log-parser.ts` — no cross-invocation baseline needs to be persisted or threaded through callers, unlike the OpenCode fix) and only sums rows past that cutoff afterward.

### OpenCode

OpenCode runs with `opencode run --format json`.

Code UX reads the JSON event stream for the transcript, structured conversation turns, and native `ses_...` session id. Because recent OpenCode builds expose authoritative token and cost totals through `opencode export <sessionID>`, Code UX captures that export after the run and stores `info.tokens` plus `info.cost` in `raw_usage_json`, including `cache.read` as `cachedInputTokens`.

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

Overview telemetry uses chunk-safe event loading, preventing the risk of hitting SQLite placeholder limits for large active sprint sets. The duration aggregation strategy bounds memory usage by first executing a lightweight count query (e.g. bounded to 10000 rows by default). To optimize database performance, it calculates perfect percentiles and aggregates directly in memory only if the sample volume is below this cap. If the count exceeds the cap, it falls back to a secondary database scan for exact min/max/avg aggregates, intentionally bypassing detailed sample materialization and percentile calculation to ensure unbounded large histories don't cause OOM errors.

Usage data now appears in two read models:

- `GET /api/projects/:projectId/execution`
  - task and sprint execution summaries now include usage rollups
- `GET /api/projects/:projectId/stats?window=24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - project-scoped statistics snapshot for the Stats page. Custom ranges must be parseable dates, where from <= to, and must remain within documented historical (e.g. Jan 1 2000) and future limits. Invalid, incomplete, inverted, or out-of-bounds custom ranges will fail consistently with validation errors.

Historical Docker-backed CLI invocations that were persisted as `unavailable` before container telemetry fallback support are backfilled at startup when they have prompt or transcript character counts. The backfill marks them as `estimated` using the same conservative character heuristic, preserving rows that already have provider-reported or provider-specific estimated usage.

The stats snapshot includes:

- project totals (including dynamic cost rollups based on typed token-pricing configurations which calculate input, output, and cached input costs in USD based on per-million token rates, defaulting to zero if unset or unconfigured. This relies on a per-snapshot pricing cache to prevent redundant provider/model lookups)
- total provider cost totals (e.g. `providerCost` map)
- total model cost totals (e.g. `modelCost` map)
- usage cost chart series for historical visualization (e.g. `core_total_cost`, `provider_cost_*`)
- model-pricing keys preserve canonical `provider/model` ids when a CLI runtime records one directly (for example `deepseek/...` or `google/...` through a local or gateway-backed provider), instead of forcing that model under the CLI provider's default catalogue namespace. Bare local model names still fall back to stable `custom/<model>` override keys, while legacy `custom/<provider>/<model>` override keys are treated as aliases for `<provider>/<model>`.
- Antigravity pricing uses explicit per-model aliases because Antigravity can route to different underlying model providers. Gemini Antigravity slugs map to Google catalogue ids, Claude thinking slugs map to Anthropic catalogue ids, and GPT OSS maps to the matching Google Vertex catalogue entry.
- active sprint metadata
- the original query (`window`, optional `from`, optional `to`)
- normalized range metadata (`label`, `resolution`, `resolutionLabel`, `from`, `to`, `bucketCount`, `isCustom`)
- adaptive hourly, daily, or weekly buckets depending on the selected range
- `chartSeries` array configuring the graph-series data for the interactive usage chart, expanding the snapshot-contract to align with the shipped response shape (`color`, `signalLabel`, `formatter`)
- task rankings
- sprint rankings
- provider split
- execution-purpose split
- token-source mix

## PR Description Rollups

Automated task and sprint PR descriptions read from the same `provider_invocations` table as the dashboard stats surface. Task PRs must query usage by the persisted task record id (`Subtask.record_id`) when it is present, while continuing to render the human task key (`T01`, `T02`, etc.) in the markdown. Runtime rows are written with the DB task id, so querying by the display key would incorrectly show `unknown` model and "No usage data recorded" for task PRs even though the sprint aggregate has usage.

Billing labels in PR descriptions resolve usage against configured provider instances by provider family plus model before falling back to the family default. This matters when multiple `codex`, `claude-code`, `qwen-code`, or `opencode` instances exist: a primary dashboard-login instance and a custom API/local gateway instance can share the same provider family. The PR composer compares the usage row's model with instance-level `model`, `customModel`, `qwenModelId`, and `openCodeModelId` so Gemma or other gateway-backed usage is not attributed to an unrelated subscription/login instance.

## UI Surface

The dashboard now has a dedicated `/stats` page.

It focuses on:

- uses standard T01 Interaction Motion Tokens (like `MODAL_MOTION.dropdown` and `MODAL_MOTION.fieldStagger`) to preserve layout and respect `prefers-reduced-motion` constraints during graph filter or stat card mode transitions.
- uses standard T04 Feedback Surfaces (`ActionFeedbackRegion`) to provide accessible loading, error, and empty-state recovery paths directly within the page, stats graph, and mode containers.
- explicitly validates custom date ranges in the Hero header and exposes clear accessible error messages immediately when ranges are inverted or incomplete.
- total cost
- total tokens
- The Overview page now reuses project stats telemetry to display a 7-day Total Tokens card for the selected project, maintaining consistency with the Stats page without introducing a separate query path.
- active AI time
- wall runtime
- telemetry confidence
- planning-lane usage
- token anatomy
- source mix
- unified Analysis Studio UX with analysis-mode controls that focus the workspace on trend, composition, or reliability
- standalone execution-purpose telemetry cards in the trend view so purpose context is visible before entering detailed chart analysis
- a richer Trend Studio that adds a window-level summary band, period context chips, the interactive usage chart, and a purpose activity section in a single self-contained analytical flow
- a full-width interactive trend graph (Usage Graph) with hover bucket inspection, staged smooth line-draw animation, and mouse drag zoom selection
- a usage-graph filter submenu (time-window + metric-series controls) that opens inline from the graph header instead of separate execution-lane wrappers
- an embedded grouped metric selector and a persistent right-side selected-metrics rail for configuring the chart series (including Token, Time, and Git series); same-window refreshes preserve user chart selection
- the metric-series flyout groups series under labelled headers for Core, Purposes, Providers, and Git so related worker/provider series stay discoverable as the catalog grows
- hourly windows keep one-hour hover buckets while rendering visible axis labels every three hours
- alternate composition and reliability views with donut charts
- reliability mode now ends with a provider breakdown grid that exposes token anatomy, invocation volume, active time, and telemetry source quality per provider
- the Composition Studio now adds cache-efficiency insight, a token-flow bar, active-versus-wall-time comparison, and a per-provider activity ledger so the provider picture stays visible without switching tabs
- the System stats view uses a controlled filter bar that keeps status, purpose, provider, and search state outside the component so the host view can own query state and result counting explicitly
- that filter bar renders status toggle chips, purpose/provider multi-select chips, a searchable text field with inline clear affordance, and a result-count badge so the system list can stay reactive without local state
- task, sprint, provider, and purpose leaderboards
- tabbed task and sprint telemetry sections integrated into the Analysis Studio, complete with search, recency, richer token breakdowns, and client-side sorting by date and usage dimensions
- a System mode entry in the analysis toggle that provides a dedicated system workspace with a dense ledger surface
- the dedicated SystemStudio workspace now renders a telemetry header, five summary metric cards, the shared system filter bar, and the invocations table in one stacked analysis surface so operational logs stay readable at a glance
- the SystemStudio ledger now includes All, Errors, and System Msgs tabs that pre-filter the already-filtered invocation set before it reaches the table, which keeps the result-count badge and the visible rows aligned
- the system invocation table exposes sortable per-invocation token columns, sticky header controls, status color-coding, sprint/task context chips, loading skeletons, empty states, and expandable detail placeholders for future message panels
- expanded invocation rows now lazy-load a dedicated transcript panel that renders role-specific message cards, preserves long system messages with an inline expand toggle, and falls back to an empty-state message when no transcript exists
- animated donut charts now expose slice-level hover focus with center-detail readouts instead of only static composition rings
- the System stats view uses a dedicated invocation hook that fetches the server-side projected project invocation ledger and trusts the server summary and paginated items for rendering, keeping the frontend main-thread free from large-array processing
- Heavy stats ledger views are backed by a page-scoped progressive list strategy (`useProgressiveList`) that renders items in batches to optimize performance. The Sprints page ledger instead keeps the full sprint collection in its table state and uses its own `Show` selector for deterministic row windowing, so sprint/task totals remain accurate before rows are limited.
- Backend read-model optimizations efficiently supply data to these page-scoped modules, ensuring fast telemetry rendering while **API contracts and routes remain completely unchanged**.
- The Stats page header owns the time-window chips and custom range inputs so the window selector stays visible across all analysis tabs and the shared trend-chart flyout can focus exclusively on metric-series toggles.
- The Live Sprint Clock card now surfaces sprint token totals inline, using compact token formatting for input, output, and cached input values so the live orchestration view can show usage rollups without leaving the sprint surface.

This page is intentionally separate from the live execution view so the live dashboard can stay optimized for orchestration while the Stats page handles historical analysis.

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
