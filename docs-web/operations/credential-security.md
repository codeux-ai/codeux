# Automation Credential Security

Code UX resolves canonical node credential IDs and named project binding keys through the credential broker. Stored values are not exposed to nodes, dashboard reads, MCP payloads, agent context, run inspection records, or access audits.

## Scope and policy

- Project credentials are owned by one project.
- Global credentials require an explicit project allowlist and retain the configuring project as their management owner. Other allowlisted projects may bind and resolve the credential but cannot mutate it.
- The credential kind must be allowed, and both the binding and credential must approve every declared capability before one secret read.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

Create, rotate, and replace requests are write-only. API responses contain configuration and status metadata but never stored values.

Create requests explicitly declare kind, scope, capabilities, and an allowlist (empty for project credentials). Runtime validation bounds names, identifiers, capabilities, list counts, and secret size (64 KiB UTF-8). Malformed arrays, unknown mutation fields, and control characters are rejected rather than coerced.

Every lifecycle mutation includes `expectedVersion`. The only mutable descriptive field is the bounded name; kind and management ownership remain immutable. Restrictions may remove allowlisted projects or capabilities but cannot add them. Project-to-global promotion is the explicit scope expansion and requires managing-project authority, `confirmScopeExpansion: true`, the current version, and an allowlist of existing projects that retains the managing project. Current-version repeated revocation is idempotent; stale versions conflict.

## Runtime redaction boundary

Node-flow credentials exist in plaintext only for the active node attempt. Exact resolved values are replaced with `[REDACTED]` before provider responses, HTTP bodies, retry errors, external-effect payloads, diagnostics, invocation messages, attempts, node outputs, or run summaries are stored. Credential IDs and non-secret metadata remain available for auditability.

The same redactor protects provider activity and raw usage telemetry. Temporary credential references are cleared after the attempt and are never logged as redaction input. Custom-node outputs, stderr logs, and diagnostics follow the same rule.

Authorization is rechecked after decryption. Concurrent revocation, rotation, restriction, promotion, or rebinding clears the plaintext buffer and causes a retry or denial instead of returning stale access.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption with a unique data key, payload nonce, and key-wrapping nonce for every write. Credential ownership and workspace context are authenticated. SQLite stores ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions—not root keys.

Headless mode requires `CODE_UX_CREDENTIAL_KEY_FILE` to point to a regular, owner-only mounted file containing an exact base64 or hexadecimal encoding of a 32-byte key. Electron serializes first-use key creation and atomically persists only the OS-protected blob. Vault and KMS adapters validate key material and report the active key id/version. If secure key material is unavailable, credential operations fail closed; there is no plaintext fallback.

## Recovery and rotation

Back up root keys separately from `app.db`; the database alone cannot recover credentials. Creation, rotation/replacement, and promotion commit ciphertext and metadata atomically. Version compare-and-swap protects every lifecycle mutation. Revocation also wins against an in-flight resolution while retaining audit metadata.

Lifecycle success and denial audits carry correlation IDs, credential IDs, and policy metadata only. Validation records `valid`, `invalid`, or `unavailable` without exposing tested values or cryptographic internals.

Legacy global records use their first valid allowlisted project as the migrated management owner; verify that owner before expanding an old global allowlist.

## Dashboard API

Credential management uses project-scoped dashboard routes. The API includes create, bounded-name update, bind, metadata-only compatibility assessment, test, rotate, replace, revoke, confirmed promotion, and monotonic restriction. Compatibility checks backend readiness, configured/active state, project access, allowed kinds, and all required capabilities without reading plaintext. List, health, compatibility, and mutation responses never contain secret values; secrets are accepted only by create, rotate, and replace operations.

Validation failures return `400`, project/management denials return `403`, concurrent-write conflicts return `409`, invalid encrypted state returns `422`, and unavailable key custody returns `503` with a safe recovery message.
