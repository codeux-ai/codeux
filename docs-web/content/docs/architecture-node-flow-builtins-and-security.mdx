# Node Flow Built-ins and External-Effect Security

The governed catalog adds deterministic branches, bounded collection processing, durable approvals, and replay-safe external effects while keeping the versioned definition registry as the executable authority.

## Control and integration nodes

- `condition` selects `true` or `false`; `switch` selects one named case or `default`. Unselected branches persist as skipped node runs.
- `foreach` accepts no more than 1,000 items. `merge` supports `object`, `array`, and `first` strategies.
- `delay` is cancellable and capped at one hour. `execute_subflow` requires same-project ownership, rejects direct self-reference, and caps depth at eight.
- `approval` persists an idempotent operator decision and continues the exact pinned run after approval. `email_draft` never sends. `email_send` requires approval and uses the idempotent outbox.
- `webhook_trigger` emits payloads accepted through secret-authenticated webhook ingress.

## Network policy

HTTP nodes and custom nodes use the same `EgressPolicyService`. HTTPS is required unless HTTP is explicitly enabled. Private, loopback, link-local, metadata, multicast, and other non-public addresses remain blocked in both modes. Credentials in URLs and raw restricted headers are rejected.

Every redirect is manually revalidated. DNS is checked for private results and rebinding. Host and port allowlists, response-size and content-type limits, propagated cancellation and timeouts, capped retries, idempotency requirements for unsafe retry, normalized headers, and per-key rate windows keep requests bounded.

Custom-node containers remain network-none. A declared `network.http` capability adds only a per-invocation authenticated Unix-socket mount that delegates typed requests to this policy service; undeclared nodes receive neither the socket nor its token.

## OAuth, approvals, and outbox

Pending approvals preserve the run, governed node, logical item, and numbered attempt. Approved decisions resume at that node boundary; rejected and expired decisions terminate durably. Repeated decisions and restart recovery do not create a second approval request, attempt, or external delivery.

OAuth authorization uses PKCE S256 and short-lived AES-256-GCM state tied to an allowlisted callback origin. Tokens live behind the connection store, rotate on refresh, enforce scopes and expiry, and are never written into graph JSON or agent-visible output. Revocation, reconnect, and health checks expose no token values.

Approvals are unique per run, node, and logical item. Outbox entries use a unique key derived from publication, run, node, and logical item, and store the provider message id after success. A restart while an entry is sending changes it to `attention_required`; Code UX does not automatically replay an unknown provider outcome.

Webhook configuration returns a newly rotated path token and secret while persisting only their hashes. Ingress requires `x-codeux-webhook-secret` and dispatches the latest published flow version.
