# Worker Clarification Contract

## Purpose

Worker clarification requests are durable, project-owned questions raised by a coding agent while a task is in progress. The backend records the question and delivers an authorized project-manager answer back to the affected provider session before closing the clarification.

## Persistence

Each clarification is stored in `project_attention_items`:

- `attention_type` is `worker_clarification`.
- `owner_type` is always `human`, so virtual-worker repair automation does not claim or consume the item.
- The attention item id is the public clarification id.
- Project, sprint, task, sprint-run, and dispatch columns retain their existing ownership and query semantics.
- `payload_json` contains the versioned `worker_clarification` payload, including the task-run and provider session references, requester agent, deduplication key, markdown question and answer, status, and lifecycle timestamps.

No clarification-specific SQLite table is used.

## Lifecycle

The clarification status is one of:

- `pending`: the human-owned attention item is open.
- `replied`: the answer was accepted and the attention item was resolved.
- `expired`: the request deadline elapsed and the attention item was expired.
- `cancelled`: the request was withdrawn and the attention item was resolved.

Reply transitions use an atomic active-attention update after provider delivery or workspace continuation succeeds. A repeated reply returns the settled result without delivering a second message or creating a second run. Expiry and cancellation are idempotent and do not replace an earlier terminal state.

Question markdown is limited to 16,000 characters and answer markdown to 32,000 characters. Required identifiers and markdown are trimmed and must be non-empty.

## Idempotency and Ownership

The requester supplies a project-scoped deduplication key. Repeating the same normalized request returns the existing clarification id; reusing that key with different scope, requester, session, or question content is rejected.

Before persistence, the service verifies every referenced task, sprint, sprint run, dispatch, and task run belongs to the declared project. It also verifies linked records agree with each other and derives omitted scope fields from the most specific runtime record. Reads and replies require both the project id and clarification id, preventing cross-project access through the public id. Reply continuation independently verifies that the replying agent is an eligible project manager for that project.

## MCP Audience Boundary

The existing project-manager MCP gateway transports two audience-scoped tools without introducing a new runtime role. `request_clarification` is advertised only to an authenticated agent that is assigned to a task in the project, selected as the manual coding agent, or included in `orchestratorAgentPresetIds`. An assignment-only agent must address its assigned task when calling the tool. `reply_to_clarification` is advertised only to the configured clarification-reply or dashboard-reply agent, the built-in Project manager fallback, or an unscoped project-manager MCP client.

The same resolver runs for `list_tools` and `call_tool`. Scoped calls must declare the agent's project; unknown agents, ineligible project roles, cross-project calls, and cross-audience calls fail as MCP `MethodNotFound`. Audience grants respect system tool toggles and explicit per-agent disables and do not enable unrelated management tools or custom MCP servers. Persistent-skill retrieval and dashboard-reply defaults remain independent grants.

Task-coding provider invocations add the narrow worker clarification gateway even when the selected coding agent's saved policy has built-in Code UX disabled. Existing explicit tool restrictions and linked custom-server filtering remain intact, and coding agents never receive `reply_to_clarification`. Fresh, resumed, and QA-requested coding prompts identify the current project, task, and available runtime records and require the worker to submit one concise, evidence-based `request_clarification` question before reporting ambiguity or a project-manager decision as a terminal blocker.

## Runtime Events and Provider Continuation

When a task run is present, lifecycle changes append idempotent task-run events such as `worker_clarification_requested`, `worker_clarification_continued`, `worker_clarification_replied`, `worker_clarification_expired`, and `worker_clarification_cancelled`. Event payloads include the clarification id, delivery mode, provider/session correlation, and complete runtime scope.

For Jules, the manager answer is sent through the existing session-message API and the existing task run and dispatch return to running only after the API accepts it. For local CLI and virtual coding providers, the task rerun service appends a clearly delimited manager-answer follow-up and starts a continuation with the same provider, model, task agent, worker branch, workspace session, and native provider-session lineage. This path does not clear the worktree, cancel the prior dispatch, reset QA state, or resolve task attention before continuation is accepted.

Taskless general questions record and settle the manager answer without creating a coding dispatch. Task-backed replies with no provider session or no preserved CLI workspace remain pending and return an error.

## Implementation

- `src/contracts/worker-clarification-types.ts`
- `src/repositories/worker-clarification-repository.ts`
- `src/services/worker-clarification-service.ts`
- `src/services/worker-clarification-continuation-service.ts`
- `src/services/task-rerun-service.ts`
- `src/repositories/project-attention-repository.ts`
- `src/repositories/execution-repository.ts`
