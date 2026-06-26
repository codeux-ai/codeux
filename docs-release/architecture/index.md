# Architecture

This section documents the internals of Code UX — the engine, the data model, the runtime topology, and the design trade-offs behind each.

It is for contributors and integrators who need to reason about *how* Code UX makes its decisions, not just *what* it does. If you only need to drive Code UX, the [User Guide](../user/index.md) and [Developer Reference](../developer/index.md) are sufficient.

## Sections

| # | Page | Topic |
| --- | --- | --- |
| 1 | [System overview](./system-overview.md) | Process model, runtime composition, top-level data flow |
| 2 | [MCP server](./mcp-server.md) | Tool dispatch, transports, authentication, session lifecycle |
| 3 | [Sprint engine](./sprint-engine.md) | Cycle pipeline, watch loop state machine, dependency resolution, retries |
| 4 | [Virtual workers](./virtual-workers.md) | Provisioning, lifecycle, Docker vs host execution, attention-item handling |
| 5 | [CI integration](./ci-integration.md) | Feature PR gate, merge protocol, autofix retries, conflict handling |
| 6 | [Dashboard architecture](./dashboard-architecture.md) | Preact stack, real-time client, route map, state model |
| 7 | [Data model](./data-model.md) | Projects, sprints, tasks, runs, dispatches, memory, conversations |
| 8 | [Configuration resolution](./configuration-resolution.md) | Cascade order, search paths, settings hierarchy |
| 9 | [Security model](./security.md) | Authentication, authorisation, secrets, network surface |

## Reading order suggestions

- **For new contributors** — read 1, 3, 7 in that order.
- **For MCP integrators** — read 1, 2, 8.
- **For dashboard / UI work** — read 1, 6, 7.
- **For ops / SRE** — read 1, 5, 9.

Each architecture page links to the relevant source files so you can audit the implementation against this document.
