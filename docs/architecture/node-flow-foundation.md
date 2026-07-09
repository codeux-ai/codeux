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

Invalid graphs throw a `ValidationError` with field-level details when persistence is attempted. The validation route returns the same structured issue list without writing data.

## Runtime

`src/services/node-flow-runtime-service.ts` executes the current flow version after revalidating the graph. It creates a parent `execution_invocations` row with `type = "node_flow"`, then runs nodes in the validator's topological order.

Supported node types:

- `input`: emits the run input object.
- `set_fields`: merges upstream object output with configured fields, including template interpolation.
- `template`: renders a string template into a configured output key.
- `provider_prompt`: calls the existing `ProviderExecutionService` with `type = "node_flow_node"` and an existing invocation id. It does not create a parallel provider runner.
- `http_request`: performs bounded HTTP/HTTPS requests with method, URL, headers, query, body, timeout, and JSON response extraction.
- `output`: selects the final output from upstream data, configured fields, or a configured path.

Provider and HTTP nodes create linked child `execution_invocations` rows with `type = "node_flow_node"`. Prompt text and HTTP secrets are not written to invocation messages; persisted run inputs, outputs, node payloads, trigger payloads, and route responses are masked for secret-like keys.

Failed nodes stop downstream descendants by default and persist skipped node runs. A node can set `data.continueOnError = true` to persist its own failure output while allowing downstream nodes to continue.

## Persistence

SQLite tables are created in both the initial schema and startup migrations:

- `node_flows`
- `node_flow_versions`
- `node_flow_agent_skills`
- `node_flow_runs`
- `node_flow_node_runs`

Graphs, widget schemas, run inputs, run outputs, and trigger payloads are stored as JSON text. Run and node-run rows store linked execution invocation ids where applicable. Flow create/update/delete and agent-skill attachment changes schedule a project structure refresh so realtime dashboard clients can refetch project-scoped data.

## HTTP Surface

Dashboard routes are registered through `registerNodeFlowRoutes`:

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

Handlers stay thin and delegate behavior to `NodeFlowService`.
