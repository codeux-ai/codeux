# Virtual Workers

## Status
Implemented

## Purpose

Virtual workers are now the only worker runtime.

Instead of keeping an external worker in a long-lived `listen` loop, Code UX now:

- detect open worker-owned attention
- create an ephemeral internal `virtual_cli` worker endpoint
- execute exactly one worker unit of work
- release and delete the endpoint when that unit finishes

## Settings Model

Worker routing is now controlled by the inherited `workers` settings section:

- `executionMode`
  - `VIRTUAL`
- `virtualWorkerProvider`
  - `gemini`
  - `codex`
  - `claude-code`

When a project or sprint resolves to `VIRTUAL`:

- worker-owned attention is opened without assigning a connected endpoint
- the internal virtual worker scheduler becomes responsible for handling the attention cycle

Dashboard operators can also force a specific virtual provider for one planning action without changing the project default worker mode:

- sprint prompt improvement overrides may specify a virtual provider and optional model
- sprint planning overrides may specify a virtual provider and optional model
- those request-scoped overrides take precedence over the inherited worker mode/provider for that planning request only

## Runtime Model

Primary files:

- `src/services/virtual-worker-service.ts`
- `src/services/worker-task-dispatch-service.ts`
- `src/domain/workers/project-attention-service.ts`
- `src/repositories/worker-endpoint-repository.ts`

Virtual workers use the same worker abstractions as the rest of the execution model:

- worker endpoints
- project worker assignments
- worker-owned attention items
- worker dispatch leases

Virtual workers create `worker_endpoints.endpoint_type = virtual_cli` and do not require MCP connection rows.

## Cycle Behavior

Each virtual cycle is project-scoped and one-shot:

1. Scheduler notices worker work for a project.
2. Code UX creates an ephemeral virtual endpoint and project assignment.
3. The cycle handles one worker-owned attention item or one pending dispatch.
4. It executes that single unit of work.
5. It releases the assignment and deletes the endpoint.
6. If more worker work remains, it schedules another cycle.

This is intentionally not an endless watch loop.

The background reconcile loop stays conservative (`3s`) to avoid unnecessary sqlite write contention, while virtual worker session completion polling is tighter (`2s`) because it only checks local session and dispatch state. Initial scheduling operations use microtask queueing to consolidate rapid sync events while preventing simultaneous cycle overlap for the same project. If a cycle finishes and work still remains, follow-up scheduling is deferred on the reconcile timer cadence instead of recursively queueing more microtasks, so dashboard HTTP probes and shutdown signals stay responsive even when persisted worker state is temporarily unchanged.

## Planning Boundary

Virtual worker scheduling is split between pure domain policies and the stateful service:

- `src/domain/workers/virtual-worker-scheduling-policy.ts` decides whether a project should schedule a cycle from plain inputs: worker execution mode, active-cycle state, queued-cycle state, next eligible attention item, and pending-dispatch presence.
- The same policy module filters attention eligibility, defers orchestrator-managed clarification retries, chooses attention routing (`merge_conflict`, `ci_fix`, `action_required`, or human escalation), and formats virtual claim reasons for open versus reclaimable claimed items.
- `src/domain/workers/virtual-worker-cycle-plan.ts` combines the next attention item, the next dispatch claim, resolved settings, and provider capacity into a typed `VirtualWorkerCycleAction`. Dispatches keep precedence over attention when both are available.

The pure helpers receive repository/service state as values and do not mutate storage, call providers, start containers, or log. This makes idle worker selection, busy worker skipping, retry deferral, disabled worker mode, and attention escalation directly unit-testable.

`src/services/virtual-worker-service.ts` remains the side-effect boundary. It:

- reads repositories and settings
- creates and deletes ephemeral virtual endpoints
- creates and releases project worker assignments
- claims attention items and dispatch leases
- checks provider concurrency through `ProviderConcurrencyService`
- starts CLI provider workflows and Docker workspaces
- updates session, dispatch, attention, guardrail, memory, and git state
- emits operational logs

## Supported Work

Today virtual workers handle:

- Dashboard chat conversations via `routeKind === "virtual"` and `virtualProvider`
- Planning agent prompt improvement
- Planning agent sprint planning
- worker-owned `merge_conflict` attention
- worker-owned `ci_fix_required` attention
- worker-owned `action_required` attention that can be auto-answered or auto-approved

Worker-originated MCP clarifications are a separate, project-manager-owned lane. `request_clarification` creates a human-owned `worker_clarification` attention item, so virtual workers do not claim it through repair or `action_required` automation. While that item is pending, the scheduling policy suppresses another dispatch or duplicate worker attention for the same task or dispatch scope. Unrelated queued tasks and dispatches remain eligible, and a taskless general clarification does not pause coding dispatches. The configured clarification-reply/dashboard-reply Project manager agent (or an unscoped project-manager MCP client) answers through `reply_to_clarification`; arbitrary worker agents cannot answer and do not receive project-manager management tools.

The reply continuation is provider-specific. Jules receives a session message and only then has its runtime projection restored to running. Local CLI providers reuse the task-rerun path with the preserved workspace, worker branch, provider/model, task agent, and native session lineage. Acceptance of that continuation does not assert task completion. Taskless general questions are recorded without scheduling a worker, and missing task-run/session/workspace context leaves a task-backed clarification pending.

For planning flows, Code UX (`src/services/planning-agent-service.ts`):

- runs the Planning agent prompt through the configured virtual worker CLI
- injects the Planning agent's current long-term memory plus the current sprint's short-term learnings into the prompt when memory is enabled
- honors per-request planning overrides for virtual provider selection, so choosing `codex` in the sprint composer actually launches the Codex CLI and credentials even if the project default is `gemini`
- creates the same planning thread record in the dashboard, but stores the request/response as system messages instead of waiting on an MCP reply
- executes a JSON retry loop up to `cliWorkflow.maxPlanningJsonRetries` (default 3) times if the initial response cannot be parsed as valid JSON
- retries failed planning provider invocations such as `Command aborted` or empty output before failing the request; these provider attempts are bounded by `guardrails.jobs.planning.cap` when planning guardrails are enabled
- maintains same-session continuation semantics during retries (`src/infrastructure/providers/cli/provider-runner.ts` and `src/infrastructure/providers/cli/provider-runtime-artifacts.ts`); subsequent JSON retry requests continue the same underlying provider session using `continueSessionId` (falling back from `nativeSessionId` to the logical `sessionId`)
- records execution and provider invocation trails during retries, so operators will see an initial system message indicating the retry followed by a new provider invocation recording the follow-up prompt and reply
- when Docker execution mode is active, planning runs inside a snapshot workspace volume and captures `.task-learnings.md` back out of that snapshot instead of trying to read host files directly; in `REMOTE` git mode, fresh planning invocations refresh `origin` and check out only `origin/<branch>` for the explicit sprint feature branch or the effective runtime git default branch, never the host repo's current checkout, so new planning does not start from a stale local branch, while restart/continue actions reuse the preserved snapshot for session continuity
- allows sprint compose, improve, and `Plan & Start` to work even when no live MCP listener is attached

Provider CLI workspace preparation is centralized through `InvocationWorkspacePreparer`. Its shared provider-invocation option builder constructs snapshot checkout, git policy, and fresh/continue lifecycle values for Docker provider calls, while its continuation resolver locates preserved workspaces and their current branches. Fresh Docker invocations in `REMOTE` git mode use explicit remote refs only: planning, project setup, dashboard/chat replies, worker inbox replies, node-flow provider prompts, QA review snapshots, task coding, QA follow-up, CI autofix, and merge-conflict repair all materialize from `origin/<branch>` refs rather than local branches or the host repo's current checkout. Dashboard/chat replies resolve dashboard settings with the project scope before building this policy, so local Git projects keep `LOCAL` snapshot behavior and do not require `origin/<defaultBranch>`. Continuation/restart flows may reuse a preserved workspace for provider-session continuity; if a preserved workspace is missing and a new workspace must be materialized, the same remote-only branch policy applies.

For merge conflicts, Code UX:

- prepares an isolated Docker workspace on the PR source branch
- seeds that Docker workspace from an exact-ref Git bundle fetch instead of cloning the bundle, using a private bootstrap `HEAD` ref so checked-out default branches cannot block the fetch; merge-conflict preparation passes the task source branch as the checkout branch and the feature target branch as the companion seed branch, fetching both into host `refs/remotes/origin/*` refs before bundling so the container can merge `origin/<targetBranch>` without falling back to stale or missing local refs
- creates local branch aliases inside the Docker volume for requested branches that were available only as `origin/*` refs, so LOCAL-mode final merge repair can still run helper Git commands such as `git merge dev` against the configured default branch
- configures a workspace-local Git identity and injects fallback author/committer environment variables for Docker-volume helper Git commands, so merge preparation and final merge commits do not depend on global container config
- runs the helper Git/inspection commands inside that workspace as the same UID:GID that owns the volume so Git does not reject the repo as an unsafe `root` checkout
- merges the target branch into it
- runs the selected CLI provider against the conflict context plus the worker agent's current long-term and sprint memory context when available
- accepts both the original merge-conflict prompt payload fields (`currentTaskPrompt`, `mergedTaskPrompts`) and the newer task-context payload fields (`currentTask`, `featureBranchTaskContexts`) when constructing that provider prompt
- explicitly instructs the worker to preserve exact literal identifiers from the prompt and conflict content, including branch names, file paths, directory names, timestamp-like marker strings, task keys, separators, hyphens, underscores, colons, and casing, and to repair malformed variants back to exact prompt literals, so conflict repair does not silently rename branch-specific artifacts
- requires the worker to write durable learnings to `.task-learnings.md`, which Code UX captures back into memory after the conflict is resolved
- verifies conflicts are resolved
- verifies the resolved source branch actually contains `origin/<targetBranch>` before clearing the merge-conflict attention item
- exports a Git patch artifact from the isolated workspace
- applies that patch back onto the host branch as a merge commit that preserves the target branch as an additional parent, then pushes it
- counts task-scoped merge-conflict attempts in the guardrail ledger; sprint-level final merge conflicts have no task row, so their retry count is stored on the attention item payload as `mergeConflictResolutionAttempts` before each real provider run
- stops opening new worker-owned repair attempts for a task once the existing `merge_conflict` item has escalated to an active human handoff, preventing repeated container startup failures from cycling after the guardrail limit is reached

Merge-conflict handling intentionally stays isolated from the original task workspace. It always runs in a dedicated ephemeral Docker workspace so conflict resolution cannot pollute the task's normal follow-up workspace.

For task-scoped CI autofix, Code UX defaults to continuing the original task coding session exactly like a QA follow-up: it reuses the logical/native provider session, provider family, effective model, coding-agent instructions, and preserved task workspace. Settings → AI Models → CI fix exposes **Continue from same session and model as coding task** as an opt-out; disabling it uses the standalone CI Fix route. Sprint-level final-merge repair has no originating task session and always uses that route. The CI-fix prompt also receives the active agent's memory context and writes new durable learnings back into memory from the reused workspace.

Workspace artifact export captures both tracked edits and newly created untracked files from the worker workspace. This matters for CI autofix follow-ups that add missing modules or tests after the original task run; the exporter uses a temporary Git index for untracked files and still excludes the transient `.task-learnings.md` memory-capture file, legacy `.code-ux-home/` provider state, and root `.pnpm-store/` package-cache state from commits. It asks Git to discover untracked files internally before diffing, so preserved Docker workspaces with many untracked paths cannot exceed command argument limits. Current Docker workers keep provider HOME and Code UX-managed npm/pnpm cache paths in a paired runtime volume mounted outside `/workspace`, so fresh workspaces contain only the coding checkout.

Immediately before every Docker provider launch attempt, Code UX reasserts ownership of that runtime volume for the container's effective non-root UID/GID. Performing this at the atomic `docker run` boundary covers newly created, previously root-owned, and concurrently recreated volumes, preventing restart recovery or startup pruning from leaving CI/QA repair unable to create provider configuration or cache directories. Workspace seed helpers explicitly trust the mounted `/workspace` path while initializing Git, then restore the provider UID/GID; this keeps restart recovery from tripping Git's dubious-ownership protection on a correctly non-root-owned volume.

Background startup pruning refreshes the tracked-session set immediately before volume removal and protects newly created workspace/runtime volumes for a short registration window. A restart cleanup scan therefore cannot delete a just-seeded QA or CI workspace before its provider session is persisted and cause Docker to launch against an empty replacement volume.

CI autofix finalization refuses to resolve worker attention as fixed when the invocation produced no patch and there are no unpublished commits on the worker branch. Existing commits ahead of the feature branch are not treated as CI-fix evidence on their own. Failed, timed-out, crashed, and no-op repair invocations consume one guardrail attempt, return the worker attention item to an unclaimed retryable state while budget remains, and preserve the previous error in the next repair prompt. At the configured cap, Code UX resolves the worker item and creates a human handoff with the attempt count and last failure.

CI autofix prompts are explicitly framed as repair jobs, not fresh task implementation jobs. The prompt starts with the target PR, worker branch, original task key/title, failed check names, failed job labels, and structured details for only the newest branch-matched failed CI run. Older matching failures are excluded. The selected run includes its run id, URL, status, conclusion, event, head branch, update time, every failed job id, every failed step, fallback log commands, and fetched failed-job log excerpts. The original task prompt is included only under a "Reference Only" section so the worker understands the already-completed scope without redoing it.

Failed-job excerpts are error-focused rather than simple head/tail truncation. For every failed job in the selected newest run, the collector scans the complete failed-job output for named failed steps and assertion/error signals, then preserves bounded actionable context around every relevant match (including exact expected/received output, stack traces, and source locations) while dropping runner provisioning and cleanup noise. Final-merge CI repair receives this same newest-run-only structured evidence.

Virtual-worker scheduling gives open repair attention precedence over queued task dispatches. It does not lease a coding dispatch while a `ci_fix_required` or merge-conflict item is waiting, and it checks capacity against the provider and limit resolved by the invocation-specific `ci_fix`/`merge_conflict` route rather than the generic virtual-worker provider. The final atomic provider-slot claim is bounded to 30 seconds; a route/capacity race therefore fails through the normal repair escalation path instead of holding sprint finalization indefinitely.

When feature-PR CI retries exhaust their guardrail, the runtime task remains blocked for intervention but its durable planning row stays `coding_completed`. This preserves the fact that the original implementation already finished and prevents the next projection cycle from turning the task back into a pending coding dispatch.

If Docker is unavailable when the CI autofix flow starts, Code UX degrades that specific repair run to a host-backed worktree instead of looping on an unrecoverable Docker failure. Merge-conflict resolution does not use this fallback: it remains Docker-only so conflict repair stays isolated from the reusable task workspace.

For QA review execution, Code UX now runs the review itself against a fresh snapshot workspace rather than the mutable task workspace. This keeps review inspection isolated while still allowing QA-requested coding follow-ups to continue in the original task workspace when appropriate. Both the review agent and QA-requested coding follow-ups now receive their current memory context, and QA follow-up edits capture fresh learnings back into memory from the actual workspace used for the fix.

Unsupported worker-owned attention types are escalated back to human attention with a summary.


## Reconciliation Scanning

To minimize idle work and redundant compute cycles, virtual worker scheduling computes a minimal actionable candidate set before checking specific project rules.

The reconciliation scan merges:
- Projects with active (unclaimed or virtual-worker-claimed) open attention items
- Projects with pending task dispatches
- Projects that already have an active virtual cycle running

It deduplicates this project set and explicitly ignores all other projects in the system. To further bounded work, projects that are already actively running a cycle or scheduled are skipped entirely during per-project need checks, ensuring settings resolution is only evaluated once per candidate and only when actually necessary to decide scheduling.

## Recovery

Startup cleanup prunes orphaned `virtual_cli` endpoints from previous runs.

Startup cleanup also removes stale Code UX Docker assets through a background, label-filtered prune so server boot does not wait on full Docker daemon scans (managed via `DockerAssetPruneService`):

- orphaned labeled helper/login containers and temp credential dirs from previous runs, removing anonymous image-declared volumes with `docker rm -f -v`
- stale labeled workspace volumes (`code-ux.workspace=true`) and paired runtime volumes (`code-ux.workspace-runtime=true`) for finished, failed, unrecoverable, or outdated sessions

Cached setup-script Docker images are content-addressed by base image, setup script content, and setup-cache Dockerfile content. They are preserved across dashboard restarts and reused until one of those inputs changes or Docker no longer has the image.

Interrupted Docker-backed sessions that were running before restart are treated as failed during recovery unless a live backing container is still present. This keeps restart recovery deterministic and prevents dead sessions from holding disk space or waiting forever for callbacks that will never arrive.

Provider completion and workflow completion are separate durable boundaries. When restart recovery finds a completed coding provider linked to an active task dispatch, it closes the interrupted run and records a recovery marker. If the preserved workspace can be resumed, the replacement run consumes that marker and continues directly with Git/PR finalization without launching the coding provider again; it never treats provider completion alone as merge-ready task state.

When a sprint reaches a terminal state, Code UX also removes the resumable CLI workspaces tied to that sprint immediately instead of relying only on the next startup cleanup pass.

If a virtual cycle dies mid-attention:

- deleting the endpoint clears stale worker assignment references
- claimed worker attention becomes reclaimable by the next virtual cycle

This prevents dead virtual workers from pinning merge-conflict items indefinitely.

### Claiming and Workspace Recovery for Containerized Executions

When running inside isolated or containerized worker environments (e.g., Gemini CLI in a Docker container):

- **Virtual Worker Claiming**: Virtual workers (using claim reason prefixes starting with `virtual_worker_`) or automated attention types (`ci_fix_required`, `merge_conflict`) can bypass the `assignedWorkerEndpointId` mismatch check. This ensures that when a virtual worker reconciles and attempts to claim/reclaim an attention item that was originally opened/assigned to a different containerized worker endpoint, the claim is successfully allowed instead of stalling.
- **Path and Workspace Normalization**: Remote origins and git remote URLs under `/workspace` container directories are dynamically resolved to correctly identify the host repository name. This allows `buildTaskRunKey` to match and reuse the correct containerized workspace targets when runs are resumed.
- **POSIX and Windows Path Matching**: CLI session queries in the tracking repository match using both Windows and POSIX-normalized host paths, falling back to `/workspace` when matching containerized sessions.

## Scheduling and Execution Split
To enable pure unit testing of virtual worker scheduling rules, Code UX extracts cycle planning into a pure domain function (`planVirtualWorkerCycle`). The VirtualWorkerService gathers state (e.g. attention items, task dispatches, available provider concurrency) and passes it to the planner. The planner then returns an explicit `VirtualWorkerCycleAction` without producing side effects, and the service executes the requested routing decision.
