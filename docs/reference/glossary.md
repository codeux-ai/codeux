# Glossary

## Code UX
The container-first, local-first agentic coding runtime that coordinates the CLI, MCP server, sprint orchestrator, dashboard, and Electron shell around project work.

## Hosted Code UX provider
The hosted remote provider accessed through the Code UX API. Code UX treats it as one provider among several and can route sprint work to it when settings select Code UX.

## Local CLI providers
Provider runtimes that execute through local CLI workflows, often inside Docker or host-backed worktrees, such as Gemini, Codex, Claude Code, Qwen Code, OpenCode, and Antigravity.

## MCP tools
The Model Context Protocol tool surface exposed by Code UX, including management, runtime, and dispatch contracts.



## .code-ux
The canonical active project artifact directory for sprints, agents, instruction templates, logs, and runtime files.

## Provider instances
Persisted provider configurations and the runtime sessions or dispatches created from them during execution.



## Dashboard v2 surfaces
The current Preact dashboard surfaces under `dashboard/src/v2/`, including execution, sprints, memory, settings, chat, and related views.


## Agent Tool Handler
Module that handles worker-local execution and reply helper calls.

## Core Tool Handler
Module that handles shared session, listener, inbox, dispatch, and attention tool calls.

## CI Intelligence
Settings group that controls merge-related protocol guidance for CI and review comments.

## Dashboard Settings
Persisted configuration object used by backend and frontend for runtime behavior.

## Instruction Template
Markdown template with placeholders rendered at runtime for protocol messaging. Templates are stored in scoped settings and fall back to built-in defaults.

## MCP
Model Context Protocol. The communication interface used by clients to call server tools.

## Sprint Loop Step
A single orchestration stage in the atomic loop pipeline (preflight, sync, derive, start, protocol, and related steps).

## Subtask
A markdown-defined unit of work in a sprint with fields like `depends_on`, `is_independent`, and `merged`.

## Watch Loop
Continuous orchestration mode that runs periodic cycles until exit criteria are reached.

## Quicksprint
Reusable Markdown template resolved from project, home, bundled `.code-ux/quicksprints/templates`, or TS fallback, converted into a sprint goal and sent through normal sprint planning.

## Scheduler
Project-scoped automation persisted in `scheduler_entries`; can run sprints, quicksprints, or chat messages once or on recurrence.

## Memory
Runtime-learned short-term sprint and long-term project learnings, embedded and injected into prompts according to agent memory config.

## Knowledge
Project-scoped document library ingested/uploaded/imported separately from memory, embedded locally, and attached to agent presets via subscriptions; agents use `search_knowledge` for exact passages.

## Preview container
Sprint-scoped Docker preview session for one `(projectId, sprintId)`, persisted in `sprint_preview_sessions`, served through the in-app browser on a preview origin, using `.code-ux/browser/start-preview.sh` or generated fallback startup.

## `manage_code_ux` (Deprecated)
Deprecated unified MCP dispatcher; dedicated `manage_*` tools are preferred.

## Legacy `.jules-subagents`
Historical artifact directory used by older docs and migration notes. Current project artifacts live under `.code-ux/`.
