# Virtual workers

A **virtual worker** is an ephemeral, on-demand agent process that handles work outside the hosted Jules API — coding tasks, CI fixes, merge conflict resolution, and other attention items.

This page describes the virtual worker lifecycle, provisioning model, execution modes, and attention-item handling.

## External worker client

Code UX also ships a headless external worker process at `dist/worker/index.js` and exposes it through the `codeux-worker` package bin. This worker is separate from the dashboard server: it connects to an authenticated Streamable HTTP MCP endpoint with `--server-url` and `--auth-token`, registers a stable worker endpoint, polls `pull_task_dispatch`, executes leased dispatches through a local worker-host command, and reports `RUNNING` plus terminal status through `update_task_dispatch`.

External workers can cover multiple projects in one process by repeating `--project-id`. Repeating `--active-project-id` narrows the current poll loop to an active subset while the server keeps the full `projectIds` set enrolled for future focus changes. The worker refuses to execute a dispatch unless the control plane returns a lease token, retries transient network failures with bounded backoff, and calls `cancel_local_dispatch` when the control plane returns a cancel action.

Environment fallbacks are available for headless deployment:

- `CODE_UX_WORKER_SERVER_URL`
- `CODE_UX_WORKER_AUTH_TOKEN`
- `MCP_HTTP_SERVER_URL`
- `MCP_HTTP_AUTH_TOKEN`
- `MCP_HTTPS_AUTH_TOKEN`

Bearer tokens and local provider credentials remain local and are not logged by the worker client.

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

Default reconcile cadence: `VIRTUAL_WORKER_RECONCILE_MS = 3000`. Default session poll: `VIRTUAL_WORKER_SESSION_POLL_MS = 2000`. Initial scheduling uses microtasks to coalesce rapid events, but follow-up cycles after `remaining_worker_work` are deferred on the reconcile cadence so stale or unchanged worker state cannot starve dashboard HTTP probes or shutdown handling.

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

- Image: `node:24-bookworm` (override via `workers.dockerImage`). Images are cached across runs using a setup image cache.
- Mounts:
  - The workspace volume (`code-ux.workspace=true`) is mounted read-write.
  - Runtime volumes (`code-ux.workspace-runtime=true`) are used for preserving package manager caches and the provider home directory outside of the main workspace.
  - Provider credentials are conceptually mounted via dedicated, isolated credential mounts (e.g. `mountAuth: true` builds provider-specific mounts without exposing raw host tokens or keys to the workspace root or command arguments).
  - Optional setup script.
- Network: default bridge.
- The CLI runs as the container's default user (root, in the default image).
- Container is removed on completion.

### HOST mode

- The CLI runs directly on the host as the Code UX process user.
- No mount; the CLI uses its native auth.
- Used *only* as a fallback for specific edge cases (such as degraded CI autofix runs when Docker is unrecoverably unavailable). Docker is the strict default and is required for merge conflict isolation.

## Worktree management

Source: `WorkspaceManager` (`src/services/workspace-manager.ts`, referenced from virtual-worker-service).

Each dispatch operates on its own Git worktree under `<repo>/.worktrees/<sessionId>/`. The worktree is created from the current feature branch HEAD, modified by the worker, then either:

- **Pushed** (PR created) and removed on dispatch completion.
- **Preserved** if the dispatch failed and policy says to keep failed worktrees for inspection.

Cleanup of terminal CLI worktrees also runs at sprint finalisation.

Docker-backed planning uses a read-only snapshot workspace instead of a mutable task worktree. In `REMOTE` git mode, fresh planning invocations refresh `origin` and check out only `origin/<branch>` for the explicit sprint feature branch or the effective runtime git default branch, never the host repo's current checkout. If that remote tracking ref or fallback cannot be prepared, planning fails instead of falling back to a stale local branch. Restart and Continue reuse the preserved snapshot workspace so cancelled or interrupted provider sessions can still resume.

Provider CLI workspace preparation is centralized through `InvocationWorkspacePreparer`. Its shared provider-invocation option builder constructs snapshot checkout, git policy, and fresh/continue lifecycle values for Docker provider calls, while its continuation resolver locates preserved workspaces and their current branches. Fresh Docker invocations in `REMOTE` git mode use explicit remote refs only: planning, project setup, dashboard/chat replies, worker inbox replies, node-flow provider prompts, QA review snapshots, task coding, QA follow-up, CI autofix, and merge-conflict repair all materialize from `origin/<branch>` refs rather than local branches or the host repo's current checkout. Dashboard/chat replies resolve dashboard settings with the project scope before building this policy, so local Git projects keep `LOCAL` snapshot behavior and do not require `origin/<defaultBranch>`. Continuation/restart flows may reuse a preserved workspace for provider-session continuity; if a preserved workspace is missing and a new workspace must be materialized, the same remote-only branch policy applies.

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

Repair attention is scheduled before ordinary coding dispatches. Code UX does not lease a coding task while CI-fix or merge-conflict attention is waiting, and capacity is checked against the provider selected by the invocation-specific route rather than the generic virtual-worker provider. The final provider-slot wait is bounded to 30 seconds so sprint finalization cannot wait forever on a saturated or stale route.

Task-scoped CI repair continues the originating coding session, native provider session, effective model, coding-agent instructions, and preserved workspace by default. Settings → AI Models → CI fix can disable this behavior and force the standalone CI Fix route; sprint-level final-merge repair always uses that route. Failed invocations return attention to an unclaimed retryable state while the guardrail budget remains. When the default five-attempt limit is reached, Code UX creates a human handoff containing the last error and attempt count.

Immediately before every Docker provider launch attempt, Code UX reasserts runtime-volume ownership for the container's effective non-root UID/GID. This repairs newly created, stale, or concurrently recreated root-owned provider HOME/cache volumes at the atomic `docker run` boundary, including standalone final-merge CI repair. Workspace seed helpers explicitly trust mounted `/workspace` while initializing Git and then restore the provider UID/GID, so restart recovery does not trip Git's dubious-ownership protection on a correctly non-root-owned volume.

Background startup pruning refreshes tracked sessions immediately before volume removal and protects newly created workspace/runtime volumes during their registration window. Restart cleanup therefore cannot delete a just-seeded QA or CI workspace and launch the provider against an empty replacement volume.

If feature-PR CI repair exhausts its guardrail, the task is blocked for intervention while its durable planning state remains coding-complete. The original coding task is not reopened or dispatched again merely because CI still fails.
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

Visible in the dashboard's **Tasks** detail panel and via `manage_tasks` → `inspect_run` and `manage_telemetry` → `list_task_dispatches`.

## Tuning

Hot knobs:

- `workers.virtualWorkerProvider` — pick the provider whose CLI is most reliable on your host.
- `workers.executionMode` — DOCKER for hermeticity, HOST for speed.
- `workers.dockerImage` — pin to a specific tag for reproducibility.
- `workers.containerSetupScript` — bootstrap the container with extra deps your worker needs (e.g. `apt-get install`).
- Per-provider `maxConcurrentTasks` — backstop against runaway parallelism.
