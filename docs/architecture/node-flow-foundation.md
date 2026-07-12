# Node Flow Foundation

Node flows are project-scoped, repeatable workflow graphs. The backend owns typed contracts, validation, persistence, dashboard HTTP routes, and a deterministic runtime for the safe initial node set.

## Contracts

The shared contracts live in `src/contracts/node-flow-types.ts`.

Primary records:

- `NodeFlowRecord` stores the current project-scoped flow, normalized graph, version, and timestamps.
- `NodeFlowGraph` contains `nodes`, `edges`, optional `inputSchema`, and JSON metadata.
- `NodeFlowNode` stores a stable node id, node type, title, optional widget schema, position, and JSON data.
- `NodeFlowEdge` connects `fromNodeId` to `toNodeId`.
- `NodeWidgetSchema` stores widget fields. Field types currently include `text`, `textarea`, `number`, `boolean`, `select`, `json`, `secretRef`, and `keyValue`.
- `NodeFlowSkillAttachment` records that a flow is exposed as a repeatable skill for an agent preset.

Run records are persisted as `NodeFlowRunRecord` and `NodeFlowNodeRunRecord`. Both records include an optional `executionInvocationId` so the dashboard can connect a flow run or node step to the execution invocation feed.

## Validation

`src/domain/node-flows/node-flow-validation.ts` owns graph normalization and validation. It checks:

- node ids are present and unique
- edge endpoints reference existing nodes
- the graph is acyclic and has a deterministic execution order
- widget fields have required id, label, type, and select option metadata
- widget default values are JSON-safe and match the field type
- malformed v1 and v2 node, edge, port, credential-binding, definition-reference, capability, policy, schema, and metadata members produce stable issues at their original paths

Invalid graphs throw a `ValidationError` with field-level details when persistence is attempted. The validation route returns the same structured issue list without writing data.

Normalization is fail closed and entry oriented. It retains safe siblings, does not renumber issue paths after rejecting an earlier array member, and returns issues in deterministic traversal order so repeated validation is stable.

## Runtime

`src/services/node-flow-runtime-service.ts` executes the current flow version after revalidating the graph. It creates a parent `execution_invocations` row with `type = "node_flow"`, then runs nodes in the validator's topological order.

The registry-backed runtime supports:

- `input`: emits the run input object.
- `set_fields`: merges upstream object output with configured fields, including template interpolation.
- `template`: renders a string template into a configured output key.
- `provider_prompt`: calls the existing `ProviderExecutionService` with `type = "node_flow_node"` and an existing invocation id. It does not create a parallel provider runner.
- `http_request`: performs bounded HTTP/HTTPS requests with method, URL, headers, query, body, timeout, and JSON response extraction.
- `condition` and `switch`: select an explicit output branch and persist unselected descendants as skipped.
- `foreach` and `merge`: emit a bounded list or combine active upstream values with an explicit strategy.
- `delay`: waits for a bounded cancellable duration.
- `approval`: persists an operator decision gate and resumes the pinned run after a decision.
- `email_draft` and `email_send`: build a draft, or send only after approval through the idempotent outbox.
- `execute_subflow`: executes a same-project published flow with recursion bounds.
- `webhook_trigger`: emits input received through secret-authenticated webhook ingress.
- `output`: selects the final output from upstream data, configured fields, or a configured path.

Versioned custom definitions can execute through the custom-node runtime after validation and registration. Definitions without a registered executable handler fail validation and cannot be published.

Provider and HTTP nodes create linked child `execution_invocations` rows with `type = "node_flow_node"`. Prompt text and HTTP secrets are not written to invocation messages; persisted run inputs, outputs, node payloads, trigger payloads, and route responses are masked for secret-like keys.

Failed nodes stop downstream descendants by default and persist skipped node runs. A node can set `data.continueOnError = true` to persist its own failure output while allowing downstream nodes to continue.

## Persistence

SQLite tables are created in both the initial schema and startup migrations:

- `node_flows`
- `node_flow_versions`
- `node_flow_agent_skills`
- `node_flow_runs`
- `node_flow_node_runs`
- `node_flow_node_attempts`
- `node_flow_publications`

Approval, webhook, and external-effect state use the related automation approval, trigger, and outbox repositories. Publication snapshots and attempt records preserve the immutable graph/policy selection and retry history used for debugging and recovery.

Graphs, widget schemas, run inputs, run outputs, and trigger payloads are stored as JSON text. Run and node-run rows store linked execution invocation ids where applicable. Flow create/update/delete and agent-skill attachment changes schedule a project structure refresh so realtime dashboard clients can refetch project-scoped data.

## HTTP Surface

Dashboard routes are registered through `registerNodeFlowRoutes`:

- `GET /api/node-flow-catalog` and `GET /api/node-flow-catalog/:nodeType`
- `POST /api/projects/:projectId/node-flow-drafts`
- `PATCH /api/node-flow-drafts/:flowId`
- `POST /api/node-flow-drafts/:flowId/validate`
- `POST /api/node-flow-drafts/:flowId/dry-run`
- `GET /api/node-flow-drafts/:flowId/bindings`
- `POST /api/node-flow-drafts/:flowId/credential-requests`
- `POST /api/node-flow-drafts/:flowId/publish`
- `GET /api/node-flows/:flowId/compare`
- `POST /api/node-flows/:flowId/rollback`
- `GET /api/projects/:projectId/node-flows`
- `POST /api/projects/:projectId/node-flows`
- `GET /api/node-flows/:flowId`
- `PATCH /api/node-flows/:flowId`
- `DELETE /api/node-flows/:flowId`
- `POST /api/node-flows/:flowId/validate`
- `POST /api/node-flows/:flowId/run`
- `GET /api/node-flows/:flowId/agent-skills`
- `POST /api/node-flows/:flowId/agent-skills`
- `DELETE /api/node-flows/:flowId/agent-skills`
- `GET /api/node-flows/:flowId/runs`
- `GET /api/node-flow-runs/:runId`
- `GET /api/node-flow-runs/:runId/node-runs`
- `GET /api/node-flow-runs/:runId/attempts`
- cancellation, retry, approval, and webhook routes described in the durable-execution and built-in security pages

Handlers stay thin and delegate behavior to `NodeFlowService`.

## Canonical Graph v2

Normalized graphs carry `schemaVersion: 2`. Nodes reference a stable definition type and version and carry typed ports, credential-id bindings, bounded retry/timeout policies, capabilities, side-effect classification, and disabled state. Graphs may declare typed input/output schemas and immutable publication metadata.

The typed registry includes configuration and UI schemas, ports, credential slots, capabilities, side effects, default policies, documentation, deprecation, executable state, and execution kind. The palette and inspector consume these manifests, so ports and configuration controls are not maintained as a separate hard-coded node list.

The governed built-ins with registered runtime handlers are:

- data and provider operations: `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output`
- control and transformation: `condition`, `switch`, `foreach`, `merge`, `delay`, and `execute_subflow`
- governed effects and triggers: `approval`, `email_draft`, `email_send`, and `webhook_trigger`

Validated custom definitions become executable only after their versioned manifest and immutable artifact are registered and the custom-node runtime is configured. Raw legacy browser `trigger`/`agent`/`task` kinds are translated by the one-time import bridge and are not runtime handlers. Other unknown types, design mockups, and manifests marked non-executable remain planned or unavailable.

Validation resolves definitions and checks configuration, handles, policies, graph limits, and cycles with field-level issues. Graph JSON rejects secret-shaped fields and generated/custom source fields. Persisted Graph v1 rows keep their original immutable snapshot and append deterministic Graph v2 as a new current version.

## Dashboard workspace and governance

`/nodes` requires a selected project and loads that project's flow library from the backend. Draft writes carry `draftRevision`; a stale revision returns a conflict rather than replacing newer work. The former `codeux:nodes-canvas:v1` browser value is eligible for one project-specific import. Its legacy kinds and handles are translated to registered Graph v2 definitions before draft creation. Import failures remain retryable warnings and do not block the backend library; success records a marker and removes the graph value.

Draft review combines structural validation, capability and side-effect policy findings, credential-slot status, and a non-executing dry run. The dashboard receives credential ids and status metadata only, never resolved secret values. Publication requires the current revision, a valid policy review, and all credential requirements bound. Runs resolve immutable pinned or latest-published snapshots.

The run debugger reads persisted runs, node runs, numbered attempts, approvals, retry decisions, invocation links, timing, and cancellation state. Responses and persisted payloads are redacted before display. Scheduling delegates to the scheduler and retains pinned-versus-latest publication semantics.

Outside development, the dashboard route requires `VITE_CODEUX_FEATURE_NODES`, `VITE_CODEUX_NODE_FLOW_BACKEND`, and `VITE_CODEUX_AUTOMATION_SECURITY` to resolve enabled. Runtime availability remains dependency-specific: providers, credential resolution, egress policy, approval/outbox, webhook configuration, and the custom-node runtime must be configured for definitions that use them.
