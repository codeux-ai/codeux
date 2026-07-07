# Workspace Hygiene

Controls cleanup of temporary worktree state after provider CLI runs.

## What It Controls

Success and failure cleanup toggles decide whether Code UX removes temporary execution workspace state.

## Recommended Defaults

Clean successful worktrees and keep failed worktrees only when you are actively debugging.

## Risks And Gotchas

Keeping failed worktrees can consume disk; removing them can erase useful repro artifacts.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-workspace-hygiene`. The Settings card header links directly to this published subpage.

## Related Docs

- [Operations Runbook](../../operations/runbook.md)
- [Security Hardening](../../operations/security-hardening.md)
