# Security model

Code UX is designed to run as a **single-user trusted process** on a developer's workstation or a dedicated server. This page documents what is and is not protected, the threat model, and the recommended deployment posture.

## Threat model

### In scope

- **Accidental exposure** of the dashboard or MCP HTTP gateway to the network.
- **Misuse of the MCP API** by a misbehaving client (validation, destructive-action gating).
- **Token / API key handling** at rest and in logs.
- **Worker isolation** — preventing virtual workers from accessing host resources outside their worktree.

### Out of scope

- **Multi-tenant authorisation** — Code UX does not have a user/role concept. Anyone with access to the process or its REST/WebSocket endpoints has full control.
- **Hostile MCP clients** — clients are trusted by virtue of being given access. The MCP layer validates inputs but does not authorise.
- **Hostile providers** — Code UX trusts that the provider CLIs and the Jules API behave as documented.

If you need multi-tenant authorisation or hostile-client isolation, run separate Code UX instances per tenant.

## Network surface

Two listeners:

| Listener | Default bind | Default auth |
| --- | --- | --- |
| Dashboard server (REST + WebSocket + UI) | `127.0.0.1:4444` | None |
| MCP HTTP gateway (when `--mcp-http`) | `127.0.0.1:<dashboardPort+1>` | Optional bearer token |

### Dashboard server

- **Unauthenticated.** Designed for trusted local consumption.
- Bind only to loopback in production (the default).
- If exposing remotely, **front with a reverse proxy** that handles auth (basic auth, OAuth proxy, mTLS, …).
- The WebSocket inherits the same security posture.

### MCP HTTP gateway

- Loopback-only by default.
- Bearer token via `--mcp-http-auth-token` (or `MCP_HTTP_AUTH_TOKEN`).
- **Required** when binding non-loopback hosts. Code UX rejects unauthenticated requests with HTTP 401 + JSON-RPC error `-32001`.
- Does not perform TLS itself — front with a reverse proxy (nginx, Caddy, Traefik) for HTTPS in production.

### Stdio transport

The stdio transport exists only when stdin is not a TTY. Since the MCP client launches the process, the trust boundary is the same as the launching client.

## Authentication & authorisation

There is no in-process user model. All authenticated callers (including `manage_code_ux`) have the same level of access — read, mutate, destroy.

The only protection layer is the **destructive-action approval handshake**:

- Actions starting with `delete_`, `reset_`, or `replace_` return `{ approvalRequired: true }` on first call.
- Caller must re-call with `approval: { confirmed: true }` to proceed.
- This is anti-foot-gun, not anti-attacker.

## Secrets handling

### Storage

- API keys stored in the settings DB (SQLite by default) at rest.
- The DB file lives in `~/.code-ux/database.sqlite` with the user's default umask.
- No encryption-at-rest by Code UX itself. Use OS-level disk encryption.

### In transit

- API keys are never logged. Log lines that include settings objects are redacted at the logger level.
- API keys are passed to provider CLIs via env vars or per-call arguments — never via command-line flags visible to other processes (`/proc/.../cmdline`).
- HTTP requests to Jules / GitHub APIs use TLS.

### `${ENV_VAR}` references

Settings fields that accept secrets (e.g. `apiKey`) accept `${ENV_VAR}` references that are resolved at start time:

```jsonc
{ "apiKey": "${MY_PROVIDER_KEY}" }
```

This avoids storing literal secrets in the DB.

## Worker isolation

### DOCKER mode

- Workers run inside a Docker container isolated from the host filesystem (only the worktree path and optionally the auth path are mounted).
- Container is removed on completion.
- Workers cannot access other projects' worktrees within the same Code UX install.

### HOST mode

- **No isolation.** The worker process inherits the user running Code UX and its access to the filesystem.
- Use only when you trust the provider CLI and the prompts you give it.

## Audit trail

Every `manage_code_ux` invocation, every cycle event, every dispatch, and every gate decision is recorded in `ExecutionInvocations`. Inspect via:

- Dashboard → Chat → Invocations.
- `GET /api/projects/:projectId/execution/invocations`.
- `manage_code_ux` → `telemetry` → `list_execution_invocations`.

## Recommended deployment

### Personal / single-developer

Run on `127.0.0.1`. No further hardening needed.

### Team / shared server

1. Run Code UX inside a dedicated user (`useradd codeux`) with limited shell access.
2. Bind the dashboard to `127.0.0.1` only.
3. Front the dashboard with a reverse proxy (nginx + auth basic / OAuth) on a public port if needed.
4. Front the MCP HTTP gateway with TLS termination, restrict by client certificate or IP allowlist if exposed.
5. Use OS-level disk encryption.
6. Rotate API keys quarterly.
7. Set `automationLevel: "ALWAYS_ASK"` for untrusted teammates' projects.

### CI / scripted

Avoid storing API keys in the settings DB if the runner is ephemeral; use `JULES_API_KEY` env var injection from your secrets manager.

## Known limitations

- **Cross-Origin Protections**: Dashboard REST routes and WebSocket connections enforce strict `Origin` and `Sec-Fetch-Site` validation. External untrusted origins are actively blocked from performing mutations, mitigating standard CSRF vectors. Still, if exposing remotely, ensure your reverse proxy enforces strong authentication.
- **No rate limiting** at the application layer (other than `express.json({ limit: "1mb" })` for body size). Reverse proxy if needed.
- **No structured RBAC.** Add it at a layer above Code UX (proxy, separate service mesh).

## Reporting vulnerabilities

If you discover a security issue, please email the maintainers privately rather than filing a public issue. The repository's `SECURITY.md` (or root README contact info) is the authoritative channel.
