# Virtual workers

A **virtual worker** is an ephemeral, on-demand agent process that handles work outside the hosted Jules API — coding tasks, CI fixes, merge conflict resolution, and other attention items.

This page describes the virtual worker lifecycle, provisioning model, execution modes, and attention-item handling.

## Source

`src/services/virtual-worker-service.ts` (~1000 LOC).

## Lifecycle

```
[Reconcile loop, every 3 s]
   │
   ▼
For each project that needs attention:
   │
   ├─ pickNextWorkerAttention(projectId)   // pull next eligible item
   │
   ├─ if found:
   │     ├─ Create ephemeral virtual endpoint in WorkerEndpointRepository
   │     ├─ Assign worker to project (ProjectWorkerAssignmentService)
   │     ├─ handleAttentionItem(endpoint.id, item, reason)
   │     │     │
   │     │     ├─ For coding/ci_fix/merge_conflict:
   │     │     │     ├─ Resolve provider settings & model
   │     │     │     ├─ Provision worktree (WorkspaceManager)
   │     │     │     ├─ Spawn CLI (DOCKER or HOST mode)
   │     │     │     │
   │     │     │     ├─ [Session poll loop, every 2 s]
   │     │     │     │     ├─ Pull session state
   │     │     │     │     ├─ Update dispatch (workerTaskDispatchService)
   │     │     │     │     └─ Exit on terminal state or cancel
   │     │     │     │
   │     │     │     └─ Cleanup worktree (unless preserve policy)
   │     │     │
   │     │     └─ For action_required (plan / clarification):
   │     │           └─ Auto-approve or auto-reply (per automationInterventions)
   │     │
   │     └─ Release worker assignment & delete ephemeral endpoint
   │
   └─ if no item: skip project
```

Default reconcile cadence: `VIRTUAL_WORKER_RECONCILE_MS = 3000`. Default session poll: `VIRTUAL_WORKER_SESSION_POLL_MS = 2000`.

## Worker provisioning

Each cycle that has work creates an *ephemeral* worker endpoint:

```ts
const endpoint = workerEndpointRepository.createVirtualEndpoint({
  endpointKey: `virtual:${projectId}:${Date.now().toString(36)}:${randomToken()}`,
  displayName: `Virtual ${providerLabel} Worker`,
  status: "connected",
  transport: "internal",
  capabilities: { canSuperviseProjects: true, canExecuteTasks: true },
});
```

The endpoint is registered in the same connection registry that real MCP clients use. The dashboard's Connections panel shows it for the duration of the dispatch.

After the dispatch completes (success, fail, cancel), the endpoint is deleted to avoid clutter.

## Provider selection

Per project, `workers.virtualWorkerProvider` (default `codex`) chooses the CLI provider. The full set of supported virtual providers:

```
gemini, codex, claude-code, qwen-code, opencode
```

Each has its own default model, thinking mode, and auth path (see [Settings reference](../developer/settings-reference.md)).

For per-invocation routing (e.g. a `ci_fix` should use Claude even if `task_coding` uses Codex), the engine consults `aiProvider.routing.<invocationId>` and overrides accordingly.

## Execution modes

Per provider, `executionMode` is `DOCKER` (default) or `HOST`.

### DOCKER mode

- Image: `node:24-bookworm` (override via `workers.dockerImage`).
- Mounts:
  - The worktree path read-write.
  - The provider auth path (e.g. `~/.gemini`) read-only, if `mountAuth: true`.
  - Optional setup script.
- Network: default bridge.
- The CLI runs as the container's default user (root, in the default image).
- Container is removed on completion.

### HOST mode

- The CLI runs directly on the host as the Code UX process user.
- No mount; the CLI uses its native auth.
- Faster startup, no Docker dependency, but less hermetic.

## Worktree management

Source: `WorkspaceManager` (`src/services/workspace-manager.ts`, referenced from virtual-worker-service).

Each dispatch operates on its own Git worktree under `<repo>/.worktrees/<sessionId>/`. The worktree is created from the current feature branch HEAD, modified by the worker, then either:

- **Pushed** (PR created) and removed on dispatch completion.
- **Preserved** if the dispatch failed and policy says to keep failed worktrees for inspection.

Cleanup of terminal CLI worktrees also runs at sprint finalisation.

## Session lifecycle

Within a dispatch, the session poll loop runs:

```ts
while (true) {
  await sleep(VIRTUAL_WORKER_SESSION_POLL_MS);

  const currentSession = sessionTracking.getSession(session.id) ?? session;
  const terminalState = resolveTerminalDispatchState(currentSession);

  const update = workerTaskDispatchService.updateDispatchForWorker({...});

  if (terminalState
      || update.controlAction === "cancel"
      || isTerminalSessionState(currentSession.state)) {
    return;
  }
}
```

Terminal session states:
- `COMPLETED` — success.
- `FAILED` — execution error.
- `CANCELLED` — user cancelled.
- `QUOTA` / `RATE_LIMITED` → mapped to `QUOTA`.

## Attention item handling

The virtual worker can claim and act on these attention item categories:

| Category | Behaviour |
| --- | --- |
| `merge_conflict` | Provision a worker on the conflicting worktree; instruct the CLI to resolve and push. |
| `ci_failure` | Provision a worker; instruct the CLI to read the failing CI log and apply a fix; respects `julesCiAutofixMaxRetries`. |
| `action_required` (plan approval) | Auto-approve via `julesApiClient.approveSessionPlan()` if `autoApprovePlan: true`. |
| `action_required` (clarification) | Auto-reply per `autoAnswerClarificationMode` (`TEMPLATE` or `WORKER`). |
| Other | Escalate to human. |

A virtual worker only attempts items eligible for its provider's capabilities. Unhandled items remain for human resolution.

## Concurrency & throttling

- Per project, only one virtual worker dispatch runs at a time. Items queue and are processed in priority order.
- Across projects, the reconcile loop iterates sequentially (not parallel) to avoid Docker / disk contention.
- The Docker daemon's own concurrency limits also apply; tune via Docker config if you scale up.

## Failure recovery

If the worker process crashes:

- The session-poll loop exits with an error.
- The dispatch row is updated to `FAILED`.
- The worktree is left in place (for forensic inspection) unless cleanup policy says otherwise.
- The next reconcile cycle picks up the same attention item (with retry counter incremented) or escalates.

If the Code UX process crashes:

- Outstanding worker containers continue running but are orphaned.
- On restart, the lifecycle's `cleanupSprintPreviews` and Docker pruning steps remove orphans.

## Telemetry

Each dispatch records:

- Start / end timestamp, duration.
- Provider, model, thinking mode, execution mode.
- Worktree path.
- PR URL on success.
- Failure reason.

Visible in the dashboard's **Tasks** detail panel and via `manage_code_ux` → `tasks` → `inspect_run` and `telemetry` → `list_task_dispatches`.

## Tuning

Hot knobs:

- `workers.virtualWorkerProvider` — pick the provider whose CLI is most reliable on your host.
- `workers.executionMode` — DOCKER for hermeticity, HOST for speed.
- `workers.dockerImage` — pin to a specific tag for reproducibility.
- `workers.containerSetupScript` — bootstrap the container with extra deps your worker needs (e.g. `apt-get install`).
- Per-provider `maxConcurrentTasks` — backstop against runaway parallelism.
