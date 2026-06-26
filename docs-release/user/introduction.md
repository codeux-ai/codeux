# Introduction

Code UX is an **open-source, container-first agentic coding runtime**. You describe a piece of
work — a feature, refactor, migration, QA pass, or CI repair — and Code UX turns it into a managed
**sprint**: planned into dependency-aware tasks, routed to the right agent, executed in isolated
Docker workspaces, reviewed through Git and CI, and tracked in a live local dashboard.

It runs entirely on your machine. There are no accounts, no seats, and no usage limits, and the
whole runtime is [MIT licensed](https://github.com/codeux-ai/codeux/blob/main/LICENSE).

## What makes it different

Most agentic coding tools try to be a single autonomous agent for everything. They push more context
into longer conversations and burn tokens on work that should be deterministic: branch setup,
dependency ordering, merge checks, CI polling, PR state, reruns, and status bookkeeping.

Code UX takes the opposite approach. It keeps the coding path predictable and moves the repetitive
operational work into software:

- **Work is a DAG, not a mega-prompt.** Large goals become atomic tasks with explicit dependencies.
  Only the tasks that are ready start, and independent tasks run in parallel.
- **Execution is containerized.** Provider CLIs run in short-lived, isolated Docker workspaces by
  default, scoped to a single task or repair flow and cleaned up afterward.
- **Git and CI are automated.** Branch prep, PR/MR creation, CI polling, merge gates, CI repair, and
  merge-conflict resolution are handled by the runtime, not re-explained to a model each time.
- **Memory is scoped.** Short-term sprint memory and long-term project memory keep prompts focused
  and token-efficient instead of dragging every past conversation into every call.

The result: agents spend their tokens on the parts that actually need judgment — planning,
implementation, review, and conflict resolution — while everything operational stays fast,
observable, and cheap.

## What Code UX is *not*

- **Not an LLM.** Code UX does not generate code itself. It routes each piece of work to the provider
  that does — Jules, Claude Code, Codex, Gemini, Qwen Code, OpenCode, or Antigravity.
- **Not a replacement for your tools.** It coordinates the agent CLIs, Git hosts, and CI you already
  use rather than replacing them.
- **Not a CI runner.** It integrates with your existing GitHub/GitLab CI and reads status to decide
  when to merge.

## How you run it

Code UX ships two ways, both powered by the same runtime:

- The **desktop app** (Windows, macOS, Linux) — an Electron shell around the runtime and dashboard.
- The **`@codeuxai/codeux` npm package** — the same orchestration server, dashboard, and MCP server
  as a CLI, without the Electron shell.

Either way, Code UX serves its dashboard locally at `http://localhost:4444`. See
[Installation](./installation.md) to get set up, then [Quickstart](./quickstart.md) to run your first
sprint.

## Core concepts

### Project

A **project** binds Code UX to a single Git repository. Each project owns its own settings overrides
(provider routing, automation level, CI policy), its sprints, tasks, agent presets, and memory. A
single Code UX runtime can manage many projects side by side.

### Sprint

A **sprint** is the unit of execution. It owns a feature branch, a set of dependency-aware tasks, a
status (`idle`, `running`, `paused`, `completed`, `failed`, `cancelled`), and an optional goal.
Sprints are planned from a natural-language prompt, imported issues, or a reusable quicksprint
template, and can round-trip through markdown for portable, reviewable task definitions.

### Task

A **task** is a single delegated coding job within a sprint, with an explicit dependency list. The
orchestrator starts a task only when its dependencies are satisfied, runs ready tasks in parallel up
to per-provider concurrency limits, and tracks each task through its lifecycle (pending → running →
coding complete → merged/complete, with failure, blocked, and QA states along the way).

### Provider and worker

A **provider** is an agent backend. A **worker** is the execution context that runs a provider for a
task:

- **Docker worker** *(default)* — the provider CLI runs inside a short-lived, isolated container.
- **Host worker** — the provider CLI runs directly on your machine when speed or local tooling
  access matters more than isolation.

Work is routed **per invocation type** — planning, task coding, QA review, CI repair,
merge-conflict resolution, clarification, and dashboard replies — so you can, for example, plan with
one model and repair CI with another. See [Providers and models](./providers-and-models.md).

### Memory

Code UX separates **sprint memory** (local decisions, fixes, and constraints that matter while a
sprint is active) from **project memory** (durable knowledge that should survive across sprints).
Prompts receive only the scoped memory they need, keeping context focused and token-efficient.

### Attention items

Anything the runtime cannot resolve autonomously — a merge conflict it can't rebase, a PR failing CI
past the retry budget, a plan awaiting approval — becomes an **attention item** surfaced on the Live
Session and Overview pages, where you can step in.

## When to use Code UX

Code UX is built for substantial work: migrations, product features, cleanup waves, QA passes, and
multi-branch delivery where a single agent session is not enough. It shines when you want to:

- Break a goal into many parallel-friendly tasks and run them concurrently with merge discipline.
- Keep execution isolated and reproducible across projects.
- Mix providers — routine coding on one, planning or conflict resolution on another.
- Supervise many moving parts from one real-time dashboard.

For a single drive-by edit, just use your agent CLI directly. For everything bigger, Code UX turns
ad hoc AI coding into a governed delivery workflow.

## Next steps

- [Install Code UX](./installation.md)
- [Run your first sprint](./quickstart.md)
- [Providers and models](./providers-and-models.md)
- [Use Code UX from an MCP client](./mcp-clients.md)
