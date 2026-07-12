# Node Flows

Node flows are project-scoped, repeatable workflow graphs for turning an operator or agent-defined procedure into a saved Code UX workflow. They are not a generic n8n compatibility layer. A good flow uses Code UX concepts, project-owned records, provider settings, execution invocations, and editable widget schemas so the same workflow can be inspected, rerun, scheduled, and attached to agents.

The foundation page in [Node Flow Foundation](./node-flow-foundation.md) lists the low-level contracts. This page describes the end-to-end architecture and runtime expectations for developers and specialist agents.

## Data Model

Node-flow persistence is owned by `NodeFlowRepository` and stored in SQLite:

| Table | Purpose |
| --- | --- |
| `node_flows` | Current project-scoped flow record: id, project id, title, description, normalized `graph_json`, current version, and timestamps. |
| `node_flow_versions` | Immutable edit snapshots written on create and every update. |
| `node_flow_publications` | Immutable executable graph and execution-policy snapshots selected by pinned or latest-published runs. |
| `node_flow_agent_skills` | Agent attachment table keyed by flow and agent preset. It stores the skill display name and description used when exposing the flow as a repeatable agent capability. |
| `node_flow_runs` | Flow run records with status, version, trigger type, redacted trigger payload, redacted input/output, error message, timestamps, and optional `execution_invocation_id`. |
| `node_flow_node_runs` | Per-node run records with status, node id, redacted input/output, error message, timestamps, and optional `execution_invocation_id`. |
| `node_flow_node_attempts` | Numbered attempts with executor/invocation identity, artifact digest, credential ids, redacted payloads, failure class, and retry decision. |

All graphs, widget schemas, run inputs, outputs, and trigger payloads are stored as JSON text and hydrated into typed contracts at the repository boundary. Flow, version, run, and attachment records belong to a project. Agent attachment operations verify that the target agent preset belongs to the same project as the flow.

## Graph Contract

The shared contract lives in `src/contracts/node-flow-types.ts`.

A `NodeFlowGraph` contains:

- `nodes`: stable node ids, string node `type`, title, optional description, optional position, optional `widgetSchema`, and JSON `data`.
- `edges`: directed links from `fromNodeId` to `toNodeId`.
- `inputSchema`: optional graph-level widget schema for run input.
- `metadata`: optional JSON object for non-secret descriptive data.

Validation is owned by `src/domain/node-flows/node-flow-validation.ts`. It normalizes ids, labels, positions, widget defaults, and graph shape; rejects missing node/edge arrays; rejects duplicate node ids; rejects edges that point at missing nodes; requires at least one node; and rejects cycles. Widget validation supports `text`, `textarea`, `number`, `boolean`, `select`, `json`, `secretRef`, and `keyValue` fields.

Validation intentionally permits arbitrary string node types at graph-save time so future node libraries can be drafted and stored. Runtime execution separately enforces the executable allowlist.

Dashboard-only editable canvas state lives in `dashboard/src/v2/lib/nodes-canvas-state.ts`. It is a pure TypeScript layer for in-progress graph editing: typed node kinds, input/output ports, port-based edges, config fields, selection state, reducer actions, deterministic layout helpers, validation issue codes, stable JSON serialization, and recovery from malformed persisted canvas drafts. The seed graph uses trigger, agent, task, condition, and output nodes so UI tasks can start from a meaningful workflow without depending on a rendering library.

## Runtime

`NodeFlowRuntimeService.runFlow(projectId, flowId, input, options)` resolves an explicit pinned or latest-published snapshot, revalidates that immutable graph, claims a durable lease, and executes nodes in topological order. See [Node Flow Durable Execution](./node-flow-durable-execution.md) for queue, retry, lease, recovery, quota, and redaction guarantees.

Runtime-supported node types are:

| Node type | Behavior |
| --- | --- |
| `input` | Emits the run input object. |
| `set_fields` | Merges upstream object output with configured `fields` or `values`; set `replace: true` to ignore upstream output. |
| `template` | Renders `template` or `prompt` into `outputKey` (default `text`). |
| `provider_prompt` | Renders a prompt and calls an existing CLI provider configuration through `ProviderExecutionService`. |
| `http_request` | Performs bounded HTTP/HTTPS requests with method, URL, headers, query, body, timeout, and optional JSON path extraction. |
| `condition`, `switch` | Select one explicit output branch; non-selected branches are persisted as skipped. |
| `foreach` | Validates and emits a bounded item list. |
| `merge` | Combines active inputs with `object`, `array`, or `first` strategy. |
| `delay` | Waits for a bounded cancellable duration. |
| `approval` | Persists an operator decision gate. |
| `email_draft`, `email_send` | Creates a draft, or sends only after approval through the idempotent outbox. |
| `execute_subflow` | Executes a same-project published subflow with recursion bounds. |
| `webhook_trigger` | Emits authenticated webhook input. |
| `output` | Selects final output from a path, configured fields, or upstream output. |

Template interpolation reads from `{{ input.path }}` and `{{ nodes.nodeId.path }}`. Node config is built from widget defaults, node `data`, and optional `data.values`, with later values overriding defaults.

Provider prompt nodes require a configured CLI provider. HTTP nodes require HTTPS unless HTTP is explicitly enabled and support `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `HEAD`. Requests pass through the shared SSRF, redirect, DNS, response-size, content-type, retry, timeout, and rate-limit policy described in [Node Flow Built-ins and External-Effect Security](./node-flow-builtins-and-security.md).

## Invocation Tracking

Node flows use `execution_invocations` as the observable runtime surface:

- each flow run creates a parent invocation with `type: "node_flow"`
- externally observable node steps create invocation rows with `type: "node_flow_node"`
- `node_flow_runs.execution_invocation_id` links the run record to the parent invocation
- `node_flow_node_runs.execution_invocation_id` links provider and HTTP node rows to their invocation record

Only `provider_prompt` and `http_request` nodes currently create `node_flow_node` invocation rows. Deterministic local nodes still create `node_flow_node_runs` rows, but do not create extra execution invocations.

Provider prompt nodes pass an existing invocation id into `ProviderExecutionService` and disable prompt/assistant transcript capture for raw prompt content. HTTP nodes append a redacted request summary. Flow run inputs, outputs, node input/output payloads, trigger payloads, graph data, and MCP responses redact secret-shaped keys such as `apiKey`, `authorization`, `cookie`, `password`, `secret`, and `token`.

## Failure Semantics

A failed node fails the flow and persists skipped records for downstream descendants by default. If a node has `data.continueOnError = true`, the failed node records `{ "error": "<message>" }` as output and downstream nodes may continue.

Cancellation records cancelled node rows for the current and remaining nodes. At completion, the parent invocation is updated to `completed`, `failed`, or `cancelled` to match the flow outcome.

## Scheduling

Scheduler entries with `targetType: "node_flow"` persist an explicit `versionSelection`: pinned schedules continue to execute version N after N+1 is published, while latest-published schedules resolve the newest publication at dispatch time. Legacy `flowVersion` values normalize to pinned selection and are executable semantics, not audit-only metadata. Ownership is validated when entries are created or updated and again before due-run execution.

Due runs call `NodeFlowRuntimeService.runFlow` with `triggerType = "scheduler"` and trigger payload metadata for the scheduler entry id, scheduled occurrence time, target type, and persisted flow version when present. Node-flow schedules advance only when `runFlow` returns a run status of `succeeded`. Returned `failed` or `cancelled` runs mark the scheduler entry `failed` with the run error and still count the attempted occurrence in `lastRunAt` and `runCount`; runtime startup rejections mark failure without creating a false successful schedule run.

## Agent Skill Attachment

`node_flow_agent_skills` exposes a saved flow to an agent preset as a repeatable skill. Attachment stores `flow_id`, `project_id`, `agent_preset_id`, `skill_name`, `description`, and timestamps.

Attachment does not copy the graph into the agent preset, and detach removes only the binding. The flow remains project-owned and can still be edited, scheduled, manually run, or attached to other agents.

## Agent Design Guidance

Specialist agents designing node flows should adapt workflows to Code UX instead of copying n8n or another tool one node at a time.

Use these rules:

- Model the repeatable outcome first, then choose the smallest Code UX graph that captures the inputs, provider calls, HTTP calls, transformations, and final output.
- Prefer `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output` nodes only when the workflow needs to execute today. Other node types may be saved for future design drafts, but they will fail at runtime until implemented.
- Put operator-editable values in `inputSchema` or per-node `widgetSchema` fields. Do not bury frequently changed values in opaque JSON blobs.
- Use `secretRef` widgets and secret reference strings for credentials. Do not place raw API keys, bearer tokens, cookies, passwords, or private headers in graph metadata, node data, widget defaults, run input, or examples.
- Validate every node field before saving: required prompt/template/url fields, finite numeric limits, supported HTTP method, JSON object input, and select defaults that match options.
- Keep flows deterministic and rerunnable. Avoid hidden dependence on local time, ambient chat state, or one-off sprint context unless it is explicitly passed as JSON input.
- Preserve inspection value. Name nodes for the operation they perform, keep edges acyclic, and make the output node return the artifact another operator or agent will actually consume.

## Graph v2 contract and migration

Graph v2 is the single workflow model used by backend, MCP, runtime, and dashboard. It adds `schemaVersion: 2`, stable definition references, typed ports and flow schemas, credential-id bindings, retry and timeout policies, capability and side-effect metadata, disabled state, and optional immutable publication metadata. Plaintext credentials, secret-shaped fields, generated source, and custom code are not valid graph data.

The executable registry contains the original deterministic/provider/HTTP nodes plus `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, and `webhook_trigger`. Unregistered custom types remain non-executable.

Backend Graph v1 migration retains the exact prior version and appends deterministic v2. Browser canvas v1 migration returns the untouched legacy snapshot separately from the normalized graph.
