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

When the healthy automatic or configured limit is at least three, one slot is held back from
ordinary background work for `worker_reply`, `dashboard_reply`, or `clarification_reply`. Compact
one- and two-slot budgets remain fully available to background work; subtracting a reserved slot
from a two-slot host would halve useful coding concurrency without leaving enough capacity for a
separate third invocation. A configured positive provider ceiling remains an upper bound; adaptive
CPU and memory admission can temporarily grant fewer new starts while the host is saturated.

Admission samples one-minute load and free memory through a one-second in-process cache. When load
per CPU reaches 0.9 or reliable free memory falls to 15%, background expansion freezes at the
current running count. One interactive reply may use the reserved slot. At load per CPU 1.5 or
reliable free memory 7%, no additional background slot is granted. Darwin's raw `os.freemem()` does
not include readily reclaimable cache, so it is not used as a memory-pressure signal there; CPU/load
pressure remains active. Extreme load alone does not consume the reply reservation because load can
also include CI and I/O work. If no provider is running, adaptive admission keeps one background
slot work-conserving unless a reliable critically-low-memory signal requires a full pause. Existing
work is never killed; admission resumes as pressure falls.

The policy does not call Docker. A rejected bounded claim may invoke stale-runtime reconciliation,
but a claim with available capacity reaches the atomic SQLite boundary first.
Provider-cap deferrals are limited to one structured diagnostic per sprint run and provider every
ten seconds, even when the blocked queue changes. The throttle state lives on the long-lived cycle
runner and is bounded, so per-cycle child loggers and wide ready queues cannot create a log-write
loop or an unbounded diagnostics cache.

Before creating a Jules session, Code UX reads a fresh, coalesced first page from `sessions.list` and
counts remote states that consume concurrent execution (`QUEUED`, `PLANNING`, and `IN_PROGRESS`).
Waiting-for-approval, waiting-for-feedback, and paused sessions do not consume this execution count;
established accounts can retain more of those historical waiting sessions than their concurrent-task
plan limit. Executing sessions visible to the API but absent from local runtime accounting reserve
part of the configured cap, and the remaining local slots are claimed atomically. Capacity
verification fails closed if the fresh preflight cannot be read.

The admission preflight and every sprint watch loop share the same in-flight page and compatible
fresh cache entry. Session records are projected to bounded orchestration fields before caching, so
provider-owned payloads and long historical outputs cannot accumulate in the process heap. A
recorded task outside the newest-first page uses a coalesced, TTL-cached exact read; tasks already
present in the shared page never trigger an exact read per cycle.

Jules does not expose a state-filtered list, subscription-slot counter, or atomic slot-reservation
endpoint. Its history is paginated and old queued work can occur beyond the bounded preflight page,
so the provider's create response remains authoritative for the unavoidable list/create and
pagination races. Explicit capacity `400`/`409`/exhausted `429` responses and the generic
`400 FAILED_PRECONDITION` currently emitted for a full subscription are retryable deferrals: Code UX
releases the provisional claim and applies a 30-second learned-cap backoff. `INVALID_ARGUMENT` and
other validation failures remain terminal with bounded provider detail.

The Jules client globally spaces request starts, performs at most one retry for a quota response,
honors `Retry-After`, and never transport-retries create, approve, or message mutations. A timed-out
live activity request aborts the underlying HTTP transport, so abandoned pagination or retries
cannot continue consuming quota after the caller has moved on.

Persisted Jules sessions are durable across runtime restarts. Startup recovery preserves running
hosted invocations even when a stale local sprint projection is terminal, then compares the cached
Jules session snapshot and reactivates only remotely active, unmerged work. Completed or cancelled
sprints and human-owned QA failures are never reopened by this repair. The startup snapshot repair
has a five-second bound; a slow hosted API cannot hold readiness, and normal session sync completes
the work later. If that bound expires, locally persisted Jules session ids plus running external
provider rows are fail-safe evidence: startup keeps those rows and their sprint monitor alive until
the late snapshot or ordinary session sync verifies the remote state. A timeout therefore cannot
terminalize hosted work merely because the local sprint summary was already failed.

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

Bundled user defaults use the same principle: concurrent seed requests share one in-flight install,
and a successful verification is reused for five minutes. The managed container setup script
migrates the known legacy installer once, while user-authored setup scripts remain untouched. This
keeps scheduling polls from rescanning and rewriting the same assets during a burst.

Provider containers receive a soft Docker CPU weight rather than a hard CPU quota. Idle CPU remains
available to CI, while Docker control-plane and sibling runtime work can make progress during a
burst.

## Workspace Preparation

Fresh Docker snapshots use the smallest reproducible source:

- all requested snapshot branches are refreshed in one targeted remote fetch; branch-sync fetches
  are single-flighted and reusable for three seconds;
- LOCAL task preparation performs no remote fetch. A fresh REMOTE task refreshes only its feature
  branch, while a resumed REMOTE task refreshes both its worker and feature branches;
- bundle creation is single-flighted and reusable for ten seconds by resolved ref state;
- single-branch bundle seeding and checkout run in one helper container for planning, QA, and reply
  workspaces;
- valid reusable snapshots return after the local Git-HEAD check without refreshing remote refs;
  missing or partial snapshots refresh inside the per-workspace creation lock before materializing;
- full-ref seeding remains the correctness fallback for unresolved or detached refs;
- repository-root and origin probes are cached; and
- paired workspace/runtime volume removal runs concurrently.

Fresh worker branches use a random UUID-derived suffix. HOST preparation creates the local ref
atomically with `git worktree add -b`; it never resets an existing branch. Finalization accepts that
fresh local ref only when the registered worktree path, branch, current tip, and ancestry prove it
belongs to the same invocation. Worktree paths are filesystem-canonicalized before comparison, so
platform aliases such as macOS `/var` and `/private/var` cannot make an invocation reject its own
branch while the branch, tip, and ancestry checks remain strict. REMOTE preparation also probes the
exact origin ref before provider work begins, and the first publication still uses an
expected-absent `--force-with-lease`, so a branch created after the probe cannot be overwritten. If
that push ends with an ambiguous retryable transport failure, publication probes the exact remote
branch before retrying. A remote tip equal to the local tip confirms success, an absent ref permits
another expected-absent attempt, and a different tip fails as an allocation collision.
Feature-branch allocation performs its normal local and remote uniqueness probes before creation.

Runtime volume ownership uses a durable `.codeux-owner` marker and the actual volume-root UID/GID.
The recursive ownership repair runs only for a new volume, an owner mismatch, or recovery from an
externally recreated volume. Ordinary launches do not run `chown -R`. A process-scoped registry
coalesces runtime-volume creation and ownership initialization across independent workspace-manager
instances, so preparation and provider launch cannot create or repair the same volume twice.

Git control-plane work uses two bounded helper tiers. The dashboard-selected project is eagerly
prewarmed, planning/reply/orchestration requests hold transient project leases, and every queued,
running, or cancellation-pending sprint run holds durable ownership. All owners converge on one
helper keyed by the repository's Git common directory and runtime owner, so concurrent sprints,
worktrees, QA, CI repair, and chat requests share it with at most four commands executing in
parallel. Ownership handoffs reuse the live generation without a stop/start window. Pause,
deselection, and terminal run states release their owner; the final owner drains pending and
in-flight commands before removal. Startup pruning completes before selected-project prewarm and
sprint recovery. Credentials, Git environment, and stdin attach only to each `docker exec`.
Repository archives, bundles, patch indexes, and rollback worktrees are staged inside the existing
project mount; truly external paths keep the one-shot fallback. After shutdown begins, late Git
commands stay one-shot so they cannot recreate a drained helper generation.

Branch preflight performs one origin refresh per orchestration request. A successful refresh makes
the local tracking refs authoritative for branch allocation and preparation, avoiding duplicate
fetches and `ls-remote` calls; independent local/remote ref probes execute concurrently.

Docker-volume workspaces reuse one short-lived sidecar per active workspace/runtime-volume pair for
local checkout, inspection, export, and bundle bootstrap commands. The sidecar is Git-capable,
network-disabled, `no-new-privileges`, and receives only the explicit Git environment allowlist.
Its transient Git home is a 1 MiB tmpfs. Coding and QA workflows reserve the exact
workspace/runtime-volume pair for their complete prepare-through-finalize lifetime, so the pool
cannot evict a sidecar merely because that workflow is temporarily between commands. Release drains
in-flight work before removing the sidecar without deleting restartable volumes.
Network Git commands use an isolated one-shot container. Each one-shot generation has an explicit
managed name, runtime-owner label, and helper label, and masks `alpine/git`'s declared `/git` volume
with tmpfs. A restart between Docker create and start can therefore reclaim the otherwise
never-started container without leaking either the workspace volume or an anonymous Git volume. The
workspace pool admits at most 16 sidecars: a new workspace evicts the least-recently-used
unreserved idle generation, or waits when every slot is executing or reserved. Helper creation and
removal share a four-operation Docker control-plane limit. This keeps overlapping task-QA and
coding waves inside the same resource bound without creating `created`/`dead` container storms.
Otherwise-idle, unreserved sidecars expire after 30 seconds, and shutdown drains both helper pools
before owner-scoped Docker cleanup. Fresh helper creation runs first without a speculative remove;
only an explicit Docker container-name conflict reclaims the deterministic name and retries once.
If shutdown or cancellation interrupts helper creation, the command fails through the bounded pool
instead of escaping into an uncapped one-shot fallback.
The shutdown sequence signals every active dispatch before beginning that drain, so provider and
workspace commands can release their helper leases concurrently instead of making restart latency
depend on their natural completion. Small bounded-parallel removal batches then reconcile every
remaining owner-scoped container state without exceeding the Docker command deadline during a
full admission wave. Initial cleanup, preview-reconciliation, and live-snapshot callbacks share the
server's tracked startup-timer set; shutdown clears that set before SQLite checkpoint/close, and
periodic callbacks refuse new repository work once closing begins. Fast restarts therefore cannot
leave a delayed loop callback querying closed storage.

Wide LOCAL merge drains resolve each worker/feature relationship once, then reuse the detached
merger's last published target SHA. Every publication remains a compare-and-swap update; only a CAS
failure rereads and resets to the concurrently advanced target. Merge history stays serial and
conflict attribution remains per task without repeating ref-existence scans for every branch.

Provider container names are reconciled only after Docker reports a real name conflict. Code UX
inspects the exact container and reclaims it only when the managed, runtime-owner, and session
labels match and Docker reports a non-running `created`, `exited`, or `dead` state. A running
same-session container is preserved, and a foreign or unverified container is never removed.
Disposing the command-spawner host during shutdown also cannot fall back to a duplicate in-process
launch once the invocation signal is aborted. The normal launch path does not run a speculative
`docker rm`.

## Telemetry And Persistence

Live telemetry is metadata-first. A provider source must change before transcript content is read.
Codex rollout transport binds every read to the native thread id emitted by the current
`codex exec --json` stream (or the exact requested resume id); it never treats an unrelated newest
rollout in a reused runtime home as the invocation's identity. Parsing retains a byte cursor,
handles split UTF-8/JSONL records, caps work per poll, and resets on source rotation or truncation.
The parser discards any single JSONL record above 2 MiB, bounds retained message/tool fields, and
keeps only the newest 256 conversation item groups. Large generated assets or command output can
therefore remain in the provider-owned rollout without exhausting the server heap; normalized usage,
session identity, and later records continue to be processed.
Claude transport also reads appended bytes, discards a JSONL record above 2 MiB, bounds retained
fields, and uses the same bounded accumulator for final collection. Qwen host logs retain at most
64 MiB of full records before projecting later calls to usage-only records. Antigravity transcript
reads use a bounded tail, while its SQLite source is copied in 2 MiB chunks and scanned one row at a
time. Unrelated Protobuf fields remain opaque instead of being recursively decoded. Unchanged
metadata still avoids all of that work.
Antigravity's explicit `--conversation` argument is reserved for ids parsed from that provider's
own log. Generic logical/workspace continuation ids use `--continue` within the isolated paired
runtime volume, preventing an orchestration id from being mistaken for a provider conversation.

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
and reinserting the invocation transcript on each poll. Full Jules histories are fetched and
tokenized through a one-at-a-time process queue, duplicate in-flight requests for the same session
join the existing work, and tokenizer input is sliced to at most 64 KiB. The raw activity array is
released after bounded messages and numeric usage are derived, before SQLite reconciliation begins.
This keeps wide hosted-session synchronization from multiplying large patch and media payloads in
the Node.js heap.

Ordinary orchestration does not read Jules activity history. The live dashboard owns the
best-effort recent feed: it advances at most one 50-activity page per cache refresh, coalesces
callers per session, rejects responses above 16 MiB, keeps at most 50 projected activities for at
most 32 sessions, and removes cumulative patches, base64 media, and shell artifacts before caching.
Only terminal usage estimation scans complete history, through the serialized ten-activity
projection described below.

Jules usage history is projected page-by-page in batches of ten activities. Every activity/tool
event remains available to the estimator, including bash output, while provider-only metadata and
base64 media bytes are discarded immediately. Because Jules repeats the complete current patch on
many progress activities, only the newest patch snapshot per source is retained and counted.
Response, retained-text, retained-patch, activity-count, and persisted-message bounds prevent one
pathological session from approaching the V8 heap ceiling.

Provider telemetry readers share a V8 heap-pressure circuit breaker. Live reads pause at 50% heap
usage or low proportional headroom. Terminal Jules estimation is retried later, and Codex shutdown
uses its current bounded accumulator rather than forcing a final read while pressure is active.
Runtime control and sprint cancellation therefore take precedence over best-effort telemetry.

Streaming provider activity is buffered for 250 ms or 50 source records, then adjacent records from
the same originator are compacted into bounded 16 KiB rows before one batch transaction. This avoids
duplicating a line-per-row firehose in both session tracking and the execution feed.

## Cleanup Control Plane

Periodic runtime cleanup is single-flight. If a 15-second interval fires while the previous sweep is
still pruning runtime paths, it joins that sweep instead of starting another database scan or
filesystem traversal. Runtime directory listing, age checks, and recursive removal use asynchronous
filesystem operations with an eight-operation bound, so stale-path cleanup does not synchronously
block container launch, telemetry, or dashboard work on the Node.js event loop.

Startup Docker asset cleanup is also single-flight. Helper containers and owner-scoped provider
containers are removed before recovery and workspace-volume pruning. Provider cleanup includes
running, exited, dead, and never-started `created` generations because a local Docker client cannot
be reattached after process loss and `docker run --rm` cannot remove a container that never started.
Shutdown likewise lists all states and force-removes owner-scoped containers; concurrent
disappearance is an idempotent success. After that prerequisite, workspace, provider-tool, and
browser-volume pipelines run independently. Docker inspection and removal use batches of at most 50
with at most four cleanup commands active at once; a failed batch falls back to bounded per-item
work instead of a serial control-plane loop.

Tracked-session snapshots, the ten-minute new-workspace grace period, active managed-volume state,
the newest-two cache generations, and the 30-day managed-volume retention window are unchanged.

The local mockup-sprint pentest runner keeps its isolated server alive after terminal sprint state
until every workspace/runtime volume labeled for that test project and sprint has been removed.
Its final safety cleanup then removes only volumes owned by that isolated state home. Repeated
400-task recovery runs therefore cannot leak thousands of volumes into the shared Docker daemon or
slow later volume and container operations.

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
- Each cycle starts no more work than the provider admission service's current purpose-aware
  capacity, including adaptive reply reservations; configured capacity is only an upper bound.
- Task QA runs in waves of at most four reviews. The cycle merges settled work and starts newly
  unblocked coding before scheduling another QA wave.
- Provider-backed clarification generation runs as bounded background work instead of holding the
  watch cycle open. A per-epoch reservation prevents duplicate reply workers, durable events
  preserve the outcome, and the configured worker timeout aborts a wedged provider run and releases
  its invocation slot.
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
- Every managed Docker container and volume carries a state-home-derived `code-ux.runtime-owner`
  label. Startup pruning, preview/file-browser reconciliation, login cleanup, and shutdown select
  that owner before removing assets, so an isolated stress-test runtime sharing the Docker daemon
  cannot stop a live runtime. Warm Git/workspace helper names include the same owner identity;
  generation-aware invalidation preserves a concurrent replacement. An ordinary second
  stopped-helper result may use a one-shot command, while shutdown and cancellation remain inside
  the bounded pool and never launch an uncapped fallback generation.

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
