# Worker clarification contract

Worker clarification requests use the existing project attention ledger as their durable store. They do not create a parallel table.

## Storage and ownership

Each request is a `project_attention_items` record with `attention_type = worker_clarification` and `owner_type = human`. The attention item id is also the public clarification id. Existing attention columns retain project, sprint, task, sprint-run, and dispatch ownership, while the versioned JSON payload records the task run, provider session, requester agent, deduplication key, markdown question and answer, state, and timestamps.

Human ownership keeps pending questions out of virtual-worker repair automation.

## Lifecycle and safety

Clarifications move from `pending` to exactly one terminal state:

- `replied` after one answer is accepted;
- `expired` when its deadline elapses;
- `cancelled` when it is withdrawn.

Replies atomically close the active attention item, so a second answer cannot replace the first. Expiry and cancellation are idempotent. Questions are limited to 16,000 characters and answers to 32,000 characters.

Every task, sprint, sprint run, dispatch, and task-run reference is checked against the declared project and against the other linked runtime records. Reads and mutations require the owning project id as well as the clarification id.

## MCP audience boundary

The project-manager MCP gateway carries two audience-scoped tools; no additional runtime role is created. Authenticated task agents can discover `request_clarification` only when they are assigned to a project task, selected as the manual coding agent, or included in the project's coding worker pool. Only the configured clarification-reply or dashboard-reply agent, the built-in Project manager fallback, or an unscoped project-manager client can discover `reply_to_clarification`.

Listing and invocation use the same checks. Unknown or ineligible agents, cross-project calls, and cross-audience calls return `MethodNotFound`. These narrow grants still honor system toggles and explicit agent disables and do not grant other management tools or custom MCP servers. Dashboard-reply and persistent-skill access continue to use their existing policies.

Task-coding runs add the narrow worker clarification gateway even when the selected coding agent has built-in Code UX disabled. Saved tool restrictions and linked custom-server filtering remain intact, and coding agents never receive `reply_to_clarification`. Fresh, resumed, and QA-requested coding prompts include the available project, task, and runtime identifiers and require one concise, evidence-based `request_clarification` question before ambiguity or a project-manager decision is reported as a terminal blocker.

## Idempotency and events

A project-scoped deduplication key makes repeated identical submissions return the existing clarification. Reusing the key for different request content or runtime scope is rejected.

Task-run-backed clarifications emit idempotent lifecycle events with clarification, attention, project, task, sprint, dispatch, task-run, session, requester, and status metadata.

Reply results expose a typed continuation request containing the answer and provider-session correlation. Provider continuation is intentionally outside this contract and is not performed automatically.
