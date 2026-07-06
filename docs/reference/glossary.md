# Glossary

## Code UX
The container-first, local-first agentic coding runtime that coordinates the CLI, MCP server, sprint orchestrator, dashboard, and Electron shell around project work.

## Hosted Jules provider
The hosted remote provider accessed through the Jules API. Code UX treats it as one provider among several and can route sprint work to it when settings select Jules.

## Local CLI providers
Provider runtimes that execute through local CLI workflows, often inside Docker or host-backed worktrees, such as Gemini, Codex, Claude Code, Qwen Code, OpenCode, and Antigravity.

## MCP tools
The Model Context Protocol tool surface exposed by Code UX, including management, runtime, and dispatch contracts.

## Quicksprints
Short-lived, template-driven execution workflows for tightly scoped work.

## Scheduler
The persistent scheduler that queues sprint, quicksprint, and chat targets and releases them when they are due.

## .code-ux
The canonical active project artifact directory for sprints, agents, instruction templates, logs, and runtime files.

## Provider instances
Persisted provider configurations and the runtime sessions or dispatches created from them during execution.

## Memory / Knowledge
The short-term sprint evidence and durable project claims that Code UX stores for retrieval and review.

## Preview sessions
Browser preview sessions and their associated URLs, logs, and scripts used for frontend verification.

## Dashboard v2 surfaces
The current Preact dashboard surfaces under `dashboard/src/v2/`, including execution, sprints, memory, settings, chat, and related views.

## Legacy `.jules-subagents`
Historical artifact directory used by older docs and migration notes. Current project artifacts live under `.code-ux/`.

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
