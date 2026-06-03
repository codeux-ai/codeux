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
Docker-backed Gemini invocations also carry the selected provider instance's `mountAuth` and `authPath` through task, QA, dashboard-chat, and compaction paths before the runner builds credential mounts. That keeps JSON-mode telemetry compatible with copied local Gemini OAuth credentials and prevents fallback to an unrelated Google Cloud project.
If a historical or failed run lacks the structured stats envelope, Code UX can still estimate from prompt and transcript text so Docker-backed runs do not remain `unavailable`.

### Codex

Codex runs with `codex exec --json`.

Code UX first looks for `token_count` JSONL events, then normalizes the usage payload via the same shared `prompt/completion/total` adapter used by other providers. This includes safe fallback handling when Codex payloads omit completion counts but provide prompt and total tokens. If JSONL usage is missing, Code UX falls back to session JSON usage, then token estimation using `js-tiktoken` over the prompt plus captured transcript.

### Claude Code

Claude Code runs with a generated native `--session-id`.

Code UX now uses a dedicated parser (`src/infrastructure/providers/cli/provider-logs/claude-code-log-parser.ts`) to read the Claude session JSONL artifacts stored at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`.

The parser handles:
- **Token usage**: accumulates `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` across all unique assistant messages (deduplicated by `message.id` to avoid double-counting streaming fragments).
- **Full conversation transcript**: extracts ordered turns of all kinds:
  - `assistant` turns from `type: "text"` content blocks.
  - `reasoning` turns from `type: "thinking"` blocks (only when non-empty; encrypted thinking blocks are silently skipped).
  - `tool_call` turns from `type: "tool_use"` blocks with tool name, id, and JSON-serialized input.
  - `tool_result` turns from user-entry `type: "tool_result"` content with output and error status.
  - `user` turns from plain user text entries.
- **Backwards compatibility**: legacy bare `{ message: { usage, content } }` entries (produced by older Claude Code versions and container artifact dumps) are handled as assistant turns.
- **Run-window isolation**: when `sinceMs` is provided, only entries at/after `sinceMs - 2000ms` are included, matching the Codex/Qwen convention.

If usage is absent or totals are zero, Code UX falls back to token estimation using `@anthropic-ai/tokenizer` over the prompt plus recovered transcript text.

For Docker-backed Claude Code runs, Code UX reads the same session JSONL from the isolated workspace runtime home (`/workspace/.code-ux-home`) before the Docker volume is cleaned up.

### Jules

Jules does not expose a compatible native token contract. Instead of excluding it, Code UX computes **estimated** tokens for Jules by accumulating input and output characters divided by 4 (the characters-per-token heuristic).

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

Usage data now appears in two read models:

- `GET /api/projects/:projectId/execution`
  - task and sprint execution summaries now include usage rollups
- `GET /api/projects/:projectId/stats?window=24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - project-scoped statistics snapshot for the Stats page

Historical Docker-backed CLI invocations that were persisted as `unavailable` before container telemetry fallback support are backfilled at startup when they have prompt or transcript character counts. The backfill marks them as `estimated` using the same conservative character heuristic, preserving rows that already have provider-reported or provider-specific estimated usage.

The stats snapshot includes:

- project totals
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

## UI Surface

The dashboard now has a dedicated `/stats` page.

It focuses on:

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
- the System stats view now uses a dedicated client-side invocation hook that fetches the project invocation ledger, applies local search/filter/sort state, and derives summary metrics from the filtered result set
- Heavy list views, such as the scrollable lazy-loaded task and sprint ledgers, are backed by a page-scoped progressive list strategy (`useProgressiveList`) that renders items in batches to optimize performance.
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
