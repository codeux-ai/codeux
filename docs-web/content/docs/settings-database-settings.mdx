# Database Settings

Manages local SQLite retention and maintenance for runtime activity data.

> Settings area: `database-settings`
> Dashboard documentation route: `/docs/settings-database-settings`

## What This Area Is For

Manages local SQLite retention and maintenance for runtime activity data. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Pruning advances old runtime history in bounded idle-time batches, retention sets the age window,
and optional startup page reclaim releases a bounded amount of free SQLite space.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Automatic pruning | Scans and mutates at most 500 rows per table in one maintenance pass. A periodic idle sweep advances the cursor until old history converges. | Disable only when local history must be retained beyond the configured window. |
| Retention days | Applies to completed task runs, invocation trees, resolved attention items, and terminal provider sessions. Raw terminal provider activity has a one-day window because the durable execution transcript remains available. | Preserved execution invocations and their parent task history are excluded. |
| Startup vacuum | Requests at most 256 pages through SQLite incremental vacuum. Automatic maintenance never executes a full-file `VACUUM`. | Older database files that predate incremental auto-vacuum may not release file space; the request remains a safe no-op for them. |

## Recommended Configuration

Keep pruning enabled. Leave startup page reclaim disabled unless bounded free-page reclamation is
useful for the local database. Provider work always takes priority over pruning and page reclaim.
Passive WAL checkpoints still run during active provider work because they do not wait for readers
or writers; this bounds disk growth during continuously busy DAGs. Graceful shutdown performs a
final checkpoint and explicitly closes all runtime SQLite connections.

The legacy `session-tracking.db` keeps provider lifecycle, branch, and activity projections. It
retains Jules prompts for hosted usage estimation, but does not copy local CLI prompts because the
durable invocation message history already stores those in `app.db`. This avoids a second large
prompt copy for wide DAG, QA, and CI-repair sessions. The schema upgrade clears legacy local prompt
copies once while preserving Jules prompts.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Short retention can remove useful troubleshooting detail; disabling pruning can grow the local DB
quickly. Each pass is intentionally small, so a multi-gigabyte legacy history may require many idle
periodic sweeps before its on-disk live data converges. Parent rows are deleted only after bounded
child cleanup, and preserved invocation trees remain linked.

Before applying changes, check:

- Whether the value affects provider credentials, Docker runtime behavior, Git automation, memory retention, or destructive cleanup.
- Whether a project override is masking the system value you expected to change.
- Whether a running sprint needs to be paused, restarted, or allowed to finish before the new value can be observed.

## Troubleshooting

If the saved setting does not appear to take effect:

- Verify the active Settings scope in the sticky command bar.
- Check for a project or sprint override that takes precedence over the system value.
- Refresh the affected dashboard page if the setting controls a rendered surface.
- Restart the local runtime only when the setting explicitly controls startup, listener, or process-level behavior.

## Related Documentation

- [Settings overview](/docs/settings-overview)
- [Dashboard Settings](/docs/user-dashboard-settings)
- [Configuration and Storage](/docs/developer-settings-reference)
- [Operations Runbook](/docs/user-troubleshooting)
