# Custom MCP Server

Configures one custom MCP server injected into compatible provider CLIs.

## What It Controls

Display name, server key, transport, URL or command, args/env/headers, description, CLI restrictions, and preview define the server.

## Recommended Defaults

Prefer HTTP/SSE for managed remote servers and restrict sensitive servers to specific CLIs.

## Risks And Gotchas

Invalid JSON, unavailable commands, or leaked auth headers can break provider startup or expose secrets.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/settings-subcategories-custom-mcp-server`. The Settings card header links directly to this published subpage.

## Related Docs

- [External MCP Worker Client](../../architecture/external-mcp-worker-client.md)
- [Security Hardening](../../operations/security-hardening.md)
