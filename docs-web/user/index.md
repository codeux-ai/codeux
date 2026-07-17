# User Guide

Welcome to Code UX — a local-first, container-first multi-provider runtime. This section is for
people running sprints, whether from the local dashboard or an MCP client.

New here? Start with [Introduction](./introduction.md) for the concepts, then
[Installation](./installation.md) and [Quickstart](./quickstart.md). Everything else is reference you
can read on demand.

## Sections

| Page | What it covers |
| --- | --- |
| [Introduction](./introduction.md) | What Code UX is, how it's different, and the core concepts. |
| [Installation](./installation.md) | Desktop app, source, CLI flags, and environment. |
| [Quickstart](./quickstart.md) | Your first sprint in about ten minutes. |
| [Providers and models](./providers-and-models.md) | The seven providers and routing work by invocation type. |
| [Sprint orchestration](./sprint-orchestration.md) | Planning, the dependency model, the watch loop, and retries. |
| [Quicksprints](./quicksprints.md) | Reusable sprint templates. |
| [Automation and CI](./automation-and-ci.md) | Auto-merge, CI autofix, attention items, and intervention modes. |
| [MCP clients](./mcp-clients.md) | Driving Code UX from Gemini CLI, Codex, Claude Code, and others. |
| [Dashboard](./dashboard/overview.md) | A page-by-page tour of the live web UI. |
| [Dashboard interaction patterns](./dashboard/interaction-patterns.md) | Shared confirmation, draft, async feedback, keyboard, focus, and reduced-motion behavior. |
| [Dashboard accessibility audit](./dashboard/accessibility-quality-audit.md) | Review and browser-acceptance checklist for dashboard changes. |
| [Settings](../settings/index.md) | The full Settings reference hub with one page per Settings area. |
| [Custom dashboards](./dashboard/custom-dashboards.md) | Agent-generated project dashboards, detached validation, publication, and rollback. |
| [Troubleshooting](./troubleshooting.md) | Common issues, log locations, and recovery. |

## Glossary

- **Project** — a managed Git repository, with its own settings, sprints, agents, and memory.
- **Sprint** — a bounded unit of work on a feature branch, containing dependency-aware tasks.
- **Task** — a single delegated coding job within a sprint, with explicit dependencies.
- **Provider** — an agent backend, either hosted (like Jules) or local CLI/Docker (like Gemini, Codex, Claude Code, Qwen Code, OpenCode, Antigravity).
- **Worker** — the execution context that runs a provider for a task, in Docker (default) or on the host.
- **Agent preset** — a reusable persona (instructions, routing hints) a worker adopts for an invocation type.
- **Memory** — short-term sprint memory and long-term project memory, scoped into prompts.
- **Persistent skill storage** — optional per-agent reusable skill storage. Enabled agents should search existing skills before creating a new one; storage mounts live outside the project workspace.
- **Attention item** — anything needing a human decision: a merge conflict, a CI failure, a plan to approve.
- **Watch loop** — the continuous loop that advances dependencies, syncs worker state, and runs the merge protocol.

For database-level concepts, see the [Architecture data model](../architecture/data-model.md).
