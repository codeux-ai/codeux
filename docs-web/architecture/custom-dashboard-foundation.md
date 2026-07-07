# Custom Dashboard Foundation

Custom dashboards are a persisted domain model for project-scoped dashboard generation. The foundation stores manifests, generated file bundles, data-source node graphs, validation history, and publication state, and the server-side validation runtime can now build and health-check a revision in an isolated Docker session. HTTP routes, MCP tools, and frontend UI are layered separately.

## Contracts

The shared contracts live in `src/contracts/custom-dashboard-types.ts`.

Primary records:

- `CustomDashboardRecord` stores the mutable project-scoped draft state, status, manifest, generated file bundle, source node graph, styleguide JSON, runtime metadata JSON, and active published revision id.
- `CustomDashboardRevisionRecord` stores immutable dashboard bundle snapshots. Manifest, files, source node graph, and styleguide data are copied into each revision so future draft edits do not mutate validation or publication history.
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

All dashboard JSON payloads are stored as text and hydrated through `CustomDashboardRepository`. Repository methods validate required fields, JSON-safety, project ownership, revision ownership, and publication invariants before writing.

## Repository Boundary

`src/repositories/custom-dashboard-repository.ts` owns persistence. It can:

- list dashboards by project and load a dashboard by id
- create and update draft metadata, manifests, files, source graphs, styleguides, and runtime metadata
- create immutable revisions from the current draft or explicit payloads
- create/update/delete validation sessions and mark a revision validated
- publish only validated revisions
- archive or delete dashboards

Publishing rejects unvalidated, failed, cancelled, or cross-dashboard revisions. Publishing a new validated revision replaces the prior `custom_dashboard_publications` row for the dashboard, preserving the single-active-publication invariant.

## Validation Runtime

`src/services/custom-dashboard-validation-service.ts` owns server-side validation execution. It consumes `CustomDashboardRepository`, `ProjectManagementRepository`, and `SettingsRepository` through the core dependency factory.

Validation flow:

- `startValidation(projectId, dashboardId, revisionId)` creates a validation session, materializes the immutable revision bundle under `.code-ux/runtime/custom-dashboards/<dashboardId>/<revisionId>/workspace`, and writes a generated Vite/Preact harness.
- The harness injects a read-only Code UX data bridge containing the revision manifest, source node graph, styleguide, runtime metadata, integrations, and declared `external_api` nodes.
- The service runs install/build inside Docker using the resolved `cliWorkflow.containerImage`, then creates and starts a detached serving container on an allocated localhost port.
- A validation session is marked `passed` only after install, build, start, and root URL health checks succeed. Build/start/health failures are recorded as failed validation reports with bounded log excerpts.
- Runtime metadata persists the workspace path, log path, host port, container id/name, image, validation URL path, commands, and latest error/log excerpt so dashboard routes can reuse the detached session later.

Validation does not publish or activate dashboards. A successful run only marks the revision validation status as `passed`; publication remains gated by `publishRevision`.

## Docker and Logs

Docker argument construction lives in `src/services/custom-dashboard-docker-plan.ts`. Validation containers use the configured CLI workflow image, bind-mount only the generated workspace/runtime home plus an optional setup script, and do not mount provider credential directories.

Logs are captured in the validation runtime directory and combined with bounded `docker logs` output through `getValidationLogs(sessionId, tail)`. `stopValidation` removes the detached container while preserving a passed revision report, and `removeValidation` removes the session row after container cleanup.
