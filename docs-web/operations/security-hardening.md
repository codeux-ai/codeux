# Headless Security Hardening

Remote dashboard/API access requires a service-token or trusted OIDC reverse-proxy boundary, TLS, project-scoped roles, and request correlation. A non-loopback `DASHBOARD_HOST` does not make credential routes public: callers still need `credential_admin`, project membership, and `CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT=true`.

The proxy must remove client-supplied identity headers and inject its own principal, roles, projects, HTTPS protocol, and backend shared secret. Service identity configuration stores only SHA-256 bearer digests. Give runners `automation_runner` and only the projects they lease; split author, publisher, approver/runner, credential administrator, and viewer identities where separation is required.

Encrypted credential data has no plaintext fallback. Missing mounted/KMS/Vault key versions fail startup and `/ready`; `/health` remains useful for liveness. Backups are incomplete without the referenced key versions. Audit export is recursively secret-redacted but still restricted operational data.

See [Authenticated Headless Server Mode](./server-mode.md) for deployment, recovery, rotation, SLOs, and limitations.

## External chat connectors

Connector secrets use encrypted envelopes and public configured-state placeholders. Startup migrates legacy `secret_json` rows only after secure key readiness, seals before compare-and-set commit, and clears plaintext only on success. Partial failures remain resumable; rollback requires the matching database and key-provider version, never a manual plaintext downgrade.

Secret/setup/mode changes invalidate verification. Remote connection mutation/verification requires TLS, `credential_admin`, and explicit remote credential management. Bindings and deliveries authorize against their stored project. MCP destructive/transport/resend actions use one-use exact-payload approval; REST resend requires explicit approval.

Ingress resolves secrets ephemerally and applies the selected provider/native or bridge authentication. Durable replay receipts protect generic signed/nonce callbacks, and atomic external-message IDs prevent duplicate chat turns. Official destinations are pinned or learned from authenticated, documented provider URLs; custom bridges/native commands remain operator-controlled and are not provider-certified.

Outbound work uses expiring leases, bounded timeouts/backoff, cancellation, and redacted public results. Shutdown releases leases and stops command/session/reconnect work; startup recovers due work and resumable sessions without making optional connector health part of global readiness. See [External Chat Providers](../architecture/external-chat-providers.md) and [troubleshooting](../user/troubleshooting.md).
