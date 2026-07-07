# Custom Dashboards

Custom dashboards are project-scoped dashboard apps generated and revised by agents, then validated in a detached Docker runtime before publication. Use them when the built-in dashboard pages do not match the operational view a team needs, such as a project-specific release panel, sprint-health cockpit, or integration-status board.

## Workflow

1. Ask the Project Manager for the dashboard you want. Include the purpose, target audience, data sources, layout preferences, review criteria, and whether it should be published after validation.
2. Review the draft at `/custom-dashboards`. Drafts expose manifest JSON, generated file bundle content, source-node graph JSON, styleguide JSON, and data catalog selections.
3. Ask for changes or edit the draft before creating a revision. Draft edits do not change previous revisions or the currently published dashboard.
4. Create a revision when the draft is ready. A revision snapshots the current manifest, files, source graph, styleguide, and runtime metadata.
5. Run detached validation. Code UX builds the revision in Docker, starts a detached preview container, and health-checks the root URL.
6. Inspect validation status, logs, and the proxied preview link. Validation passes only after install, build, container start, and root health checks succeed.
7. Publish the validated revision. Publication is blocked unless the revision has a passed validation report.
8. Roll back by publishing an earlier passed revision, or archive the dashboard to clear its active publication while preserving history.

If validation fails, use the report and logs to create a new revision. Code UX rejects failed, queued, running, cancelled, missing, or mismatched validation sessions before publication state changes.

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

Project Manager agents use the `manage_custom_dashboards` MCP tool to create drafts, create revisions, validate revisions, inspect logs, publish passed revisions, archive dashboards, and read the data catalog.

The same workflow is available through the dashboard REST API:

- `GET/POST /api/projects/:projectId/custom-dashboards`
- `GET /api/projects/:projectId/custom-dashboards/data-catalog`
- `GET/PATCH/DELETE /api/custom-dashboards/:dashboardId`
- `POST /api/custom-dashboards/:dashboardId/revisions`
- `POST /api/custom-dashboards/:dashboardId/revisions/:revisionId/validate`
- `POST /api/custom-dashboards/:dashboardId/revisions/:revisionId/publish`
- `GET /api/custom-dashboard-validations/:sessionId`
- `GET /api/custom-dashboard-validations/:sessionId/logs`
- `POST /api/custom-dashboard-validations/:sessionId/stop`
- `DELETE /api/custom-dashboard-validations/:sessionId`
- `ALL /api/custom-dashboard-validations/:sessionId/proxy{*rest}`

Published dashboards render inside a sandboxed iframe. The frame can request only declared source nodes through the Code UX bridge, and the parent dashboard returns data through same-origin API calls.
