# Glossary

## Agent Tool Handler
Module that handles `task_agent` and worker-local agent helper calls.

## Core Tool Handler
Module that handles source/session/activity tool calls.

## CI Intelligence
Settings group that controls merge-related protocol guidance for CI and review comments.

## Dashboard Settings
Persisted configuration object used by backend and frontend for runtime behavior.

## Instruction Template
Markdown file with placeholders rendered at runtime for protocol messaging.

## MCP
Model Context Protocol. Communication interface used by clients to call server tools.

## Sprint Loop Step
A single orchestration stage in the atomic loop pipeline (preflight, sync, derive, start, protocol, etc.).

## Subtask
A markdown-defined unit of work in a sprint with fields like `depends_on`, `is_independent`, and `merged`.

## Watch Loop
Continuous orchestration mode that runs periodic cycles until exit criteria are reached.
