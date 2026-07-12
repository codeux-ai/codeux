# Custom Dashboards

Custom dashboards are project-scoped dashboard apps generated and revised by agents, then validated in a detached Docker runtime before publication. Use them when the built-in dashboard pages do not match the operational view a team needs, such as a project-specific release panel, sprint-health cockpit, or integration-status board.

## Workflow

1. Ask the Project Manager for the dashboard you want. Include the purpose, target audience, data sources, layout preferences, review criteria, and whether it should be published after validation.
2. Review the draft at `/custom-dashboards`. Typed tabs cover manifest fields, normalized routes, TypeScript/TSX/CSS and legacy file entries, source nodes, credential slots and bindings, and catalog selections. Advanced JSON remains available for complete snapshots.
3. Ask for changes or edit the draft before creating a revision. Draft edits do not change previous revisions or the currently published dashboard.
4. Create a revision when the draft is ready. A revision snapshots the current manifest, files, source graph, credential bindings, route definitions, styleguide, and runtime metadata.
5. Run detached validation. Code UX builds the revision in Docker, captures the browser-ready Vite artifact, starts a detached preview container, and health-checks the root URL.
6. Inspect validation status, logs, and the proxied preview link. Validation passes only after install, build, artifact capture, container start, and root health checks succeed.
7. Publish the validated revision. Publication is blocked unless the revision has a passed validation report.
8. Roll back by publishing an earlier passed revision, or archive the dashboard to clear its active publication while preserving history.

If validation fails, use the report and logs to create a new revision. Code UX rejects failed, queued, running, cancelled, missing, or mismatched validation sessions before publication state changes. When a dashboard is already published, validating later drafts keeps the active published dashboard open, and validation sessions for the active published revision do not replace its published validation snapshot.

Dashboard bundles can use individualized Preact components, strict TypeScript/TSX route entries, CSS, and Tailwind v4 utilities. List every source and stylesheet in `manifest.filePaths`; route `entryFile` values must name declared TypeScript/TSX files. Code UX supplies the package manifest and Vite, TypeScript, and Tailwind configuration. User package files, install scripts, build configuration, arbitrary dependencies, undeclared or oversized files, unsafe paths, and embedded credential literals fail validation before any build runs.

## Data Sources

Custom dashboards declare a `sourceNodeGraph` with nodes, edges, and optional metadata. Nodes have `id`, `type`, `title`, and optional JSON `config`.

| Source type | Runtime behavior |
| --- | --- |
| `project_dashboard_data`, `project_dashboard`, `dashboard_data` | Reads project execution data. |
| `stats`, `project_stats` | Reads project stats. `config.window` selects the stats window when present. |
| `telemetry`, `overview_telemetry` | Reads overview telemetry. |
| `integrations_metadata`, `integrations` | Returns only non-secret metadata declared on the source node. |
| `external_api` | Reads declared routes through the server source gateway. Hosts, methods, ports, content types, redirects, timeouts, rate limits, and response sizes remain server-controlled; credential values never enter the viewer. |

Generated dashboards should handle unavailable-source errors visibly. External API connectors are not fully available through the in-app viewer yet.

### Credential slots and bindings

Source nodes may declare up to 32 credential slots with a stable slot identifier, label, allowed credential kinds, and required capability. Draft bindings contain only a declared slot and a project-accessible credential ID. Code UX verifies project scope, active/configured status, kind, and capability, then records a stable `custom-dashboard:<dashboard-id>:<slot>` server binding. Responses expose non-secret credential metadata only, and revisions retain their binding snapshot when a draft is rebound.

The workspace renders only credential metadata. Bind writes `{ slot, credentialId }`; rotate and revoke use project-scoped credential broker routes. A rotated value is write-only, is cleared after the request, and never enters generated code, dashboard JSON, logs, iframe configuration, or share URLs. Revoke requires confirmation.

### Route definitions

Drafts may declare up to 32 metadata-only routes. Every route has a normalized local path, label, bundle-relative entry file listed in the manifest, and optional bounded JSON metadata. Schemes, query strings, fragments, traversal, filesystem paths, script URLs, duplicate normalized paths, and host-app route prefixes are rejected. Revisions retain their route snapshot when draft routes change.

## Published Subpage Routing

Share links use `/custom-dashboards?dashboard=<id>&mode=viewer&route=<normalized-path>`. The host restores deep links, updates history for route controls, and handles browser back/forward. Unknown paths fall back to the root or first declared route.

The sandbox uses dependency-free hash history because its `srcdoc` has an opaque origin. The frozen bridge exposes `routePath` and `navigate(path, { replace? })`, emits `codeux:dashboard-route` in the frame, and sends route changes through the existing frame/session-checked message channel. Generated code must use this bridge and cannot import host application modules. Route-less direct HTML and browser-JavaScript bundles remain compatible at `/`.

Validation previews and published viewers use the same `/api/custom-dashboard-runtime/source` boundary. Requests must identify the owning project/dashboard/revision, an active publication or matching validation session, a declared source, and any requested route, credential slot, and capability. External credentials resolve only on the server and are never included in generated bridge payloads.

An external node declares its fixed `baseUrl`, explicit `allowedHosts`, and `routes` with allowed methods. Optional port, content-type, timeout, redirect, response-size, and rate-limit settings remain bounded by the runtime. Dashboard code calls `readSource` with the declared source and route; it cannot ask the gateway to fetch an arbitrary URL.

## Agent and API Notes

Project Manager agents use the `manage_custom_dashboards` MCP tool to create drafts, create revisions, validate revisions, inspect logs, publish passed revisions, archive dashboards, and read the data catalog.

The same workflow is available through the dashboard REST API:

- `GET/POST /api/projects/:projectId/custom-dashboards`
- `GET /api/projects/:projectId/custom-dashboards/data-catalog`
- `GET/PATCH/DELETE /api/custom-dashboards/:dashboardId`
- `POST /api/custom-dashboards/:dashboardId/revisions`
- `POST /api/custom-dashboards/:dashboardId/revisions/:revisionId/validate`
- `POST /api/custom-dashboards/:dashboardId/revisions/:revisionId/publish`
- `POST /api/custom-dashboards/:dashboardId/runtime/halt`
- `POST /api/custom-dashboards/:dashboardId/runtime/resume`
- `GET /api/custom-dashboard-validations/:sessionId`
- `GET /api/custom-dashboard-validations/:sessionId/logs`
- `POST /api/custom-dashboard-validations/:sessionId/stop`
- `DELETE /api/custom-dashboard-validations/:sessionId`
- `ALL /api/custom-dashboard-validations/:sessionId/proxy{*rest}`

Published dashboards render inside a sandboxed iframe. For TSX/Preact drafts such as the default `src/dashboard.tsx` bundle, the viewer uses the persisted validation artifact instead of the source entry file, so it can open after publication even when the detached validation preview is gone. The frame can request only declared source nodes through the Code UX bridge, and the parent dashboard returns data through same-origin API calls.

The viewer shows loading until the session-bound readiness message arrives. A crash, unhandled rejection, empty document, or readiness timeout produces one bounded halt report and a visible error without unmounting the Code UX shell. Halted dashboards offer validated resume and revision selection for publish-based rollback. Failed validation returns to logs, draft repair, a new revision, and revalidation; archived and unpublished dashboards never execute.
