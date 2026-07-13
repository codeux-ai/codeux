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

Authenticated dashboard requests resolve project ownership from the persisted flow, run, or approval record before role and project authorization. This applies to ID-only draft, publication, comparison, rollback, attachment, webhook-configuration, run debugger, attempt, cancellation, retry, and approval routes; a caller-supplied body or query project id is not treated as proof of ownership. Webhook ingress is the exception to dashboard bearer authentication and continues to use its path-token and webhook-secret scheme, while dashboard host and browser-origin protections still apply.

## Graph Contract

The shared contract lives in `src/contracts/node-flow-types.ts`.

A `NodeFlowGraph` contains:

- `nodes`: stable node ids, string node `type`, title, optional description, optional position, optional `widgetSchema`, and JSON `data`.
- `edges`: directed links from `fromNodeId` to `toNodeId`.
- `inputSchema`: optional graph-level widget schema for run input.
- `metadata`: optional JSON object for non-secret descriptive data.

Validation is owned by `src/domain/node-flows/node-flow-validation.ts`. It normalizes ids, labels, positions, widget defaults, and graph shape; rejects missing node/edge arrays; rejects duplicate node ids; rejects edges that point at missing nodes; requires at least one node; and rejects cycles. Widget validation supports `text`, `textarea`, `number`, `boolean`, `select`, `json`, `secretRef`, and `keyValue` fields.

Migration and validation treat persisted Graph v1 and canonical Graph v2 as untrusted input. Malformed collection members are rejected at their original index, such as `nodes[1].ports[0]` or `edges[2]`, while structurally valid siblings remain available to the rest of normalization. Definition references, credential bindings, capabilities, policies, port and graph schemas, and JSON metadata emit deterministic field-level issues instead of throwing. Revalidating the same graph produces the same ordered issue list.

Validation requires every node's type/version reference to resolve through the registry and rejects unknown definitions. Runtime execution then dispatches according to the registered definition's executable state and execution kind; a planning concept is not runnable merely because it has a string type.

The dashboard uses the same backend-owned Graph v2 record as the runtime. The selected project controls library loading; no project means no flow, credential, publication, or run requests. The registry list endpoint returns flat palette summaries, while the node-type detail endpoint returns a complete `NodeDefinitionManifest` with nested `ui`, schemas, policies, documentation, and deprecation metadata. The inspector consumes that full manifest. Draft saves use optimistic `draftRevision` checks and surface conflicts without overwriting the newer record.

`dashboard/src/v2/lib/nodes-canvas-state.ts` remains only a compatibility and pure graph-state layer. Its legacy browser graph can be imported once into a project draft. The adapter translates `trigger`/`agent`/`task` into registered `input`/`set_fields`/`provider_prompt` nodes, remaps legacy handles to governed ports, and retains non-secret canvas metadata. Import failure is isolated from the normal library load; only a successful draft creation removes the old graph key and records the project marker. Browser storage is not the workflow source of truth.

### Credential binding lifecycle

Each versioned node definition is the slot-policy authority: every slot declares whether it is required, its allowed credential kinds, and all required capabilities. The picker lists project-visible metadata, then filters each candidate through secure-backend readiness, configured/active state, project access, kind, and capability compatibility. It never resolves a value.

`NodeFlowNode.credentialBindings` is the only persisted binding source. Selecting, replacing, or unbinding a credential changes the matching `{ slot, credentialId }` entry in the complete canonical graph and saves with the current `draftRevision`. The dashboard adopts the returned graph and revision, then refreshes governed review. A `409`-style revision conflict refreshes the latest draft and requires a deliberate retry; it never replays a stale binding over sibling changes.

Required unbound slots and any bound credential denied by backend readiness, configuration, active status, project access, allowed kind, or required capabilities block publication. Optional unbound slots do not. Runtime revalidates the immutable publication and repeats the same policy immediately before direct credential-ID resolution, so revocation, restriction, rotation/rebinding races, missing custody, or incompatible policy deny the node attempt rather than injecting stale plaintext. Graph, review, publication, MCP, and dashboard payloads contain IDs and non-secret policy metadata only.

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
- Use the governed executable built-ins listed in the runtime table when the workflow needs to execute today. A registered custom definition is executable only when its validated immutable artifact and custom runtime are available. Treat unknown types, legacy browser-only kinds, and non-executable manifests as planned or unavailable definitions.
- Put operator-editable values in `inputSchema` or per-node `widgetSchema` fields. Do not bury frequently changed values in opaque JSON blobs.
- Use `secretRef` widgets and secret reference strings for credentials. Do not place raw API keys, bearer tokens, cookies, passwords, or private headers in graph metadata, node data, widget defaults, run input, or examples.
- Validate every node field before saving: required prompt/template/url fields, finite numeric limits, supported HTTP method, JSON object input, and select defaults that match options.
- Keep flows deterministic and rerunnable. Avoid hidden dependence on local time, ambient chat state, or one-off sprint context unless it is explicitly passed as JSON input.
- Preserve inspection value. Name nodes for the operation they perform, keep edges acyclic, and make the output node return the artifact another operator or agent will actually consume.

## Graph v2 contract and migration

Graph v2 is the single workflow model used by backend, MCP, runtime, and dashboard. It adds `schemaVersion: 2`, stable definition references, typed ports and flow schemas, credential-id bindings, retry and timeout policies, capability and side-effect metadata, disabled state, and optional immutable publication metadata. Plaintext credentials, secret-shaped fields, generated source, and custom code are not valid graph data.

The executable registry contains the original deterministic/provider/HTTP nodes plus `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, and `webhook_trigger`. Unregistered custom types remain non-executable.

Backend Graph v1 migration retains the exact prior version and appends deterministic v2. Invalid legacy members are carried across the migration boundary so validation can report their original paths rather than silently dropping them. Browser canvas v1 migration returns the untouched legacy snapshot separately from the normalized graph.

## Dashboard and security prerequisites

Outside development builds, the Nodes workspace is enabled only when `VITE_CODEUX_FEATURE_NODES`, `VITE_CODEUX_NODE_FLOW_BACKEND`, and `VITE_CODEUX_AUTOMATION_SECURITY` are true. These flags expose the surface; they do not replace runtime dependencies. Provider execution, credential resolution, outbound HTTP, approval-gated email, webhook ingress, and custom-node containers each require their corresponding configured service and security policy.

The dashboard exposes credential binding ids, declared kinds, scopes, and status metadata only. Resolved values stay at the credential broker/runtime boundary and are redacted before invocation messages, attempt payloads, diagnostics, and route responses are persisted or rendered. Policy review must surface requested capabilities and external side effects before publication, and publication requires a valid current draft with all required bindings satisfied.
