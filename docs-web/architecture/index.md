# Architecture

This section documents the internals of Code UX — the engine, the data model, the runtime topology, and the design trade-offs behind each.

It is for contributors and integrators who need to reason about *how* Code UX makes its decisions, not just *what* it does. If you only need to drive Code UX, the [User Guide](../user/index.md) and [Developer Reference](../developer/index.md) are sufficient.

## Sections

| # | Page | Topic |
| --- | --- | --- |
| 1 | [System overview](./system-overview.md) | Container-first process model, runtime composition, top-level data flow |
| 2 | [MCP server](./mcp-server.md) | Tool dispatch, transports, authentication, session lifecycle |
| 3 | [Sprint engine](./sprint-engine.md) | Cycle pipeline, watch loop state machine, dependency resolution, retries |
| 4 | [Virtual workers](./virtual-workers.md) | Provisioning, lifecycle, Docker vs host execution, attention-item handling |
| 5 | [CI integration](./ci-integration.md) | Feature PR gate, merge protocol, autofix retries, conflict handling |
| 6 | [Dashboard architecture](./dashboard-architecture.md) | Preact stack, real-time client, route map, state model |
| 7 | [Data model](./data-model.md) | Projects, sprints, tasks, runs, dispatches, memory, conversations |
| 8 | [Custom dashboard foundation](./custom-dashboard-foundation.md) | Persisted dashboard manifests, generated bundles, validation history, and publication state |
| 9 | [Execution invocation tracking](./execution-invocation-tracking.md) | Provider parser normalization, usage isolation, live telemetry, transcript persistence |
| 10 | [External chat connectors](./external-chat-providers.md) | Provider setup, channel bindings, inbound dedupe, outbound delivery state |
| 11 | [Configuration resolution](./configuration-resolution.md) | Cascade order, search paths, settings hierarchy |
| 12 | [Speech input](./speech-input.md) | Persisted transcription settings, privacy boundary, provider fallback contract |
| 13 | [Security model](./security.md) | Authentication, authorisation, secrets, network surface |
| 14 | [Worker clarification contract](./worker-clarification-contract.md) | Durable human-owned worker questions, idempotent replies, and continuation boundary |
| 15 | [Custom nodes](./custom-nodes.md) | Generated TypeScript packages, validation/publication gates, and hardened container execution |

## Runtime Notes

Agent persistent skill storage is opt-in per preset. A shared project-owned agent resolver applies the same idempotent search-first prompt guidance, scoped `search_skills` MCP access, and read-only versioned storage mounts to canonical provider executions and direct worker-inbox replies. Internal repositories live under `~/.code-ux/skill-storages/<project-id>/<storage-id>/repo`, are committed through the Docker Git helper, and mount at `/code-ux/persistent-skills/<storage-id>/`; disabled, unattached, cross-project, or unscoped invocations remain unchanged.

## Reading order suggestions

- **For new contributors** — read 1, 3, 7 in that order.
- **For MCP integrators** — read 1, 2, 8.
- **For dashboard / UI work** — read 1, 6, 7.
- **For ops / SRE** — read 1, 5, 9.

Each architecture page links to the relevant source files so you can audit the implementation against this document.
