# Built-in MCP (Code UX)

Controls which built-in Code UX MCP tool categories are available to containerized CLIs.

## What It Controls

Tool-category and individual-tool toggles decide what trusted provider and project-manager clients may call on their next run. Agent presets add a separate access layer in the Agents editor.

## Recommended Defaults

Keep the global surface aligned with project-manager workflows. For individual agents, start with Code UX disabled and enable scheduler-only access only when the preset needs agent-owned wakeups or task reruns.

## Risks And Gotchas

Disabling required tools can make provider workflows fail; enabling broad tools increases capability exposure. The restricted `scheduler` tool is narrower than `manage_scheduler`, but it can still create runtime work, so non-chat agents should receive it only through an intentional per-agent opt-in.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#built-in-mcp`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [MCP Tools and Contracts](../../mcp/tools-and-contracts.md)
- [Security Hardening](../../operations/security-hardening.md)
