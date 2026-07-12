# Nodes Automation Workspace

The **Nodes** page (`/nodes`) is a project-scoped Graph v2 authoring and operations workspace backed by the canonical node-flow repository. Select a project before using it: the page does not request a flow library, credential metadata, publications, or run history without an active project. Browser storage is not a workflow database and edits are never auto-saved locally.

The selected project's library is loaded from the backend. Creating and saving drafts writes to that project, and changing projects clears the current workspace before loading the next library. Saves include `draftRevision`; if another editor has advanced the draft, the backend returns a conflict and the page asks the operator to reload and reapply the change instead of overwriting it.

## Legacy canvas import

On the first load for a selected project, the dashboard checks the former `codeux:nodes-canvas:v1` key. When present, it normalizes the payload to Graph v2, creates an **Imported Nodes Canvas** backend draft, records a project-specific migration marker, and removes the legacy graph value. A failed import leaves the value available for retry. The marker prevents duplicates. After this one-time bridge, local storage is not read or written as the workflow source of truth.

## Governed editing

The versioned definition registry supplies the palette, executable state, typed ports, configuration and widget schemas, capabilities, credential slots, side-effect classification, and default retry/timeout policy. The inspector is rendered from the selected definition rather than a hard-coded node form. The graph stores a type/version reference, non-secret configuration, and credential ids; it never stores custom source or credential values.

Credential slots show metadata-only states such as bound, missing, or denied and can submit a binding request. Secret material stays behind the credential broker and is excluded from graphs, browser output, logs, and examples.

The selected flow also loads the active project's agent presets and its current flow-to-agent attachments. Attachment controls remain page-owned and pass only preset and attachment metadata into the inspector. Attaching or detaching calls the governed node-flow attachment routes and then reloads the selected flow's bindings; switching projects or flows clears the prior selection and ignores stale responses. Loading and retryable failure states remain visible without exposing graphs, credentials, or broader node-flow management capability to an attached agent.

Validation and dry run report structural issues, requested capabilities, credential requirements, side-effect differences, and policy findings. Dry run is review-only and does not execute nodes. Publication requires the current draft revision, a valid graph with no error-level policy findings, and all declared credential requirements bound. Publications are immutable; comparison and rollback operate on versioned snapshots.

## Executable definitions

The governed built-ins currently registered with runtime handlers are `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, `webhook_trigger`, and `output`.

Validated custom definitions may also execute after their versioned manifest and immutable artifact are registered and the custom-node runtime is configured. A palette mockup, legacy `trigger`/`agent`/`task` canvas kind, unknown type, or definition marked non-executable is a planning or unavailable definition, not an executable handler.

## Operations

Only published versions run. The debugger shows redacted run output, graph and node states, attempts, retry classifications and decisions, approval state, invocation links, timing, cancellation, and safe retry controls. Approval decisions resume or terminate the same pinned durable run. Scheduling is entered through the Scheduler page and targets a pinned or latest-published version.

Outside development builds, the workspace is exposed only when the Nodes feature flag and both node-flow backend and automation-security prerequisites are enabled. Execution also depends on the services required by a definition: for example, a configured provider for `provider_prompt`, allowed egress for `http_request`, approval and outbox services for governed email sending, webhook configuration for webhook ingress, and the custom-node runtime for registered custom definitions. Availability is not a claim that every integration is configured for production.

An attached agent receives only the governed `run_attached_flow` capability for that project-owned binding. Runtime execution still verifies project ownership, publication state, attachment identity, and credential policy; attachment never grants graph inspection, credential access, or the broader `manage_node_flows` surface.
