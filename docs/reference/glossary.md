# Glossary

## Code UX
The core platform architecture encompassing the MCP server, sprint orchestration engine, instruction template system, and dashboard.

## Hosted Jules provider
The remote agent infrastructure provided by the platform.

## Local CLI providers
Local execution environments such as Gemini or Claude Code.

## MCP tools
The Model Context Protocol implementation for platform tools.

## Quicksprints
Rapid, scoped atomic execution workflows.

## Scheduler
Component responsible for managing virtual worker cycles and assigning tasks.

## .code-ux
The canonical active directory for artifacts, logs, workspaces, and settings.

## Provider instances
Specific instantiated connections to an LLM provider.

## Memory / Knowledge
The short-term and long-term evidence contexts collected during sprint execution.

## Preview sessions
The browser preview architecture component for real-time frontend verification.

## Dashboard v2 surfaces
The core UI interaction layers for execution, stats, settings, and memory.

## Agent Tool Handler
Module that handles worker-local execution and reply helper calls.

## Core Tool Handler
Module that handles `get_session`, listener, inbox, dispatch, and attention tool calls.

## CI Intelligence
Settings group that controls merge-related protocol guidance for CI and review comments.

## Dashboard Settings
Persisted configuration object used by backend and frontend for runtime behavior.

## Instruction Template
Markdown template with placeholders rendered at runtime for protocol messaging. Templates are stored in scoped settings and fall back to built-in defaults.

## MCP
Model Context Protocol. Communication interface used by clients to call server tools.

## Sprint Loop Step
A single orchestration stage in the atomic loop pipeline (preflight, sync, derive, start, protocol, etc.).

## Subtask
A markdown-defined unit of work in a sprint with fields like `depends_on`, `is_independent`, and `merged`.

## Watch Loop
Continuous orchestration mode that runs periodic cycles until exit criteria are reached.
