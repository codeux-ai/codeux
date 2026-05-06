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
Gemini must keep `--output-format json` enabled even when native MCP settings are injected; current Gemini CLI versions still load MCP settings in JSON mode and include the authoritative `stats` block. The collector records model-level `input`, `cached`, `candidates`, and `thoughts` counts, mapping `thoughts` into `reasoningOutputTokens`.
Docker-backed Gemini invocations also carry the selected provider instance's `mountAuth` and `authPath` through task, QA, dashboard-chat, and compaction paths before the runner builds credential mounts. That keeps JSON-mode telemetry compatible with copied local Gemini OAuth credentials and prevents fallback to an unrelated Google Cloud project.
If a historical or failed run lacks the structured stats envelope, Code UX can still estimate from prompt and transcript text so Docker-backed runs do not remain `unavailable`.

### Codex

Codex runs with `codex exec --json`.

Code UX first looks for `token_count` JSONL events. If those are missing, it falls back to token estimation using `js-tiktoken` over the prompt plus captured transcript.

### Claude Code

Claude Code runs with a generated native `--session-id`.

Code UX reads usage from the persisted Claude session JSONL artifact under `~/.claude/projects/...`. If usage is absent, it falls back to token estimation using `@anthropic-ai/tokenizer` over the prompt plus recovered transcript text.
For Docker-backed Claude Code runs, Code UX reads the same session JSONL from the isolated workspace runtime home (`/workspace/.code-ux-home`) before the Docker volume is cleaned up.

### Jules

Jules does not expose a compatible native token contract. Instead of excluding it, Code UX computes **estimated** tokens for Jules by accumulating input and output characters divided by 4 (the characters-per-token heuristic).

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
- a full-width interactive trend graph (Usage Graph) with hover bucket inspection, staged smooth line-draw animation, and mouse drag zoom selection
- a usage-graph filter submenu (time-window + metric-series controls) that opens inline from the graph header instead of separate execution-lane wrappers
- an embedded grouped metric selector and a persistent right-side selected-metrics rail for configuring the chart series (including Token, Time, and Git series); same-window refreshes preserve user chart selection
- hourly windows keep one-hour hover buckets while rendering visible axis labels every three hours
- alternate composition and reliability views with donut charts
- task, sprint, provider, and purpose leaderboards
- tabbed task and sprint telemetry sections integrated into the Analysis Studio, complete with search, recency, richer token breakdowns, and client-side sorting by date and usage dimensions
- animated donut charts now expose slice-level hover focus with center-detail readouts instead of only static composition rings
- Heavy list views, such as the scrollable lazy-loaded task and sprint ledgers, are backed by a page-scoped progressive list strategy (`useProgressiveList`) that renders items in batches to optimize performance.
- Backend read-model optimizations efficiently supply data to these page-scoped modules, ensuring fast telemetry rendering while **API contracts and routes remain completely unchanged**.

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
