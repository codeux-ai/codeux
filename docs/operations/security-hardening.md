# Security Hardening

This page documents the concrete security posture of Code UX. Code UX operates as a single-user trusted process designed for local development or isolated execution. It explicitly does not feature multi-tenant RBAC, full authentication for standard UI flows, or protection from hostile users with existing network access to the application.

## Dependency Audit Enforcement

Dependency vulnerability scanning is enforced via our CI/CD pipeline.

During the CI process, dependencies are evaluated with `pnpm run audit` (which enforces `pnpm audit --audit-level=high`) alongside normal tests and builds. The process respects the frozen lockfile installation structure and blocks builds with high-severity risks.

## Implemented Protections

While Code UX trusts the developer and any connected systems, several specific protections constrain the application attack surface, primarily against cross-site attacks, path escapes, and SSRF risks if the application is bound to accessible network interfaces.

### Dashboard & API Access
- **Trusted-Host Enforcement:** The dashboard strictly validates `Host` and `X-Forwarded-Host` headers against the configured allowed hosts to prevent host header injection attacks.
- **Origin/Fetch-Metadata Checks:** Dashboard endpoints employ strict `Sec-Fetch-Site` checks and explicit `Origin` validation. API modifications from external, untrusted browser origins are rejected to prevent CSRF vectors.
- **Strict Parsing:** Incoming request payloads are validated using strict parsing schemas to reject malformed data, unexpected types, or excessive sizes before processing. Dashboard JSON parsing is route-aware: normal `/api` mutations use a 1 MB JSON body limit, while the 25 MB allowance is reserved for settings save routes (`PUT /api/system-settings`, `PUT /api/projects/:projectId/settings`, and `PUT /api/sprints/:sprintId/settings`) that can carry appearance background-image data URLs. Multipart knowledge uploads and preview proxy requests bypass the dashboard JSON parser so their route-specific handlers keep ownership of body processing.
- **Rate Limiting:** Critical API endpoints apply rate limiting to prevent abuse and mitigate denial-of-service risks.
- **Security Headers:** HTTP responses enforce rigorous security headers (e.g., `X-Content-Type-Options: nosniff`, restrictive `Content-Security-Policy`, and explicit frame-ancestor rules) to protect the dashboard context.
- **Websocket Origin Checks:** The core WebSocket connections similarly validate origins to prevent blind websocket hijacking from hostile origins.
- **Local Binding Default:** The dashboard binds exclusively to the loopback interface (`127.0.0.1`) by default.

### MCP Gateway
- **Session Hardening & Bearer Auth:** The Model Context Protocol (MCP) HTTP gateway implements robust session and lifecycle constraints. When the MCP service is configured for non-loopback access, it mandates HTTP Bearer token authentication to proceed. Unauthenticated external access will result in an immediate rejection (`401 Unauthorized`).
- **MCP Config Validation:** The gateway rigorously validates all incoming configurations and payloads against the Model Context Protocol schemas, ensuring only properly structured instructions are executed.
- **Approval Correlation Guard:** MCP approval tracking accepts only bounded correlation ID shapes and rejects malformed, path-like, or token-like values without clearing valid pending approvals.

### Preview & File Capabilities
- **File-Browser Path Constraints:** The file-browser strictly enforces directory containment. Path traversal attempts (using `..` or null-byte injections) are validated out; the service prevents any reading or exploration of directories outside the target workspace.
- **Validated Filesystem Sinks:** Directory browsing, in-repository knowledge ingestion, and repository initialization resolve candidate paths through shared containment helpers before calling filesystem APIs. Symlink targets are checked after canonicalization, and the validated path value is the only value passed to the filesystem sink.
- **Upload/Path Ingestion Limits:** Data ingestion points and upload facilities restrict excessive file sizes and deeply-nested paths. This maintains stability and limits arbitrary disk exhaustion or path-length manipulation.
- **Markdown URL Sanitization:** Markdown and generated HTML correctly sanitize embedded links and image sources, mitigating JavaScript URI injections (`javascript:`) in rendered output.
- **Preview Proxy Hardening:** The local preview proxy enforces clear boundaries on the local ports and destination hosts it will forward traffic towards, reducing blind SSRF proxy abuse.
- **Preview Frame Compatibility:** Preview-host traffic is treated as local trusted application content rather than dashboard chrome. The dashboard does not stamp its frame/permissions hardening headers onto preview-host responses, and proxied preview HTML has upstream CSP and `X-Frame-Options` stripped so the in-app iframe remains loadable.
- **Preview CORS Compatibility:** Preview-host traffic answers CORS preflights and overrides upstream `Access-Control-*` headers at the proxy boundary. The dashboard API origin keeps its CSRF guard; only preview-host origins get permissive local-app CORS behavior.

### Redaction
- **Log and Output Filtering:** Internal API keys, credentials, and sensitive configurations are actively scrubbed and redacted from application logs, debug outputs, and exported execution traces. The shared redactor covers provider API keys, OpenAI-compatible key shapes, GitHub/GitLab/Jira tokens, bearer/basic authorization headers, URL credentials, nested arrays, and error messages/stacks.
- **Settings Secret Inputs:** Dashboard settings fields that store provider API keys, Git host tokens, Jira API tokens, and external embedding API keys render as masked secret inputs by default. Operators must explicitly use the reveal control to inspect a value.
- **Docker Secret Transport:** Provider and preview Docker launches write selected host/provider environment variables to temporary `0600` env-files and pass those files via `--env-file`. This keeps API keys and Git tokens out of the host `docker run` argv visible through process listings while preserving the same container environment.

### Subprocess & Settings Mutation Safety
- **Shell-Free Command Execution:** Shared subprocess execution validates command names, argument null bytes, and stdin file paths immediately before spawning, then runs with `shell: false` so arguments are not reinterpreted by a shell.
- **Prototype Pollution Guards:** Dotted settings paths are parsed through a safe-key validator before clone-on-write mutation. `__proto__`, `constructor`, `prototype`, and empty path segments are rejected before any assignment.

## Trust Model & Limitations
Code UX is built as a single-user system.
- **No Multi-user RBAC:** There is no concept of users or roles. If a connection reaches the dashboard or MCP API, it is fully trusted.
- **Operational Guidance:** If you run Code UX on an interface accessible beyond `127.0.0.1`, you must front it with a reverse proxy (e.g., Nginx, Caddy) providing strong authentication (Basic Auth, OAuth2 proxy, mTLS) and TLS termination. Failure to restrict external network access will give any network user full execution rights on the host system.
