# Dashboard notification feed

The dashboard exposes a read-only cross-project notification queue at `GET /api/notifications`.

The endpoint combines active open or claimed attention items with the newest unrepresented execution failures, automatic system stops, and system errors. Active attention takes precedence over equivalent task or sprint execution signals, while resolved, dismissed, and expired attention is omitted.

Every notification includes:

- a stable ID, kind, and severity
- a safe summary, detailed reason, and next-step instructions
- project and sprint identity
- optional task identity
- source run, dispatch, event, or attention IDs
- direct links to the relevant dashboard context
- created and updated timestamps

Sprint-level notifications have no task context. The response is `{ notifications: [], updatedAt: null }` when nothing is actionable.

The feed does not return raw execution payloads, provider credentials, or session metadata. It is refreshed through the existing `overview.telemetry.updated` realtime invalidation path and does not mutate attention state when read.
