# High-Concurrency Docker Orchestration

Code UX keeps local provider and CI work parallel while reserving host capacity for Docker, SQLite,
the dashboard, and interactive replies.

- A positive `maxConcurrentTasks` is a hard cap.
- Local-provider `0` uses adaptive CPU and memory admission; Jules `0` remains unlimited hosted work.
- Docker inventory, managed artifact verification, Git fetches, bundles, and workspace preparation
  are single-flighted and cached away from ordinary warm launches.
- Automatic image pulls and provider release checks use a persisted six-hour freshness window, so
  burst-time restarts do not stampede registries or the Docker control plane.
- Telemetry and invocation persistence process deltas instead of rewriting complete transcripts.
- Every retention table advances through 500-row cursor batches only while provider work is idle.
- Passive idle-time WAL checkpoints and a 256-page incremental-vacuum cap avoid full-file barriers.
- Runtime and startup asset cleanup are single-flight; stale-path filesystem work is asynchronous,
  while Docker inspection/removal uses bounded parallel batches.

The published architecture page is available at
[`/docs/architecture-high-concurrency-orchestration`](/docs/architecture-high-concurrency-orchestration).

Managed provider tools are versioned Docker volumes installed once per compatible version. They are
not installed per invocation; warm launches reuse their verified immutable cache identity.
