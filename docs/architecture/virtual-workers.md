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
- honors per-request planning overrides for virtual provider selection, so choosing `codex` in the sprint composer actually launches the Codex CLI and credentials even if the project default is `gemini`
- creates the same planning thread record in the dashboard, but stores the request/response as system messages instead of waiting on an MCP reply
- executes a retry loop up to `cliWorkflow.maxPlanningJsonRetries` (default 3) times if the initial response cannot be parsed as valid JSON
- maintains same-session continuation semantics during retries (`src/infrastructure/providers/cli/provider-runner.ts`); subsequent JSON retry requests continue the same underlying provider session using `continueSessionId` (falling back from `nativeSessionId` to the logical `sessionId`)
- records execution and provider invocation trails during retries, so operators will see an initial system message indicating the retry followed by a new provider invocation recording the follow-up prompt and reply
- allows sprint compose, improve, and `Plan & Start` to work even when no live MCP listener is attached

For merge conflicts, Sprint OS:

- prepares an isolated Docker workspace on the PR source branch
- runs the helper Git/inspection commands inside that workspace as the same UID:GID that owns the volume so Git does not reject the repo as an unsafe `root` checkout
- merges the target branch into it
- runs the selected CLI provider against the conflict context
- accepts both the original merge-conflict prompt payload fields (`currentTaskPrompt`, `mergedTaskPrompts`) and the newer task-context payload fields (`currentTask`, `featureBranchTaskContexts`) when constructing that provider prompt
- verifies conflicts are resolved
- exports a Git patch artifact from the isolated workspace
- applies that patch back onto the host branch and pushes it

Unsupported worker-owned attention types are escalated back to human attention with a summary.

## Recovery

Startup cleanup prunes orphaned `virtual_cli` endpoints from previous runs.

If a virtual cycle dies mid-attention:

- deleting the endpoint clears stale worker assignment references
- claimed worker attention becomes reclaimable by the next virtual cycle

This prevents dead virtual workers from pinning merge-conflict items indefinitely.
