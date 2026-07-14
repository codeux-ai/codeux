# Automation Credential Security

Code UX stores automation credentials through a broker rather than exposing secret values to node definitions, dashboard reads, MCP payloads, agent context, or run inspection records. Canonical node bindings reference credential metadata by ID; only the broker can resolve the value at execution time after project and capability checks. Named project binding keys use the same broker for other automation consumers.

## Scope and policy

- Project credentials can be managed only through their owning project.
- Global credentials are opt-in and require an explicit project allowlist containing the configuring project. The configuring project remains the credential's management owner after promotion; other allowlisted projects may bind and resolve it but cannot rotate, replace, revoke, promote, or restrict it.
- Resolution succeeds only when the credential kind is allowed and both the credential and binding approve every declared capability. Authorization is completed before the broker performs its single secret read.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

Node-flow definition slots explicitly declare required/optional state, allowed kinds, and required capabilities. Draft review and every publication path use the broker's metadata-only compatibility assessment; runtime sends the same declaration to direct credential-id resolution immediately before execution. Graph `credentialBindings` are canonical. The legacy credential-request endpoint records no binding and identifies its result as non-persistent.

The dashboard accepts secret values only on create, rotate, and replace requests. Responses contain configuration, scope, status, key-version, and validation metadata but never stored values. Access-event rows contain identifiers, binding keys, capabilities, outcomes, and denial reasons; they never contain secret material.

The Settings Integrations catalog exposes this broker as its first standard card. The card derives unavailable, ready/unconfigured, and configured states from backend health and project-visible metadata; **Manage** opens a project-aware detail view without rendering a secret, request body, or raw server error. Allowlisted non-owner projects can understand and use compatible global credentials but see management actions disabled.

Create controls require deliberate capability selection and explicit project or global scope. Global allowlists retain the management owner, and scope-expanding creation or promotion is confirmed. Rename, test, rotation/replacement, restriction, promotion, and revocation report typed inline status, disable overlapping actions, and refresh after stale-version conflicts. Destructive and scope-expanding actions use keyboard-operable confirmation dialogs with focus restoration.

All create, rotate, and replacement fields are controlled write-only inputs. They are never hydrated from metadata and are cleared after every submission outcome, project change, and component teardown. Credential metadata drafts and browser stores do not receive secret values.

Management inputs are validated at runtime rather than trusted from TypeScript types. Create requests must explicitly declare kind, scope, capabilities, and an allowlist (an empty array for project credentials). Names, kinds, binding keys, project ids, capabilities, and list counts are bounded; malformed arrays, unknown mutation fields, and control characters are rejected instead of being silently coerced. A stored value is limited to 64 KiB of UTF-8 data. Global allowlists must explicitly retain the management owner.

Every lifecycle mutation carries `expectedVersion`. Successful name updates, validation tests, rotations/replacements, promotions, restrictions, and first-time revocations increment the version. A repeated revoke against an already-revoked credential at its current version is an idempotent no-op; stale requests return a conflict. Metadata updates may change only the bounded display name, so kind and management ownership remain immutable.

Restriction is monotonic: it may remove allowlisted projects or capabilities but cannot add either. Project-to-global promotion is the explicit scope expansion and requires the managing project, a current version, `confirmScopeExpansion: true`, an allowlist containing the managing project, and project IDs that already exist.

## Runtime redaction boundary

Node-flow execution resolves credential values only for the active node attempt. Before any provider response, HTTP body, retry error, external-effect payload, diagnostic, invocation message, attempt, node output, or run summary is persisted, the runtime replaces exact resolved values with `[REDACTED]` in addition to masking secret-shaped keys. Credential IDs and non-secret metadata remain available for audit and attempt correlation.

Provider activity persistence uses the same invocation-scoped redactor, including raw usage telemetry and provider session identifiers. Temporary credential references are cleared after each attempt and are never included in redaction logs or diagnostics. Custom-node containers apply the equivalent policy to structured output, stderr logs, and diagnostics before returning control to the flow runtime.

Resolution authorization is checked both before and after decryption. If a credential is revoked, rotated, restricted, promoted, or rebound while a read is in flight, the plaintext buffer is cleared and the broker denies or retries against the current version; stale authorization is never returned to the caller.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption. Each write generates a unique 256-bit data key, payload nonce, and key-wrapping nonce. Credential ownership and workspace context are authenticated as additional data. SQLite stores only ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions.

Root keys are never stored in SQLite or a project checkout. The normal loopback dashboard automatically provisions one raw 32-byte root key at `~/.code-ux/security/credential-root.key` (the equivalent user-profile path on Windows). On POSIX filesystems, its dedicated parent directory is `0700` and the regular file is `0600`; Windows inherits the current user's profile ACL because Node does not expose meaningful POSIX owner/mode bits there. Creation uses an exclusive atomic install, durable filesystem synchronization where supported, and concurrent startup convergence so restarts recover the identical key. Before creation or access, every custody-path component from the Code UX home through the key parent is inspected without following symbolic links; a symbolic-link or non-directory ancestor fails closed before a redirected key can be provisioned. Existing symbolic links, non-files, or malformed keys are never repaired automatically; permissive modes or unexpected UID ownership also fail closed on POSIX. Credential operations return metadata-only setup guidance instead.

Automatic local-file custody is limited to the non-server dashboard with local authentication, loopback binding, and remote credential management disabled. Electron's process provider remains first priority and continues to use OS `safeStorage`. Explicit `CODE_UX_CREDENTIAL_KEY_PROVIDER=mounted-key-file|vault|kms` configuration takes priority over automatic custody; setting `CODE_UX_CREDENTIAL_KEY_FILE` alone remains compatible with the mounted-file provider. Unknown values and an explicit `local-file` selection are rejected. Dashboard-disabled headless operation, server mode, authenticated dashboards, non-loopback bindings, and remote credential-management deployments do not auto-provision a local key.

For mounted-file custody, `CODE_UX_CREDENTIAL_KEY_FILE` identifies a regular, owner-only mounted file whose contents are an exact base64 or hexadecimal encoding of 32 bytes. Oversized or permissively decodable key files are rejected. The environment variable contains a path, not key material. Keep the mount readable only by the Code UX process and outside the project workspace.

Electron serializes first-use root-key creation, persists only the OS-protected blob through an atomic owner-only file replacement, and refuses credential operations when `safeStorage` is unavailable. Vault and KMS adapters validate 32-byte caller-owned key material and report the active key id/version in health results. No provider silently falls back to plaintext or an insecure locally derived key.

| Deployment boundary | Root-key custody | Provisioning behavior |
| --- | --- | --- |
| Normal CLI dashboard on loopback with local authentication | Local file under the user-home Code UX security directory, with enforced owner-only POSIX modes or inherited Windows user-profile ACLs | Automatically created on first use and reused after restart. A normal local dashboard user does not mount or configure a key file. |
| Electron desktop | Operating-system `safeStorage` | Automatically creates and persists only the OS-protected blob; unavailable `safeStorage` blocks credential operations. |
| Dashboard-disabled headless, server mode, authenticated dashboard, non-loopback binding, or remote credential management | Explicit mounted file, Vault, or KMS provider | Never auto-provisions local custody. Setup and recovery fail closed until the configured provider reports available, secure key identity and version metadata. |

## Recovery and rotation

Back up root keys independently from `app.db`. For the normal local dashboard, back up `~/.code-ux/security/credential-root.key` while preserving owner-only handling; for external providers, retain every referenced key version. Losing a required key version makes its ciphertext unrecoverable by design. Restoring only SQLite is insufficient.

Credential creation commits metadata and its first envelope in one SQLite transaction. Rotation/replacement and promotion likewise commit the new envelope, metadata, version, and rotation record atomically. Compare-and-swap guards apply to every lifecycle mutation so losing callers must refresh metadata and retry instead of overwriting newer state. Root-key providers must retain old key IDs and versions until envelopes are rewrapped. Revocation wins against in-flight resolutions and preserves audit metadata.

Lifecycle successes and denials emit correlation-aware automation audit records containing credential IDs and policy metadata only. Validation updates report `valid`, `invalid`, or `unavailable` without including tested values or low-level cryptographic errors.

Custom dashboards use a stricter metadata-only consumer boundary. Dedicated slot declarations define allowed kinds and required capabilities, while separate draft and immutable-revision binding columns store credential IDs. Binding review delegates to the broker's compatibility assessment and never resolves plaintext. Required or invalid bindings stop validation before workspace creation and are rechecked before publication. Credential values and binding IDs are excluded from generated dashboard artifacts, Docker configuration, validation output, generic REST/MCP responses, and iframe messages; only the dedicated binding-management response may expose IDs with non-secret metadata.

Existing global credentials created before management ownership was stored are migrated with their first valid allowlisted project as the management owner. Operators should verify that owner before expanding a legacy global credential's allowlist.

## API surface

Project-scoped routes live under `/api/projects/:projectId/credentials`. Supported operations are create, bounded-name update (`PATCH /:credentialId`), bind, metadata-only compatibility assessment, test, rotate, replace, revoke, promote, and restrict. Compatibility evaluates key-backend readiness, configuration, active status, project access, allowed kinds, and all required capabilities without resolving plaintext. A backend is ready only when it is available and secure and reports both a non-empty key ID and a key version; missing key identity metadata produces the stable `backend_unavailable` compatibility issue. List, compatibility, health, and mutation responses return metadata or policy results only. Existing dashboard authentication and remote credential-management guards apply before these routes.

Runtime validation failures return `400`, project/management denials return `403`, compare-and-swap conflicts return `409`, invalid encrypted state returns `422`, and unavailable key custody returns an actionable `503` response.

## Integrated verification contract

Credential security changes are exercised against a normal isolated local runtime, not only mocked service boundaries. A composition-root restart test constructs two successive `CodeUxServer` instances against the same isolated home, proving that production dependency wiring recovers the SQLite metadata, local-file key identity, named binding, and authorized runtime resolution. The broader integration suite also provisions local key custody concurrently and verifies that public REST and MCP payloads remain value-free. Lifecycle coverage includes optimistic conflicts, validation, rotation/replacement, monotonic restriction, confirmed promotion, revocation, malformed input, and explicit key-provider outages. Custom-dashboard MCP coverage performs metadata-only slot listing, approval-gated binding, a stale optimistic conflict, explicit refresh and retry, and unbinding through the real management handler.

The credentialed-automation drill proves that missing, revoked, cross-project, wrong-kind, insufficient-capability, and unavailable-backend bindings fail before a provider or custom node can be invoked. Its disclosure canary is checked across public responses, structured records, SQLite text columns, generated workspaces, Docker command inputs, validation artifacts, graph JSON, dashboard records, and browser/iframe-visible state; encrypted binary envelopes are the only intentional storage location.

Production-bundle Playwright coverage enables the documented Nodes and Custom Dashboards feature gates inside its isolated runtime. It exercises Settings lifecycle feedback and recovery, node binding/replacement/unbinding through publication and a local mock-provider run, custom-dashboard build/runtime slots and publication blocking, keyboard focus restoration, and narrow-viewport operation without external provider or network dependencies. A second independently homed runtime explicitly selects the mounted-file provider without a configured file; the browser verifies unavailable health and recovery guidance, preserves visible non-secret metadata, and proves create, test, rotate, replace, promote, and revoke controls cannot emit mutation requests until custody recovers.

## Troubleshooting without disclosure

- If custody is unavailable, inspect the metadata-only credential health or readiness result and the configured provider name. For the normal loopback dashboard, verify ownership and file type on the existing Code UX security path, plus owner-only modes on POSIX or the inherited user-profile ACL on Windows; for Electron, restore OS `safeStorage`; for headless or remote operation, restore the configured mount, Vault, or KMS version. Never paste, print, regenerate over, or move root-key material into a repository to diagnose the failure.
- If a mutation reports a stale `expectedVersion`, refresh credential metadata and review the newer scope, capabilities, validation state, and status before retrying. Do not reuse the rejected request blindly and do not bypass the comparison check.
- If encrypted rows exist but their key version is unavailable, restore the exact retained provider version before starting runners. Replacing it with a new key does not decrypt old envelopes; restore from the independent custody backup or recover the affected credential through the supported replacement workflow after the runtime is ready.
