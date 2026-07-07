# System Runtime

Configures dashboard port and runtime logging behavior for the local Code UX process.

## What It Controls

Dashboard port controls the HTTP listener; console and debug-file levels control log verbosity.

## Recommended Defaults

Keep port 4444 and info/error logging for daily use; raise verbosity only while debugging.

## Risks And Gotchas

Changing the port requires reconnecting clients, and debug logging may write large local files.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-system-runtime`. The Settings card header links directly to this published subpage.

## Related Docs

- [Operations Runbook](../../operations/runbook.md)
- [Logging and Correlation IDs](../../operations/logging-and-correlation.md)
