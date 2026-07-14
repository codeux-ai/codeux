# High-Concurrency Docker Orchestration

Code UX treats concurrency as a throughput problem, not a count of containers. The runtime keeps
provider and CI work parallel while reserving enough host capacity for Docker, SQLite, the dashboard,
and interactive replies to remain responsive.

This page defines the performance contract for local CLI providers. Jules executes remotely and is
not charged against the local Docker resource budget.

## Admission And Priority

Provider claims remain atomic SQLite operations across projects and processes. A configured
`maxConcurrentTasks` greater than zero is a hard ceiling. For local providers, `0` selects adaptive
admission rather than unbounded container creation; for Jules, `0` still means unlimited hosted
work.

The automatic local ceiling is the smaller of:

- half of the available logical CPUs; and
- the memory budget after reserving the greater of 4 GiB or 15% of host memory, using 2.5 GiB as the
  planning estimate for one active provider/CI container.

One slot is held back from ordinary background work for `worker_reply`, `dashboard_reply`, or
`clarification_reply`. A configured positive provider ceiling remains an upper bound; adaptive CPU and memory admission can temporarily grant fewer new starts while the host is saturated.

Admission samples one-minute load and free memory through a one-second in-process cache. When load
per CPU reaches 0.9 or free memory falls to 15%, background expansion freezes at the current running
count. One interactive reply may use the reserved slot. At load per CPU 1.5 or free memory 7%, no
additional background slot is granted. Extreme load alone does not consume the reply reservation
because Linux load also counts I/O wait; critically low memory does. Existing work is never killed;
admission resumes as pressure falls.

The policy does not call Docker. A rejected bounded claim may invoke stale-runtime reconciliation,
but a claim with available capacity reaches the atomic SQLite boundary first.
Unchanged provider-cap deferrals are coalesced to one structured diagnostic per provider every ten
seconds, so a wide ready queue does not turn a one-second orchestration loop into a log-write loop.

## Docker Inventory

Docker availability and container discovery share one process-wide inventory:

- one `docker ps --format` command provides both availability and labeled container state;
- callers share the same in-flight promise and short TTL;
- failed probes are cached briefly instead of creating a retry storm;
- mutations invalidate the shared generation; and
- destructive stale recovery refuses an inventory older than two seconds.

Unlimited hosted claims and successful local claims do not perform Docker reconciliation. Missing
containers are recovered only after the claim is full, invocation age/activity guards have passed,
and a sufficiently fresh inventory confirms absence.

## Managed Artifact Cache

Managed images, provider-tool volumes, and the Playwright browser volume are verified once per
process and single-flighted during startup. A warm invocation does not run a provider `--version`
verification container or repeat image inspection. `DockerRunner` resolves its selected runtime
image once and passes that immutable digest to the tool and browser managers.

Update discovery and installation remain background operations. Versioned volume names, immutable
image digests, completion markers, and runtime compatibility keys remain the trust boundary. A
missing asset detected after external Docker pruning invalidates the process cache and enters the
normal prepare-and-verify recovery path.

Automatic runtime pulls and provider release lookups use a six-hour persisted freshness window, so
restarting runtime processes during a CI burst does not create a registry/control-plane stampede.
Manual preparation remains forceful, and launch-time validation repairs an externally removed or
corrupted artifact on demand.

Provider containers receive a soft Docker CPU weight rather than a hard CPU quota. Idle CPU remains
available to CI, while Docker control-plane and sibling runtime work can make progress during a
burst.

## Workspace Preparation

Fresh Docker snapshots use the smallest reproducible source:

- targeted remote fetches are single-flighted and reusable for three seconds;
- bundle creation is single-flighted and reusable for ten seconds by resolved ref state;
- single-branch bundle seeding and checkout run in one helper container for planning, QA, and reply
  workspaces;
- full-ref seeding remains the correctness fallback for unresolved or detached refs;
- repository-root and origin probes are cached; and
- paired workspace/runtime volume removal runs concurrently.

Runtime volume ownership uses a durable `.codeux-owner` marker and the actual volume-root UID/GID.
The recursive ownership repair runs only for a new volume, an owner mismatch, or recovery from an
externally recreated volume. Ordinary launches do not run `chown -R`.

Provider container names are reclaimed only after Docker reports a real name conflict. The normal
launch path no longer runs a speculative `docker rm`.

## Telemetry And Persistence

Live telemetry is metadata-first. A provider source must change before transcript content is read.
Codex rollout parsing and transport retain a byte cursor, handle split UTF-8/JSONL records, cap work
per poll, and reset on source rotation or truncation. Claude transport also reads appended bytes.
Qwen mutable JSON files and the Antigravity SQLite source use a coherent full read only after their
cheap metadata changes; unchanged polls do not copy or parse them.

Provider stdout/stderr uses bounded append-efficient buffers rather than repeated whole-string
concatenation. Structured Docker JSON is parsed for telemetry without duplicating it into the raw
activity stream.

Structured invocation messages reconcile by stable ordinal in one SQLite transaction:

- unchanged prefixes retain their row IDs;
- appended turns produce tail inserts;
- tool lifecycle changes update only the affected rows;
- source truncation deletes only the obsolete tail;
- invocation aggregates update once; and
- one realtime notification is emitted only when persisted state changed.

Text-only completion fallback remains append-only so retry and audit messages are not removed.
Hosted Jules activity-to-message sync uses the same atomic suffix reconciliation instead of clearing
and reinserting the invocation transcript on each poll.

Streaming provider activity is buffered for 250 ms or 50 source records, then adjacent records from
the same originator are compacted into bounded 16 KiB rows before one batch transaction. This avoids
duplicating a line-per-row firehose in both session tracking and the execution feed.

## Cleanup Control Plane

Periodic runtime cleanup is single-flight. If a 15-second interval fires while the previous sweep is
still pruning runtime paths, it joins that sweep instead of starting another database scan or
filesystem traversal. Runtime directory listing, age checks, and recursive removal use asynchronous
filesystem operations with an eight-operation bound, so stale-path cleanup does not synchronously
block container launch, telemetry, or dashboard work on the Node.js event loop.

Startup Docker asset cleanup is also single-flight. Helper and login containers are removed before
workspace volumes so mounted volumes retain the existing safety ordering. After that prerequisite,
workspace, provider-tool, and browser-volume pipelines run independently. Docker inspection and
removal use batches of at most 50 with at most four cleanup commands active at once; a failed batch
falls back to bounded per-item work instead of a serial control-plane loop.

Tracked-session snapshots, the ten-minute new-workspace grace period, active managed-volume state,
the newest-two cache generations, and the 30-day managed-volume retention window are unchanged.

## Database Maintenance

Terminal execution invocations, provider invocations, and their message trees follow the configured
retention period unless an execution invocation is explicitly preserved. Raw provider activity for
terminal sessions is retained for one day because the durable execution feed and invocation
transcript already contain the operator-facing history.

Every retention table is scanned through a row-id cursor and mutates at most 500 rows per pass.
Potentially large invocation and task-run child tables are cleaned first; a parent is eligible only
after its children are gone, preventing an unbounded foreign-key cascade. The low-frequency
maintenance loop advances every category until storage converges, but defers the entire sweep while
provider work is active.

Normal WAL maintenance uses `PASSIVE` checkpoints only while provider work is idle, so active
readers and writers are not forced through a periodic truncate barrier. Automatic maintenance never
issues full `VACUUM` or `TRUNCATE` operations. The legacy startup-vacuum setting instead requests at
most 256 pages through SQLite incremental vacuum; newly created databases enable incremental mode,
while older files that predate that mode may safely no-op until an explicit offline migration.

## Scheduling Invariants

- Independent queued dispatches within one project fan out up to both
  `workers.maxConcurrency` and effective provider capacity.
- Provider claims remain atomic across every project and runtime process.
- Interactive work cannot exceed an explicit positive provider cap.
- Existing providers are not killed in response to pressure.
- Attention and repair work retains precedence over ordinary coding dispatches.
- No task, dispatch, attention item, workspace, or branch may be claimed twice to increase
  parallelism.
- Background reconciliation and preview/file-browser reconciliation are single-flight and cannot
  overlap their own previous interval.
- Periodic runtime and startup Docker cleanup cannot overlap themselves, block the event loop with
  synchronous recursive filesystem work, or issue unbounded Docker commands.

## Focused Verification

```bash
pnpm exec vitest run tests/backend/services/adaptive-provider-admission-policy.test.ts
pnpm exec vitest run tests/backend/services/provider-concurrency-service.test.ts tests/backend/services/docker-service.test.ts
pnpm exec vitest run tests/backend/infrastructure/providers/cli/provider-telemetry-watcher.test.ts tests/backend/infrastructure/providers/cli/codex-log-parser.test.ts
pnpm exec vitest run tests/backend/services/provider-execution-service.test.ts tests/backend/repositories/execution-repository.test.ts
pnpm exec vitest run tests/backend/infrastructure/providers/cli/docker-runner.test.ts tests/backend/infrastructure/providers/cli/workspace-manager.test.ts
pnpm exec vitest run tests/backend/services/activity-write-coalescer.test.ts tests/backend/services/database-maintenance-service.test.ts
pnpm exec vitest run tests/backend/services/runtime-cleanup-service.test.ts tests/backend/services/docker-runtime-prune-service.test.ts tests/backend/services/docker-asset-prune-service.test.ts
pnpm run lint
pnpm run build
```
