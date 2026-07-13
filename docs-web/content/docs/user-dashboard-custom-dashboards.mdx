# Custom Dashboards

Custom dashboards are project-scoped dashboard apps generated and revised by agents, then validated in a detached Docker runtime before publication. Use them when the built-in dashboard pages do not match the operational view a team needs, such as a project-specific release panel, sprint-health cockpit, or integration-status board.

## Workflow

1. Ask the Project Manager for the dashboard you want. Include the purpose, target audience, data sources, layout preferences, review criteria, and whether it should be published after validation.
2. Review the draft at `/custom-dashboards`. Drafts expose manifest JSON, generated file bundle content, source-node graph JSON, styleguide JSON, and data catalog selections.
3. Ask for changes or edit the draft before creating a revision. Draft edits do not change previous revisions or the currently published dashboard.
4. If the manifest declares credential slots, review them through the credential-binding management surface. Bind each required slot to a compatible credential ID; no secret value is entered into the dashboard draft or generated code.
5. Create a revision when the draft is ready. A revision snapshots the current manifest, files, source graph, styleguide, runtime metadata, and credential-ID bindings.
6. Run detached validation. Code UX reviews bindings before it builds the revision in Docker, captures the browser-ready Vite artifact, starts a detached preview container, and health-checks the root URL.
7. Inspect validation status, logs, and the proxied preview link. Validation passes only after credential policy, install, build, artifact capture, container start, and root health checks succeed.
8. Publish the validated revision. Publication rechecks credential metadata and remains blocked unless the revision has a passed validation report.
9. Roll back by publishing an earlier passed revision, or archive the dashboard to clear its active publication while preserving history.

If validation fails, use the report and logs to create a new revision. Code UX rejects failed, queued, running, cancelled, missing, or mismatched validation sessions before publication state changes. When a dashboard is already published, validating later drafts keeps the active published dashboard open, and validation sessions for the active published revision do not replace its published validation snapshot.

## Data Sources

Custom dashboards declare a `sourceNodeGraph` with nodes, edges, and optional metadata. Nodes have `id`, `type`, `title`, and optional JSON `config`.

| Source type | Runtime behavior |
| --- | --- |
| `project_dashboard_data`, `project_dashboard`, `dashboard_data` | Reads project execution data. |
| `stats`, `project_stats` | Reads project stats. `config.window` selects the stats window when present. |
| `telemetry`, `overview_telemetry` | Reads overview telemetry. |
| `integrations_metadata`, `integrations` | Returns only non-secret metadata declared on the source node. |
| `external_api` | Placeholder only. Arbitrary external calls are not proxied and return an unavailable-source error. |

Generated dashboards should handle unavailable-source errors visibly. External API connectors are not fully available through the in-app viewer yet.

## Agent and API Notes

Project Manager agents use the `manage_custom_dashboards` MCP tool to create drafts, list credential slots, bind or unbind credential IDs, create revisions, validate revisions, inspect logs, publish passed revisions, archive dashboards, and read the data catalog. Credential mutations require the normal stateful human-approval handshake and an optimistic `expectedBindingRevision`.

The same workflow is available through the dashboard REST API:

- `GET/POST /api/projects/:projectId/custom-dashboards`
- `GET /api/projects/:projectId/custom-dashboards/data-catalog`
- `GET/PATCH/DELETE /api/custom-dashboards/:dashboardId`
- `POST /api/custom-dashboards/:dashboardId/revisions`
- `POST /api/custom-dashboards/:dashboardId/revisions/:revisionId/validate`
- `POST /api/custom-dashboards/:dashboardId/revisions/:revisionId/publish`
- `GET /api/projects/:projectId/custom-dashboards/:dashboardId/credential-bindings`
- `PUT /api/projects/:projectId/custom-dashboards/:dashboardId/credential-bindings`
- `DELETE /api/projects/:projectId/custom-dashboards/:dashboardId/credential-bindings/:slotId`
- `GET /api/custom-dashboard-validations/:sessionId`
- `GET /api/custom-dashboard-validations/:sessionId/logs`
- `POST /api/custom-dashboard-validations/:sessionId/stop`
- `DELETE /api/custom-dashboard-validations/:sessionId`
- `ALL /api/custom-dashboard-validations/:sessionId/proxy{*rest}`

Remote callers to credential-binding routes require the credential-administrator role, project access, and enabled remote credential management. Required missing bindings and bound credentials that are revoked, inaccessible, unconfigured, wrong-kind, missing capabilities, or blocked by unavailable key custody fail before workspace creation and are rechecked before publication. REST and MCP publication denials include sanitized slot-specific issues without credential IDs or values. Optional unbound slots remain valid.

Custom-dashboard binding is metadata-only: no secret is resolved, and credential values and binding IDs are excluded from generated files, bridges, Docker configuration, validation output, generic REST/MCP responses, iframe configuration, and browser messages. Generic response and viewer boundaries recursively redact known IDs from nested manifests, files, source graphs, runtime metadata, validation reports, and viewer artifacts. Dedicated binding-management responses may return credential IDs and non-secret metadata so operators and agents can select them.

Published dashboards render inside a sandboxed iframe. For TSX/Preact drafts such as the default `src/dashboard.tsx` bundle, the viewer uses the persisted validation artifact instead of the source entry file, so it can open after publication even when the detached validation preview is gone. The frame can request only declared source nodes through the Code UX bridge, parent and frame handlers verify the expected window source, and the parent dashboard returns data through same-origin API calls.
