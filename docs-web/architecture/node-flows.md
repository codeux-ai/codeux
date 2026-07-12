# Node Flows

Node flows are project-owned, versioned Graph v2 workflows.

Authenticated dashboard routes resolve persisted project ownership from flow, run, or approval ids before authorizing the request. Drafts, publications, comparisons, rollbacks, attachments, webhook configuration, debugger data, attempts, cancellation, retry, and approvals cannot be accessed by presenting a different body or query project id. Webhook ingress remains on its path-token and webhook-secret scheme, with dashboard host and browser-origin protections still enforced.

## Implemented runtime nodes

| Type | Execution |
| --- | --- |
| `input` | Emits run input. |
| `set_fields` | Transforms object fields. |
| `template` | Renders text templates. |
| `provider_prompt` | Invokes a configured CLI provider. |
| `http_request` | Performs a bounded HTTP/HTTPS request. |
| `condition`, `switch` | Selects one explicit output branch and persists unselected branches as skipped. |
| `foreach`, `merge` | Bounds item fan-out and combines active inputs with an explicit strategy. |
| `delay`, `approval` | Waits with cancellation or persists an operator decision gate. |
| `email_draft`, `email_send` | Produces a draft, or sends only after approval through the idempotent outbox. |
| `execute_subflow` | Executes a same-project published flow with recursion bounds. |
| `webhook_trigger` | Emits secret-authenticated webhook input. |
| `output` | Selects the result. |

These are the executable definitions. Other custom palette concepts remain non-executable until a versioned handler is registered. Graph v1 migration preserves the legacy snapshot and appends deterministic v2. Both migrated v1 and canonical v2 graphs are validated as untrusted input: malformed nested members fail closed with stable paths at their original array indices, valid siblings are retained where safe, and repeated validation returns the same ordered issues instead of throwing.

Execution uses immutable publications rather than the mutable editor row. Runs select a pinned publication or the latest published version, then use durable queue claims, leases, bounded quotas, timeout/cancellation propagation, and numbered retry attempts. Expired external attempts with unknown outcomes require operator attention and are not silently replayed. See [Node Flow Durable Execution](./node-flow-durable-execution.md).

HTTP and future custom-node requests share one HTTPS-first egress policy with URL-credential rejection, DNS and redirect revalidation, private-network and metadata blocking, host/port allowlists, bounded content, retries, timeouts, and rate limits. See [Built-ins and External-Effect Security](./node-flow-builtins-and-security.md).
