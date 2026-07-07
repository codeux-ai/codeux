# Database Settings

Manages local SQLite retention and maintenance for runtime activity data.

## What It Controls

Pruning removes old completed activity, retention sets the age window, and vacuum compacts storage on startup.

## Recommended Defaults

Keep pruning and vacuum enabled unless you are preserving local forensic history.

## Risks And Gotchas

Short retention can remove useful troubleshooting detail; disabling pruning can grow the local DB quickly.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#database-settings`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Configuration and Storage](../configuration-and-storage.md)
- [Operations Runbook](../../operations/runbook.md)
