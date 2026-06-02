# Introduction

## What Code UX is

Code UX is a multi-agent **sprint orchestration platform**. You describe a piece of work — typically a feature, refactor, or migration — and Code UX:

1. **Plans** the sprint into independent and dependent subtasks.
2. **Dispatches** each subtask to a worker (a hosted Jules session or a virtual worker running a CLI agent).
3. **Monitors** progress through a continuous watch loop, polling sessions and CI status.
4. **Gates** merges with policy: PR creation, CI green checks, comment resolution, conflict detection, and optional auto-merge.
5. **Escalates** anything it cannot handle (merge conflicts, repeated CI failures, plan approval) as an *attention item* visible in the dashboard.
6. **Finalises** the sprint by merging the feature branch into `main` and emitting a status report.

Underneath, Code UX is built on three pillars:

- A **Model Context Protocol (MCP) server** that any MCP-compatible client can drive (Gemini CLI, Codex CLI, Claude Desktop, custom integrations).
- A **dependency-aware orchestration engine** that understands subtask graphs, merge state, retries, and emergency-stop conditions.
- A **live Preact dashboard** that turns the entire engine into a real-time web UI on `http://localhost:4444`.

## What it is not

- Code UX is **not** itself an LLM. It does not perform code generation; it routes work to providers that do (Jules, Gemini CLI, Codex CLI, Claude Code CLI, Qwen Code CLI, OpenCode CLI).
- It is **not** a CI runner. It *integrates* with the GitHub CI you already use and reads PR status to decide when to merge.
- It is **not** a chat UI in the traditional sense. The chat surface exists, but the primary interaction model is *sprint-driven*: you describe outcomes, the engine breaks them down and runs them.

## Core concepts

### Project

A **project** binds Code UX to a single Git repository. Each project owns:

- Its own **settings overrides** (provider routing, automation level, CI policy).
- Its own **sprints**, **tasks**, **agent presets**, and **memory**.
- A set of **worker assignments** that decide which connected MCP clients can pick up its work.

You can manage as many projects as you like in a single Code UX runtime.

### Sprint

A **sprint** is the unit of execution. It owns:

- A **feature branch** (created on first run, merged to `main` on completion).
- A list of **subtasks**, each with their own dependency graph.
- A **status** (`idle`, `running`, `paused`, `completed`, `failed`, `cancelled`).
- Optional **goal**, **start/end dates**, and **showcase pinning** for the dashboard.

### Subtask

A **subtask** is a delegated coding job. The on-disk representation is a markdown file with YAML frontmatter (see [Sprint and subtask file format](../developer/sprint-format.md)):

```markdown
title: Implement login endpoint
depends_on: ["setup-db"]
is_independent: false
merged: false
prompt:
Add POST /auth/login. Validate credentials against the users table.
Return a signed JWT on success.
```

Status flows through the lifecycle:

```
PENDING → RUNNING → CODING_COMPLETED → COMPLETED
                 ↘ FAILED  ↘ BLOCKED  ↘ QUOTA  ↘ QA_REVIEW_FAILED
```

### Worker

A **worker** is anything that can execute a subtask. Two flavours:

- **Jules hosted worker** — Runs on Google's Jules Agent API. No setup beyond an API key.
- **Virtual worker** — Runs locally, wrapping one of the open CLI providers (Gemini, Codex, Claude Code, Qwen Code, OpenCode, Antigravity CLI). Can run **on the host** or **inside a Docker container** (`node:24-bookworm` by default).

Workers are routed per *invocation type* (`task_coding`, `planning`, `dashboard_reply`, `clarification_reply`, `qa_review`, `ci_fix`, `merge_conflict`) so that, for example, planning runs on Gemini Pro while CI fixes run on Claude Sonnet.

### Watch loop

The watch loop is the heartbeat of an active sprint. By default it cycles every **10 seconds** and emits a checkpoint report every **300 seconds**. Each cycle:

1. Loads subtasks from disk and the database.
2. Syncs worker session state with the orchestrator.
3. Derives task statuses (handling completions, failures, quota).
4. Starts any newly-ready tasks (respecting dependencies and concurrency caps).
5. Runs the merge protocol (creates/merges PRs per policy).
6. Resolves attention items where automation allows.
7. Sleeps until the next interval, or finalises the sprint.

### Attention item

Anything the engine cannot resolve autonomously becomes an attention item. Categories include:

- **Merge conflict** — A worker branch cannot rebase cleanly onto the feature branch.
- **CI failure** — A PR has failing checks past the autofix retry budget.
- **Action required** — Awaiting plan approval, awaiting clarification, paused session.
- **QA review failed** — A QA agent rejected the worker's output.

Attention items appear on the **Live Session** and **Overview** pages. Virtual workers can claim and act on many of them automatically; the rest escalate to a human.

## When to use Code UX

Code UX shines when:

- You want to break a feature into 5–30 parallel-friendly tasks and execute them concurrently.
- You want a *durable* execution model (sprints survive client restarts; the orchestrator runs server-side).
- You want to mix providers — using cheap providers for routine coding and premium providers for planning or merge conflict resolution.
- You want a UI that surfaces sprint progress and human-required actions in real time.

Code UX is overkill for a single drive-by edit; for that, just use your CLI provider directly.

## Next steps

- [Install Code UX](./installation.md)
- [Run your first sprint](./quickstart.md)
- [Connect Code UX to your MCP client](./mcp-clients.md)
