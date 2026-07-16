# Headless Security Hardening

Remote dashboard/API access requires a service-token or trusted OIDC reverse-proxy boundary, TLS, project-scoped roles, and request correlation. A non-loopback `DASHBOARD_HOST` does not make credential routes public: callers still need `credential_admin`, project membership, and `CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT=true`.

The proxy must remove client-supplied identity headers and inject its own principal, roles, projects, HTTPS protocol, and backend shared secret. Service identity configuration stores only SHA-256 bearer digests. Give runners `automation_runner` and only the projects they lease; split author, publisher, approver/runner, credential administrator, and viewer identities where separation is required.

Encrypted credential data has no plaintext fallback. Missing mounted/KMS/Vault key versions fail startup and `/ready`; `/health` remains useful for liveness. Backups are incomplete without the referenced key versions. Audit export is recursively secret-redacted but still restricted operational data.

Shared subprocess execution validates command names, arguments, stdin files, and working directories immediately before spawning. Working directories must resolve to existing real directories inside the user home, application directory, OS temporary directory, or an explicit `CODE_UX_DIRECTORY_BROWSER_ROOTS` entry before either the inline or helper-process boundary. Git helper repository discovery accepts only `.git` directories and worktree targets with a valid `HEAD`, so stale ancestor markers cannot widen host bind mounts. The selected project and active project workflows share one runtime-owned warm helper per repository: repo-local worktrees share it, separate repositories remain isolated, stdin files stream through `docker exec -i`, and Git/auth environment applies only to each exec. Repository-owned transient artifacts stay inside the existing mount. Commands needing a truly external bind use a one-shot helper. `shell: false` prevents argument values from being reinterpreted as shell syntax.

Docker provider launches stage selected environment values, provider argv, and generated provider configuration in restrictive temporary files. Oversized prompts for stdin-capable CLIs are streamed from a separate restrictive file through `docker run -i`, keeping the prompt out of both the host Docker command line and the container's final `execve` arguments while avoiding operating-system argument-size failures.

See [Authenticated Headless Server Mode](./server-mode.md) for deployment, recovery, rotation, SLOs, and limitations.

## External chat connectors

Connector secrets use encrypted envelopes and public configured-state placeholders. Startup migrates legacy `secret_json` rows only after secure key readiness, seals before compare-and-set commit, and clears plaintext only on success. Partial failures remain resumable; rollback requires the matching database and key-provider version, never a manual plaintext downgrade.

Secret/setup/mode changes invalidate verification. Remote connection mutation/verification requires TLS, `credential_admin`, and explicit remote credential management. Bindings and deliveries authorize against their stored project. MCP destructive/transport/resend actions use one-use exact-payload approval; REST resend requires explicit approval.

Ingress resolves secrets ephemerally and applies the selected provider/native or bridge authentication. Durable replay receipts protect generic signed/nonce callbacks, and atomic external-message IDs prevent duplicate chat turns. Official destinations are pinned or learned from authenticated, documented provider URLs; custom bridges/native commands remain operator-controlled and are not provider-certified.

Outbound work uses expiring leases, bounded timeouts/backoff, cancellation, and redacted public results. Shutdown releases leases and stops command/session/reconnect work; startup recovers due work and resumable sessions without making optional connector health part of global readiness. See [External Chat Providers](../architecture/external-chat-providers.md) and [troubleshooting](../user/troubleshooting.md).
