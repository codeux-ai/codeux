# Node Flows Dashboard

The **Nodes** page (`/nodes`) is the project-scoped backend authoring, publication, and operations surface for canonical node flows. No selected project means no flow library, credential metadata, publications, or durable run history are requested.

## Library, drafts, and migration

The library loads through `GET /api/projects/:projectId/node-flows`. Drafts are created through `POST /api/projects/:projectId/node-flow-drafts` and saved through revision-checked `PATCH /api/node-flow-drafts/:flowId`. A stale revision produces a visible conflict and never overwrites newer work.

The former browser graph at `codeux:nodes-canvas:v1` is eligible for one import into the selected project. The bridge maps `trigger` to `input`, `agent` to `set_fields`, and `task` to `provider_prompt`; `condition` and `output` remain governed definitions, ports are remapped, and legacy configuration is retained as non-secret metadata. Code UX creates an **Imported Nodes Canvas** backend draft and only then removes the legacy value and records a project-specific marker. A failed import remains retryable and is isolated from normal library loading, while a successful marker prevents duplicates.

## Registry-driven editing and credentials

`GET /api/node-flow-catalog` returns flat versioned palette summaries. `GET /api/node-flow-catalog/:nodeType` returns the full `NodeDefinitionManifest`, including nested `ui.widgetSchema`, configuration schema, policies, documentation, and deprecation metadata. The inspector renders from that full contract. Graphs reference a definition version and store non-secret configuration and credential ids; they do not contain custom-node source or resolved credentials.

Credential slots use the versioned definition's allowed kinds and required capabilities to offer project-visible credential metadata. Only active, configured credentials with project access and a healthy secure backend are selectable; unavailable entries explain the operator-facing reason without exposing secret or key-custody details, and an empty compatible set links directly to **Settings → Integrations**.

Selecting, replacing, or removing a credential updates only that slot in the node's canonical `credentialBindings` and immediately saves the complete draft through the current optimistic revision. The dashboard then adopts the canonical flow revision and refreshes governed review. Saving, saved, policy-denial, and error states are announced. A revision conflict loads the latest draft, preserves the selected slot workflow and sibling edits, and requires the operator to choose again rather than replaying the stale mutation. Credential plaintext remains behind the broker and is excluded from graph data, component state, browser output, logs, and documentation examples.

The complete governed built-in set currently registered with executable handlers is `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, `webhook_trigger`, and `output`.

Registered custom definitions can execute only when their validated versioned manifest, immutable artifact, and custom-node runtime are available. Raw legacy `trigger`/`agent`/`task` kinds are translated by the browser import bridge rather than executed directly. Unknown or unregistered types, mockup entries, and definitions marked non-executable are planned or unavailable definitions.

## Governance and publication

Draft review provides structural validation, policy findings, requested permissions, side-effect review, and a non-executing dry run. Publication requires the current draft revision, a valid governed review, and all required credentials. Each publication is an immutable snapshot; comparison and rollback operate on versioned history, and only a pinned or latest-published version can execute.

## Durable debugger and scheduling

The debugger reads persisted flow runs, node runs, attempt history, retry classifications and decisions, approval records, invocation links, timing, and redacted input and output. Pending approvals expose keyboard-accessible **Approve & continue** and **Reject** actions. A decision continues or terminates the same pinned run, and repeated decisions return its current durable state without duplicating a governed attempt or external send. The debugger also supports cancellation and safe retry.

Foreach runs persist one downstream node run and attempt sequence per deterministic logical item. Item inputs, retries, cancellation, approvals, and side-effect identity survive restart; concurrency is bounded by the node configuration. Empty collections select the explicit `empty` branch and persist the item branch as skipped, while oversized collections fail instead of being truncated.

The layout stacks on small screens, preserves keyboard-visible focus, labels loading/error/empty states, and bounds long histories and JSON output with scrolling.

Rendered run payloads redact secret-shaped keys such as `apiKey`, `authorization`, `cookie`, `password`, `secret`, and `token`.

The run debugger lists durable approvals beside node attempts. A pending item offers **Approve & continue** and **Reject** actions. The decision applies to the same pinned run, and repeated clicks return its current state without sending an approved external effect twice.

## Agent attachment

A selected project loads its agent presets, and selecting a flow loads that flow's current bindings. The inspector exposes only agent names and attachment skill metadata; it never renders agent instructions, custom source, credential values, or decrypted material.

Attaching and detaching use the governed node-flow attachment routes, then refresh the selected flow's bindings. Project or flow changes clear the prior selection and visible bindings, abort in-flight reads where possible, and ignore stale responses. Loading, failure, retry, empty, and mutation states remain keyboard accessible. The backend independently enforces project ownership and the attached-flow capability boundary; dashboard state does not grant authorization.

A flow can be attached to a project agent preset as a repeatable skill with a name and description. Detaching removes only that binding; the flow, its graph, schedules, and run history remain in the project.

Scheduling is entered through `/scheduler` and targets a pinned or latest-published version. A flow can also be attached to a project agent preset as a reusable skill; removing the attachment does not remove the flow, publications, schedules, or run history.

Scheduled node-flow entries select a project-owned flow and may include optional JSON object input. Pause, resume, failure handling, and due-run behavior match the normal scheduler model.

## Graph v2 boundary

The dashboard edits the shared Graph v2 contract. The initial executable registry was `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output`; the current governed catalog extends it with `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, and `webhook_trigger`. Planned palette concepts are not runtime handlers.

Outside development builds, `/nodes` requires the Nodes feature flag plus the node-flow backend and automation-security prerequisites. Individual definitions can additionally require provider, credential-broker, egress, approval/outbox, webhook, or custom-runtime configuration. Catalog presence and feature visibility do not assert that an integration is configured or production-ready.
