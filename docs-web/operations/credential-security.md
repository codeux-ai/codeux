# Automation Credential Security

Code UX resolves canonical node credential IDs and named project binding keys through the credential broker. Stored values are not exposed to nodes, dashboard reads, MCP payloads, agent context, run inspection records, or access audits.

## Scope and policy

- Project credentials are owned by one project.
- Global credentials require an explicit project allowlist and retain the configuring project as their management owner. Other allowlisted projects may bind and resolve the credential but cannot mutate it.
- Both the binding and credential must approve the requested capability.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

Create, rotate, and replace requests are write-only. API responses contain configuration and status metadata but never stored values.

Runtime validation bounds names, identifiers, capabilities, list counts, and secret size (64 KiB UTF-8). Malformed arrays and control characters are rejected rather than coerced.

## Runtime redaction boundary

Node-flow credentials exist in plaintext only for the active node attempt. Exact resolved values are replaced with `[REDACTED]` before provider responses, HTTP bodies, retry errors, external-effect payloads, diagnostics, invocation messages, attempts, node outputs, or run summaries are stored. Credential IDs and non-secret metadata remain available for auditability.

The same redactor protects provider activity and raw usage telemetry. Temporary credential references are cleared after the attempt and are never logged as redaction input. Custom-node outputs, stderr logs, and diagnostics follow the same rule.

Authorization is rechecked after decryption. Concurrent revocation, rotation, restriction, promotion, or rebinding clears the plaintext buffer and causes a retry or denial instead of returning stale access.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption with a unique data key, payload nonce, and key-wrapping nonce for every write. Credential ownership and workspace context are authenticated. SQLite stores ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions—not root keys.

The trusted loopback dashboard automatically provisions one raw 32-byte root key at `~/.code-ux/security/credential-root.key`, with a `0700` parent and `0600` regular file. Provisioning is exclusive, atomic, durable where filesystem synchronization is supported, and safe across concurrent startup. Symbolic links, non-files, malformed content, permissive modes, and unexpected ownership fail closed and are not repaired automatically.

Automatic local-file custody is disabled for server mode, dashboard-disabled headless operation, authenticated or non-loopback dashboards, and remote credential management. Electron remains first priority and persists only an OS-protected blob. Explicit `CODE_UX_CREDENTIAL_KEY_PROVIDER=mounted-key-file|vault|kms` configuration takes priority; `CODE_UX_CREDENTIAL_KEY_FILE` alone remains a compatible mounted-file selection. Unknown values and explicit `local-file` selection are rejected. If secure key material is unavailable, credential operations fail closed; there is no plaintext fallback.

## Recovery and rotation

Back up root keys separately from `app.db`; the database alone cannot recover credentials. Local dashboard backups must include `~/.code-ux/security/credential-root.key` with owner-only handling. Creation, rotation/replacement, and promotion commit ciphertext and metadata atomically. Version compare-and-swap permits only one overlapping value change to commit. Revocation also wins against an in-flight resolution while retaining audit metadata.

Legacy global records use their first valid allowlisted project as the migrated management owner; verify that owner before expanding an old global allowlist.

## Dashboard API

Credential management uses project-scoped dashboard routes. List, health, and mutation responses return metadata only. Secret values are accepted only by create, rotate, and replace operations.

Validation failures return `400`, project/management denials return `403`, and concurrent-write conflicts return `409` for a safe caller retry.
