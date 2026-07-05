# Code Quality And Performance Contracts

This page turns recent audit findings into durable implementation guidance for realtime delivery, execution projections, provider telemetry, session sync, and dashboard rendering. It is a maintenance contract, not a release note.

Use this page when changing hot paths that affect `/api/live`, `/api/execution`, provider invocation telemetry, session activity sync, or v2 dashboard task/runtime rendering. The detailed architecture still lives in the linked pages; this page names the invariants, owner files, and focused verification commands.

## Contract Map

| Contract | Keep this true | Primary owner files | Focused verification |
| --- | --- | --- | --- |
| Bounded live snapshots | Live payload assembly must remain server-owned, semantically deduplicated, cached by explicit policy, and scoped to subscribed realtime channels. Do not add browser reconciliation or raw timestamp churn as a change signal. | `src/app/live/project-live-snapshot.ts`, `src/app/lifecycle/dashboard-snapshot-cache.ts`, `src/app/lifecycle/dashboard-snapshot-cache-policy.ts`, `src/services/dashboard-realtime-service.ts`, `src/repositories/dashboard-realtime-event-repository.ts`, `dashboard/src/lib/runtime-snapshot-stability.ts`, `dashboard/src/hooks/use-dashboard-runtime-data.ts` | `pnpm exec vitest run tests/backend/app/live/project-live-snapshot.test.ts tests/backend/app/lifecycle/dashboard-snapshot-cache.test.ts tests/dashboard/v2/lib/live-session-view-model.test.ts` |
| Scoped execution caches | Execution snapshot enrichment must deduplicate task, sprint-run, dispatch, and invocation IDs before rollups and must not introduce per-task follow-up queries. Cache scope and TTL changes belong in the lifecycle cache policy. | `src/repositories/execution/project-execution-snapshot-query.ts`, `src/repositories/execution/execution-usage-query.ts`, `src/repositories/execution/execution-wall-time-query.ts`, `src/repositories/execution/execution-invocations-query.ts`, `src/app/lifecycle/dashboard-snapshot-cache-policy.ts` | `pnpm exec vitest run tests/backend/repositories/execution/project-execution-snapshot-query.test.ts tests/backend/repositories/execution/execution-usage-query.test.ts tests/backend/repositories/execution/execution-wall-time-query.test.ts` |
| Indexed projection slices | Execution snapshots must load bounded SQL slices for sprint runs, dispatches, runtime events, invocations, attention, usage, and wall time, then merge by stable identifiers in memory. Avoid all-history scans, unbounded `ORDER BY`, JSON-expression indexes, and repeated array filters in task loops. | `src/repositories/execution/execution-sprint-runs-query.ts`, `src/repositories/execution/execution-task-dispatches-query.ts`, `src/repositories/execution/execution-runtime-events-query.ts`, `src/repositories/execution/execution-invocations-query.ts`, `src/repositories/execution/execution-human-intervention-query.ts`, `src/repositories/db/app-db-schema.ts`, `src/repositories/db/app-db-migrations.ts` | `pnpm exec vitest run tests/backend/repositories/execution/execution-snapshot-slice-queries.test.ts tests/backend/repositories/execution/execution-task-dispatches-query.test.ts tests/backend/repositories/execution/project-execution-snapshot-query.test.ts` |
| Metadata-first provider telemetry | Live provider telemetry must use cheap metadata and source fingerprints before reading full transcripts or provider databases. Final post-process usage collection remains authoritative, and cumulative-session providers must subtract baselines so resumed runs do not re-report earlier usage. | `src/infrastructure/providers/cli/provider-telemetry-watcher.ts`, `src/infrastructure/providers/cli/provider-runner.ts`, `src/infrastructure/providers/cli/provider-usage.ts`, `src/infrastructure/providers/cli/provider-logs/codex-log-parser.ts`, `src/infrastructure/providers/cli/provider-logs/opencode-log-parser.ts`, `src/infrastructure/providers/cli/provider-logs/antigravity-log-parser.ts`, `src/infrastructure/providers/cli/provider-logs/usage-parse-utils.ts`, `src/repositories/execution/provider-invocation-usage-writes.ts`, `src/repositories/execution/execution-invocations-query.ts` | `pnpm exec vitest run tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts tests/backend/infrastructure/providers/cli/provider-usage.test.ts tests/backend/infrastructure/providers/cli/usage-parse-utils.test.ts` |
| Bounded activity fetches | Session sync must plan the smallest set of active sessions, skip foreign or locally terminal work where possible, cap per-session activity pages, limit concurrency, and timeout provider reads without failing the whole sync loop. | `src/domain/sprint/session-sync/activity-fetch-plan.ts`, `src/domain/sprint/session-sync/bounded-activity-fetch.ts`, `src/sprint/steps/session-sync-step.ts`, `src/server/activity-cache-service.ts` | `pnpm exec vitest run tests/backend/domain/sprint/session-sync/activity-fetch-plan.test.ts tests/backend/domain/sprint/session-sync/bounded-activity-fetch.test.ts tests/backend/sprint/session-sync-step.test.ts tests/backend/server/activity-cache-service.test.ts` |
| Pure dashboard view models | v2 dashboard pages must build task, live runtime, and stats render models through pure helpers before JSX composition. Components should memoize scoped inputs and avoid rebuilding indexes, filter counts, task-card invocation feeds, or board columns inline during render. | `dashboard/src/v2/lib/live-session-view-model.ts`, `dashboard/src/v2/lib/tasks/task-board-view-model.ts`, `dashboard/src/v2/lib/task-board-state.ts`, `dashboard/src/v2/pages/stats/use-stats-page-data.ts`, `dashboard/src/v2/pages/stats/chart-view-models.ts`, `dashboard/src/v2/LiveSessionPage.tsx`, `dashboard/src/v2/TasksPage.tsx` | `pnpm exec vitest run tests/dashboard/v2/lib/live-session-view-model.test.ts tests/dashboard/lib/task-board-view-model.test.ts tests/dashboard/lib/task-board-state.test.ts tests/dashboard/v2/use-stats-page-data.test.tsx` |
| Guardrail-backed regressions | Hot-path regressions must be enforced by typed tests and repository guardrails, not reviewer memory. Keep guardrail checks focused on durable risks: stale artifacts, broad `any`, unsafe dependency placeholders, realtime snapshot persistence, duplicate optimistic insertion, and large duplicate implementation blocks. | `scripts/check-quality-guardrails.mjs`, `tests/backend/scripts/quality-guardrails.test.ts`, `src/shared/late-bound-dependency.ts`, `src/app/dependency-factory/dashboard-factory.ts` | `pnpm run quality:guardrails`, `pnpm exec vitest run tests/backend/scripts/quality-guardrails.test.ts` |

For documentation-only changes, the minimum repository check is still:

```bash
pnpm run lint
```

## Change Rules

### Realtime And Live Snapshots

- Keep `ProjectLiveDashboardSnapshot` assembled on the backend through `getProjectLiveSnapshot`; browser code renders stabilized snapshots and UI-only transport state.
- Deduplicate realtime delivery semantically. Top-level `updatedAt` and transport timestamps are assembly metadata, not sufficient proof that runtime state changed.
- Heavy live payloads stay on dedicated scopes such as `project:<projectId>:live`; do not broaden delivery to generic project scopes without a measured reason.
- Cache policies are explicit runtime contracts. Change TTLs, invalidation keys, or immutable snapshot assumptions only in the cache policy and update tests beside the cache.

Related docs: [Live Runtime Contract](./live-runtime-contract.md), [Execution Dashboard Projection](./execution-dashboard-projection.md), [System Overview](./system-overview.md).

### Execution Projection

- Add new execution fields by extending the relevant slice query and mapper, not by adding dashboard-side joins or polling extra endpoints from the Live page.
- Keep slices visibly bounded: project-recent rows, selected-sprint rows, expanded sprint-run rows, and final payload caps should be explicit in the query module.
- Use indexed scalar columns for hot filters and recency ordering. Avoid indexes over prompt text, transcripts, markdown, large JSON payloads, or provider output blobs.
- When enriching usage, wall time, or invocation data, deduplicate ID sets first and use chunked `IN` queries through existing repository helpers.

Related docs: [Execution Dashboard Projection](./execution-dashboard-projection.md), [Execution Invocation Tracking](./execution-invocation-tracking.md), [Repository Map](./repository-map.md).

### Provider Telemetry

- Treat provider telemetry as metadata-first during a running process: check provider/model identity, native session id, stdout/stderr fingerprints, and provider-specific file metadata before reading full transcripts or databases.
- Preserve the separation between best-effort live telemetry and final authoritative usage collection after provider completion.
- Providers with cumulative session stores, such as Codex rollout files, OpenCode exports, and resumed Antigravity databases, must isolate the current invocation from prior turns before persisting usage.
- Store raw usage payloads when they are needed as future baselines, but keep dashboard rollups on normalized numeric columns and `usage_source`.

Related docs: [Usage Telemetry And Stats](./usage-telemetry-and-stats.md), [Execution Dashboard Projection](./execution-dashboard-projection.md).

### Session Sync And Activity

- Session sync should fetch activity only for sessions that can still change visible task state or runtime messages.
- Keep page size, concurrency, and timeout limits at the fetch helper boundary so provider stalls degrade individual sessions rather than the entire sprint loop.
- Activity sync must preserve ordering after bounded concurrent fetches so task updates stay deterministic.
- Dashboard activity cache changes must maintain bounded fetch concurrency and short negative caching for repeated empty or failing reads.

Related docs: [System Overview](./system-overview.md), [Project Runtime Integration](./project-runtime-integration.md), [Operations Runbook](../operations/runbook.md).

### Dashboard Rendering

- Keep expensive derivation in pure helpers under `dashboard/src/v2/lib/` or focused stats view-model modules. Components should compose already-shaped data.
- Build and pass indexes for execution history before task-level rendering. Do not scan dispatches, runtime events, or invocations once per task card.
- Runtime feeds, task boards, stat tables, and invocation panels must stay bounded with local scroll ownership and `min-w-0`/wrapping rules for long IDs, provider names, branch names, paths, prompts, and errors.
- Pending, stale, empty, and reduced-motion states are part of the rendering contract. Performance fixes must preserve accessible labels, focus behavior, `aria-busy`, and live-region semantics.

Related docs: [Live Runtime Visual System](../dashboard/design-system-live-runtime.md), [Tasks Page Design System](../dashboard/design-system-tasks.md), [Dashboard Guide](../dashboard/dashboard-guide.md), [Stats & Analytics Design System](../dashboard/design-system-stats.md).

### Guardrails And Tests

- If a regression is cheap to detect statically, add or extend a guardrail in `scripts/check-quality-guardrails.mjs` and cover it in `tests/backend/scripts/quality-guardrails.test.ts`.
- If a regression depends on runtime semantics, add a focused Vitest case beside the owning module before broadening to integration tests.
- Do not lower coverage thresholds or loosen guardrails to land hot-path changes. Fix the implementation or narrow the guardrail to the real invariant.

Related docs: [Quality Guardrails](./quality-guardrails.md), [Testing and Quality](../development/testing-and-quality.md).
