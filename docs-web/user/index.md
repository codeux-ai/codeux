# User Guide

Welcome to Code UX. This section is written for users running sprints — through the dashboard, through an MCP client like Gemini CLI or Claude Desktop, or both.

If you have not installed Code UX yet, start with [Installation](./installation.md) and then [Quickstart](./quickstart.md). Everything else is reference material you can read on demand.

## Sections

| # | Page | What it covers |
| --- | --- | --- |
| 1 | [Introduction](./introduction.md) | What Code UX is, what problems it solves, key concepts |
| 2 | [Installation](./installation.md) | Global install, source install, prerequisites |
| 3 | [Quickstart](./quickstart.md) | First sprint in under 10 minutes |
| 4 | [Connecting MCP clients](./mcp-clients.md) | Gemini CLI, Codex CLI, Claude Desktop, custom clients |
| 5 | [Dashboard](./dashboard/overview.md) | Page-by-page tour of the live web UI |
| 6 | [Sprint orchestration in depth](./sprint-orchestration.md) | Plan / Status / Orchestrate, dependency model, retries |
| 7 | [Providers and models](./providers-and-models.md) | Choosing and routing between Jules, Gemini, Codex, Claude, Qwen, OpenCode |
| 8 | [Automation, CI and merge policy](./automation-and-ci.md) | Auto-merge, CI autofix, attention items, intervention modes |
| 9 | [Quicksprint templates](./quicksprints.md) | Reusable sprint templates |
| 10 | [Troubleshooting](./troubleshooting.md) | Common errors, log locations, recovery |

## Glossary (quick reference)

- **Project** — A repository under management. Has its own settings, sprints, agents, memory, and MCP connections.
- **Sprint** — A bounded unit of work containing one or more subtasks. Owns a feature branch; merges to `main` on completion.
- **Subtask** — A single delegated unit of coding work. Stored as a markdown file with YAML frontmatter (status, dependencies, prompt).
- **Agent preset** — A reusable persona (system instructions, avatar, memory template) that a worker can adopt.
- **Worker** — A runtime that executes a task. Either the **Jules** hosted API or a **virtual worker** running a CLI provider (Gemini, Codex, Claude Code, Qwen Code, OpenCode, Antigravity CLI) on the host or in Docker.
- **Sprint run** — A single execution attempt of a sprint. A sprint can be run, paused, cancelled, and re-run repeatedly.
- **Attention item** — Anything that needs human or worker attention: a merge conflict, a CI failure, an awaiting plan approval, a clarification request.
- **Watch loop** — The continuous monitoring loop that polls task state, advances dependencies, and emits checkpoint reports.

For a complete glossary including database-side concepts, see the [Architecture data model](../architecture/data-model.md).
