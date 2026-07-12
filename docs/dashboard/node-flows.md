# Node Flows Dashboard

The **Nodes** page (`/nodes`) is the project-scoped authoring and operations surface for canonical node flows. No selected project means no flow library, credentials, publications, or run history are requested.

## Library and drafts

The library loads through `GET /api/projects/:projectId/node-flows`. Drafts are created through `POST /api/projects/:projectId/node-flow-drafts` and saved through revision-checked `PATCH /api/node-flow-drafts/:flowId`. A stale revision produces a visible conflict and never overwrites newer work.

The former browser canvas is eligible for one project-specific import. After a successful backend draft creation, its graph value is removed and a migration marker prevents duplicates. Browser storage is never used for ongoing persistence.

## Registry and credentials

`GET /api/node-flow-catalog` is the registry source for palette entries, typed ports, configuration and widget schemas, execution availability, capabilities, side effects, policies, and credential requirements. Selecting a definition loads its full versioned manifest. Graphs reference a definition version and do not contain custom-node source.

The inspector displays credential slots as bound, missing, or denied and can request a binding. It displays credential metadata only; secret values never enter the graph or dashboard output.

The registered governed built-ins are `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, `condition`, `switch`, `foreach`, `merge`, `delay`, `approval`, `email_draft`, `email_send`, `execute_subflow`, `webhook_trigger`, and `output`. Registered, validated custom definitions can execute when their immutable artifact and runtime are available. Legacy canvas kinds, unregistered names, and definitions marked non-executable remain planning or unavailable definitions and cannot run.

## Governance and publication

T06 draft endpoints provide structural validation, policy findings, requested permissions, side-effect review, dry runs, immutable publication, version comparison, and rollback. Dry runs never execute nodes. Only a valid draft with satisfied required credentials can publish, and only published versions execute.

## Run debugger and scheduling

The debugger reads persisted runs, node runs, attempt history, and approval decisions. Pending approvals expose keyboard-accessible **Approve & continue** and **Reject** actions. A decision continues or terminates the same pinned run, and repeated clicks return its current durable state without duplicating the governed attempt or external send. The debugger also overlays node state, shows retry reasons and decisions, links invocation ids, reports timing, supports cancellation and safe retry, and redacts secret-shaped values before rendering. Scheduling is entered through `/scheduler`; scheduler execution also resolves published versions.

The layout stacks on small screens, preserves keyboard-visible focus, labels loading/error/empty states, and bounds long histories and JSON output with scrolling.

## Agent attachments

For the selected flow, the workspace loads project-owned agent presets and existing attachments. The selector excludes agents already attached, and attach/detach buttons are native keyboard controls with visible focus treatment. Every mutation uses the governed flow attachment API and refreshes the selected flow's bindings afterward. Changing projects or flows clears the prior selection and attachment state; late responses from the old scope are ignored. Load and mutation failures leave known bindings visible and provide a retry action.

The inspector receives agent names and attachment metadata only. An attachment exposes only the narrow `run_attached_flow` capability to that project agent; execution continues to verify ownership, the binding, an immutable publication, and credential policy without exposing graph or secret material.

Outside development, `/nodes` requires the Nodes feature flag plus the node-flow backend and automation-security prerequisites. Individual definitions can require additional provider, credential-broker, egress, approval/outbox, webhook, or custom-runtime configuration; catalog presence alone does not assert production readiness for an integration.
