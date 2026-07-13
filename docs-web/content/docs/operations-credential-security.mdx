# Automation Credential Security

Code UX resolves canonical node credential IDs and named project binding keys through the credential broker. Stored values are not exposed to nodes, dashboard reads, MCP payloads, agent context, run inspection records, or access audits.

## Scope and policy

- Project credentials are owned by one project.
- Global credentials require an explicit project allowlist and retain the configuring project as their management owner. Other allowlisted projects may bind and resolve the credential but cannot mutate it.
- Both the binding and credential must approve the requested capability.
- Revoked, unavailable, missing, cross-project, or insufficiently capable credentials fail closed.

Create, rotate, and replace requests are write-only, and the dashboard clears successful secret inputs. Settings selectors list active metadata for binding and retain metadata-only revoked or unavailable bound states for explicit unbinding. API responses contain configuration and status metadata but never stored values.

Runtime validation bounds names, identifiers, capabilities, list counts, and secret size (64 KiB UTF-8). Malformed arrays and control characters are rejected rather than coerced.

## Settings credential references

Provider, nested Qwen provider, Git host, Jira, importer, speech, and embedding secrets are represented in settings by non-secret `{ credentialId, capability: "read" }` references. Dashboard and MCP settings reads keep legacy plaintext fields empty. Local-auth and dashboard-auth mounts remain non-secret configuration and continue to work independently.

Startup migrates the complete supported legacy credential set—including all provider keys, nested Qwen model-provider keys, Git hosts, Jira, importer token/secret pairs, speech, and embedding keys—into project credentials or explicitly allowlisted global credentials, then removes the original values while preserving non-secret settings. The legacy database source is deleted only after those values enter the handoff. The migration is idempotent; malformed payloads and unavailable secure storage or project scope are scrubbed, and runtime resolution fails closed rather than using plaintext settings.

The import-sources API and dashboard expose only boolean source, credential, and provider availability metadata. Raw values are never returned, rendered, pre-filled, or copied into settings; they exist only at the startup migration boundary.

Fresh settings startup initializes secure key custody only when plaintext credentials or external hints actually need migration, so Electron does not contact the OS keychain unnecessarily.

Authorized runtime consumers resolve references with an active project and explicit consumer key. Existing scope, allowlist, capability, audit, revocation, and concurrent-change checks apply, and the decrypted buffer is zeroed after the consumer callback.

Provider invocations resolve provider, nested Qwen, and Git host references at the CLI request boundary for every attempt. The next invocation sees rotations, while revocation, scope denial, or missing `read` capability prevents execution. Mounted local-auth providers retain their existing behavior.

Hosted Jules calls keep only project scope, a credential reference, and a consumer key in request context. Every HTTP request and retry resolves the current broker value, then removes the authorization header from response and error objects. The shared client retains no plaintext, and a configured reference never falls through to `JULES_API_KEY` or CLI authentication after a broker failure.

Remote repository operations resolve credentials independently at their execution boundary. Task and QA refreshes, preview and file-browser snapshots, provider and virtual-worker workspace preparation, project setup, agent-preset pushes, and pull-request queries resolve only the credential for the detected GitHub or GitLab origin. Legacy token fields remain empty, and a configured invalid or inaccessible reference fails closed rather than using ambient authentication. Environment or Git CLI authentication remains compatible only when no broker reference is configured.

Selected-project Git status uses that same boundary. With no Git host reference, environment-token and Git CLI compatibility remain available. With a reference, each status request resolves it using the selected project scope and `read` capability; broker denial cannot fall through to ambient authentication, and resolved values are removed from propagated status errors.

Sprint orchestration uses separate broker consumers for origin fetch, unique branch discovery, branch preparation, and branch preflight, so rotation and revocation are observed by each remote operation without changing local-only Git behavior.

Jira, external importers, speech, and external embeddings use the same bounded callback around each HTTP request. Temporary environments and request headers receive the value, while telemetry, errors, and invocation messages are exact-value redacted before the broker clears its buffer.

## Runtime redaction boundary

Node-flow credentials exist in plaintext only for the active node attempt. Exact resolved values are replaced with `[REDACTED]` before provider responses, HTTP bodies, retry errors, external-effect payloads, diagnostics, invocation messages, attempts, node outputs, or run summaries are stored. Credential IDs and non-secret metadata remain available for auditability.

The same redactor protects provider activity and raw usage telemetry. Temporary credential references are cleared after the attempt and are never logged as redaction input. Custom-node outputs, stderr logs, and diagnostics follow the same rule.

Authorization is rechecked after decryption. Concurrent revocation, rotation, restriction, promotion, or rebinding clears the plaintext buffer and causes a retry or denial instead of returning stale access.

## Encryption and key custody

The SQLite secret store uses AES-256-GCM envelope encryption with a unique data key, payload nonce, and key-wrapping nonce for every write. Credential ownership and workspace context are authenticated. SQLite stores ciphertext, authentication tags, wrapped keys, nonces, and key identifiers/versions—not root keys.

Headless mode requires `CODE_UX_CREDENTIAL_KEY_FILE` to point to a regular, owner-only mounted file containing an exact base64 or hexadecimal encoding of a 32-byte key. Electron serializes first-use key creation and atomically persists only the OS-protected blob. Vault and KMS adapters validate key material and report the active key id/version. If secure key material is unavailable, credential operations fail closed; there is no plaintext fallback.

## Recovery and rotation

Back up root keys separately from `app.db`; the database alone cannot recover credentials. Creation, rotation/replacement, and promotion commit ciphertext and metadata atomically. Version compare-and-swap permits only one overlapping value change to commit. Revocation also wins against an in-flight resolution while retaining audit metadata.

Legacy global records use their first valid allowlisted project as the migrated management owner; verify that owner before expanding an old global allowlist.

## Dashboard API

Credential management uses project-scoped dashboard routes. List, health, and mutation responses return metadata only. Secret values are accepted only by create, rotate, and replace operations.

Validation failures return `400`, project/management denials return `403`, and concurrent-write conflicts return `409` for a safe caller retry.
