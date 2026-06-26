# Code UX Documentation

> **Code UX** is an open-source, container-first agentic coding runtime. It turns a goal into a
> managed sprint — planned, routed to the right agent, executed in isolated Docker workspaces,
> reviewed through Git and CI, and tracked in a live local dashboard — across Jules, Claude Code,
> Codex, Gemini, Qwen Code, OpenCode, and Antigravity.

This site is the canonical reference for installing, operating, integrating, and extending Code UX.

---

## Choose your path

| If you are… | Start here |
| --- | --- |
| **A user** running sprints from the dashboard or an MCP client | [User Guide →](./user/index.md) |
| **A developer** integrating with the MCP server, HTTP API, or realtime protocol | [Developer Reference →](./developer/index.md) |
| **An architect or contributor** working on the engine itself | [Architecture →](./architecture/index.md) |

---

## At a glance

- **Multi-provider routing** — route work across seven providers per invocation type (planning, coding, QA, CI repair, merge-conflict), with weights, concurrency, and model defaults.
- **Container-first execution** — provider CLIs run in short-lived, isolated Docker workspaces by default; host execution is available when speed matters more than isolation.
- **Sprint orchestration** — dependency-aware DAG scheduling, parallel task dispatch, a continuous watch loop, and emergency-stop safety.
- **Git, CI & issue imports** — branch prep, PR/MR discovery, CI polling and merge gates, automated CI repair, and issue import from GitHub, GitLab, and Jira.
- **Scoped memory** — short-term sprint memory and long-term project memory keep prompts focused and token-efficient.
- **Live dashboard** — a real-time Preact UI at `http://localhost:4444` for projects, sprints, tasks, live sessions, agents, chat, memory, stats, and browser previews.
- **MCP server** — Code UX also speaks Model Context Protocol over stdio and an optional HTTPS gateway, so MCP clients can drive the runtime directly.

---

## Conventions

- **Code paths** are repository-relative (e.g. `src/server/code-ux-server.ts`) so you can jump to the source.
- **Defaults** appear inline in tables, alongside the configuration key where applicable.
- **CLI examples** assume the `codeux` binary (or `npx @codeuxai/codeux`) is on your `PATH`.

---

## Versioning and license

This documentation tracks the `0.8.x` release line of the
[`@codeuxai/codeux`](https://www.npmjs.com/package/@codeuxai/codeux) npm package. Code UX is released
under the [MIT License](https://github.com/codeux-ai/codeux/blob/main/LICENSE).
