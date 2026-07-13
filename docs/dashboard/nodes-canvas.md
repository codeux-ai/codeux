# Nodes Automation Workspace

The **Nodes** page (`/nodes`) is a project-scoped Graph v2 authoring and operations workspace backed by the canonical node-flow repository. Select a project before using it: the page does not request a flow library, credential metadata, publications, or run history without an active project. Browser storage is not a workflow database and edits are never auto-saved locally.

The selected project's library is loaded from the backend. Creating and saving drafts writes to that project, and changing projects clears the current workspace before loading the next library. Saves include `draftRevision`; if another editor has advanced the draft, the backend returns a conflict and the page asks the operator to reload and reapply the change instead of overwriting it.

## Legacy canvas import

On the first load for a selected project, the dashboard checks the former `codeux:nodes-canvas:v1` key. When present, it translates legacy `trigger`, `agent`, and `task` kinds to `input`, `set_fields`, and `provider_prompt`, retains `condition` and `output`, remaps legacy ports, and preserves labels, positions, and non-secret canvas configuration. It then creates an **Imported Nodes Canvas** backend draft, records a project-specific migration marker, and removes the legacy graph value. A failed import leaves the value available for retry and shows a warning without preventing existing backend flows from loading.

## Governed editing

The versioned definition registry supplies the palette, executable state, typed ports, configuration and widget schemas, capabilities, credential slots, side-effect classification, and default retry/timeout policy. The inspector is rendered from the selected definition rather than a hard-coded node form. The graph stores a type/version reference, non-secret configuration, and credential ids; it never stores custom source or credential values.

Credential slots show metadata-only states such as bound, missing, or denied. Opening a slot picker loads project-visible credential metadata and secure-backend health, then assesses every candidate against the versioned definition's allowed kinds and required capabilities. Only active, configured, project-authorized candidates with compatible kind/capabilities and ready secure custody are selectable; incompatible candidates remain non-selectable with a safe policy reason. The picker never resolves credential plaintext.

Bind, replace, and remove actions persist directly from the inspector. Code UX changes only the selected slot's `{ slot, credentialId }` entry in the node's canonical `credentialBindings`, preserves sibling bindings and node data, and saves the complete graph with the loaded `draftRevision`. Removing a required binding is allowed as a draft edit, but the refreshed review immediately marks that requirement missing and blocks publication until it is satisfied.

After a successful mutation, the page refetches the canonical flow, adopts its new revision, and refreshes governed review before reporting success. If another editor advanced the draft, the optimistic conflict path loads the latest flow and review, keeps the selected node/slot workflow available, and requires the operator to choose again; it never replays the stale binding over newer edits. Authorization or compatibility denial leaves the prior binding state intact or reports the saved binding as currently denied. Graphs, requests, component state, notices, browser storage, logs, and rendered review contain credential IDs and non-secret metadata only—never stored values.

Pointer dragging uses local preview state inside the canvas and persists the final position only on pointer release. The workspace also suspends the global animated WebGL background while `/nodes` is active, which keeps canvas interaction on a bounded compositor path without changing the configured appearance on other visible routes.

Validation and dry run report structural issues, requested capabilities, credential requirements, side-effect differences, and policy findings. Dry run is review-only and does not execute nodes. Publication requires the current draft revision, a valid graph with no error-level policy findings, and all declared credential requirements bound. Publications are immutable; comparison and rollback operate on versioned snapshots.

## Executable definitions

The governed built-ins currently registered with runtime handlers are `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, `webhook_trigger`, and `output`.

Validated custom definitions may also execute after their versioned manifest and immutable artifact are registered and the custom-node runtime is configured. A palette mockup, legacy `trigger`/`agent`/`task` canvas kind, unknown type, or definition marked non-executable is a planning or unavailable definition, not an executable handler.

## Operations

Only published versions run. The debugger shows redacted run output, graph and node states, attempts, retry classifications and decisions, approval state, invocation links, timing, cancellation, and safe retry controls. Approval decisions resume or terminate the same pinned durable run. Scheduling is entered through the Scheduler page and targets a pinned or latest-published version.

Outside development builds, the workspace is exposed only when the Nodes feature flag and both node-flow backend and automation-security prerequisites are enabled. Execution also depends on the services required by a definition: for example, a configured provider for `provider_prompt`, allowed egress for `http_request`, approval and outbox services for governed email sending, webhook configuration for webhook ingress, and the custom-node runtime for registered custom definitions. Availability is not a claim that every integration is configured for production.
