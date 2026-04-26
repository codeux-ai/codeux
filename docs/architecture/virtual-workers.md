# Virtual Workers

## Status
Implemented

## Purpose

Virtual workers are now the only worker runtime.

Instead of keeping an external worker in a long-lived `listen` loop, Sprint OS now:

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
2. Sprint OS creates an ephemeral virtual endpoint and project assignment.
3. The cycle handles one worker-owned attention item.
4. It handles one item.
5. It releases the assignment and deletes the endpoint.
6. If more worker work remains, it schedules another cycle.

This is intentionally not an endless watch loop.

The background reconcile loop stays conservative (`3s`) to avoid unnecessary sqlite write contention, while virtual worker session completion polling is tighter (`2s`) because it only checks local session and dispatch state.

## Supported Work

Today virtual workers handle:

- Dashboard chat conversations via `routeKind === "virtual"` and `virtualProvider`
- Planning agent prompt improvement
- Planning agent sprint planning
- worker-owned `merge_conflict` attention
- worker-owned `ci_fix_required` attention
- worker-owned `action_required` attention that can be auto-answered or auto-approved

For planning flows, Sprint OS (`src/services/planning-agent-service.ts`):

- runs the Planning agent prompt through the configured virtual worker CLI
- injects the Planning agent's current long-term memory plus the current sprint's short-term learnings into the prompt when memory is enabled
- honors per-request planning overrides for virtual provider selection, so choosing `codex` in the sprint composer actually launches the Codex CLI and credentials even if the project default is `gemini`
- creates the same planning thread record in the dashboard, but stores the request/response as system messages instead of waiting on an MCP reply
- executes a retry loop up to `cliWorkflow.maxPlanningJsonRetries` (default 3) times if the initial response cannot be parsed as valid JSON
- maintains same-session continuation semantics during retries (`src/infrastructure/providers/cli/provider-runner.ts`); subsequent JSON retry requests continue the same underlying provider session using `continueSessionId` (falling back from `nativeSessionId` to the logical `sessionId`)
- records execution and provider invocation trails during retries, so operators will see an initial system message indicating the retry followed by a new provider invocation recording the follow-up prompt and reply
- when Docker execution mode is active, planning runs inside a snapshot workspace volume and captures `.task-learnings.md` back out of that snapshot instead of trying to read host files directly
- allows sprint compose, improve, and `Plan & Start` to work even when no live MCP listener is attached

For merge conflicts, Sprint OS:

- prepares an isolated Docker workspace on the PR source branch
- seeds that Docker workspace from an exact-ref Git bundle fetch instead of cloning the bundle, using a private bootstrap `HEAD` ref so checked-out default branches cannot block the fetch; this prevents stale local branches from shadowing newer `origin/*` target refs during merge preparation
- configures a workspace-local Git identity so merge preparation and final merge commits do not depend on global container config
- runs the helper Git/inspection commands inside that workspace as the same UID:GID that owns the volume so Git does not reject the repo as an unsafe `root` checkout
- merges the target branch into it
- runs the selected CLI provider against the conflict context plus the worker agent's current long-term and sprint memory context when available
- accepts both the original merge-conflict prompt payload fields (`currentTaskPrompt`, `mergedTaskPrompts`) and the newer task-context payload fields (`currentTask`, `featureBranchTaskContexts`) when constructing that provider prompt
- requires the worker to write durable learnings to `.task-learnings.md`, which Sprint OS captures back into memory after the conflict is resolved
- verifies conflicts are resolved
- verifies the resolved source branch actually contains `origin/<targetBranch>` before clearing the merge-conflict attention item
- exports a Git patch artifact from the isolated workspace
- applies that patch back onto the host branch as a merge commit that preserves the target branch as an additional parent, then pushes it

Merge-conflict handling intentionally stays isolated from the original task workspace. It always runs in a dedicated ephemeral Docker workspace so conflict resolution cannot pollute the task's normal follow-up workspace.

For CI autofix, Sprint OS now prefers reusing the existing task workspace when one is still available for the same worker branch. That allows follow-up CI fixes to continue in the same workspace context instead of creating an unnecessary new Docker volume for every CI rerun. The CI-fix prompt also receives the worker agent's current memory context and writes new durable learnings back into memory from the reused workspace.

Workspace artifact export captures both tracked edits and newly created untracked files from the worker workspace. This matters for CI autofix follow-ups that add missing modules or tests after the original task run; the exporter uses a temporary Git index for untracked files and still excludes the transient `.task-learnings.md` memory-capture file and `.sprint-os-home/` provider home from commits.

If Docker is unavailable when the CI autofix flow starts, Sprint OS degrades that specific repair run to a host-backed worktree instead of looping on an unrecoverable Docker failure. Merge-conflict resolution does not use this fallback: it remains Docker-only so conflict repair stays isolated from the reusable task workspace.

For QA review execution, Sprint OS now runs the review itself against a fresh snapshot workspace rather than the mutable task workspace. This keeps review inspection isolated while still allowing QA-requested coding follow-ups to continue in the original task workspace when appropriate. Both the review agent and QA-requested coding follow-ups now receive their current memory context, and QA follow-up edits capture fresh learnings back into memory from the actual workspace used for the fix.

Unsupported worker-owned attention types are escalated back to human attention with a summary.

## Recovery

Startup cleanup prunes orphaned `virtual_cli` endpoints from previous runs.

Startup cleanup also aggressively removes stale Sprint OS Docker assets:

- stale workspace volumes for finished, failed, unrecoverable, or outdated sessions
- cached setup-script Docker images from previous runs

Interrupted Docker-backed sessions that were running before restart are treated as failed during recovery unless a live backing container is still present. This keeps restart recovery deterministic and prevents dead sessions from holding disk space or waiting forever for callbacks that will never arrive.

When a sprint reaches a terminal state, Sprint OS also removes the resumable CLI workspaces tied to that sprint immediately instead of relying only on the next startup cleanup pass.

If a virtual cycle dies mid-attention:

- deleting the endpoint clears stale worker assignment references
- claimed worker attention becomes reclaimable by the next virtual cycle

This prevents dead virtual workers from pinning merge-conflict items indefinitely.
