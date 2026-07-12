# Automation Credential Security

Code UX resolves canonical node credential IDs and named project binding keys through the credential broker. Stored values are not exposed to nodes, dashboard reads, MCP payloads, agent context, run inspection records, or access audits.

## Scope and policy

- Project credentials are owned by one project.
- Global credentials require an explicit project allowlist.
- Both the binding and credential must approve the requested capability.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

Create, rotate, and replace requests are write-only. API responses contain configuration and status metadata but never stored values.

## Runtime redaction boundary

Node-flow credentials exist in plaintext only for the active node attempt. Exact resolved values are replaced with `[REDACTED]` before provider responses, HTTP bodies, retry errors, external-effect payloads, diagnostics, invocation messages, attempts, node outputs, or run summaries are stored. Credential IDs and non-secret metadata remain available for auditability.

The same redactor protects provider activity and raw usage telemetry. Temporary credential references are cleared after the attempt and are never logged as redaction input. Custom-node outputs, stderr logs, and diagnostics follow the same rule.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption with a unique data key, payload nonce, and key-wrapping nonce for every write. Credential ownership and workspace context are authenticated. SQLite stores ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions—not root keys.

Headless mode requires `CODE_UX_CREDENTIAL_KEY_FILE` to point to a mounted file containing a base64- or hexadecimal-encoded 32-byte key. Electron uses the OS `safeStorage` boundary. Vault and KMS adapters report explicit health states. If secure key material is unavailable, credential operations fail closed; there is no plaintext fallback.

## Recovery and rotation

Back up root keys separately from `app.db`; the database alone cannot recover credentials. Rotation creates a fresh encrypted envelope, increments the credential version, and records metadata about the transition. Revocation prevents subsequent resolution while retaining audit metadata.

## Dashboard API

Credential management uses project-scoped dashboard routes. List, health, and mutation responses return metadata only. Secret values are accepted only by create, rotate, and replace operations.
