# Rate Limit

Controls retries after provider quota or rate-limit responses.

## What It Controls

Quota reset waits, fixed retry delays, retry counts, and no-timer quota retry caps define retry behavior.

## Recommended Defaults

Retry on concrete quota reset timers and keep fixed retries modest.

## Risks And Gotchas

Aggressive retries can keep failing tasks occupied and delay operator escalation.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#rate-limit`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Operations Runbook](../../operations/runbook.md)
- [Provider Routing](../provider-routing.md)
