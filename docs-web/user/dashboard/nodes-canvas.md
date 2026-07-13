# Nodes Canvas

The **Nodes** page (`/nodes`) is a project-scoped Graph v2 workspace backed by the Code UX node-flow APIs. Select a project to load its flow library, credential metadata, publications, and run history. Changing projects clears the current view before loading the newly selected project's records; without a selected project, the page does not request node-flow data.

## Backend drafts and conflicts

New flows and saved edits are persisted in the selected project's backend flow library. Each save includes the `draftRevision` that was loaded. If another editor has advanced that revision, Code UX reports a conflict instead of overwriting the newer draft; reload the flow and reapply the intended edit.

The former browser canvas is handled only as a one-time compatibility import. If `codeux:nodes-canvas:v1` exists when a project first loads, Code UX translates legacy kinds and ports to registered Graph v2 definitions and creates an **Imported Nodes Canvas** draft while preserving non-secret labels, positions, and configuration. A successful import records a project-specific marker and removes the old value. A failed import remains retryable and does not block existing backend flows.

Canvas dragging is previewed locally and commits one position update on pointer release. The route uses a static, context-free background while the canvas is mounted to avoid WebGL compositor pressure.

## Registry-driven editing

The backend definition registry drives the palette and inspector. Each versioned manifest declares whether it is executable, its typed input/output ports, configuration and widget schemas, credential slots, capabilities, side-effect class, default retry/timeout policy, documentation, and deprecation state. Graphs store versioned definition references, non-secret configuration, policies, and credential ids—not custom source or resolved credentials.

The governed built-ins with runtime handlers are:

| Area | Executable definitions |
| --- | --- |
| Data, AI, and HTTP | `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `output` |
| Control and transformation | `condition`, `switch`, `foreach`, `merge`, `delay`, `execute_subflow` |
| Governed effects and triggers | `approval`, `email_draft`, `email_send`, `webhook_trigger` |

Validated custom definitions can also execute after their immutable artifact and versioned manifest are registered and the custom-node runtime is available. Raw legacy `trigger`, `agent`, and `task` kinds are translated by the one-time import bridge and are not executed directly. Unknown types, mockup entries, and definitions marked non-executable remain planning or unavailable definitions.

## Credentials, review, and publication

Credential slots display metadata-only status such as bound, missing, or denied. Opening a slot picker loads project-visible credential metadata and secure-backend health, then assesses every candidate against the versioned definition's allowed kinds and required capabilities. Only active, configured, project-authorized candidates with compatible kind/capabilities and ready secure custody are selectable; incompatible candidates remain non-selectable with a safe policy reason. The picker never resolves credential plaintext.

Bind, replace, and remove actions persist directly from the inspector. Code UX changes only the selected slot's `{ slot, credentialId }` entry in the node's canonical `credentialBindings`, preserves sibling bindings and node data, and saves the complete graph with the loaded `draftRevision`. Removing a required binding is allowed as a draft edit, but the refreshed review immediately marks that requirement missing and blocks publication until it is satisfied.

After a successful mutation, the page refetches the canonical flow, adopts its new revision, and refreshes governed review before reporting success. If another editor advanced the draft, the optimistic conflict path loads the latest flow and review, keeps the selected node/slot workflow available, and requires the operator to choose again; it never replays the stale binding over newer edits. Authorization or compatibility denial leaves the prior binding state intact or reports the saved binding as currently denied. Graphs, requests, component state, notices, browser storage, logs, and rendered review contain credential IDs and non-secret metadata only—never stored values.

Agent attachments are also metadata-only. The selected project supplies the available preset names, and the selected flow supplies its current skill names and descriptions. Attach and detach refresh that governed backend state; project or flow transitions clear previous bindings and ignore obsolete requests. Agent instructions, custom source, credentials, and decrypted values are never rendered by the attachment controls.

Validation and dry run report graph issues, requested capabilities, credential requirements, side-effect differences, and policy findings. Dry run does not execute nodes. Publication requires the current draft revision, a valid graph and policy review, and all required credentials bound. Published snapshots are immutable; the workspace can compare versions or restore a prior version into a new draft revision.

## Runs and schedules

Only published versions run. The debugger shows redacted run output, flow and node status, numbered attempts, retry classifications and decisions, approvals, invocation links, timing, cancellation, and safe retry controls. Approval decisions continue or terminate the same pinned durable run rather than starting an unrelated run.

Use the [Scheduler](./scheduler.md) to schedule a pinned or latest-published flow version. Provider, HTTP, approval-gated email, webhook, and custom-node execution each require their corresponding configured runtime and security services.

Outside development builds, the workspace is available only when the Nodes feature flag, node-flow backend prerequisite, and automation-security prerequisite are enabled. These gates expose the feature; they do not assert that every external integration is configured for production.
