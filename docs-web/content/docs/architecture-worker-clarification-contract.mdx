# Worker clarification contract

Worker clarification requests use the existing project attention ledger as their durable store. They do not create a parallel table.

## Storage and ownership

Each request is a `project_attention_items` record with `attention_type = worker_clarification` and `owner_type = human`. The attention item id is also the public clarification id. Existing attention columns retain project, sprint, task, sprint-run, and dispatch ownership, while the versioned JSON payload records the task run, provider session, authenticated execution invocation, requester agent, deduplication key, markdown question and answer, automation checkpoints, state, and timestamps.

Human ownership keeps pending questions out of virtual-worker repair automation.

## Lifecycle and safety

Clarifications move from `pending` to exactly one terminal state:

- `replied` after one answer is accepted;
- `expired` when its deadline elapses;
- `cancelled` when it is withdrawn.

Replies close the active attention item only after provider delivery or workspace continuation succeeds. Repeated replies return the settled result without sending another message or starting another run. Expiry and cancellation are idempotent. Questions are limited to 16,000 characters and answers to 32,000 characters.

An automatic coordinator waits for the requesting coding turn to stop, asks the configured clarification-reply Project manager, and delivers the returned answer through the same reply service. The answer-generation invocation is restricted to read-only project knowledge and skill search regardless of the manager preset's broader permissions; mutation tools and linked custom MCP servers are unavailable. It recovers pending records after restart. Provider failure, guardrail exhaustion, timeout, or missing continuation evidence leaves the human attention item open with failure evidence. Only `queued` and `running` sprint runs permit generation or delivery; paused and terminal runs retain the human attention without launching provider work.

Immediately before persisting the answer, Code UX rechecks the sprint run and both invocation rows. A provider result that arrives after pause or cancellation is discarded and cannot resurrect cancelled runtime state.

Every task, sprint, sprint run, dispatch, and task-run reference is checked against the declared project and against the other linked runtime records. Reads and mutations require the owning project id as well as the clarification id, and continuation verifies that the replying agent is an eligible project manager for that project.

Runtime composition explicitly gives the server its continuation-enabled management handler. If continuation wiring is unavailable, the MCP reply fails closed instead of directly settling the clarification.

## MCP audience boundary

The project-manager MCP gateway carries two audience-scoped tools; no additional runtime role is created. Active task-coding invocations advertise both `X-Code-Ux-Agent` and `X-Code-Ux-Invocation`. Code UX verifies that the invocation is active and belongs to the same agent, project, task, and task run before granting `request_clarification`; static task assignment, manual selection, and coding-pool membership remain fallback authorization paths. Only the configured clarification-reply or dashboard-reply agent, the built-in Project manager fallback, or an unscoped project-manager client can discover `reply_to_clarification`.

Listing and invocation use the same checks. Unknown or ineligible agents, cross-project calls, and cross-audience calls return `MethodNotFound`. These narrow grants still honor system toggles and explicit agent disables and do not grant other management tools or custom MCP servers. Dashboard-reply and persistent-skill access continue to use their existing policies.

Task-coding runs add the narrow worker clarification gateway even when the selected coding agent has built-in Code UX disabled. Saved tool restrictions and linked custom-server filtering remain intact, and coding agents never receive `reply_to_clarification`. Fresh, resumed, and QA-requested coding prompts include the available project, task, and runtime identifiers and require one concise, evidence-based `request_clarification` question before ambiguity or a project-manager decision is reported as a terminal blocker.

## Idempotency and events

A project-scoped deduplication key makes repeated identical submissions return the existing clarification. Reusing the key for different request content or runtime scope is rejected.

Task-run-backed clarifications emit idempotent lifecycle and delivery events with clarification, attention, project, task, sprint, dispatch, task-run, provider session, requester, and status metadata.

Jules replies use the existing session-message API. Gemini, Codex, Claude Code, Qwen Code, OpenCode, Antigravity, and the local test CLI append a delimited manager-answer follow-up and resume the exact preserved workspace, worker branch, provider, model, task agent, and native session lineage through the task rerun path. Antigravity's generated connection advertises both required Streamable HTTP response media types. A newer workspace or branch is rejected. Fresh-session fallback is disabled for clarification continuation. Missing lineage leaves the clarification pending.

An explicit clarification request wins even if the provider later prints a completed outcome. Code UX parks before Git finalization, preserves partial edits without committing or pushing them, and keeps the worker branch and workspace lineage available for continuation. The coding-attempt guardrail is checked before automatic manager generation; if exhausted, the same attention item remains open for a human.

A reasoning-based blocked marker with no Git changes creates or reuses this attention path; it cannot create an attention-free terminal block. The provider turn is recorded as completed rather than failed, and its workspace is pinned until clarification continuation even when normal success cleanup would remove it. Non-recoverable Git or execution-environment failures create a critical human attention item before blocked state is persisted.

Session synchronization keeps an unanswered request blocked and visible even when the provider snapshot is stale. Its planning record stays `in_progress`, and the dispatch boundary independently defers ordinary starts while durable clarification state is pending. Only a continuation carrying the exact clarification id may pass, and it must create a new dispatch and task run before delivery can settle the attention. A matching continuation or reply restores running state once; repeated reconciliation is idempotent, stale-session requests are ignored, and cancelled or paused runs are not resurrected. Virtual workers treat the clarification type and payload as project-manager-owned, so they cannot auto-answer the question or claim duplicate work for the matching task or dispatch while it is pending. Unrelated task and dispatch scopes remain eligible.

Taskless questions record the manager answer without creating a coding dispatch. A task-backed reply remains pending when its provider session or preserved CLI workspace is unavailable.
