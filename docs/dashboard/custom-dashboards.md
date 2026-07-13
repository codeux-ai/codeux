# Custom Dashboards

Custom dashboards are project-scoped dashboard apps generated and revised by agents, then validated in a detached Docker runtime before publication. Use them when the built-in dashboard pages do not match the operational view a team needs, such as a project-specific release panel, sprint-health cockpit, or integration-status board.

The source of truth is the Code UX database. Drafts stay mutable, revisions are immutable snapshots, validation sessions record build/runtime results, and publication is a single active pointer to one validated revision.

## User Workflow

1. Ask the Project Manager for the dashboard you want. Include the purpose, target audience, data sources, layout preferences, review criteria, and whether the dashboard should be published after validation.
2. Review the draft in the dashboard workspace at `/custom-dashboards`. The draft includes editable manifest JSON, generated file bundle content, source-node graph JSON, styleguide JSON, and data catalog selections.
3. Ask for changes or edit the draft before creating a revision. Draft edits do not change previous revisions or the currently published dashboard.
4. If the manifest declares credential slots, review them through the credential-binding management surface. Bind each required slot to a compatible credential ID; no secret value is entered into the dashboard draft or generated code.
5. Create a revision when the draft is ready. A revision snapshots the current manifest, file bundle, source graph, styleguide, runtime metadata, and credential-ID bindings.
6. Run detached validation for the revision. Code UX reviews bindings before it materializes the bundle, builds it in Docker, starts a detached preview container, and health-checks the root URL.
7. Inspect validation status, logs, and the proxied preview link. Validation passes only after credential policy, install, build, browser artifact capture, container start, and root health checks succeed. A passed validation does not publish by itself.
8. Publish the validated revision. Publication rechecks credential metadata and requires `validationStatus: "passed"` with a valid validation report. Publishing another passed revision is the rollback path.
9. Archive dashboards you no longer want active. Archiving clears the active publication and marks the dashboard archived while preserving revision and validation history.

If validation fails, use the report and logs to create a new revision. Do not publish around the failure; the repository rejects failed, queued, running, cancelled, missing, or mismatched validation sessions before publication state changes. When a dashboard is already published, validating later drafts keeps the active published dashboard open, and validation sessions for the active published revision do not replace its published validation snapshot.

## Agent Workflow

Project Manager agents should use the `manage_custom_dashboards` MCP surface rather than writing generated code into `dashboard/src`.

Recommended sequence:

1. Gather missing requirements for purpose, audience, source data, style, accessibility, and publication intent.
2. Call `data_catalog` for the project when reusing existing custom-dashboard source declarations.
3. Call `create` or `update` with a complete manifest, file bundle, source-node graph, styleguide, and runtime metadata.
4. Call `list_credential_slots` when the manifest declares slots. Select only candidate credential IDs reported compatible, then call `bind_credential` with the current `expectedBindingRevision` and complete the human-approval flow. Use `unbind_credential` before changing a bound slot's policy.
5. Call `create_revision` to snapshot the draft and binding IDs.
6. Call `validate_revision`, then poll `validation_status` and read `validation_logs` when the session is not passed.
7. Repair failures by updating the draft or binding metadata and creating a new revision.
8. Call `publish_revision` only after validation passed. Include `validationSessionId` when publishing from the session just reviewed.
9. Use `archive` only after human approval; the action follows the standard destructive-action approval flow.

## Data-Source Node Graph

Each dashboard draft and revision can declare a `sourceNodeGraph`:

```json
{
  "nodes": [
    { "id": "execution", "type": "project_dashboard_data", "title": "Project execution" },
    { "id": "stats", "type": "stats", "title": "Seven-day stats", "config": { "window": "7d" } }
  ],
  "edges": [],
  "metadata": {}
}
```

Nodes have `id`, `type`, `title`, and optional JSON `config`. Edges have `fromNodeId`, `toNodeId`, and an optional `id`. The graph records the data the generated dashboard expects; it is also used by the in-app viewer to decide which source requests are allowed.

Supported user-level source types:

| Source type | Runtime behavior |
| --- | --- |
| `project_dashboard_data`, `project_dashboard`, `dashboard_data` | Reads project execution data from `GET /api/projects/:projectId/execution`. |
| `stats`, `project_stats` | Reads project stats from `GET /api/projects/:projectId/stats`; `config.window` selects the stats window when present, otherwise `7d` is used. |
| `telemetry`, `overview_telemetry` | Reads overview telemetry from `GET /api/telemetry/overview`. |
| `integrations_metadata`, `integrations` | Returns only the non-secret metadata declared on the source node. It does not expose provider credentials or effective settings secrets. |
| `external_api` | Placeholder only in the in-app viewer. It is declared in the graph and validation bridge, but arbitrary external calls are not proxied and return an unavailable-source error. |

Unsupported source types return an explicit unavailable-source error. Generated dashboards should handle these errors visibly instead of assuming all declared data is available.

## REST API Surface

Custom dashboard routes are registered with the dashboard server:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/custom-dashboards` | List dashboards for a project. |
| `POST` | `/api/projects/:projectId/custom-dashboards` | Create a mutable draft. |
| `GET` | `/api/projects/:projectId/custom-dashboards/data-catalog` | Return project dashboard summaries and declared source nodes. |
| `GET` | `/api/custom-dashboards/:dashboardId` | Return a dashboard plus revisions. |
| `PATCH` | `/api/custom-dashboards/:dashboardId` | Update mutable draft fields. |
| `DELETE` | `/api/custom-dashboards/:dashboardId` | Archive the dashboard and clear active publication. |
| `POST` | `/api/custom-dashboards/:dashboardId/revisions` | Create an immutable revision from the draft or supplied overrides. |
| `POST` | `/api/custom-dashboards/:dashboardId/revisions/:revisionId/validate` | Start a detached validation session. Body may include `projectId`; otherwise the server resolves it from the revision. |
| `POST` | `/api/custom-dashboards/:dashboardId/revisions/:revisionId/publish` | Publish a validated revision, optionally with `validationSessionId`. |
| `GET` | `/api/projects/:projectId/custom-dashboards/:dashboardId/credential-bindings?revisionId=...` | Review draft or revision slots, current bindings, backend health, and bounded compatible credential metadata. |
| `PUT` | `/api/projects/:projectId/custom-dashboards/:dashboardId/credential-bindings` | Bind or replace one slot using `slotId`, `credentialId`, and `expectedBindingRevision`. |
| `DELETE` | `/api/projects/:projectId/custom-dashboards/:dashboardId/credential-bindings/:slotId` | Unbind one slot using `expectedBindingRevision`. |
| `GET` | `/api/custom-dashboard-validations/:sessionId` | Read validation session status and runtime metadata. |
| `GET` | `/api/custom-dashboard-validations/:sessionId/logs?tail=200` | Read bounded validation and container logs. |
| `POST` | `/api/custom-dashboard-validations/:sessionId/stop` | Stop the detached validation container. |
| `DELETE` | `/api/custom-dashboard-validations/:sessionId` | Remove a validation session after cleanup. |
| `ALL` | `/api/custom-dashboard-validations/:sessionId/proxy{*rest}` | Same-origin proxy to the detached validation runtime. |
| `ALL` | `/api/custom-dashboards/validation-sessions/:sessionId/proxy{*rest}` | Backward-compatible validation proxy route. |

The binding routes are credential-management routes: authenticated remote callers require `credential_admin`, project access, and enabled remote credential management. Stale binding revisions return `409`; incompatible credential selection returns `403`. Publication first repeats metadata-only binding review, then applies the repository validation gate. Active publications remain the opening source of truth while later validation sessions run.

## MCP Surface

The dedicated MCP tool is `manage_custom_dashboards` and is available to the project-manager runtime role. It supports:

- `list`, `get`, `create`, `update`
- `create_revision`
- `validate_revision`, `validation_status`, `validation_logs`
- `publish_revision`
- `archive`
- `data_catalog`
- `list_credential_slots`, `bind_credential`, `unbind_credential`

Credential actions use `projectId`, `dashboardId`, `slotId`, `credentialId`, and `expectedBindingRevision`; an optional `revisionId` reviews an immutable snapshot. Bind and unbind require the normal stateful human-approval handshake. They reject secret, header, environment, and other undeclared fields. Other important fields include `sessionId`, `validationSessionId`, `title`, `description`, `manifest`, `fileBundle`, `sourceNodeGraph`, `styleguide`, `runtimeMetadata`, `tail`, and `approval`.

The dashboard chat JSON-action bridge also understands the legacy `custom_dashboards` management domain, but agents should prefer the dedicated MCP tool when it is available.

## Validation Runtime

Validation sessions move through `queued`, `building`, `running`, `passed`, `failed`, or `cancelled`.

During validation, Code UX:

- performs metadata-only compatibility review for every bound slot and every required slot
- creates a validation session row and runtime directory under the selected project
- writes the generated bundle plus a known Vite/Preact harness
- injects a read-only `codeUxDataBridge` / `CodeUXCustomDashboard` object
- runs install and build in Docker using the resolved CLI workflow image
- persists the built Vite `dist` files on the validated revision as the published-viewer artifact
- starts a detached preview container on an allocated localhost port
- health-checks the root URL before marking the session passed
- records workspace path, log path, container id/name, host port, validation proxy path, commands, and log excerpts in runtime metadata

Required missing bindings and bound credentials that are missing, revoked, inaccessible, unconfigured, wrong-kind, missing capabilities, or blocked by unavailable/insecure key custody fail with slot-specific issues before workspace creation. Optional unbound slots remain valid. No custom-dashboard path resolves secret plaintext: credential values and binding IDs stay out of generated source, file bundles, bridge files, Docker arguments and mounts, validation reports and logs, viewer records, iframe configuration, and browser messages. Dedicated credential-binding management responses may return credential IDs and non-secret metadata so operators and agents can select them.

Stopping a validation session removes the detached container. It does not invalidate a passed revision report. Removing a validation session deletes the session row after cleanup; the revision's validation metadata remains the publication gate.

## Published Viewer and Rollback

The in-app viewer renders only published dashboards whose active `publishedRevisionId` points to a revision with a passed validation report. For the default `src/dashboard.tsx` draft and other TSX/Preact revisions validated through the harness, the viewer uses the persisted Vite `dist` artifact instead of the source entry file, so publication does not depend on the detached validation container still running. Generated code runs inside a sandboxed iframe document and talks to the parent app through a constrained `postMessage` bridge. The parent serves only declared source-node requests.

Rollback is publish-based: select an earlier passed revision and publish it again. The publication pointer moves back to that immutable revision. Archive is the safe removal path when no dashboard should be active; it clears the publication pointer while preserving history.
