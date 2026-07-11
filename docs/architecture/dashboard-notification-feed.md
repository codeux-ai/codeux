# Dashboard Notification Feed

## Purpose

The dashboard notification feed is a read-only, cross-project projection of actionable execution state. It combines active project attention with recent execution failures so a dashboard client can show one bounded queue without selecting or mutating a project.

## API

`GET /api/notifications` returns:

- `notifications`: deterministically ordered notification records
- `updatedAt`: the newest record timestamp, or `null` for an empty feed

Each record includes a stable ID, kind, severity, safe summary and instructions, project/sprint/task identity, source IDs, timestamps, and prebuilt project, sprint, task, and Live-page links. Sprint-level records keep task fields and task links `null`.

## Sources and precedence

`ExecutionRepository.getDashboardNotifications()` delegates to `DashboardNotificationQuery`, which reads existing tables only:

- active `open` and `claimed` rows from `project_attention_items`
- failed or blocked `task_dispatches`
- failed `sprint_runs`
- selected task and sprint error events
- system-originated sprint pause and cancellation events

An active attention item is authoritative for its task or sprint-run scope. Equivalent execution fallbacks are suppressed, and remaining fallbacks are reduced to the newest deterministic record per scope and signal family. Resolved, dismissed, and expired attention rows are excluded.

## Security boundary

The projection never returns raw attention or event payloads, provider/session metadata, or credential fields. User-visible text is normalized, bounded, and redacts common authorization, token, password, secret, and credential-in-URL forms. Event payload parsing is limited to selected reason and error-message fields.

## Realtime refresh

No notification-specific persistence or polling service exists. Attention and execution mutations continue to schedule the existing `overview.telemetry.updated` realtime event. Dashboard clients refresh `/api/notifications` when that cross-project invalidation arrives; reading the feed never claims, resolves, dismisses, or expires attention.

The top-nav notification projection subscribes to `overview` even when no project is selected, and adds the selected `project:<id>` scope for scheduler invalidations. Feed records are mapped to semantic dashboard severity and icon states, retain structured project/sprint/task/reason/instruction details, and expose direct task, Live, sprint, or project targets. The client preserves each selected server-owned link and its query parameters verbatim; Tasks, Live, Sprints, and Projects consume the supplied project and sprint scope so cross-project actions update the shared dashboard selection before showing the target context. Browser-local read and dismiss state keys include the record's `updatedAt`, so an unchanged record remains stable across refreshes while a materially refreshed intervention becomes visible and unread again.

## Primary files

- `src/contracts/dashboard-notification-types.ts`
- `src/repositories/execution/dashboard-notification-query.ts`
- `src/server/runtime-routes.ts`
