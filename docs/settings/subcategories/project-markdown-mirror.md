# Project Markdown Mirror

Controls whether dashboard-authored agent presets are mirrored into project-local markdown files.

## What It Controls

The mirror toggle writes companion files under `.code-ux/agents` for selected project agents.

## Recommended Defaults

Enable it when agent instructions should be reviewable with project changes.

## Risks And Gotchas

Mirrored files can make agent edits visible in repository diffs if `.code-ux/agents` is tracked.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user-dashboard-settings#project-markdown-mirror`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Agent Sync And Planning Agent](../../architecture/agent-sync-and-planning-agent.md)
- [Agent Routing](../../architecture/agent-routing.md)
