# Node Flow Built-ins and External-Effect Security

The governed built-in catalog extends publication-based node-flow execution with deterministic control nodes and durable boundaries for external effects. The definition registry remains the executable authority; a graph can only run a node when its versioned manifest is registered and executable.

## Built-in catalog

| Node | Contract |
| --- | --- |
| `condition` | Evaluates a bounded operator and selects exactly the `true` or `false` output port. Unselected branches persist as skipped node runs. |
| `switch` | Evaluates no more than 100 configured cases and selects one named case or `default`. |
| `foreach` | Validates an array and emits at most 1,000 items. Inputs above the configured bound fail before fan-out. |
| `merge` | Combines active upstream values with `object`, `array`, or `first` strategy. |
| `delay` | Waits for a cancellable duration from zero through one hour. |
| `approval` | Creates or reuses a durable approval keyed by run, node, and logical item. |
| `email_draft` | Produces a draft only and never contacts a provider. |
| `email_send` | Requires an approved decision, then dispatches through the idempotent outbox. |
| `execute_subflow` | Executes a published flow owned by the same project, rejects direct self-reference, and caps nesting at eight. |
| `webhook_trigger` | Emits input accepted by a secret-authenticated webhook configuration. |

The existing `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output` nodes retain their previous contracts. Typed manifest ports identify branch handles, many-valued merge inputs, and trigger outputs. Branch routing only runs a node when at least one incoming edge is active, allowing merges to join a selected path without treating an unselected sibling as a failure.

## Governed egress

`EgressPolicyService` is the single request boundary for HTTP nodes and future custom-node network calls. HTTPS is required by default. A node must explicitly opt into HTTP, and even then private networking remains blocked. The service rejects credentials embedded in URLs; loopback, private, link-local, carrier-grade NAT, benchmarking, multicast, and cloud-metadata addresses; metadata hostnames; restricted raw headers; and ports or hosts outside configured allowlists.

Each redirect is handled manually and fully revalidated. DNS is resolved twice before dispatch, and a changed or newly private result is treated as rebinding. Cross-origin redirects remove credential headers. Response bodies are streamed into a bounded buffer, content types are allowlisted, timeouts and caller cancellation propagate, retry counts are capped, unsafe methods require an idempotency key before retry, and an in-process rate window bounds requests per project and host.

## OAuth boundary

`OAuthBroker` implements authorization-code flow with PKCE S256. Authorization state is authenticated AES-256-GCM ciphertext containing a short expiry, callback origin, redirect URI, verifier, connection id, and nonce. Callback origins must be explicitly allowlisted and match the state. Token exchange and refresh results are stored behind an `OAuthConnectionStore`; access and refresh tokens are returned only to provider-bound execution code, never to graph JSON or agent-visible output.

Refresh happens shortly before expiry and rotates the stored refresh token when the provider returns one. Required scopes are checked before access. Revocation deletes local state after provider revocation; reconnect begins from a revoked local connection; health checks refresh when necessary and expose only health, expiry, and scopes.

## Approvals and outbox

`automation_approvals` persists pending and terminal decisions. Repeating the same run, node, and logical item returns the existing decision, so restarts do not create a second prompt. Email sending is approval-gated by default; `email_draft` is the non-irreversible default.

`automation_outbox` has a unique SHA-256 idempotency key derived from publication id, run id, node id, and logical item. Provider message ids are stored after success. A process restart while an entry is `sending` changes it to `attention_required`, because the provider may have accepted the operation; Code UX does not replay an unknown external outcome automatically.

## Webhook routes

Creating `POST /api/node-flows/:flowId/webhook` rotates and returns a path token and secret once. Only their hashes are persisted. `POST /api/webhooks/node-flows/:pathToken` requires the secret in `x-codeux-webhook-secret`, uses constant-time digest comparison, and dispatches the latest published version with `triggerType: webhook`. The response returns only run identity and status.

Example condition edges use explicit handles:

```json
{
  "nodes": [
    { "id": "check", "type": "condition", "title": "Check", "data": { "path": "input.enabled" } },
    { "id": "draft", "type": "email_draft", "title": "Draft", "data": { "to": "owner@example.test", "subject": "Ready", "body": "Review this draft." } },
    { "id": "done", "type": "output", "title": "Done" }
  ],
  "edges": [
    { "fromNodeId": "check", "fromHandle": "true", "toNodeId": "draft" },
    { "fromNodeId": "check", "fromHandle": "false", "toNodeId": "done" }
  ]
}
```
