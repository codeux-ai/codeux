# High-Concurrency Docker Orchestration

Code UX keeps local provider and CI work parallel while reserving host capacity for Docker, SQLite,
the dashboard, and interactive replies.

- A positive `maxConcurrentTasks` is a hard cap.
- Local-provider `0` uses adaptive CPU and memory admission; Jules `0` remains unlimited hosted work.
- Darwin admission ignores raw free-memory percentage because it excludes reclaimable cache, while
  retaining CPU/load pressure. A zero-running provider keeps one progress slot unless reliable
  critical memory requires a complete pause.
- Docker inventory, managed artifact verification, Git fetches, bundles, and workspace preparation
  are single-flighted and cached away from ordinary warm launches.
- Automatic image pulls and provider release checks use a persisted six-hour freshness window, so
  burst-time restarts do not stampede registries or the Docker control plane.
- Concurrent default-asset seeding is single-flight and revalidated at a five-minute cadence; the
  legacy bootstrap migrates once without overwriting user-authored setup scripts.
- Telemetry and invocation persistence process deltas instead of rewriting complete transcripts.
- Live Git/CI enrichment inspects at most five newest authoritative failed runs; newer successes
  suppress historical log retrieval, log-fetch failures aggregate, and the dashboard renders five
  warning details plus an overflow count.
- Every retention table advances through 500-row cursor batches only while provider work is idle.
- Passive idle-time WAL checkpoints and a 256-page incremental-vacuum cap avoid full-file barriers.
- Runtime and startup asset cleanup are single-flight; stale-path filesystem work is asynchronous,
  while Docker inspection/removal uses bounded parallel batches.
- Managed Docker containers and volumes carry a state-home-derived runtime-owner label. Cleanup,
  shutdown, preview/file-browser reconciliation, and warm-helper names are owner-scoped, so local
  stress tests can share the daemon with a live runtime. A stopped helper is retried by generation
  and falls back to one-shot execution if its replacement also disappears.
- The dashboard-selected project is eagerly prewarmed, while planning/orchestration requests and
  queued, running, or cancellation-pending sprint runs hold overlapping leases on one host-backed
  Git helper per project/runtime owner. Concurrent sprints, worktrees, QA, CI repair, and chat share
  it with at most four commands in flight; handoffs do not stop and recreate the helper. The final
  owner drains and removes it. Startup cleanup finishes before selected-project prewarm and sprint
  recovery. Credentials and stdin remain scoped to each exec. Git archives, bundles, patch indexes,
  and rollback worktrees stay inside the project mount; genuinely external paths remain one-shot.
  One successful origin refresh supplies tracking refs to the rest of branch preflight, eliminating
  duplicate fetches and remote probes. A valid reusable snapshot skips remote refresh entirely;
  missing or partial snapshots refresh only after winning the per-workspace creation lock. LOCAL
  task preparation never fetches; a fresh REMOTE task refreshes only its feature branch, while a
  resumed REMOTE task refreshes both worker and feature branches. Fresh worker branches use random
  UUID-derived suffixes. HOST preparation creates them atomically with `git worktree add -b`, and
  finalization accepts the resulting local ref only when the exact registered worktree, branch,
  tip, and ancestry prove invocation ownership. REMOTE preparation probes the exact origin ref
  before provider work, while publication retains an expected-absent lease for the remaining race.
  An ambiguous first-push transport failure probes the exact remote ref: the matching local tip
  confirms publication, absence permits a safe retry, and a different tip fails as a
  branch-allocation collision.
  Docker-volume work uses a network-disabled, `no-new-privileges` sidecar per active
  workspace/runtime-volume pair. Its Git home is a bounded tmpfs; coding and QA reserve the exact
  sidecar for the complete workflow, release drains commands, and restartable volumes remain. The
  workspace pool is capped at 16; new work evicts only an unreserved idle sidecar or waits. Helper
  create/remove operations share a four-operation Docker control-plane limit. Fresh
  helper creation avoids speculative removal and reclaims its deterministic name only after an
  explicit Docker name conflict. Runtime-volume creation and ownership initialization are
  coalesced process-wide across workspace-manager instances. Network Git remains one-shot. Once
  shutdown begins, late
  host-backed Git work also stays one-shot so it cannot recreate a persistent helper generation
  after the warm pool drain, and interrupted workspace-helper creation cannot escape the cap through
  a one-shot fallback.
- Wide LOCAL merge drains inspect worker/feature ancestry once and reuse the last published target
  SHA. Each serial publication retains compare-and-swap protection; only a concurrent target change
  triggers a ref refresh and retry.
- Startup removes stale owner-scoped provider containers in every Docker state before recovery,
  including never-started `created` generations. Shutdown also inspects every state and treats
  concurrent disappearance as successful idempotent cleanup. It signals active dispatches before
  draining helper leases, then removes the remaining owner-scoped containers in bounded batches so
  restart latency does not wait for uncancelled workspace commands or one oversized Docker call.
  Initial background-loop callbacks use the server's tracked startup timers; shutdown cancels them
  before SQLite closes, and periodic callbacks reject new repository work after closing begins.
  The local mockup-sprint pentest waits for terminal owner-scoped workspace cleanup and removes only
  its isolated runtime's remaining volumes before exit, preventing repeated 400-task runs from
  degrading later Docker operations.
- Provider name-conflict recovery inspects the exact container and removes only a managed,
  same-runtime, same-session container in a non-running `created`, `exited`, or `dead` state.
  Running same-session containers and foreign or unverified containers are preserved. When shutdown
  disposes the command-spawner host, an already-aborted provider command is not duplicated through
  the in-process fallback.
- Provider-cap diagnostics are limited to one write per sprint run and provider every ten seconds,
  even when the blocked queue changes. Long-lived bounded throttle state prevents per-cycle child
  loggers from defeating the limit or retaining unbounded history.
- Jules admission reads a fresh, coalesced first page from the API and counts executing `QUEUED`,
  `PLANNING`, and `IN_PROGRESS` sessions missing from local accounting. Waiting/paused history does
  not consume the execution count. An unavailable preflight fails closed with the task queued. Since
  Jules exposes no state filter or subscription-slot endpoint and old running work may be paginated,
  capacity `400`/`409`/exhausted `429` responses plus the generic capacity
  `400 FAILED_PRECONDITION` remain authoritative retryable deferrals that release the provisional
  claim and apply a 30-second learned-cap backoff.
- Startup preserves persisted Jules sessions and repairs false local terminal projections from a
  fresh remote-active snapshot before ordinary reconciliation; completed/cancelled sprints, merged
  tasks, and human QA handoffs remain terminal. The snapshot repair is bounded to five seconds so a
  slow hosted API cannot hold runtime readiness. On timeout, local durable session/runtime evidence
  keeps monitoring alive until the late snapshot or ordinary sync verifies the provider state.
- Scheduler starts consume current purpose-aware provider capacity, including adaptive reply
  reservations. Task QA runs in waves of at most four so merges and newly unblocked coding progress
  between review waves instead of waiting behind a full-DAG QA backlog.

The published architecture page is available at
[`/docs/architecture-high-concurrency-orchestration`](/docs/architecture-high-concurrency-orchestration).

Managed provider tools are versioned Docker volumes installed once per compatible version. They are
not installed per invocation; warm launches reuse their verified immutable cache identity.
