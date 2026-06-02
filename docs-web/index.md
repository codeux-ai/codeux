# Code UX Documentation

> **Code UX** is a multi-agent sprint orchestration platform that turns a single prompt into a fully managed engineering workflow — planning, dispatch, CI gating, merge, and review — across Jules, Gemini, Codex, Claude, Qwen, and OpenCode workers.

This documentation site is the canonical reference for installing, operating, integrating, and extending Code UX.

---

## Choose your path

| If you are… | Start here |
| --- | --- |
| **A user** running sprints from the dashboard or an MCP client | [User Guide →](./user/index.md) |
| **A developer** integrating with the MCP server, REST API, or building plugins | [Developer Reference →](./developer/index.md) |
| **An architect or contributor** working on the engine itself | [Architecture →](./architecture/index.md) |

---

## At a glance

- **Sprint orchestration engine** — Markdown-defined sprints with a dependency-aware cycle runner, continuous watch loop, and emergency-stop safety.
- **Multi-provider workers** — Pluggable virtual workers run on Gemini, Codex, Claude Code, Qwen Code, OpenCode, or the hosted Jules API. Routing is controlled per task type, per project.
- **Live Preact dashboard** — Real-time WebSocket-backed UI on `http://localhost:4444` covering sprints, tasks, chat, agents, memory, sprint preview browsers, and stats.
- **MCP server** — Speaks Model Context Protocol over stdio and (optionally) Streamable HTTP. Exposes 7 tools, including the unified `manage_code_ux` action surface (8 management domains, 60+ actions).
- **Built-in CI gate** — Live PR monitoring, configurable auto-merge policies, optional CI autofix retries, merge-conflict escalation.
- **Memory & embeddings** — On-device embedding models (ONNX runtime), short-term sprint memory, long-term project memory with promotion and semantic search.
- **Sprint preview browser** — Spin up Docker preview containers per sprint with a live in-app browser, port mapping, and editable startup scripts.

---

## Top-level table of contents

### [User Guide](./user/index.md)
1. [Introduction](./user/introduction.md)
2. [Installation](./user/installation.md)
3. [Quickstart](./user/quickstart.md)
4. [Connecting MCP clients](./user/mcp-clients.md) — Gemini CLI, Codex CLI, Claude Desktop
5. [The dashboard](./user/dashboard/overview.md)
   - [Overview](./user/dashboard/overview.md)
   - [Projects](./user/dashboard/projects.md)
   - [Sprints](./user/dashboard/sprints.md)
   - [Tasks](./user/dashboard/tasks.md)
   - [Live Session](./user/dashboard/live-session.md)
   - [Chat](./user/dashboard/chat.md)
   - [Agents](./user/dashboard/agents.md)
   - [Memory](./user/dashboard/memory.md)
   - [Sprint Preview Browser](./user/dashboard/browser-preview.md)
   - [Stats](./user/dashboard/stats.md)
   - [Settings](./user/dashboard/settings.md)
6. [Sprint orchestration in depth](./user/sprint-orchestration.md)
7. [Providers and models](./user/providers-and-models.md)
8. [Automation, CI and merge policy](./user/automation-and-ci.md)
9. [Quicksprint templates](./user/quicksprints.md)
10. [Troubleshooting](./user/troubleshooting.md)

### [Developer Reference](./developer/index.md)
1. [MCP tools](./developer/mcp-tools.md) — 7 root tools and their schemas
2. [Management actions](./developer/management-actions.md) — every action under `manage_code_ux`
3. [HTTP API reference](./developer/http-api.md) — 100+ REST endpoints
4. [Realtime WebSocket protocol](./developer/websocket-realtime.md)
5. [Configuration & CLI](./developer/configuration.md)
6. [Settings schema reference](./developer/settings-reference.md)
7. [Sprint and subtask file format](./developer/sprint-format.md)
8. [Building from source](./developer/building-from-source.md)
9. [Testing & quality gates](./developer/testing.md)

### [Architecture](./architecture/index.md)
1. [System overview](./architecture/system-overview.md)
2. [MCP server internals](./architecture/mcp-server.md)
3. [Sprint engine](./architecture/sprint-engine.md)
4. [Virtual workers](./architecture/virtual-workers.md)
5. [CI integration](./architecture/ci-integration.md)
6. [Dashboard architecture](./architecture/dashboard-architecture.md)
7. [Data model](./architecture/data-model.md)
8. [Configuration resolution](./architecture/configuration-resolution.md)
9. [Security model](./architecture/security.md)

---

## Conventions used in this documentation

- **Code paths** are given as repository-relative paths (e.g. `src/server/code-ux-server.ts`) so you can jump straight to the source.
- **Defaults** appear inline in tables. Where a value is configurable, the configuration key is listed alongside it.
- **CLI examples** assume the `codeux` binary or `npx codeux` is on `PATH`.
- **Endpoints** use `:paramName` for path parameters and document required query parameters separately.

---

## Versioning

This documentation tracks the `1.2.x` release line of the `codeux` npm package, which is published from the `main` branch. The runtime announces its MCP server identity as `code-ux`.

## License

Code UX is distributed under the **ISC License**.
