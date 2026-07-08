# Restart Behavior

Chooses how active sprints and interrupted provider invocations are reconciled after the app restarts.

## What It Controls

Sprint policy continues, pauses, or cancels active sprints; invocation policy continues, cancels, or restarts interrupted work.

## Recommended Defaults

Continue sprints and continue invocations for local development; pause when you want manual review after downtime.

## Risks And Gotchas

Restarting interrupted work can duplicate provider effort if the previous CLI run was still externally active.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#restart-behavior`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Operations Runbook](../../operations/runbook.md)
- [Atomic Sprint Loop](../../sprint-loop/atomic-loop.md)
