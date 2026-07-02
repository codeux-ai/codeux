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

For Docker-backed Claude Code runs, Code UX reads the same session JSONL from the paired provider runtime volume mounted at `/code-ux-runtime-home` before the Docker workspace and runtime volumes are cleaned up.

### Antigravity

Antigravity runs with `agy` CLI commands.

Code UX parses session data from two sources:
- **Token usage**: reads the conversation's SQLite database file (`~/.gemini/antigravity-cli/conversations/<id>.db` or fallback path `~/.gemini/antigravity/conversations/<id>.db`). It decodes the custom Protobuf data stored in the latest row of the `gen_metadata` table to extract:
  - `inputTokens`
  - `outputTokens` (falling back to reasoning + candidates if output tokens are zero or missing)
  - `reasoningTokens`
- **Full conversation transcript**: reads the JSONL transcript file (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` or fallback path under `antigravity`). The transcript parser processes:
  - `user` turns from `USER_INPUT` entry types (stripping `<USER_REQUEST>` wrapper tags).
  - `assistant` and `tool_call` turns from `PLANNER_RESPONSE` entry types.
  - `tool_result` turns from `RUN_COMMAND` or `TOOL_RESPONSE` entries.
  - `reasoning` turns from `SYSTEM` source events.

For Docker-backed Antigravity runs, the SQLite database is encoded to Base64 within the container first, and then decoded to a temporary file on the host before parsing to bypass Docker named volume permission issues.

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
- `GET /api/projects/:projectId/stats?window=24h|7d|30d|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - project-scoped statistics snapshot for the Stats page. Custom ranges must be parseable dates, where `from <= to`, and invalid or incomplete ranges fail with validation errors.

Historical Docker-backed CLI invocations that were persisted as `unavailable` before container telemetry fallback support are backfilled at startup when they have prompt or transcript character counts. The backfill marks them as `estimated` using the same conservative character heuristic, preserving rows that already have provider-reported or provider-specific estimated usage.

The stats snapshot includes:

- project totals (including dynamic cost rollups based on typed token-pricing configurations which calculate input, output, and cached input costs in USD based on per-million token rates, defaulting to zero if unset or unconfigured. This relies on a per-snapshot pricing cache to prevent redundant provider/model lookups)
- total provider cost totals (e.g. `providerCost` map)
- total model cost totals (e.g. `modelCost` map)
- usage cost chart series for historical visualization (e.g. `core_total_cost`, `provider_cost_*`)
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
- the trend workspace now presents a compact metric strip, an interactive plot, and a persistent control rail with grouped series switches, zoom controls, and an accessible live summary for the focused bucket
- the usage chart summary surfaces selected-window averages, invocation density, peak active time, and total cost directly from bucket telemetry so the analysis surface reads like a telemetry panel instead of a single-scale line graph
- the stats refactor did not change the snapshot contract or route shape; it only changed how the frontend composes the same project stats payload

## UI Surface

The dashboard now has a dedicated `/stats` page.

The page focuses on:

- the hero keeps the project and window context visible, with preset chips and custom date inputs always available above the mode toggle
- the mode toggle exposes trend, composition, models, reliability, ledgers, and system as primary analysis surfaces
- trend mode uses a compact metric strip, an interactive usage chart, a persistent side rail, and a graph filter menu that only controls series visibility
- chart controls keep hover, keyboard focus, and drag zoom synchronized so the accessible summary and the plot always describe the same bucket
- composition mode emphasizes provider share, token anatomy, and summary cards before deeper ledgers
- models mode emphasizes throughput, success rate, latency, cache efficiency, and model highlights
- reliability mode emphasizes telemetry confidence and provider/source quality before the provider breakdown
- ledgers mode uses tabbed task, sprint, and git ledgers with roving focus and stable badge counts
- system mode uses a controlled filter bar, explicit result counts, and a sortable invocation table with expandable rows for transcript detail
- the system ledger keeps status, purpose, provider, and search outside the table so the operator can reason about the filtered set before reading rows
- loading, error, and empty states use semantic feedback regions and preserve the surrounding layout instead of collapsing the workspace
- the page uses the same stats snapshot contract as before; the sprint refactor only changed presentation and local client state, not the backend route shape or payload fields

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
