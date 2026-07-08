# Watch Loop

Controls whether live sprint orchestration keeps polling and how frequently it emits work.

## What It Controls

The watch-loop toggle, evaluation interval, and output interval drive recurring orchestration checks.

## Recommended Defaults

Keep the loop enabled with moderate intervals for active sprints.

## Risks And Gotchas

Very short intervals can add noise; disabling the loop means progress depends on manual or external triggers.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#watch-loop`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Atomic Sprint Loop](../../sprint-loop/atomic-loop.md)
- [Operations Runbook](../../operations/runbook.md)
