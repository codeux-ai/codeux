# Developer Reference

This section is the precise contract reference for everyone integrating with Code UX — whether you are wiring it into an MCP client, building a dashboard plugin, or extending the engine.

If you are looking for narrative explanations, the [User Guide](../user/index.md) is friendlier. If you want internals, see [Architecture](../architecture/index.md).

## Sections

| # | Page | Purpose |
| --- | --- | --- |
| 1 | [MCP tools](./mcp-tools.md) | The 7 root MCP tools, exact JSON schemas |
| 2 | [Management actions](./management-actions.md) | Every action surfaced under `manage_code_ux`, by domain |
| 3 | [HTTP API reference](./http-api.md) | All REST endpoints exposed by the dashboard server |
| 4 | [Realtime WebSocket protocol](./websocket-realtime.md) | The live update stream protocol |
| 5 | [Configuration & CLI](./configuration.md) | Every CLI flag, env var, and config search rule |
| 6 | [Settings schema reference](./settings-reference.md) | The full settings tree |
| 7 | [Sprint and subtask file format](./sprint-format.md) | On-disk markdown format with YAML frontmatter |
| 8 | [Building from source](./building-from-source.md) | Build, link, run from a clone |
| 9 | [Testing & quality gates](./testing.md) | Vitest, coverage thresholds, CI gates |

## Versioning

This reference tracks the **1.2.x** release line. Breaking changes follow semver — minor versions add tools / fields without removing them, major versions may remove or restructure.

The MCP server name is `code-ux` and version is `1.2.0`. Capabilities advertised at `initialize`: `tools`, `resources`, `prompts`.

## Stable vs experimental

Unless explicitly marked `experimental` or `deprecated`, every contract documented here is stable for the 1.x series. Experimental surfaces:

- The `compact_thread` mode of `generate_dashboard_reply`.
- The `preview` management domain (interface may evolve as Docker tooling matures).
- The `WORKER` invocation routing profile.

Deprecated surfaces (slated for removal in 2.0):

- `include_task_dispatch` and `include_attention_items` parameters on the `listen` tool.
