# Dashboard Resource Layer

This page describes the shared dashboard resource provider, resource caching, and the page-scoped module boundaries that optimize the v2 frontend architecture.

## Overview

The dashboard resource layer manages data fetching, caching, and invalidation for the v2 project-management UI. It shifts the dashboard from global, monolithic state to page-scoped module boundaries and a progressive rendering strategy.

Importantly, **API routes and backend contracts remain unchanged**. The optimizations are entirely focused on frontend read-model consumption, backend read-model projection efficiency, and client-side rendering.

## Shared Resource Provider

Data fetching is governed by a unified resource layer rather than ad-hoc `useEffect` blocks. The shared resource provider ensures that:
- Requests for the same resource key within a page are deduplicated.
- Reusable cache payloads map project and sprint contexts so switching selected sprints does not repeatedly refetch unchanged baseline data.
- Stale data is preserved during background refreshes to prevent UI flashing.
- Live runtime polling keeps the last non-empty sprint status and execution snapshot while active work is still present, preventing the live page from flashing into the empty "Awaiting sprint decomposition" state during transient refresh gaps.
- Live runtime status aggregation and task activity hydration run through the same `processDashboardTasks` projection so counters, task cards, and race placement stay phase-consistent during post-coding polling.
- Cache invalidation is coordinated through realtime websocket events.

## Resource Keys and Cache Invalidation

Resources are identified by deterministic keys (e.g., `project:<id>:sprints`, `project:<id>:tasks`, `project:<id>:execution`).

When a realtime websocket event arrives (such as `project.structure.updated` or `project.execution.updated`), the resource layer invalidates the corresponding resource keys. The active page module then silently re-fetches the data in the background and updates the UI once the new read-model arrives.

## Page-Scoped Module Boundaries

The v2 frontend is strictly organized into page-scoped module boundaries:
- **Overview:** Project collection and aggregate system stats.
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
