# Node Flows Dashboard

The **Nodes** page (`/nodes`) is the project-scoped authoring and operations surface for canonical node flows. No selected project means no flow library, credentials, publications, or run history are requested.

## Library and drafts

The library loads through `GET /api/projects/:projectId/node-flows`. Drafts are created through `POST /api/projects/:projectId/node-flow-drafts` and saved through revision-checked `PATCH /api/node-flow-drafts/:flowId`. A stale revision produces a visible conflict and never overwrites newer work.

The former browser canvas is eligible for one project-specific import. After a successful backend draft creation, its graph value is removed and a migration marker prevents duplicates. Browser storage is never used for ongoing persistence.

## Registry and credentials

`GET /api/node-flow-catalog` is the T01 source for palette entries, typed ports, widget schemas, execution availability, capabilities, side effects, policies, and credential requirements. Selecting a definition loads its full versioned manifest. Graphs reference a definition version and do not contain custom-node source.

The inspector displays credential slots as bound, missing, or denied and can request a binding. It displays credential metadata only; secret values never enter the graph or dashboard output.

## Governance and publication

T06 draft endpoints provide structural validation, policy findings, requested permissions, side-effect review, dry runs, immutable publication, version comparison, and rollback. Dry runs never execute nodes. Only a valid draft with satisfied required credentials can publish, and only published versions execute.

## Run debugger and scheduling

The debugger reads persisted runs, node runs, and attempt history. It overlays node state, shows retry reasons and decisions, links invocation ids, reports timing, supports cancellation and safe retry, and redacts secret-shaped values before rendering. Scheduling is entered through `/scheduler`; scheduler execution also resolves published versions.

The layout stacks on small screens, preserves keyboard-visible focus, labels loading/error/empty states, and bounds long histories and JSON output with scrolling.
