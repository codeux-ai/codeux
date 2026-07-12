# Node Flows

The **Nodes** page (`/nodes`) is the project-scoped backend authoring, publication, and operations surface for canonical node flows. No selected project means no flow library, credential metadata, publications, or durable run history are requested.

## Library, Drafts, And Migration

The flow library contains backend drafts and publications owned by the active project. Saves include the loaded draft revision, so a concurrent edit produces a visible conflict and never overwrites newer work.

The former browser graph at `codeux:nodes-canvas:v1` is eligible for one import into the selected project. Code UX normalizes it to Graph v2, creates an **Imported Nodes Canvas** backend draft, and only then removes the legacy value and records a project-specific marker. A failed import remains retryable, while a successful marker prevents duplicates. Browser storage is never the ongoing workflow source of truth.

## Registry-Driven Editing And Credentials

The versioned node-definition registry supplies palette entries, typed ports, configuration and widget schemas, execution availability, capabilities, side effects, policies, and credential requirements. Selecting a definition loads its manifest and renders the inspector from that contract. Graphs reference a definition version and store non-secret configuration and credential ids; they do not contain custom-node source or resolved credentials.

Credential slots display metadata-only states such as bound, missing, or denied and can request a binding. Secret values remain behind the credential broker and are excluded from graphs and browser output.

The complete governed built-in set currently registered with executable handlers is `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, `webhook_trigger`, and `output`.

Registered custom definitions can execute only when their validated versioned manifest, immutable artifact, and custom-node runtime are available. Legacy `trigger`/`agent`/`task` canvas kinds, unknown or unregistered types, mockup entries, and definitions marked non-executable are planned or unavailable definitions, not executable handlers.

## Governance And Publication

Draft review provides structural validation, policy findings, requested permissions, side-effect review, and a non-executing dry run. Publication requires the current draft revision, a valid governed review, and all required credentials. Each publication is an immutable snapshot; comparison and rollback operate on versioned history, and only a pinned or latest-published version can execute.

## Durable Debugger And Scheduling

The debugger reads persisted flow runs, node runs, attempt history, retry classifications and decisions, approval records, invocation links, timing, and redacted input and output. Pending approvals offer **Approve & continue** and **Reject** actions. A decision continues or terminates the same pinned run, and repeated decisions return its current durable state without duplicating a governed attempt or external send. The debugger also supports cancellation and safe retry.

Use the [Scheduler](./scheduler.md) to target a pinned or latest-published version. A flow can also be attached to a project agent preset as a reusable skill; removing the attachment does not remove the flow, publications, schedules, or run history.

Rendered run payloads redact secret-shaped keys such as `apiKey`, `authorization`, `cookie`, `password`, `secret`, and `token`.

The run debugger lists durable approvals beside node attempts. A pending item offers **Approve & continue** and **Reject** actions. The decision applies to the same pinned run, and repeated clicks return its current state without sending an approved external effect twice.

## Agent Attachment

A flow can be attached to a project agent preset as a repeatable skill with a name and description. Detaching removes only that binding; the flow, its graph, schedules, and run history remain in the project.

The Nodes workspace loads the selected project's agent presets together with the selected flow's existing bindings. Already attached agents are removed from the selector. Attach and detach actions are keyboard accessible, use the governed APIs, and refresh the binding list after success. Switching projects or flows clears selection and stale attachment state. A failed load or mutation leaves known bindings visible and exposes a retry action.

The inspector displays attachment metadata only. An attached agent receives the narrow `run_attached_flow` operation, which still verifies project ownership, the binding, publication state, and credential policy without granting graph inspection, credential access, or `manage_node_flows`.

Outside development builds, `/nodes` requires the Nodes feature flag plus the node-flow backend and automation-security prerequisites. Individual definitions can additionally require provider, credential-broker, egress, approval/outbox, webhook, or custom-runtime configuration. Catalog presence and feature visibility do not assert that an integration is configured or production-ready.
