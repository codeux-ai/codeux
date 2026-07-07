# Built-in MCP (Code UX)

Controls which built-in Code UX MCP tool categories are available to containerized CLIs.

## What It Controls

Tool-category and individual-tool toggles decide what providers may call on their next run.

## Recommended Defaults

Disable only categories you know a provider should not access.

## Risks And Gotchas

Disabling required tools can make provider workflows fail; enabling broad tools increases capability exposure.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#built-in-mcp`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [MCP Tools and Contracts](../../mcp/tools-and-contracts.md)
- [Security Hardening](../../operations/security-hardening.md)
