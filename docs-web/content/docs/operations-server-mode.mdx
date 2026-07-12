# Authenticated Headless Server Mode

Code UX separates MCP bearer access from the authenticated dashboard administrative API. Remote dashboard/API deployments must use digest-backed service identities or terminate OIDC at a trusted reverse proxy; loopback desktop operation remains a trusted local boundary.

## Identity and authorization

Set `CODE_UX_DASHBOARD_AUTH_MODE=service_token` and provide `CODE_UX_SERVICE_IDENTITIES_JSON` entries containing `id`, `displayName`, SHA-256 `tokenSha256`, `roles`, explicit `projectIds`, and `enabled`. Workers send the bearer through `CODE_UX_WORKER_AUTH_TOKEN` and may assert the matching identity with `CODE_UX_WORKER_SERVICE_ID`.

Alternatively, set `CODE_UX_DASHBOARD_AUTH_MODE=trusted_proxy`, configure `CODE_UX_TRUSTED_PROXY_SECRET`, terminate/validate OIDC at the proxy, strip client identity headers, and inject trusted principal, role, and project headers. Authenticated remote traffic requires TLS (`X-Forwarded-Proto: https`) unless insecure HTTP is explicitly enabled for an isolated test.

Roles are `credential_admin`, `automation_author`, `automation_publisher`, `automation_runner`, and `viewer`. Credential routes additionally require `CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT=true`; enabling it without a healthy secure key provider makes readiness fail. Host/origin checks, no-store responses, and administrative rate limits remain active.

The `credential_admin` role can still read administrative readiness, audit export, and SLO metrics while remote credential management is disabled. The feature flag gates credential-management and credential-health routes only.

## Probes, audit, and SLOs

`/health` is liveness. `/ready` also checks credential-key recovery, the audit store, and distributed-runner identities and returns `503` when required components are unavailable. If encrypted credential rows exist and their key cannot be recovered, startup aborts before listeners bind.

Authenticated operators can use `/api/admin/readiness`, `/api/admin/audit/export` (redacted NDJSON), and `/api/admin/metrics/slo`. Audit covers management calls, credential access, runs, attempts, approvals, and outbox delivery with correlation ids.

Baseline alerts: readiness not ready for five minutes, management 5xx above 1% or p95 above one second for ten minutes, repeated lease expiry, credential-denial spikes, outbox failure backlog, or any secret/audit check failure. Target zero unauthorized project grants, secret disclosures, and duplicate side effects.

## Backup and recovery

Back up SQLite with WAL consistency, settings, project `.code-ux/` state, and every referenced external key version. Restore keys before databases, keep runner admission disabled, require `/ready`, then reconcile leases, approvals, audit continuity, and outbox counts. Never back up plaintext service tokens beside their digests.

Rotate service identities by overlapping new/old digests until runners authenticate with the new token. Rotate credential values through the broker so graph bindings retain ids and resolve the next version. Retain old KMS/Vault versions until envelope rewrap and restore drills pass.

Rollback creates and publishes a new draft from an earlier immutable version; in-flight runs stay pinned. Recovery requeues only known-safe pre-invocation work and leaves uncertain external outcomes for attention. OIDC validation and Vault/KMS client integration remain deployment-host responsibilities, and MCP bearer authority remains broader than dashboard roles.
