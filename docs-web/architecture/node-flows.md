# Node Flows

Node flows are project-owned, versioned Graph v2 workflows.

## Implemented runtime nodes

| Type | Execution |
| --- | --- |
| `input` | Emits run input. |
| `set_fields` | Transforms object fields. |
| `template` | Renders text templates. |
| `provider_prompt` | Invokes a configured CLI provider. |
| `http_request` | Performs a bounded HTTP/HTTPS request. |
| `output` | Selects the result. |

These are the only executable definitions. Trigger, agent-router, task, condition, notification, and other palette concepts are planned entries without runtime handlers. Graph v1 migration preserves the legacy snapshot and appends deterministic v2.

Execution uses immutable publications rather than the mutable editor row. Runs select a pinned publication or the latest published version, then use durable queue claims, leases, bounded quotas, timeout/cancellation propagation, and numbered retry attempts. Expired external attempts with unknown outcomes require operator attention and are not silently replayed. See [Node Flow Durable Execution](./node-flow-durable-execution.md).
