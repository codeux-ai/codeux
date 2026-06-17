# Dashboard Resource Layer

This page describes the shared dashboard resource provider, resource caching, and the page-scoped module boundaries that optimize the v2 frontend architecture.

## Overview

The dashboard resource layer manages data fetching, caching, and invalidation for the v2 project-management UI. It shifts the dashboard from global, monolithic state to page-scoped module boundaries and a progressive rendering strategy.

Importantly, **API routes and backend contracts remain unchanged**. The optimizations are entirely focused on frontend read-model consumption, backend read-model projection efficiency, and client-side rendering.

To support cleaner, more testable backend projections, `ProjectRuntimeRepository` has been split into narrower modules (`RuntimeContextStore` and `RuntimeStatusProjection`) under `src/repositories/project-runtime/`. This modularization decouples persistence and caching from the actual live status assembly, ensuring that runtime state aggregation remains easy to trace and test independently.

## Shared Resource Provider

Data fetching is governed by a unified resource layer rather than ad-hoc `useEffect` blocks. The shared resource provider ensures that:
- Requests for the same resource key within a page are deduplicated.
- Reusable cache payloads map project and sprint contexts so switching selected sprints does not repeatedly refetch unchanged baseline data.
- Stale data is preserved during background refreshes to prevent UI flashing.
- Live runtime polling keeps the last non-empty sprint status and execution snapshot while active work is still present, preventing the live page from flashing into the empty "Awaiting sprint decomposition" state during transient refresh gaps.
- Live runtime status aggregation and task activity hydration run through the same `processDashboardTasks` projection so counters, task cards, and race placement stay phase-consistent during post-coding polling.
- Live task cards, DAG nodes, filter counts, and timing summaries now share one runtime projection that merges stable project task structure with `/api/status`, execution dispatches, and terminal runtime events before rendering.
- Active status refreshes preserve prior session/provider/branch/PR metadata when a transient `/api/status` poll returns the same task without those ephemeral runtime fields, preventing live cards from dropping context between updates.
- The Live page now waits for the resolved sprint scope from the header selection before loading sprint-filtered task data; while that selection is still hydrating, it uses the runtime status `sprint_id` as the fallback scope instead of widening to project-wide "All Sprints".
- Project status is dynamically derived from `has_active_runs` (active/queued sprint runs or sprints with status `'running'`). If a project has no active runs, its status is mapped to `"idle"` even if the database status column is stale (e.g. from crashed processes or sprint deletions).
- Sprints only show as `"running"` if their latest sprint run status is `"queued"` or `"running"`. If a sprint run is completed, failed, cancelled, or does not exist, the effective sprint status falls back to `"idle"`.
- Header telemetry metrics (`TelemetryStats`) filter task counts to only include running and queued tasks belonging to actively running sprints.
- Cache invalidation is coordinated through realtime websocket events.
- Silent websocket/poll refreshes are deduplicated per resource, but a foreground refresh that supersedes an in-flight silent refresh must clear that silent dedupe handle. This prevents navigation or manual refresh from leaving future silent invalidations attached to an already-aborted request.
- In-flight project-level requests are abort-safe: if a shared project-level request is aborted by its initial caller unmounting, subsequent callers automatically retry instead of inheriting a poisoned aborted promise. Cache entries are populated only from successful, non-aborted fetches.
- Dashboard API reads are non-cacheable at the HTTP boundary. The shared frontend JSON helper sends `cache: "no-store"` by default, and backend `/api/*`, `/health`, and `/ready` responses carry no-store headers so browser and Electron sessions always request live runtime data.
- Project effective-settings reads that carry an abort signal are intentionally not globally deduplicated. Settings, Agents, and layout chrome can mount and unmount around the same project at different times, and sharing an abortable request lets one route teardown reject another route's active read. Explicit settings reloads use `cache: "reload"` after save/reset so the page reflects persisted settings instead of a warmed effective-settings payload.
- Dashboard agent preset listing returns existing SQLite presets immediately and schedules markdown/source synchronization in a throttled background task. First-time projects with no presets still await the initial sync so default agents are seeded, while internal planning/MCP callers continue to use the strict `listAgentPresets` path that awaits sync and source decoration.

## Resource Keys and Cache Invalidation

Resources are identified by deterministic keys (e.g., `project:<id>:sprints`, `project:<id>:tasks`, `project:<id>:execution`).

The project data context now uses structural equality checks to stabilize the context reference and accepts abort signals to prevent stale state from overriding newer updates.

When a realtime websocket event arrives (such as `project.structure.updated` or `project.execution.updated`), the resource layer invalidates the corresponding resource keys. The active page module then silently re-fetches the data in the background and updates the UI once the new read-model arrives.

Page resource hooks keep their public refresh callbacks stable across unchanged options. The sprint registry also treats "already loaded" as a per-project entry condition rather than a value that flips after the first fetch warms the module cache. This prevents cached sprint data from scheduling repeated `/api/projects/:projectId/sprints` refreshes when no sprint is running or changing.

Initial page load resources deduplicate in-flight requests across hook instances. Sprint, execution, effective settings, and task reads share the same project-scoped request when global chrome and the active page mount at the same time. The top navigation defers search-only task data and preview-session reads until search is opened, so hidden search providers do not add startup requests or preview polling.

Realtime websocket subscription updates are batched during route mount so many page and chrome hooks still produce one shared `/api/realtime` socket and a small number of subscription frames. Memory, settings, and live dashboard pages also avoid hydration-phase duplicate reads: Memory waits for the selected sprint before loading sprint-scoped memories, settings reads share cached system/import/effective settings payloads, and the Live page waits for project selection before requesting `/api/live?projectId=...`.

## Page-Scoped Module Boundaries

The v2 frontend is strictly organized into page-scoped module boundaries:
- **Overview:** Project collection and aggregate system stats. To avoid redundant waterfall requests in nested components like `HeaderStats` and `TasksList`, the Overview page uses `useOverviewPageData` to hoist selected-project sprint, task, and 7-day snapshot fetches to the page root. The data is then transformed into derived sparkline series (like `completedTasksTrend`) and passed downward.
- **Sprints:** Project-scoped sprint registry, composer, and markdown export.
- **Tasks:** Project-scoped task board, sprint-filtered view based on active sprint selection, and dependency management.
- **Stats:** Project-scoped usage telemetry, token trends, and performance ledgers.
- **Live:** Active execution runtime bounded by the selected active sprint, running tasks, and live realtime feeds.

Each module exclusively loads the resources it requires. Navigation between modules drops unused resource subscriptions, reducing memory overhead and background polling pressure.

## Progressive List Rendering

Heavy list views, such as the sprint registry or stats ledgers, utilize a progressive list rendering approach (`useProgressiveList`).
- Lists render an initial lightweight viewport of items.
- As the user scrolls, an intersection observer triggers progressive unrolling of the remaining items in batches.
- This prevents main-thread blocking when rendering hundreds of tasks or sprint rows, while still allowing the full dataset to be available for client-side search and sorting.
