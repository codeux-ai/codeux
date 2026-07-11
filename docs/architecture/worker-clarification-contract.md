# Worker Clarification Contract

## Purpose

Worker clarification requests are durable, project-owned questions raised by a coding agent while a task is in progress. The backend contract records the request and its reply without introducing a second persistence model or continuing the provider session itself.

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

Reply transitions use an atomic active-attention update. A resolved request cannot accept a second answer. Expiry and cancellation are idempotent and do not replace an earlier terminal state.

Question markdown is limited to 16,000 characters and answer markdown to 32,000 characters. Required identifiers and markdown are trimmed and must be non-empty.

## Idempotency and Ownership

The requester supplies a project-scoped deduplication key. Repeating the same normalized request returns the existing clarification id; reusing that key with different scope, requester, session, or question content is rejected.

Before persistence, the service verifies every referenced task, sprint, sprint run, dispatch, and task run belongs to the declared project. It also verifies linked records agree with each other and derives omitted scope fields from the most specific runtime record. Reads and replies require both the project id and clarification id, preventing cross-project access through the public id.

## MCP Audience Boundary

The existing project-manager MCP gateway transports two audience-scoped tools without introducing a new runtime role. `request_clarification` is advertised only to an authenticated agent that is assigned to a task in the project, selected as the manual coding agent, or included in `orchestratorAgentPresetIds`. An assignment-only agent must address its assigned task when calling the tool. `reply_to_clarification` is advertised only to the configured clarification-reply or dashboard-reply agent, the built-in Project manager fallback, or an unscoped project-manager MCP client.

The same resolver runs for `list_tools` and `call_tool`. Scoped calls must declare the agent's project; unknown agents, ineligible project roles, cross-project calls, and cross-audience calls fail as MCP `MethodNotFound`. Audience grants respect system tool toggles and explicit per-agent disables and do not enable unrelated management tools or custom MCP servers. Persistent-skill retrieval and dashboard-reply defaults remain independent grants.

## Runtime Events and Continuation Boundary

When a task run is present, lifecycle changes append idempotent task-run events such as `worker_clarification_requested`, `worker_clarification_replied`, `worker_clarification_expired`, and `worker_clarification_cancelled`. Event payloads include both the clarification id and attention item id plus the complete runtime scope and requester metadata.

A successful reply returns a typed `WorkerClarificationContinuationRequest`. It contains the answer and provider-session correlation required by the continuation integration, but this contract does not call a provider or resume a session.

## Implementation

- `src/contracts/worker-clarification-types.ts`
- `src/repositories/worker-clarification-repository.ts`
- `src/services/worker-clarification-service.ts`
- `src/repositories/project-attention-repository.ts`
- `src/repositories/execution-repository.ts`
