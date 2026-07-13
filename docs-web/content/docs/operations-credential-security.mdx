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

Chat connector credentials use the same key-provider and envelope-encryption boundary in `chat_provider_connection_secrets`. Dashboard and MCP writes seal before a single secret-version CAS transaction commits connection metadata and creates, replaces, or clears the envelope; provider profiles receive decrypted values only for the active ingress or outbound operation, and public/repository reads expose configured field names with redacted values. Startup performs an idempotent post-readiness migration of legacy `secret_json` rows one connection at a time; a failed seal leaves that row unchanged and a later startup safely resumes it.

Headless mode requires `CODE_UX_CREDENTIAL_KEY_FILE` to point to a regular, owner-only mounted file containing an exact base64 or hexadecimal encoding of a 32-byte key. Electron serializes first-use key creation and atomically persists only the OS-protected blob. Vault and KMS adapters validate key material and report the active key id/version. If secure key material is unavailable, credential operations fail closed; there is no plaintext fallback.

## Recovery and rotation

Back up root keys separately from `app.db`; the database alone cannot recover credentials. Creation, rotation/replacement, and promotion commit ciphertext and metadata atomically. Version compare-and-swap permits only one overlapping value change to commit. Revocation also wins against an in-flight resolution while retaining audit metadata.

Legacy global records use their first valid allowlisted project as the migrated management owner; verify that owner before expanding an old global allowlist.

## Dashboard API

Credential management uses project-scoped dashboard routes. List, health, and mutation responses return metadata only. Secret values are accepted only by create, rotate, and replace operations.

Validation failures return `400`, project/management denials return `403`, and concurrent-write conflicts return `409` for a safe caller retry.
