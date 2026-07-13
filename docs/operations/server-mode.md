# Secure Headless Server Mode

Server mode runs Code UX as an authenticated MCP HTTP control plane without binding the dashboard UI, dashboard REST routes, dashboard realtime websocket, terminal websocket, or static dashboard assets. Use it for headless hosts, CI-adjacent automation, and cluster worker control planes where clients connect over Streamable HTTP instead of launching Code UX over stdio.

Server mode is different from ordinary `--headless` mode:

| Mode | Dashboard | MCP HTTP | Token behavior |
| --- | --- | --- | --- |
| Default dashboard mode | Enabled | Enabled by default | Uses an explicit token or the generated user token in `~/.code-ux/security.json`. |
| `--headless` / `--no-dashboard` | Disabled | Uses normal MCP HTTP enablement rules | Preserves local-development behavior and can use the generated user token when HTTP is enabled. |
| `--server-mode` / `CODE_UX_SERVER_MODE=true` | Disabled | Enabled by default | Requires an explicit MCP HTTP bearer token with at least 32 bearer-safe characters. |

## Threat Model

MCP bearer access remains a runtime-wide control-plane identity. The dashboard administrative API has a separate authenticated-headless boundary with project-scoped roles; do not treat an MCP bearer as a dashboard service identity.

## Authenticated Dashboard API

Remote dashboard/API operation is fail-closed. Setting a non-loopback `DASHBOARD_HOST` without an explicit authentication mode defaults the API to `service_token`, so unconfigured callers receive `401`/`403` instead of inheriting desktop access. Loopback desktop mode remains `local`.

Choose one boundary:

- `CODE_UX_DASHBOARD_AUTH_MODE=service_token`: define `CODE_UX_SERVICE_IDENTITIES_JSON` as an array of identities with `id`, `displayName`, a lowercase SHA-256 `tokenSha256`, `roles`, `projectIds`, and `enabled`. Workers may send the matching id with `--service-identity-id` or `CODE_UX_WORKER_SERVICE_ID`; the bearer remains in `CODE_UX_WORKER_AUTH_TOKEN`.
- `CODE_UX_DASHBOARD_AUTH_MODE=trusted_proxy`: terminate OIDC at a trusted proxy, set `CODE_UX_TRUSTED_PROXY_SECRET`, and have the proxy overwrite `X-Code-UX-Proxy-Secret`, `X-Code-UX-Principal-Id`, `X-Code-UX-Roles`, `X-Code-UX-Project-Ids`, and optional name/kind headers. Never forward client-supplied copies.

Roles are `credential_admin`, `automation_author`, `automation_publisher`, `automation_runner`, and `viewer`. Project ids are explicit; `*` is an operator-only all-project grant. Credential routes additionally require `CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT=true`. Enabling that flag without a healthy secure key provider makes readiness fail.

The `credential_admin` role can read `/api/admin/readiness`, `/api/admin/audit/export`, and `/api/admin/metrics/slo` even when remote credential management is disabled. The feature flag gates credential creation, binding, testing, rotation, replacement, revocation, promotion, restriction, and credential-health routes; it does not disable operational readiness, audit, or SLO inspection.

TLS is assumed at the reverse proxy. Authenticated remote requests must arrive with HTTPS or a trusted `X-Forwarded-Proto: https`; `CODE_UX_ALLOW_INSECURE_HTTP=true` is limited to isolated test networks. Same-origin browser checks, no-store headers, host validation, and a 600-request/minute administrative API limiter remain active. Webhook and provider-ingress endpoints retain their dedicated authentication schemes.

Example identity generation (the JSON stores only the digest):

```bash
token="$(openssl rand -base64 48 | tr -d '\n')"
digest="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
# Put $token in the runner secret manager and $digest in CODE_UX_SERVICE_IDENTITIES_JSON.
```

Use server mode when:

- the dashboard must not be reachable from the host
- MCP clients or workers need a stable HTTP endpoint
- a reverse proxy or private network boundary provides TLS and network admission
- operators can treat the bearer token as a secret with full runtime authority

Do not expose the MCP HTTP listener directly to the public internet. The Node listener is HTTP; terminate HTTPS with a trusted reverse proxy, tunnel, service mesh, or load balancer when traffic leaves the host.

## Startup

Generate the token in the process environment or a secret manager. Do not paste real bearer values into shell history, logs, tickets, release notes, or documentation.

```bash
export MCP_HTTP_AUTH_TOKEN="$(openssl rand -base64 48 | tr -d '\n')"

codeux \
  --server-mode \
  --mcp-http-host 127.0.0.1 \
  --mcp-http-port 4445 \
  --mcp-http-path /mcp
```

For a cluster control plane behind a reverse proxy or private network interface:

```bash
export CODE_UX_SERVER_MODE=true
export MCP_HTTP_AUTH_TOKEN="$(openssl rand -base64 48 | tr -d '\n')"
export MCP_HTTP_HOST=0.0.0.0
export MCP_HTTP_PORT=4445
export MCP_HTTP_PATH=/mcp
export MCP_HTTP_MAX_SESSIONS=500
export MCP_HTTP_SESSION_TIMEOUT_MS=3600000

codeux
```

The legacy `mcp-https` names remain supported for compatibility:

| Purpose | Preferred | Legacy-compatible |
| --- | --- | --- |
| Gateway enablement | `MCP_HTTP_ENABLED`, `--no-mcp-http` to disable outside server mode | `MCP_HTTPS_ENABLED`, `--no-mcp-https` to disable outside server mode |
| Gateway host | `MCP_HTTP_HOST`, `--mcp-http-host` | `MCP_HTTPS_HOST`, `--mcp-https-host` |
| Gateway port | `MCP_HTTP_PORT`, `--mcp-http-port` | `MCP_HTTPS_PORT`, `--mcp-https-port` |
| Gateway path | `MCP_HTTP_PATH`, `--mcp-http-path` | `MCP_HTTPS_PATH`, `--mcp-https-path` |
| Bearer token | `MCP_HTTP_AUTH_TOKEN`, `--mcp-http-auth-token` | `MCP_HTTPS_AUTH_TOKEN`, `--mcp-https-auth-token` |
| Session cap | `MCP_HTTP_MAX_SESSIONS`, `--mcp-http-max-sessions` | `MCP_HTTPS_MAX_SESSIONS`, `--mcp-https-max-sessions` |
| Idle timeout | `MCP_HTTP_SESSION_TIMEOUT_MS`, `--mcp-http-session-timeout-ms` | `MCP_HTTPS_SESSION_TIMEOUT_MS`, `--mcp-https-session-timeout-ms` |

Server mode rejects startup when the explicit token is missing, empty, shorter than 32 characters, or contains characters outside the bearer-safe set. It does not fall back to the generated local user token.

If `--server-mode` is combined with an explicit MCP HTTP disable flag, server mode still restores the MCP HTTP listener on the default MCP port because the server-mode contract requires authenticated remote MCP access while the dashboard stays disabled.

## Health And Readiness

The MCP HTTP listener serves probes without the dashboard server:

```bash
curl --fail http://127.0.0.1:4445/health
curl --fail http://127.0.0.1:4445/ready
```

Use `/health` for process liveness. It only proves that the listener is up.

Use `/ready` for runtime readiness. It reports whether the Code UX runtime finished the required startup path and can accept work. During startup, maintenance such as Docker cleanup, preview reconciliation, branch reaping, and recovery work can continue after the listener binds, so `/health` can pass before `/ready`.

Do not include `Authorization` headers in probe logs. The probe endpoints do not require bearer credentials.

`/ready` also reports `credentialKey`, `auditStore`, and `distributedRunner`. `/health` remains live during a key-provider outage, while `/ready` returns `503`. Startup aborts before dashboard or MCP binding when encrypted credential rows exist but their key provider cannot recover the wrapping key. Select a provider with `CODE_UX_CREDENTIAL_KEY_PROVIDER=mounted-key-file|vault|kms`; mounted files use `CODE_UX_CREDENTIAL_KEY_FILE` and owner-only permissions. Vault/KMS modes require their host adapter to be configured and healthy.

Authenticated operators can inspect `/api/admin/readiness`, export redacted NDJSON from `/api/admin/audit/export`, and sample `/api/admin/metrics/slo`. Audit rows include the correlation id, principal, project, action, outcome, and redacted metadata for management requests, credential access, runs, attempts, approvals, and outbox delivery.

## Backup, Restore, Rotation, And Rollback

Back up `~/.code-ux/app.db` with a SQLite-aware snapshot that includes/checkpoints WAL state, the settings database, project `.code-ux/` directories, and the external key-provider versions needed by every encrypted envelope. Never place plaintext service tokens or root keys in the database backup. Restore into an isolated host, restore keys first, run `/ready`, then enable runners.

Rotate service tokens by adding the new digest, deploying the new runner secret, observing successful authenticated calls, and disabling the old identity entry. Rotate credential values through the credential rotation API; existing graph bindings keep the credential id and resolve the new version. Retain old KMS/Vault key versions until every envelope has been rewrapped and a restore drill succeeds.

To roll back an automation, create a new draft from the earlier immutable version, review it, and publish it. In-flight runs remain pinned to their original publication. Stop runner admission before database recovery; after restore, startup recovery requeues only known-safe work and leaves unknown external outcomes in `attention_required`.

## Baseline SLOs And Alerts

Initial operator baselines are 99.9% authenticated management availability, p95 management latency below 500 ms, zero unauthorized project grants, zero secret disclosure, and zero duplicate outbox side effects. Alert when readiness is not ready for 5 minutes, management 5xx rate exceeds 1% for 10 minutes, p95 exceeds 1 second for 10 minutes, leases repeatedly expire, denied credential access spikes, outbox failures remain pending for 5 minutes, or any audit/secret scanning check fails.

Local mode is intentionally a trusted loopback desktop boundary. Authenticated headless mode adds API RBAC, project scope, key readiness, durable audit, and service identities, but it is not a general multi-tenant identity platform: OIDC token validation belongs at the trusted proxy, Vault/KMS require host adapters, and MCP bearer authority remains broader than dashboard roles.

## Client Connections

MCP HTTP clients connect to the configured path with `Authorization: Bearer <token>`. The first JSON-RPC request on a new Streamable HTTP session must be `initialize`; the server returns an `mcp-session-id` header that the client echoes on later calls.

For a local CLI or dashboard-adjacent session that supports MCP HTTP, configure:

- URL: `http://<server-host>:4445/mcp`
- header name: `Authorization`
- header value: `Bearer <token-from-secret-manager>`

Verify without exposing the token:

```bash
curl --fail http://127.0.0.1:4445/health
curl --fail http://127.0.0.1:4445/ready
```

Then verify through the MCP client by listing tools or running a read-only management action such as listing projects. Do not use `curl -v`, shell tracing, or command transcripts that print the authorization header.

If a local dashboard app is used only as an operator console for a separate server-mode instance, configure its MCP client entry to the server-mode URL and bearer header. The dashboard UI of the server-mode process itself remains unavailable by design.

## Settings Synchronization

Settings synchronization uses the `manage_settings` bundle actions:

- `export_settings_bundle`
- `apply_settings_bundle`

Bundles can include system, project, and sprint scopes. Metadata includes `schemaVersion: 1`, `exportedAt`, `includedScopes`, a SHA-256 `fingerprint` computed from a secret-redacted representation, and `containsSecrets`.

Approved workflow:

1. Export a bundle from the source runtime. Export defaults to the `system` scope and always returns credential references, configured-state metadata, or redacted fields; provider API keys, git tokens, issue-tracker tokens, login credentials, and other credential plaintext are never returned.
2. Review the bundle before moving it to the destination. Redacted placeholders are expected and must not be replaced with plaintext in shared artifacts.
3. If project or sprint settings are required, include `scopes`, `projectIds`, and `sprintIds`. Sprint exports require the owning `projectId` so imports can normalize sprint overrides against the resolved project base.
4. Apply the bundle on the destination with `apply_settings_bundle`. The importer persists through `saveSystemSettings`, `saveProjectSettings`, and `saveSprintSettings`, so values follow the same sanitizer and override normalization as dashboard saves.
5. For partial rollout or rollback, pass `scopes` on apply to limit which bundle scopes are written.

Secret-shaped requests retain the stateful settings approval flow:

- The compatibility `includeSecrets: true` export input asks for approval when secret-shaped source settings are detected. Repeating the exact request with `approval.confirmed: true` still returns only references and redacted fields, never plaintext.
- A bundle marked `containsSecrets: true`, or one whose payload contains secret-shaped fields, is applied only after the same one-use approval flow. Apply runs through the normal sanitizer and does not echo submitted values.
- Approval is bound to the exact normalized payload, expires after 15 minutes, and is consumed after one successful execution.

Bundles move non-secret configuration and broker credential references only. Create, replace, or rotate values through write-only credential operations on the destination; bind or revoke credentials through metadata-only broker operations. The one-way startup migration converts supported legacy plaintext into broker references locally; settings export/apply does not migrate or back up broker plaintext.

Rollback is another approved apply. Export a known-good bundle before changing a destination runtime, then apply that bundle back to the affected scopes if the rollout must be reverted. This restores settings and reference bindings, not credential values; roll back credential material separately through broker rotation or replacement. Do not rely on logs or chat transcripts as backups because MCP responses intentionally omit credential plaintext.

## Cluster Workers

External workers connect to the server-mode MCP HTTP endpoint as control-plane clients. The worker process also starts a local `worker-host` runtime over stdio for execution on the worker machine.

Start a worker with the shipped bin:

```bash
codeux-worker \
  --server-url http://SERVER_HOST:4445/mcp \
  --auth-token "$CODE_UX_WORKER_AUTH_TOKEN" \
  --connection-key worker:build-node-01 \
  --display-name "Build node 01" \
  --project-id project-id
```

Equivalent environment variables:

```bash
export CODE_UX_WORKER_SERVER_URL=http://SERVER_HOST:4445/mcp
export CODE_UX_WORKER_AUTH_TOKEN="$MCP_HTTP_AUTH_TOKEN"

codeux-worker --connection-key worker:build-node-01 --project-id project-id
```

Worker config supports multi-project operation:

- repeat `--project-id` to register eligible projects
- repeat `--active-project-id` to advertise active project focus
- use a stable `--connection-key` so reconnects update the existing registered endpoint
- set `--server-command`, repeated `--server-arg`, and `--server-cwd` only when the worker-local execution runtime needs a custom command

Cluster behavior:

- Registered workers are not license-capped. The active Streamable HTTP session cap defaults to 100 and can be raised for large clusters.
- Project assignments live in `project_worker_assignments`. A project can have one primary worker and any number of overflow workers.
- Active-session protection prevents runaway clients from allocating unlimited Streamable HTTP sessions. Raise `MCP_HTTP_MAX_SESSIONS` only to the capacity the server can actually operate.
- Heartbeats derive endpoint status. Stale or offline workers are excluded from new claims, and stale primary workers can be bypassed by eligible overflow workers.
- Dispatch safety depends on both `task_dispatches` and `execution_leases`. A worker must not start local execution unless the server returns a claim with a lease token. Heartbeats renew the lease while the task runs; expired leases can be claimed by another eligible worker.
- Multi-project workers claim only work for projects they are assigned to and advertise as active or eligible.

## Token Rotation

Safe rotation is a short planned restart unless a reverse proxy or secret manager can coordinate old/new tokens externally.

1. Generate a new token in the secret manager.
2. Update client and worker secret references, but do not restart them yet.
3. Restart the server-mode process with the new token.
4. Restart or reconnect MCP clients and workers so they initialize new sessions with the new token.
5. Confirm `/ready` passes and clients can list tools or claim work.
6. Revoke the old token from the secret manager and remove it from local shells, process managers, and deployment manifests.

Existing HTTP sessions authenticated with the previous token should be treated as invalid after server restart because Streamable HTTP sessions are in memory. Workers should reinitialize rather than attempting to reuse old `mcp-session-id` values.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Startup fails with a server-mode token error | `--server-mode` or `CODE_UX_SERVER_MODE=true` is set without an explicit valid bearer token. | Set `MCP_HTTP_AUTH_TOKEN` or `MCP_HTTPS_AUTH_TOKEN`, or pass the matching CLI flag. Use at least 32 bearer-safe characters. |
| Startup fails when binding `0.0.0.0`, `::`, or a LAN address | MCP HTTP is reachable beyond loopback without an active token. | Configure an explicit bearer token and put TLS/auth network controls in front of the HTTP listener. |
| Dashboard URL is unavailable | Expected in server mode. | Use MCP HTTP clients and `/health` or `/ready`. Start a separate dashboard-mode process only when an operator UI is required. |
| HTTP returns `401 Unauthorized` | Missing `Authorization: Bearer <token>`, wrong token, duplicate authorization headers, or a client still using the old token after rotation. | Reinstall or update the client secret, reconnect, and avoid printing headers in diagnostics. |
| HTTP returns `400` on a new MCP session | The first request was not JSON-RPC `initialize`, or `mcp-session-id` / `x-code-ux-agent` was malformed. | Let the MCP SDK initialize the session, or clear stale session state and reconnect. |
| Session cap errors appear | Too many active Streamable HTTP sessions, usually from leaked clients or a cluster larger than the default cap. | Stop stale clients, shorten `MCP_HTTP_SESSION_TIMEOUT_MS`, or raise `MCP_HTTP_MAX_SESSIONS` within server capacity. |
| Worker appears stale or offline | Heartbeats stopped, the worker process is down, network access failed, or the stable connection key changed unexpectedly. | Restart the worker with the same `--connection-key`, verify `/ready`, and check logs for bounded connection metadata. |
| Worker connects but does not claim work | No active project assignment, project not included in `--project-id` / `--active-project-id`, stale endpoint status, task executor mismatch, or no lease returned. | Confirm project assignment and worker status, then verify queued dispatches. Do not start local execution without a lease token. |
| `/health` passes but `/ready` fails | Listener is alive but runtime readiness has not completed or the server is degraded. | Wait for startup recovery to finish, then inspect structured logs. Use `/ready` for load balancer readiness gates. |
| A raw secret appears in an exported settings bundle | This violates the reference-only export contract. | Stop sharing the artifact, rotate the exposed credential through the write-only broker operation, preserve only redacted diagnostics, and report the incident. `includeSecrets: true` must not return plaintext even after approval. |

## Related Docs

- [MCP Runtime and Dispatch](../mcp/runtime-and-dispatch.md)
- [Streamable HTTP Worker Gateway](../architecture/streamable-http-worker-gateway.md)
- [Security Hardening](./security-hardening.md)
- [CLI Commands Reference](../reference/cli-commands.md)
