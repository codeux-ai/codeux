# Jira Configuration

Connects Jira issue search, import transitions, and completion transitions.

## What It Controls

Site URL, account email, API token, project key, transition names, and move/close toggles drive Jira automation.

## Recommended Defaults

Use a dedicated API token and test transition names against the target Jira workflow.

## Risks And Gotchas

Wrong transition names prevent issue movement; broad tokens expose more Jira scope than needed.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#jira-configuration`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Sprint Imports](../../dashboard/sprint-imports.md)
- [Security Hardening](../../operations/security-hardening.md)
