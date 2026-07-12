# Headless Security Hardening

Remote dashboard/API access requires a service-token or trusted OIDC reverse-proxy boundary, TLS, project-scoped roles, and request correlation. A non-loopback `DASHBOARD_HOST` does not make credential routes public: callers still need `credential_admin`, project membership, and `CODE_UX_REMOTE_CREDENTIAL_MANAGEMENT=true`.

The proxy must remove client-supplied identity headers and inject its own principal, roles, projects, HTTPS protocol, and backend shared secret. Service identity configuration stores only SHA-256 bearer digests. Give runners `automation_runner` and only the projects they lease; split author, publisher, approver/runner, credential administrator, and viewer identities where separation is required.

Encrypted credential data has no plaintext fallback. Missing mounted/KMS/Vault key versions fail startup and `/ready`; `/health` remains useful for liveness. Backups are incomplete without the referenced key versions. Audit export is recursively secret-redacted but still restricted operational data.

See [Authenticated Headless Server Mode](./server-mode.md) for deployment, recovery, rotation, SLOs, and limitations.
