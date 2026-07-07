# System Database

Wipes the local Code UX database so the app returns to a clean state on reload.

## What It Controls

The hard reset action removes projects, sprints, tasks, histories, and system state.

## Recommended Defaults

Use only for local reset or unrecoverable database corruption after exporting anything needed.

## Risks And Gotchas

This deletes all local runtime state and cannot be undone from the dashboard.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#system-database`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Configuration and Storage](../configuration-and-storage.md)
- [Operations Runbook](../../operations/runbook.md)
