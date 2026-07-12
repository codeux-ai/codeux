# Automation Credential Security

Code UX stores automation credentials through a broker rather than exposing secret values to node definitions, dashboard reads, MCP payloads, agent context, or run inspection records. Canonical node bindings reference credential metadata by ID; only the broker can resolve the value at execution time after project and capability checks. Named project binding keys use the same broker for other automation consumers.

## Scope and policy

- Project credentials can be managed only through their owning project.
- Global credentials are opt-in and require an explicit project allowlist containing the configuring project.
- Resolution succeeds only when both the credential and binding approve the requested capability.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

The dashboard accepts secret values only on create, rotate, and replace requests. Responses contain configuration, scope, status, key-version, and validation metadata but never stored values. Access-event rows contain identifiers, binding keys, capabilities, outcomes, and denial reasons; they never contain secret material.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption. Each write generates a unique 256-bit data key, payload nonce, and key-wrapping nonce. Credential ownership and workspace context are authenticated as additional data. SQLite stores only ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions.

Root keys are never stored in SQLite. Headless mode requires `CODE_UX_CREDENTIAL_KEY_FILE` to identify a mounted file whose contents decode from base64 or hexadecimal to exactly 32 bytes. The environment variable contains a path, not key material. Keep the mount readable only by the Code UX process and outside the project workspace.

Electron uses the OS-backed `safeStorage` boundary and refuses credential operations when secure OS storage is unavailable. Vault and KMS adapters expose explicit health states. No provider silently falls back to plaintext or an insecure locally derived key.

## Recovery and rotation

Back up root keys independently from `app.db`. Losing a required key version makes its ciphertext unrecoverable by design. Restoring only SQLite is insufficient.

Credential rotation writes a fresh envelope with a new data key and nonces, increments the credential version, and records metadata about the transition. Root-key providers must retain old key IDs and versions until envelopes are rewrapped. Revocation prevents resolution immediately while preserving audit metadata.

## API surface

Project-scoped routes live under `/api/projects/:projectId/credentials`. Supported operations are create, bind, test, rotate, replace, revoke, promote, and restrict. List and health endpoints return metadata only. Existing dashboard authentication and middleware apply before these routes.
