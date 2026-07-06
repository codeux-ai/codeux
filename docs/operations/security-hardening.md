# Security Hardening

This page documents the concrete security posture of Code UX. Code UX operates as a single-user trusted process designed for local development or isolated execution. It explicitly does not feature multi-tenant RBAC, full authentication for standard UI flows, or protection from hostile users with existing network access to the application.

## Dependency Audit Enforcement

Dependency vulnerability scanning is enforced via our CI/CD pipeline.

During the CI process, dependencies are evaluated with `pnpm run audit` (which enforces `pnpm audit --audit-level=high`) alongside normal tests and builds. The process respects the frozen lockfile installation structure and blocks builds with high-severity risks.

Release publishing, release checks, and desktop packaging workflows also run `pnpm run audit` after dependency installation and before packaging or publishing artifacts. This keeps dependency risk evaluation on every artifact-producing path, not only on pull request CI.

## Supply-Chain Workflow Guardrails

Automated guardrails enforce the repository's dependency and workflow security posture:

- GitHub Actions dependency installs must use `pnpm install --frozen-lockfile --ignore-scripts`. Packaging workflows that need native Electron rebuilds keep the install script-free and run the explicit rebuild step (`pnpm run electron:install-deps`) afterward.
- Security-relevant workflows declare explicit least-privilege `permissions` and pin action references to the major action versions already used by the project.
- `scripts/check-quality-guardrails.mjs` scans production code and scripts for `curl | bash`, `wget | sh`, `eval`, shell-enabled child process execution, and Docker `--privileged` usage.
- Known provider CLI fallback installers are narrowly allowlisted by exact source line and rationale. They remain bounded to documented provider hosts, run inside provider containers, and are used only when the expected provider command is absent.

Local verification:

```bash
pnpm run test:backend -- tests/backend/scripts/quality-guardrails.test.ts tests/backend/ci/workflow-health.test.ts
pnpm run quality:guardrails
pnpm run audit
```

## Implemented Protections

While Code UX trusts the developer and any connected systems, several specific protections constrain the application attack surface, primarily against cross-site attacks, path escapes, and SSRF risks if the application is bound to accessible network interfaces.

### Dashboard & API Access
- **Trusted-Host Enforcement:** The dashboard strictly validates `Host` and `X-Forwarded-Host` headers against the configured allowed hosts to prevent host header injection attacks.
- **Origin/Fetch-Metadata Checks:** Dashboard endpoints employ strict `Sec-Fetch-Site` checks and explicit `Origin` validation. API modifications from external, untrusted browser origins are rejected to prevent CSRF vectors.
- **Strict Parsing:** Incoming request payloads are validated using strict parsing schemas to reject malformed data, unexpected types, or excessive sizes before processing. Dashboard JSON parsing is route-aware: normal `/api` mutations use a 1 MB JSON body limit, while the 25 MB allowance is reserved for settings save routes (`PUT /api/system-settings`, `PUT /api/projects/:projectId/settings`, and `PUT /api/sprints/:sprintId/settings`) that can carry appearance background-image data URLs. Multipart knowledge uploads and preview proxy requests bypass the dashboard JSON parser so their route-specific handlers keep ownership of body processing.
- **Project-Scoped Knowledge Objects:** Knowledge document read, delete, re-embed, and project-import endpoints verify document ownership against the requested project before returning content or mutating data. Cross-project document IDs are reported as not found, and import errors never include foreign document text.
- **Rate Limiting:** Critical API endpoints apply rate limiting to prevent abuse and mitigate denial-of-service risks.
- **Security Headers:** HTTP responses enforce rigorous security headers (e.g., `X-Content-Type-Options: nosniff`, restrictive `Content-Security-Policy`, and explicit frame-ancestor rules) to protect the dashboard context.
- **Websocket Origin Checks:** The core WebSocket connections similarly validate origins to prevent blind websocket hijacking from hostile origins.
- **Local Binding Default:** The dashboard binds exclusively to the loopback interface (`127.0.0.1`) by default.

### MCP Gateway
- **Session Hardening & Bearer Auth:** The Model Context Protocol (MCP) HTTP gateway implements robust session and lifecycle constraints. When the MCP service is configured for non-loopback access (`0.0.0.0`, `::`, or a LAN address), startup fails unless a non-empty HTTP Bearer token is configured. Loopback-only development binds (`127.0.0.1`, `localhost`, or `::1`) may remain unauthenticated.
- **MCP Header Preflight:** The MCP HTTP gateway normalizes and validates `Authorization`, `mcp-session-id`, and `x-code-ux-agent` headers before any session lookup. Missing or malformed bearer credentials return a sanitized `401 Unauthorized`; malformed session or agent identifiers return a sanitized `400 Bad Request`; inactive session ids use a generic invalid-session response.
- **MCP Session Limits:** The gateway allows at most 100 active Streamable HTTP sessions and closes sessions idle for more than one hour before accepting a new initialize request. Session-cap logs include bounded operational metadata only, such as request method, path, active count, and maximum count.
- **MCP Config Validation:** The gateway rigorously validates all incoming configurations and payloads against the Model Context Protocol schemas, ensuring only properly structured instructions are executed.
- **Approval Correlation Guard:** MCP approval tracking accepts only bounded correlation ID shapes and rejects malformed, path-like, or token-like values without clearing valid pending approvals.

### Preview & File Capabilities
- **File-Browser Path Constraints:** The file-browser strictly enforces directory containment. Path traversal attempts (using `..` or null-byte injections) are validated out; the service prevents any reading or exploration of directories outside the target workspace.
- **Validated Filesystem Sinks:** Directory browsing, in-repository knowledge ingestion, and repository initialization resolve candidate paths through shared containment helpers before calling filesystem APIs. Symlink targets are checked after canonicalization, and the validated path value is the only value passed to the filesystem sink.
- **Catalog-Bound Instruction Files:** Dashboard instruction-file editing is limited to the static instruction file catalog. File IDs are not treated as paths, catalog destinations are canonicalized under the project base directory, existing targets are checked with `realpath`, and new-file parents are checked before writes so symlinks cannot redirect reads or writes outside the repository.
- **Upload/Path Ingestion Limits:** Data ingestion points and upload facilities restrict excessive file sizes and deeply-nested paths. This maintains stability and limits arbitrary disk exhaustion or path-length manipulation.
- **Dashboard Markdown URL Sanitization:** Markdown rendering and direct dashboard `href` assignment share the same URL policy. Links allow `http`, `https`, `mailto`, anchors, query-only links, and relative paths; images allow only `http` and `https`. The policy rejects protocol-relative URLs, backslash-prefixed URLs, malformed absolute URLs, control-character or HTML-entity protocol obfuscation, `javascript:`, `data:`, `vbscript:`, and scheme-smuggled relative values before the first path delimiter. Raw HTML is disabled in markdown, transformed markdown URLs are revalidated, rendered attributes are escaped, and external markdown links include `rel="noopener noreferrer"` to prevent reverse-tabnabbing.
- **Preview Proxy Hardening:** The local preview proxy enforces clear boundaries on the local ports and destination hosts it will forward traffic towards, reducing blind SSRF proxy abuse.
- **Preview Frame Compatibility:** Preview-host traffic is treated as local trusted application content rather than dashboard chrome. The dashboard does not stamp its frame/permissions hardening headers onto preview-host responses, and proxied preview HTML has upstream CSP and `X-Frame-Options` stripped so the in-app iframe remains loadable.
- **Preview CORS Compatibility:** Preview-host traffic answers CORS preflights and overrides upstream `Access-Control-*` headers at the proxy boundary. The dashboard API origin keeps its CSRF guard; only preview-host origins get permissive local-app CORS behavior.

### Electron Desktop Shell
- **Sandboxed Renderer:** The desktop BrowserWindow runs with context isolation, renderer sandboxing, and Node integration disabled. The isolated preload exposes only the directory picker, zoom, and window-control IPC bridge required by the dashboard.
- **Internal Navigation Allowlist:** Electron allows internal rendering only for the resolved dashboard origin and canonical same-port preview hosts in the form `preview-<session>.localhost:<dashboardPort>`. All other renderer navigations are denied.
- **External Link Handling:** Non-internal `http`, `https`, and `mailto` targets are opened with the operating system through `shell.openExternal` after scheme validation. Unsafe schemes such as `file:`, `javascript:`, and `data:` are blocked instead of being rendered in the desktop shell.
- **Permission Denial:** Electron permission requests from dashboard and preview pages are denied by default, including camera, microphone, geolocation, notifications, and media prompts. Preview origins currently have no permission exception.
- **IPC Input Validation:** Desktop IPC handlers reject invalid renderer input before invoking native APIs. Directory picker defaults must be strings without control characters, and zoom factors must be finite numbers.

### Redaction
- **Log and Output Filtering:** Internal API keys, credentials, and sensitive configurations are actively scrubbed and redacted from application logs, debug outputs, and exported execution traces. The shared redactor covers provider API keys, OpenAI-compatible key shapes, GitHub/GitLab/Jira tokens, bearer/basic authorization headers, URL credentials, nested arrays, and error messages/stacks.
- **MCP Gateway Log Hygiene:** Unauthorized, invalid-header, inactive-session, and session-cap gateway logs omit bearer values, supplied session ids, and supplied agent ids. They retain only correlation-safe metadata needed for operations.
- **Settings Secret Inputs:** Dashboard settings fields that store provider API keys, Git host tokens, Jira API tokens, and external embedding API keys render as masked secret inputs by default. Operators must explicitly use the reveal control to inspect a value.
- **Docker Secret Transport:** Provider and preview Docker launches write selected host/provider environment variables to temporary `0600` env-files and pass those files via `--env-file`. This keeps API keys and Git tokens out of the host `docker run` argv visible through process listings while preserving the same container environment.

### Subprocess & Settings Mutation Safety
- **Shell-Free Command Execution:** Shared subprocess execution validates command names, argument null bytes, and stdin file paths immediately before spawning, then runs with `shell: false` so arguments are not reinterpreted by a shell.
- **Prototype Pollution Guards:** Dotted settings paths are parsed through a safe-key validator before clone-on-write mutation. `__proto__`, `constructor`, `prototype`, and empty path segments are rejected before any assignment.

## Trust Model & Limitations
Code UX is built as a single-user system.
- **No Multi-user RBAC:** There is no concept of users or roles. If a connection reaches the dashboard or MCP API, it is fully trusted.
- **Operational Guidance:** If you run Code UX on an interface accessible beyond `127.0.0.1`, you must front it with a reverse proxy (e.g., Nginx, Caddy) providing strong authentication (Basic Auth, OAuth2 proxy, mTLS) and TLS termination. Failure to restrict external network access will give any network user full execution rights on the host system.
