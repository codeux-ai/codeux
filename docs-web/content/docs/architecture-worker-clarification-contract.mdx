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

## Idempotency and events

A project-scoped deduplication key makes repeated identical submissions return the existing clarification. Reusing the key for different request content or runtime scope is rejected.

Task-run-backed clarifications emit idempotent lifecycle events with clarification, attention, project, task, sprint, dispatch, task-run, session, requester, and status metadata.

Reply results expose a typed continuation request containing the answer and provider-session correlation. Provider continuation is intentionally outside this contract and is not performed automatically.
