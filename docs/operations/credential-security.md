# Automation Credential Security

Code UX stores automation credentials through a broker rather than exposing secret values to node definitions, dashboard reads, MCP payloads, agent context, or run inspection records. Canonical node bindings reference credential metadata by ID; only the broker can resolve the value at execution time after project and capability checks. Named project binding keys use the same broker for other automation consumers.

## Scope and policy

- Project credentials can be managed only through their owning project.
- Global credentials are opt-in and require an explicit project allowlist containing the configuring project. The configuring project remains the credential's management owner after promotion; other allowlisted projects may bind and resolve it but cannot rotate, replace, revoke, promote, or restrict it.
- Resolution succeeds only when both the credential and binding approve the requested capability.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

The dashboard accepts secret values only on create, rotate, and replace requests. Responses contain configuration, scope, status, key-version, and validation metadata but never stored values. Access-event rows contain identifiers, binding keys, capabilities, outcomes, and denial reasons; they never contain secret material.

Management inputs are validated at runtime rather than trusted from TypeScript types. Names, kinds, binding keys, project ids, capabilities, and list counts are bounded; malformed arrays and control characters are rejected instead of being silently coerced. A stored value is limited to 64 KiB of UTF-8 data. Global allowlists must explicitly retain the management owner.

## Settings credential references

Sensitive provider, nested Qwen provider, Git host, Jira, importer, speech, and embedding settings use non-secret `{ credentialId, capability: "read" }` references. Settings repository reads, dashboard responses, snapshots, and MCP exports keep legacy plaintext-shaped fields redacted and expose only these references. Local-auth and dashboard-auth mount paths remain ordinary non-secret settings and do not pass through the broker.

At dashboard startup, the one-way migration reads legacy values from raw settings storage, creates project credentials for project/sprint overrides or explicitly allowlisted global credentials for system integrations, and rewrites the source record without the original value. Repeated startup is idempotent because migrated records contain references only. Environment and legacy `settings.json` hints enter through this same migration boundary instead of being copied into settings responses. If the secure key provider or a valid project scope is unavailable, plaintext is scrubbed and resolution fails closed; there is no settings fallback.

Fresh settings startup does not initialize the secure key provider unless plaintext credentials or external credential hints actually require migration. This keeps Electron startup independent of OS keychain availability until encrypted storage is needed.

Runtime settings consumers resolve a reference with the active project, an explicit consumer binding key, and the `read` capability. The broker reuses its scope, allowlist, status, capability, audit, and compare-and-swap checks, and the decrypted buffer is zeroed immediately after the bounded consumer callback completes or throws.

Provider invocations resolve the selected provider reference, nested Qwen provider references, and Git host references at the CLI request boundary for every attempt. Rotation is therefore visible to the next invocation, while revocation, project-scope denial, or missing `read` capability prevents the subprocess or Docker workspace request from starting. Mounted local-auth providers bypass API-key resolution and retain their existing mount behavior.

Jira, external importers, speech transcription/synthesis, and external embeddings use the same bounded callback immediately around their HTTP request. Effective settings remain metadata-only; request headers and temporary provider environments receive the resolved value, and returned telemetry, provider errors, and invocation messages are exact-value redacted before the broker releases and clears its buffer.

## Runtime redaction boundary

Node-flow execution resolves credential values only for the active node attempt. Before any provider response, HTTP body, retry error, external-effect payload, diagnostic, invocation message, attempt, node output, or run summary is persisted, the runtime replaces exact resolved values with `[REDACTED]` in addition to masking secret-shaped keys. Credential IDs and non-secret metadata remain available for audit and attempt correlation.

Provider activity persistence uses the same invocation-scoped redactor, including raw usage telemetry and provider session identifiers. Temporary credential references are cleared after each attempt and are never included in redaction logs or diagnostics. Custom-node containers apply the equivalent policy to structured output, stderr logs, and diagnostics before returning control to the flow runtime.

Resolution authorization is checked both before and after decryption. If a credential is revoked, rotated, restricted, promoted, or rebound while a read is in flight, the plaintext buffer is cleared and the broker denies or retries against the current version; stale authorization is never returned to the caller.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption. Each write generates a unique 256-bit data key, payload nonce, and key-wrapping nonce. Credential ownership and workspace context are authenticated as additional data. SQLite stores only ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions.

Root keys are never stored in SQLite. Headless mode requires `CODE_UX_CREDENTIAL_KEY_FILE` to identify a regular, owner-only mounted file whose contents are an exact base64 or hexadecimal encoding of 32 bytes. Oversized or permissively decodable key files are rejected. The environment variable contains a path, not key material. Keep the mount readable only by the Code UX process and outside the project workspace.

Electron serializes first-use root-key creation, persists only the OS-protected blob through an atomic owner-only file replacement, and refuses credential operations when `safeStorage` is unavailable. Vault and KMS adapters validate 32-byte caller-owned key material and report the active key id/version in health results. No provider silently falls back to plaintext or an insecure locally derived key.

## Recovery and rotation

Back up root keys independently from `app.db`. Losing a required key version makes its ciphertext unrecoverable by design. Restoring only SQLite is insufficient.

Credential creation commits metadata and its first envelope in one SQLite transaction. Rotation/replacement and promotion likewise commit the new envelope, metadata, version, and rotation record atomically. Compare-and-swap guards allow only one overlapping value change to commit; losing callers must retry instead of overwriting a newer secret. Root-key providers must retain old key IDs and versions until envelopes are rewrapped. Revocation wins against in-flight resolutions and preserves audit metadata.

Existing global credentials created before management ownership was stored are migrated with their first valid allowlisted project as the management owner. Operators should verify that owner before expanding a legacy global credential's allowlist.

## API surface

Project-scoped routes live under `/api/projects/:projectId/credentials`. Supported operations are create, bind, test, rotate, replace, revoke, promote, and restrict. List and health endpoints return metadata only. Existing dashboard authentication and middleware apply before these routes.

Runtime validation failures return `400`, project/management denials return `403`, and compare-and-swap conflicts return `409` so callers can retry without treating policy failures as server crashes.
