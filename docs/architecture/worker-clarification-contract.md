# Worker Clarification Contract

## Purpose

Worker clarification requests are durable, project-owned questions raised by a coding agent while a task is in progress. The backend records the question and delivers an authorized project-manager answer back to the affected provider session before closing the clarification.

## Persistence

Each clarification is stored in `project_attention_items`:

- `attention_type` is `worker_clarification`.
- `owner_type` is always `human`, so virtual-worker repair automation does not claim or consume the item.
- The attention item id is the public clarification id.
- Project, sprint, task, sprint-run, and dispatch columns retain their existing ownership and query semantics.
- `payload_json` contains the versioned `worker_clarification` payload, including task-run, provider-session, and execution-invocation references; requester agent; deduplication key; markdown question and answer; status; automation checkpoints; and lifecycle timestamps.

No clarification-specific SQLite table is used.

## Lifecycle

The clarification status is one of:

- `pending`: the human-owned attention item is open.
- `replied`: the answer was accepted and the attention item was resolved.
- `expired`: the request deadline elapsed and the attention item was expired.
- `cancelled`: the request was withdrawn and the attention item was resolved.

Reply transitions use an atomic active-attention update after provider delivery or workspace continuation succeeds. A repeated reply returns the settled result without delivering a second message or creating a second run. Expiry and cancellation are idempotent and do not replace an earlier terminal state.

The automatic clarification coordinator subscribes to new records and recovers pending records on startup. It waits for the requesting coding turn to stop before invoking the configured clarification-reply Project manager. This answer-generation turn is invocation-scoped and read-only: it can search project knowledge and persistent skills but cannot call mutation tools or linked custom MCP servers, even when the saved Project manager preset has broader access. The Project manager returns an answer body; the backend validates and delivers it through the same continuation service used by `reply_to_clarification`. The attention item remains open until continuation is accepted. Provider failure, missing continuation evidence, timeout, or a clarification-reply guardrail leaves it open with `automationStatus: human_required` and failure evidence.

Automatic generation and delivery are allowed only while the originating sprint run is `queued` or `running`. A pause, cancellation request, cancellation, failure, or completion prevents provider work and keeps the attention item available for human handling. Delivery repeats this check immediately before provider continuation so a concurrent pause cannot launch new work.

The Project-manager provider result is checked against the sprint run, execution invocation, and provider invocation immediately before its answer is persisted. If pause or cancellation settled that runtime while the provider was finishing, the late result is discarded and cannot rewrite cancelled rows to completed or failed.

Question markdown is limited to 16,000 characters and answer markdown to 32,000 characters. Required identifiers and markdown are trimmed and must be non-empty.

## Idempotency and Ownership

The requester supplies a project-scoped deduplication key. Repeating the same normalized request returns the existing clarification id; reusing that key with different scope, requester, session, or question content is rejected.

Before persistence, the service verifies every referenced task, sprint, sprint run, dispatch, task run, and execution invocation belongs to the declared project. It also verifies linked records agree with each other and derives omitted scope fields from the authenticated execution invocation or task run. Reads and replies require both the project id and clarification id, preventing cross-project access through the public id. Reply continuation independently verifies that the replying agent is an eligible project manager for that project.

Runtime dependency composition explicitly supplies the continuation-enabled management handler to `CodeUxServer`. The MCP reply path fails closed when that continuation service is unavailable; it never falls back to settling a task-backed clarification directly.

## MCP Audience Boundary

The existing project-manager MCP gateway transports two audience-scoped tools without introducing a new runtime role. `request_clarification` is advertised to the authenticated agent that owns the active `cli_task_coding` execution invocation. Static task assignment, manual coding selection, and `orchestratorAgentPresetIds` remain fallback eligibility paths. Invocation-scoped authorization is important for dynamically selected fallback workers: routing configuration may not name them even though the durable invocation does. An assignment-only agent must address its assigned task when calling the tool. `reply_to_clarification` is advertised only to the configured clarification-reply or dashboard-reply agent, the built-in Project manager fallback, or an unscoped project-manager MCP client.

Every task-coding provider MCP configuration carries `X-Code-Ux-Agent` and `X-Code-Ux-Invocation`. The HTTP gateway validates both headers, and tool authorization verifies that the invocation is active, belongs to the same project and agent, has type `cli_task_coding`, and matches the requested task and task run. The execution invocation id is internal request context, not a caller-controlled tool argument.

The same resolver runs for `list_tools` and `call_tool`. Scoped calls must declare the agent's project; unknown agents, ineligible project roles, cross-project calls, and cross-audience calls fail as MCP `MethodNotFound`. Audience grants respect system tool toggles and explicit per-agent disables and do not enable unrelated management tools or custom MCP servers. Persistent-skill retrieval and dashboard-reply defaults remain independent grants.

Task-coding provider invocations add the narrow worker clarification gateway even when the selected coding agent's saved policy has built-in Code UX disabled. Existing explicit tool restrictions and linked custom-server filtering remain intact, and coding agents never receive `reply_to_clarification`. Fresh, resumed, and QA-requested coding prompts identify the current project, task, and available runtime records and require the worker to submit one concise, evidence-based `request_clarification` question before reporting ambiguity or a project-manager decision as a terminal blocker.

## Runtime Events and Provider Continuation

When a task run is present, lifecycle changes append idempotent task-run events such as `worker_clarification_requested`, `worker_clarification_continued`, `worker_clarification_replied`, `worker_clarification_expired`, and `worker_clarification_cancelled`. Event payloads include the clarification id, delivery mode, provider/session correlation, and complete runtime scope.

For Jules, the manager answer is sent through the existing session-message API and the existing task run and dispatch return to running only after the API accepts it. For local CLI and virtual coding providers, the task rerun service appends a clearly delimited manager-answer follow-up and starts a continuation with the same provider, model, task agent, worker branch, workspace session, and native provider-session lineage. A newer workspace or branch is rejected instead of being mistaken for the source conversation.

An explicit clarification request is authoritative even if the provider later prints a completed outcome. The CLI workflow checks durable clarification state before Git finalization, preserves partial edits without committing or pushing them, and parks the task with the worker branch and workspace lineage intact. Automatic continuation also evaluates the task-coding guardrail before generating a manager answer; an exhausted coding budget leaves the same attention item open for a human.

The supported local provider matrix is Gemini, Codex, Claude Code, Qwen Code, OpenCode, Antigravity, and the local test CLI. Antigravity's generated Code UX MCP connection explicitly advertises both Streamable HTTP response media types so its requests satisfy the gateway transport contract. Clarification continuation disables fresh-session fallback: Claude Code requires its captured native session id, Codex may use its supported workspace-local `resume --last` path, and the other providers use their native continuation mode. Missing lineage fails before dispatch and keeps the attention pending. Each accepted continuation must create a new Code UX dispatch, task run, and execution invocation for observability while retaining parent task-run, parent execution-invocation, workspace, branch, and provider-conversation lineage. Reusing an unrelated active dispatch is a delivery failure and cannot settle the attention item.

A coding agent's `CODE_UX_TASK_OUTCOME: blocked` marker is evidence, not authority to create a naked terminal block. If the turn ends without Git changes, Code UX creates or reuses a clarification and records the provider turn as completed rather than failed. The task and dispatch may remain blocked only with that active attention while the coordinator obtains a decision. Non-recoverable Git authentication or execution-environment failures create a separate critical human attention item before persisting blocked runtime state.

The no-change Git path explicitly pins a workspace while its clarification is pending, even when ordinary success cleanup is enabled, QA is disabled, or the task is outside an active sprint run. The continuation path does not clear the worktree, cancel the prior dispatch, reset QA state, or resolve task attention before continuation is accepted.

Session synchronization projects an active `worker_clarification_requested` event as blocked task and dispatch state even when the provider snapshot is stale. The planning task remains `in_progress`, rather than becoming scheduler-eligible `pending`, while its runtime task run is `BLOCKED`. The dispatch service also checks durable clarification state atomically before every start: an ordinary dispatch is deferred while any matching clarification is pending, and only the continuation carrying that exact clarification id may pass. A matching continuation or reply event permits one running projection; source event keys make repeated reconciliation idempotent. Requests tied to a retired session are ignored, and paused or cancelled runs are never reactivated. Virtual-worker scheduling treats both the canonical attention type and its payload discriminator as project-manager-owned, so pending questions cannot enter automatic clarification replies or cause a duplicate claim for the matching task or dispatch. Other task and dispatch scopes remain eligible for scheduling.

Taskless general questions record and settle the manager answer without creating a coding dispatch. Task-backed replies with no provider session or no preserved CLI workspace remain pending and return an error.

## Implementation

- `src/contracts/worker-clarification-types.ts`
- `src/repositories/worker-clarification-repository.ts`
- `src/services/worker-clarification-service.ts`
- `src/services/worker-clarification-continuation-service.ts`
- `src/services/worker-clarification-coordinator-service.ts`
- `src/services/task-rerun-service.ts`
- `src/repositories/project-attention-repository.ts`
- `src/repositories/execution-repository.ts`
