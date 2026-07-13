# Custom Dashboard Foundation

Custom dashboards are a persisted domain model for project-scoped dashboard generation. The foundation stores manifests, generated file bundles, data-source node graphs, validation history, and publication state, and the server-side validation runtime can build and health-check a revision in an isolated Docker session. HTTP routes, MCP tools, and the Preact management workspace are thin layers over the repository and validation-service boundaries.

## Contracts

The shared contracts live in `src/contracts/custom-dashboard-types.ts`.

Primary records:

- `CustomDashboardRecord` stores the mutable project-scoped draft state, status, manifest, generated file bundle, source node graph, safe routes, credential bindings, styleguide JSON, runtime metadata JSON, and active published revision id.
- `CustomDashboardRevisionRecord` stores immutable dashboard bundle snapshots. Manifest, files, source node graph, safe routes, credential bindings, and styleguide data are copied into each revision so future draft edits do not mutate validation or publication history.
- `CustomDashboardValidationSessionRecord` stores validation attempts for a revision, including queued/building/running/passed/failed/cancelled status, validation report JSON, runtime metadata, and timestamps.
- `CustomDashboardManifest` describes the generated dashboard bundle with schema version, title, entry file, file paths, optional data-source graph, and metadata.

Dashboard status values are `draft`, `validating`, `validated`, `published`, `rejected`, and `archived`. Validation status values are `queued`, `building`, `running`, `passed`, `failed`, and `cancelled`.

## Persistence

SQLite tables are created in both the initial schema and startup migrations:

| Table | Purpose |
| --- | --- |
| `custom_dashboards` | Current mutable project-scoped draft state, including manifest JSON, file bundle JSON, source node graph JSON, styleguide JSON, runtime metadata JSON, status, and timestamps. |
| `custom_dashboard_revisions` | Immutable revision snapshots with copied manifest, files, source graph, styleguide, runtime metadata, validation status/report, validated timestamp, and revision number. |
| `custom_dashboard_validation_sessions` | Validation history for revisions, including status transitions, report JSON, runtime metadata, and start/finish timestamps. |
| `custom_dashboard_publications` | The active publication pointer for a dashboard. The table is keyed by `dashboard_id`, so each dashboard has at most one active published revision. |

`custom_dashboards` also carries runtime state independently from publication: `active` or `halted`, a bounded redacted halt reason, the halted revision, halt/resume/update timestamps, and JSON recovery metadata. Existing rows migrate to `active` without changing their publication pointer.

All dashboard JSON payloads are stored as text and hydrated through `CustomDashboardRepository`. Repository methods validate required fields, JSON-safety, project ownership, revision ownership, and publication invariants before writing.

Credential slots live on source nodes. Bindings are authorized against credential metadata without resolving plaintext, persisted under stable dashboard/slot binding keys, and serialized with metadata only. Route definitions are normalized, bounded, bundle-relative metadata; executable URLs, traversal, and host-app route prefixes are rejected before persistence.

## Repository Boundary

`src/repositories/custom-dashboard-repository.ts` owns persistence. It can:

- list dashboards by project and load a dashboard by id
- create and update draft metadata, manifests, files, source graphs, styleguides, and runtime metadata
- create immutable revisions from the current draft or explicit payloads
- create/update/delete validation sessions and mark a revision validated
- publish only validated revisions
- halt the current published revision with compare-and-set revision checks, and explicitly resume or roll back only to a passed revision
- archive or delete dashboards

Publishing rejects unvalidated, failed, cancelled, or cross-dashboard revisions. Publishing a new validated revision replaces the prior `custom_dashboard_publications` row for the dashboard, preserving the single-active-publication invariant.

A runtime halt never deletes or rewrites the immutable published revision. Source resolution and the browser viewer refuse to execute any halted dashboard, even when its publication remains valid. Repeated reports from the same frame revision are idempotent; stale-revision reports are rejected. Resume verifies the current publication and its passed validation report. A rollback from a halted revision additionally supplies the expected current publication, preventing a concurrent publication change from being overwritten.

## Validation Runtime

`src/services/custom-dashboard-validation-service.ts` owns server-side validation execution. It consumes `CustomDashboardRepository`, `ProjectManagementRepository`, and `SettingsRepository` through the core dependency factory and is exposed to dashboard routes through the dashboard lifecycle dependency object.

Validation flow:

- `startValidation(projectId, dashboardId, revisionId)` creates a validation session, materializes the immutable revision bundle under `.code-ux/runtime/custom-dashboards/<dashboardId>/<revisionId>/workspace`, and writes a generated Vite/Preact harness.
- Validation derives an ephemeral server-controlled build manifest. It accepts at most 128 declared `.ts`, `.tsx`, and `.css` files (512 KiB per file and 2 MiB total), requires TypeScript/TSX primary and route entries, and imports declared CSS entries through the harness. Tailwind v4 is compiled by the server-owned `@tailwindcss/vite` configuration.
- User package manifests, lockfiles, npm configuration, Vite/TypeScript/PostCSS/Tailwind configuration, undeclared files, traversal paths, raw secret literals, and unsupported source types are rejected before Docker starts. Raw credential-shaped fields, static credential headers, bearer literals, and embedded source credentials are also rejected at repository normalization, before any draft or unvalidated revision can persist or reach REST, MCP, catalog, revision, bridge, or runtime payloads. Declarative credential-slot `headerName` and `scheme` metadata remains valid. The generated package uses only fixed Preact, Vite, TypeScript, Tailwind, and Tailwind Vite integration dependencies; lifecycle scripts are disabled.
- Validation runtime paths are canonicalized under the selected project before filesystem reads or writes, including bundle materialization, logs, and persisted viewer artifacts.
- The harness injects a read-only Code UX data bridge containing non-secret revision metadata and a source client bound to the validation session; credential bindings and values are excluded.
- The service runs TypeScript checking plus install/build inside Docker using the resolved `cliWorkflow.containerImage`, then creates and starts a detached serving container on an allocated localhost port. Both containers use a non-root host mapping, no-new-privileges, dropped capabilities, and CPU, memory, process, file-descriptor, command-time, and output limits. Only the validation workspace and isolated runtime home are mounted; provider credentials, setup scripts, host homes, databases, and project credential stores are excluded.
- A validation session is marked `passed` only after install, build, start, and root URL health checks succeed. Build/start/health failures are recorded as failed validation reports with bounded log excerpts.
- Runtime metadata persists the workspace path, log path, host port, container id/name, image, validation URL path, commands, latest bounded/redacted error log excerpt, and a browser-ready bounded Vite `dist` artifact for passed revisions so the published viewer can render TSX-based drafts without a live validation container. Failed and unvalidated revisions never receive an executable viewer artifact.

Validation does not publish or activate dashboards. A successful run only marks the revision validation status as `passed`; publication remains gated by `publishRevision`. Publication accepts either a revision already marked `passed` with a valid report or an explicit passed validation session for that revision. Failed, queued, running, cancelled, missing, or cross-revision validation sessions are rejected before the publication pointer changes.

## REST and MCP Surface

Dashboard HTTP routes live in `src/server/custom-dashboard-routes.ts` and are registered with the existing dashboard route groups. They are thin adapters over `CustomDashboardRepository` and `CustomDashboardValidationService`:

- project routes list/create dashboards and expose a data catalog at `/api/projects/:projectId/custom-dashboards/data-catalog`
- dashboard routes get/update/archive a dashboard and create revisions
- validation routes start validation, read status/logs, stop/remove validation sessions, and publish revisions
- same-origin runtime mutation routes halt and explicitly resume a published dashboard
- validation proxy routes forward same-origin requests to a running validation host port when the session runtime metadata exposes one
- `/api/custom-dashboard-runtime/source` is the shared typed server source gateway for validation previews and active published revisions; it authorizes declared sources/routes, enforces bounded external egress policy, and resolves credential values through the server-side broker without placing them in iframe payloads

The MCP management surface is `manage_custom_dashboards` in `src/mcp/management/custom-dashboard-actions.ts`. It supports `list`, `get`, `create`, `update`, `create_revision`, `validate_revision`, `validation_status`, `validation_logs`, `publish_revision`, `archive`, and `data_catalog`. `archive` follows the same approval fingerprint flow as other destructive management actions.

Project Manager and dashboard chat prompts steer user-created dashboard requests through this management surface. Agents should gather missing purpose, data-source, styleguide, layout, and publication intent details, then create or update drafts and revisions with complete manifests, file bundles, source node graphs, styleguide tokens, runtime metadata, accessibility notes, and validation expectations. Generated bundles are dependency-free Preact/Tailwind-compatible validation-harness code and must not be written directly into `dashboard/src`.

After a revision is created, agents should start validation and wait for a passed validation status before publishing. Failed validation is repaired by creating a new revision from the validation report/logs rather than overriding the active published dashboard.

Validation proxy requests reuse the preview proxy boundary: request bodies are capped at 5 MB, dashboard credentials and hop-by-hop/proxy/control headers are stripped before upstream forwarding, `Origin`/`Referer`/`Sec-Fetch-Site` are normalized to the loopback upstream, and upstream `Set-Cookie`, CSP, CSP report-only, and `X-Frame-Options` response headers are removed before returning to the dashboard origin.

## Frontend Workspace

The Preact workspace is reachable at `/custom-dashboards` and is lazy-loaded from `dashboard/src/v2/CustomDashboardsPage.tsx`. It is project-scoped through the existing selected-project context and uses typed helpers in `dashboard/src/v2/lib/custom-dashboard-api.ts` for list/get/create/update, revision creation, detached validation sessions, logs, publication, archiving, and data catalog lookup.

The page manages typed mutable controls for:

- manifest fields and declared file paths
- generated TypeScript, TSX, CSS, direct HTML, and browser-JavaScript file entries
- normalized route definitions
- source nodes, credential slots, capability requirements, and metadata-only credential bindings
- data catalog source selection
- complete manifest, routes, bindings, graph, file bundle, and styleguide JSON through the advanced escape hatch

Draft edits remain persisted bundle text sent back through API calls; generated dashboard code is not imported from `dashboard/src` at runtime. Revisions are created as immutable snapshots, then validated through a detached session. The validation panel shows build/start/health stage state, renders refreshed logs, links to the validation proxy preview, and disables publication until the selected revision has a passed validation report or a matching passed validation session. Once a dashboard has an active publication pointer, later validation sessions for draft revisions do not demote the dashboard from `published`, and later validation sessions for the active published revision do not replace its stored validation snapshot.

Published dashboards open through `CustomDashboardViewer`, which resolves the active `publishedRevisionId` from the loaded dashboard detail and renders only when the dashboard status is `published`, the published revision exists, and that revision still has a valid passed validation report. Draft, rejected, archived, unvalidated, and missing-publication states render a local blocked panel with the last validation report and a return-to-editor action rather than executing the bundle.

Each iframe instance reports readiness once and reports `error`, `unhandledrejection`, missing readiness, or an unusable document once. The parent bounds and redacts the reason, persists a halt against the exact published revision, and catches persistence failures so generated code cannot crash the Preact shell. Startup recovery preserves all halted rows and records recovery metadata; it marks stale active validation sessions failed when their managed container is missing, stopped, or unhealthy without invalidating an already valid publication.

`custom-dashboard-router.ts` owns host-side normalization, query-state parsing, route selection, deep-link creation, and history updates. Viewer URLs carry dashboard, mode, and normalized route state; `popstate` restores back/forward navigation. Inside the opaque-origin `srcdoc` frame, the bootstrap uses dependency-free hash history, exposes frozen `routePath`/`navigate` bridge members, and exchanges route changes only through the existing frame-window, opaque-origin, and bridge-session checks. Unknown routes fall back to root or the first declared route, and route-less legacy bundles continue at `/`.

The viewer uses a sandboxed iframe `srcdoc` document so generated dashboard code never runs inside the main Preact bundle. For validated TSX/Preact revisions, it prefers the persisted Vite `dist` viewer artifact from revision runtime metadata and inlines the artifact's HTML, CSS, and JavaScript into the frame document. Older direct HTML or browser-ready JavaScript entry files still render through the previous entry-file path. The frame receives a frozen `codeUxDataBridge` / `CodeUXCustomDashboard` object and can request only declared sources or external routes. Published requests cross a frame-source, opaque-origin, per-frame-session `postMessage` boundary; validation harness requests carry their owning validation session. Both modes reach `CustomDashboardRuntimeService`, which verifies project/dashboard/revision ownership and active publication or session state. The runtime selects a sole required credential slot automatically, requires an explicit declared slot when required selection is ambiguous, and preserves unauthenticated access when no required slot is unresolved. It rejects invalid selection and binding metadata before egress. External credentials resolve inside `CredentialBroker.withResolvedCredentialId` and pass only as trusted headers to `EgressPolicyService`, which enforces explicit hosts, ports, methods, content types, timeouts, redirects, rate limits, and bounded bodies. Browser authorization, cookies, dashboard session headers, sensitive upstream headers, and upstream error bodies are not forwarded.

Navigation is centralized through `dashboard/src/v2/lib/navigation-items.ts`, so both the kinetic dock and sidebar expose the Dashboards destination with stable labels, tour markers, and route prefetching.

## Docker and Logs

Docker argument construction lives in `src/services/custom-dashboard-docker-plan.ts`. Validation containers use the configured CLI workflow image, bind-mount only the generated workspace/runtime home plus an optional setup script, and do not mount provider credential directories.

Logs are captured in the validation runtime directory and combined with bounded `docker logs` output through `getValidationLogs(sessionId, tail)`. `stopValidation` removes the detached container while preserving a passed revision report, and `removeValidation` removes the session row after container cleanup.
