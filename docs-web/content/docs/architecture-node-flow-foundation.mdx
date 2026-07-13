# Node Flow Foundation

Code UX uses one project-owned Graph v2 contract across the dashboard, backend, MCP surface, scheduler, and runtime. Graphs carry `schemaVersion: 2`, stable versioned definition references, typed ports and flow schemas, credential-id bindings, bounded policies, capabilities, side effects, disabled state, and optional immutable publication metadata.

## Registry and executable handlers

The definition registry is the authority for the palette and runtime. Manifests provide configuration/UI schemas, ports, credential slots, capabilities, side effects, default policy, documentation, deprecation, executable state, and execution kind. Every credential slot explicitly declares required/optional state plus bounded, non-empty allowed kinds and required capabilities.

The governed built-ins with registered handlers are:

| Area | Definitions |
| --- | --- |
| Data, provider, and HTTP | `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `output` |
| Control and transformation | `condition`, `switch`, `foreach`, `merge`, `delay`, `execute_subflow` |
| Governed effects and triggers | `approval`, `email_draft`, `email_send`, `webhook_trigger` |

A validated custom definition becomes executable only after its immutable artifact and versioned manifest are registered and the custom-node runtime is configured. Unknown types, legacy browser-only `trigger`/`agent`/`task` kinds, mockups, and definitions marked non-executable are planned or unavailable definitions, not handlers.

## Validation, policy, and secrets

Validation resolves each definition and checks configuration, port handles and schemas, policies, graph bounds, and cycles. Migrated Graph v1 and canonical Graph v2 inputs fail closed: malformed nodes, edges, ports, credential bindings, definition references, capabilities, policies, schemas, and metadata produce deterministic field-level issues at their original paths without discarding safe siblings. Repeated validation preserves issue ordering. It rejects plaintext secret-shaped fields and generated or custom source in graph JSON. The dashboard receives credential binding ids and metadata-only states; resolved values remain behind the credential broker. Credential values and secret-shaped payloads are redacted before invocation messages, attempts, diagnostics, route responses, and debugger output are persisted or rendered.

Draft review reports requested capabilities, side effects, credential status, policy findings, and a non-executing dry run. For each bound slot it uses the credential broker's metadata-only compatibility contract and reports backend readiness, configured/active state, project access, kind and capability compatibility, and missing capabilities. Stable findings for missing required bindings and every denial block draft and legacy create/update publication; an unbound optional slot remains valid.

At runtime the current versioned definition is checked again before an executor runs. Undeclared, duplicate, or newly required-but-missing slots fail closed, and the broker receives the same allowed kinds and required capabilities before one authorized secret read. Revocation, restriction, replacement, access changes, and encrypted-backend failure therefore stop execution before the node executor. Graph `credentialBindings` remain canonical; the legacy credential-request endpoint explicitly reports that it is non-persistent and never changes them. Runs select an immutable pinned or latest-published snapshot.

## Project workspace and migration

`/nodes` loads the selected project's backend flow library and does not request flow data without a selected project. Revision-checked saves return a conflict rather than replacing a newer draft.

The former `codeux:nodes-canvas:v1` value can be imported once into a project draft. Legacy kinds and handles are translated to registered Graph v2 definitions before creation. Import failures remain retryable and do not block existing flows; success records a project marker and removes the old value. Persisted Graph v1 records retain their exact immutable version and append deterministic Graph v2.

## Operations and prerequisites

The run debugger reads redacted flow runs, node runs, numbered attempts, approvals, retry decisions, invocation links, timing, and cancellation state. Scheduling preserves pinned-versus-latest publication selection.

Outside development, `/nodes` requires the Nodes feature flag plus the node-flow backend and automation-security prerequisites. Definition-specific execution still requires the applicable provider, credential, egress, approval/outbox, webhook, or custom-node service and security policy. Registry presence alone is not a production-readiness claim.
