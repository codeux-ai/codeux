# Execution Invocation Tracking

## Overview

The `ExecutionRepository` manages `execution_invocations` and `execution_invocation_messages`, a first-class model for tracking context, prompt flows, tool calls, and LLM responses. This architecture provides robust observability, historical context per sprint, and dashboard tracing capabilities without tying invocation solely to single provider usage records.

## Key Structures

### `execution_invocations`
This table represents the high-level LLM request or agent session. It holds metadata such as provider, model, status, and associated task context (if any). It can also point back to native token reporting in `provider_invocations` via `provider_invocation_id`. It keeps a rolled up `message_count` and `last_message_at` for sorting dashboard displays.

Execution invocations span various purposes:
- **Coding & Virtual Planning**: Core orchestration loops.
- **Clarification**: Prompt rewrites or operator clarification flows.
- **QA Coverage**: Automated verification and quality assurance sweeps.

For supported models, tracking relies on provider-reported usage. For Jules integrations, we compute **estimated** tokens by accumulating input and output characters divided by 4 (the characters-per-token heuristic), keeping it accounted for without inventing authoritative native counts.

### `execution_invocation_messages`
This table records each granular interaction loop in an invocation, preserving the exact sequence of \`system\`, \`user\`, \`assistant\`, and \`tool\` messages. It persists markdown content and parsed JSON arguments for tool calls, serving as a replayable log of an agent's reasoning process.

Before being written to the database, provider-specific conversation turns are normalized and mapped into a standard message format within `src/services/provider-conversation-message-mapper.ts`. This ensures that specialized kinds like reasoning and tool interactions are mapped to correct unified schema values (e.g. keeping reasoning distinct without changing core DB schemas).

Invocation persistence applies a narrow hygiene sanitizer for one known noisy bootstrap case: lines matching `fatal: your current branch 'code-ux-bootstrap-*' does not have any commits yet` are removed before chat-facing invocation message content is written. Other `fatal:` lines and unrelated stderr/stdout remain unchanged so real failures still surface.

## Chat Thread Usage
Execution invocations are heavily used by the Chat page to track activity.
When chat conversations take place (routed to either connected workers or virtual providers), those discrete operations and interactions generate `execution_invocations` with `type === "chat"`.
This provides a clear audit log of the agent's work and prompt history separate from the user-facing `ConversationThreadRecord` and `ConversationMessageRecord` items.
User-facing chat threads show up with `scope === "project"`, while agent background logs and execution runs appear with `scope === "connection"`.

## Realtime Synchronization

When an invocation or its messages are created/updated, the server emits a project-scoped realtime event.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: true })\`: Triggered on major state changes like creation and status updates.
- \`scheduleProjectExecutionRefresh(projectId, { includeOverview: false })\`: Triggered when appending messages to avoid heavy recalculations if only appending content.
- Burst writes are coalesced in \`ExecutionRepository\` per project on the next tick. If any write in the burst requires overview refresh, the coalesced dispatch escalates to \`includeOverview: true\`.

## Startup Recovery

CLI-backed provider invocations now persist their workflow execution mode alongside the session id used to launch the worker.

On Code UX restart, runtime recovery reconciles any still-`running` CLI provider invocations before the dashboard rehydrates:
- tracked background CLI sessions recovered from `session-tracking.db` are marked failed because the original owning process exited
- Docker-backed invocations are checked against active Docker containers using the `code-ux.session-id` label; if no active container remains, the provider invocation and linked execution invocation are failed and annotated with a recovery message

This prevents stale `qa_review` or worker invocations from remaining indefinitely `running` after the underlying container or host process has already exited.

## Relationships

Execution invocations cascade when their parent \`project_id\`, \`sprint_id\`, or \`task_id\` are deleted. They optionally reference \`task_run_id\` or \`dispatch_id\` but function independently to track planning sweeps, conflict resolution, or ad-hoc agent activity.

Additionally, every execution invocation explicitly links to a `provider_invocations` usage row. The execution transcripts stored in `execution_invocation_messages` serve as the replayable prompt history corresponding to the exact token and time consumption recorded in the usage row, allowing the dashboard Stats page to drill down into the exact sequence that generated specific costs.
