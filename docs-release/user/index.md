# User Guide

Welcome to Code UX — the open-source, container-first agentic coding runtime. This section is for
people running sprints, whether from the local dashboard or an MCP client.

New here? Start with [Introduction](./introduction.md) for the concepts, then
[Installation](./installation.md) and [Quickstart](./quickstart.md). Everything else is reference you
can read on demand.

## Sections

| Page | What it covers |
| --- | --- |
| [Introduction](./introduction.md) | What Code UX is, how it's different, and the core concepts. |
| [Installation](./installation.md) | Desktop app, npm CLI, source, CLI flags, and environment. |
| [Quickstart](./quickstart.md) | Your first sprint in about ten minutes. |
| [Providers and models](./providers-and-models.md) | The seven providers and routing work by invocation type. |
| [Sprint orchestration](./sprint-orchestration.md) | Planning, the dependency model, the watch loop, and retries. |
| [Quicksprints](./quicksprints.md) | Reusable sprint templates. |
| [Automation and CI](./automation-and-ci.md) | Auto-merge, CI autofix, attention items, and intervention modes. |
| [MCP clients](./mcp-clients.md) | Driving Code UX from Gemini CLI, Codex, Claude Code, and others. |
| [Dashboard](./dashboard/overview.md) | A page-by-page tour of the live web UI. |
| [Troubleshooting](./troubleshooting.md) | Common issues, log locations, and recovery. |

## Glossary

- **Project** — a managed Git repository, with its own settings, sprints, agents, and memory.
- **Sprint** — a bounded unit of work on a feature branch, containing dependency-aware tasks.
- **Task** — a single delegated coding job within a sprint, with explicit dependencies.
- **Provider** — an agent backend (Jules, Claude Code, Codex, Gemini, Qwen Code, OpenCode, Antigravity).
- **Worker** — the execution context that runs a provider for a task, in Docker (default) or on the host.
- **Agent preset** — a reusable persona (instructions, routing hints) a worker adopts for an invocation type.
- **Memory** — short-term sprint memory and long-term project memory, scoped into prompts.
- **Attention item** — anything needing a human decision: a merge conflict, a CI failure, a plan to approve.
- **Watch loop** — the continuous loop that advances dependencies, syncs worker state, and runs the merge protocol.

For database-level concepts, see the [Architecture data model](../architecture/data-model.md).
