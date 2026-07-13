# Automation Credential Security

Code UX stores automation credentials through a broker rather than exposing secret values to node definitions, dashboard reads, MCP payloads, agent context, or run inspection records. Canonical node bindings reference credential metadata by ID; only the broker can resolve the value at execution time after project and capability checks. Named project binding keys use the same broker for other automation consumers.

## Scope and policy

- Project credentials can be managed only through their owning project.
- Global credentials are opt-in and require an explicit project allowlist containing the configuring project. The configuring project remains the credential's management owner after promotion; other allowlisted projects may bind and resolve it but cannot rotate, replace, revoke, promote, or restrict it.
- Resolution succeeds only when both the credential and binding approve the requested capability.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

The dashboard accepts secret values only on create, rotate, and replace requests. Responses contain configuration, scope, status, key-version, and validation metadata but never stored values. Access-event rows contain identifiers, binding keys, capabilities, outcomes, and denial reasons; they never contain secret material.

Management inputs are validated at runtime rather than trusted from TypeScript types. Names, kinds, binding keys, project ids, capabilities, and list counts are bounded; malformed arrays and control characters are rejected instead of being silently coerced. A stored value is limited to 64 KiB of UTF-8 data. Global allowlists must explicitly retain the management owner.

## Runtime redaction boundary

Node-flow execution resolves credential values only for the active node attempt. Before any provider response, HTTP body, retry error, external-effect payload, diagnostic, invocation message, attempt, node output, or run summary is persisted, the runtime replaces exact resolved values with `[REDACTED]` in addition to masking secret-shaped keys. Credential IDs and non-secret metadata remain available for audit and attempt correlation.

Provider activity persistence uses the same invocation-scoped redactor, including raw usage telemetry and provider session identifiers. Temporary credential references are cleared after each attempt and are never included in redaction logs or diagnostics. Custom-node containers apply the equivalent policy to structured output, stderr logs, and diagnostics before returning control to the flow runtime.

Resolution authorization is checked both before and after decryption. If a credential is revoked, rotated, restricted, promoted, or rebound while a read is in flight, the plaintext buffer is cleared and the broker denies or retries against the current version; stale authorization is never returned to the caller.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption. Each write generates a unique 256-bit data key, payload nonce, and key-wrapping nonce. Credential ownership and workspace context are authenticated as additional data. SQLite stores only ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions.

Root keys are never stored in SQLite or a project checkout. The normal loopback dashboard automatically provisions one raw 32-byte root key at `~/.code-ux/security/credential-root.key`. Its dedicated parent directory is `0700` and the regular file is `0600`. Creation uses an exclusive atomic install, durable filesystem synchronization where supported, and concurrent startup convergence so restarts recover the identical key. Before creation or access, every custody-path component from the Code UX home through the key parent is inspected without following symbolic links; a symbolic-link or non-directory ancestor fails closed before a redirected key can be provisioned. Existing symbolic links, non-files, malformed keys, permissive modes, or unexpected ownership are never repaired automatically; credential operations fail closed with metadata-only setup guidance.

Automatic local-file custody is limited to the non-server dashboard with local authentication, loopback binding, and remote credential management disabled. Electron's process provider remains first priority and continues to use OS `safeStorage`. Explicit `CODE_UX_CREDENTIAL_KEY_PROVIDER=mounted-key-file|vault|kms` configuration takes priority over automatic custody; setting `CODE_UX_CREDENTIAL_KEY_FILE` alone remains compatible with the mounted-file provider. Unknown values and an explicit `local-file` selection are rejected. Dashboard-disabled headless operation, server mode, authenticated dashboards, non-loopback bindings, and remote credential-management deployments do not auto-provision a local key.

For mounted-file custody, `CODE_UX_CREDENTIAL_KEY_FILE` identifies a regular, owner-only mounted file whose contents are an exact base64 or hexadecimal encoding of 32 bytes. Oversized or permissively decodable key files are rejected. The environment variable contains a path, not key material. Keep the mount readable only by the Code UX process and outside the project workspace.

Electron serializes first-use root-key creation, persists only the OS-protected blob through an atomic owner-only file replacement, and refuses credential operations when `safeStorage` is unavailable. Vault and KMS adapters validate 32-byte caller-owned key material and report the active key id/version in health results. No provider silently falls back to plaintext or an insecure locally derived key.

## Recovery and rotation

Back up root keys independently from `app.db`. For the normal local dashboard, back up `~/.code-ux/security/credential-root.key` while preserving owner-only handling; for external providers, retain every referenced key version. Losing a required key version makes its ciphertext unrecoverable by design. Restoring only SQLite is insufficient.

Credential creation commits metadata and its first envelope in one SQLite transaction. Rotation/replacement and promotion likewise commit the new envelope, metadata, version, and rotation record atomically. Compare-and-swap guards allow only one overlapping value change to commit; losing callers must retry instead of overwriting a newer secret. Root-key providers must retain old key IDs and versions until envelopes are rewrapped. Revocation wins against in-flight resolutions and preserves audit metadata.

Existing global credentials created before management ownership was stored are migrated with their first valid allowlisted project as the management owner. Operators should verify that owner before expanding a legacy global credential's allowlist.

## API surface

Project-scoped routes live under `/api/projects/:projectId/credentials`. Supported operations are create, bind, test, rotate, replace, revoke, promote, and restrict. List and health endpoints return metadata only. Existing dashboard authentication and middleware apply before these routes.

Runtime validation failures return `400`, project/management denials return `403`, and compare-and-swap conflicts return `409` so callers can retry without treating policy failures as server crashes.
