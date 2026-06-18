# Security Hardening

This page documents the concrete security posture of Code UX. Code UX operates as a single-user trusted process designed for local development or isolated execution. It explicitly does not feature multi-tenant RBAC, full authentication for standard UI flows, or protection from hostile users with existing network access to the application.

## Vulnerability Scanning

Dependency vulnerability scanning is enforced via our CI/CD pipeline.

During the CI process, dependencies are evaluated with `pnpm run audit` (which enforces `pnpm audit --audit-level=high`) alongside normal tests and builds. The process respects the frozen lockfile installation structure and blocks builds with high-severity risks.

## Implemented Protections

While Code UX trusts the developer and any connected systems, several specific protections constrain the application attack surface, primarily against cross-site attacks, path escapes, and SSRF risks if the application is bound to accessible network interfaces.

### Dashboard & API Access
- **Origin/Fetch-Metadata Checks:** Dashboard endpoints employ strict `Sec-Fetch-Site` checks and explicit `Origin` validation. API modifications from external, untrusted browser origins are rejected to prevent CSRF vectors.
- **Security Headers:** HTTP responses enforce rigorous security headers (e.g., `X-Content-Type-Options: nosniff`, restrictive `Content-Security-Policy`, and explicit frame-ancestor rules) to protect the dashboard context.
- **Websocket Origin Checks:** The core WebSocket connections similarly validate origins to prevent blind websocket hijacking from hostile origins.
- **Local Binding Default:** The dashboard binds exclusively to the loopback interface (`127.0.0.1`) by default.

### MCP Gateway
- **Session Hardening & Bearer Auth:** The Model Context Protocol (MCP) HTTP gateway implements robust session and lifecycle constraints. When the MCP service is configured for non-loopback access, it mandates HTTP Bearer token authentication to proceed. Unauthenticated external access will result in an immediate rejection (`401 Unauthorized`).

### Preview & File Capabilities
- **File-Browser Path Constraints:** The file-browser strictly enforces directory containment. Path traversal attempts (using `..` or null-byte injections) are validated out; the service prevents any reading or exploration of directories outside the target workspace.
- **Upload/Path Ingestion Limits:** Data ingestion points and upload facilities restrict excessive file sizes and deeply-nested paths. This maintains stability and limits arbitrary disk exhaustion or path-length manipulation.
- **Markdown URL Sanitization:** Markdown and generated HTML correctly sanitize embedded links and image sources, mitigating JavaScript URI injections (`javascript:`) in rendered output.
- **Preview Proxy Constraints:** The local preview proxy enforces clear boundaries on the local ports and destination hosts it will forward traffic towards, reducing blind SSRF proxy abuse.

### Secret Redaction
- **Log and Output Filtering:** Internal API keys, credentials, and sensitive configurations are actively scrubbed and redacted from application logs, debug outputs, and exported execution traces.

## Trust Model & Limitations
Code UX is built as a single-user system.
- **No Multi-user RBAC:** There is no concept of users or roles. If a connection reaches the dashboard or MCP API, it is fully trusted.
- **Operational Guidance:** If you run Code UX on an interface accessible beyond `127.0.0.1`, you must front it with a reverse proxy (e.g., Nginx, Caddy) providing strong authentication (Basic Auth, OAuth2 proxy, mTLS) and TLS termination. Failure to restrict external network access will give any network user full execution rights on the host system.
