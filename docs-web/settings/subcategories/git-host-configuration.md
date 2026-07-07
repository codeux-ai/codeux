# Git Host Configuration

Stores GitHub or GitLab tokens and Docker git-auth behavior for repository automation.

## What It Controls

Tokens, GitHub auth mounting, auth paths, local git config copy, and container git identity control remote repository access.

## Recommended Defaults

Prefer least-privilege tokens and use local auth copy only on trusted machines.

## Risks And Gotchas

Tokens and copied auth directories can grant repository write access inside provider containers.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-git-host-configuration`. The Settings card header links directly to this published subpage.

## Related Docs

- [Security Hardening](../../operations/security-hardening.md)
- [Operations Runbook](../../operations/runbook.md)
