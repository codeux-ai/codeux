# Execution Invocation Tracking

## Overview

The `ExecutionRepository` manages `execution_invocations` and `execution_invocation_messages`, a first-class model for tracking context, prompt flows, tool calls, and LLM responses. This architecture provides robust observability, historical context per sprint, and dashboard tracing capabilities without tying invocation solely to single provider usage records.

## Key Structures

### `execution_invocations`
This table represents the high-level LLM request or agent session. It holds metadata such as provider, model, status, and associated task context (if any). It can also point back to native token reporting in `provider_invocations` via `provider_invocation_id`. It keeps a rolled up `message_count` and `last_message_at` for sorting dashboard displays.

### `execution_invocation_messages`
This table records each granular interaction loop in an invocation, preserving the exact sequence of \`system\`, \`user\`, \`assistant\`, and \`tool\` messages. It persists markdown content and parsed JSON arguments for tool calls, serving as a replayable log of an agent's reasoning process.

## Chat Thread Usage
Execution invocations are heavily used by the Chat page to track activity.
When chat conversations take place (routed to either connected workers or virtual providers), those discrete operations and interactions generate `execution_invocations` with `type === "chat"`.
This provides a clear audit log of the agent's work and prompt history separate from the user-facing `ConversationThreadRecord` and `ConversationMessageRecord` items.
User-facing chat threads show up with `scope === "project"`, while agent background logs and execution runs appear with `scope === "connection"`.

## Realtime Synchronization

When an invocation or its messages are created/updated, the server emits a project-scoped realtime event.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: true })\`: Triggered on major state changes like creation and status updates.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: false })\`: Triggered when appending messages to avoid heavy recalculations if only appending content.

## Relationships

Execution invocations cascade when their parent \`project_id\`, \`sprint_id\`, or \`task_id\` are deleted. They optionally reference \`task_run_id\` or \`dispatch_id\` but function independently to track planning sweeps, conflict resolution, or ad-hoc agent activity.
