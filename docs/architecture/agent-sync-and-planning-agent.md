# Agent Sync And Planning Agent

## Status
Implemented

## Purpose

Sprint OS now treats dashboard agents as database-backed records that can be seeded and refreshed from markdown files under:

- `<project>/.sprint-os/agents/*.md`
- `~/.sprint-os/agents/*.md`

The built-in roles are now:

- `Planning agent`
- `Project manager`
- `Quality assurance agent`
- `Worker`

These agents are used as follows:

- `Planning agent`
  - improve a sprint prompt before creation
  - plan sprint subtasks after creation
  - optionally start the sprint immediately after planning
- `Worker`
  - provide the editable execution prompt for background CLI task runs
  - provide the editable reply prompt for connected worker/listener inbox responses
- `Project manager`
  - provide the editable instruction source for worker-routed clarification auto-answer
- `Quality assurance agent`
  - review completed tasks and sprint completion with full sprint context
  - continue existing Jules or CLI task sessions with concrete fix instructions when QA requests changes

## Source Of Truth

Agents are stored in sqlite and edited from the dashboard.

SQLite remains the live authority, but projects can also mirror dashboard edits into project-local markdown under:

- `<project>/.sprint-os/agents/*.md`

That mirror is controlled by the project setting:

- `agents.saveToProjectDirectory` (default `true`)

That means:

- newly discovered markdown agents are imported into sqlite automatically
- existing DB agents remain editable in the dashboard
- when project markdown mirroring is enabled, dashboard create/update writes the agent body into a project-local markdown file
- mirrored project files use a filesystem-safe slug format such as `planning_agent.md`
- editing a default or home-backed agent from the dashboard creates a project-local override file instead of modifying the default/home source
- if the linked markdown file later differs from the DB copy, the agent is marked `out_of_sync`
- the dashboard can re-import one agent or bulk-sync all out-of-sync project agents back into sqlite on demand

## Agent Metadata

`agent_presets` now stores source metadata in addition to the editable instruction body:

- `source_path`
- `source_scope`
- `source_updated_at`
- `source_imported_at`
- `avatar_config_json` (used for dashboard UI avatars: body, hair, face, shirt, bottom)
- `memory_template_override_enabled`
- `memory_template_markdown`

These metadata fields are synced bidirectionally with project markdown files using a `---json` frontmatter codec:

```markdown
---json
{
  "avatarConfig": {
    "body": "human",
    "hair": "short"
  },
  "memoryTemplateOverrideEnabled": true,
  "memoryTemplateMarkdown": "Format memory here."
}
---
Agent instructions go here.
```

The API record also exposes derived sync state:

- `manual`
- `synced`
- `out_of_sync`
- `missing_source`

## Import Resolution

When Sprint OS syncs project agents:

1. project-level `.sprint-os/agents` is scanned first
2. repo-default `.sprint-os/agents` from the running Sprint OS checkout is scanned second
3. home-level `.sprint-os/agents` is scanned third
4. filename without `.md` becomes the agent name
5. project-scoped files win on name collisions
6. previously unseen agents are imported into sqlite automatically

## Planning Agent Flow

The Planning agent runs through the existing connected listen-mode inbox path or a virtual worker.

Behavior:

1. dashboard resolves the `Planning agent` from the DB.
2. dashboard selects an active listen-mode planning connection, preferring `worker` and then falling back to `listener`.
3. dashboard creates an execution invocation. If using a connected worker, it also opens a background, non-chat-visible thread (`scope: "connection"`) targeted at that worker.
4. dashboard posts a planning request message. It records the prompt, routing information, and any JSON-retry attempts as system/user/assistant messages in the invocation audit trail.
5. the worker (or virtual provider) processes the request and generates the reply.
6. Sprint OS captures the reply in the invocation, parses the payload, and applies the result. During parsing, Sprint OS utilizes a shared `src/services/structured-provider-response-service.ts` to execute virtual provider runs and automatically retry parsing using corrective prompts if the shape is malformed. The payload extraction leverages `src/services/planning-json-extractor.ts` to recursively search noisy, markdown-wrapped, or nested provider responses for the canonical JSON payload.

Planning route cancellation is explicit. Dashboard route handlers no longer bind sprint planning or prompt improvement to the HTTP response close event, so refreshing or closing the browser does not terminate the provider run. The sprint composer attaches a `clientRequestId` to each planning request; `Cancel Active Request` posts that id to the planning cancellation endpoint, while `New Sprint` only detaches the current composer UI and leaves the server-side planning run active.

When memory is enabled, planning prompts also include:

- the planning agent's current long-term memory for the project
- the current sprint's short-term learnings for that same planning agent when a sprint scope exists
- the effective learnings-capture instruction, using the agent-specific memory template override when configured

In Docker execution mode, planning runs against a snapshot workspace and captures `.task-learnings.md` back out of that snapshot volume so memory capture still works even though the provider never writes directly into the host repo path.

### Prompt Lineage

Sprint OS stores the complete lineage of a sprint's evolution:

- `originalPrompt`: The raw, unrefined request from the user.
- `goal`: The improved, technically precise description generated by the Planning agent.

This allows users to refer back to their original intent even after the Planning agent has refined the scope.

### Grounded Improve Prompt

The `Improve with AI` flow now encourages the Planning agent to scan the repository before suggesting improvements. This "grounded" approach allows the agent to:

- Verify existing file paths and module structures.
- Clarify architectural patterns and symbols mentioned in the prompt.
- Propose implementation-ready scopes that are aware of the codebase reality.

### Planning Overrides

The sprint composer can provide request-scoped overrides for the planning process:

- `planningAgentPresetId`: Select a specific agent preset to use for planning. Only presets with a `planning` label are eligible for selection. If omitted or invalid, the system falls back to the default built-in `Planning agent`.
- `workerId`: Explicitly route the planning request to a specific connected MCP worker.
- `virtualModel`: Override the default virtual worker model (e.g., using a more capable model for complex planning) without changing project-wide settings.

These overrides are honored by all planning-related actions, including `Improve with AI` (Plan ahead with AI), `Plan Only`, `Plan & Start`, and `Replan`. Selecting an alternate planning preset allows operators to use specialized instructions for a single sprint without changing the project's default worker routing or virtual model overrides.

### Replanning

Existing sprints can be explicitly replanned. When the `replan` flag is set, Sprint OS:

- Clears the existing task set and its dependencies.
- Generates a fresh DAG of tasks from the current sprint goal.
- Preserves the sprint's identity and metadata.

### Planning Contracts

The planning contract is now strictly enforced by the `PlanningPayloadValidator` during ingestion. The validator ensures that the planner emits database-ready tasks without improvising formatting, and triggers automatic JSON retries with explicit error guidance if the contract is violated:

- task keys should use `T01`, `T02`, `T03`, ... in topological order
- the `tasks` array itself is the DAG order
- dependencies must only reference keys defined earlier in the task list (forward references are rejected)
- every task must include `title`, `description`, `promptMarkdown`, `priority`, `executorType`, and `dependsOn`
- `priority` and `executorType` are validated against allowed enum values
- `promptMarkdown` is standardized to five sections in this exact order:
  - `## Objective`
  - `## Scope`
  - `## Implementation Requirements`
  - `## Constraints`
  - `## Verification`

This strict validation occurs before any tasks are written to the repository, ensuring that partial or malformed plans never reach the database. This keeps planning quality deterministic across providers and reduces executor ambiguity.

### Provider Throttling And Quota Recovery

Virtual planning now classifies retryable provider failures before deciding whether to fail the invocation:

- `QUOTA_EXHAUSTED` means the provider reported a real quota window, optionally with a reset time.
- `RATE_LIMITED` means the provider rejected the request transiently, including Gemini `429` no-capacity responses.

Planning follows the shared CLI workflow retry controls:

- `cliWorkflow.retryOnQuotaReset` (default `true`)
- `cliWorkflow.retryOnRateLimit` (default `true`)
- `cliWorkflow.rateLimitRetryDelaySeconds` (default `10`)
- `cliWorkflow.maxRateLimitRetries` (default `5`)

When a retryable provider error occurs, Sprint OS appends an explicit system event to the execution invocation, records the classified error on the invocation row, waits for the configured backoff/reset, and retries. Rate-limit retries stop after the configured max retry count, while quota-reset retries still wait for the provider's reset window. For providers that support native session continuation, each retry now resumes the prior provider session instead of starting a brand-new conversation. That makes the dashboard invocation rail and message history show:

- which error type occurred
- whether Sprint OS is waiting on quota reset or rate-limit backoff
- which virtual model the planning agent actually used

If `autoStart` is enabled, Sprint OS starts orchestration after the tasks are created.

## Worker Agent Flow

The Worker agent is resolved from sqlite in the same way as the Planning agent.

Behavior:

1. Sprint OS syncs/imports the `Worker` preset from markdown if a linked project/default/home file exists
2. task execution prompt assembly loads the `Worker` instructions from sqlite
3. dashboard inbox reply generation also loads the `Worker` instructions from sqlite
4. when the dashboard edits `Worker`, the DB record is updated and optionally mirrored back into `<project>/.sprint-os/agents/worker.md`

This replaces the old `worker.md` and `listener.md` guide-loading path.

## Instruction Templates

Sprint protocol text such as planning blockers, merge guidance, attention summaries, watch-loop headers, and cleanup output is no longer file-backed.

Those templates now live in scoped settings:

- `agents.instructionTemplates`

They are edited from:

- `Settings -> Agents`

Built-in defaults remain in code, while system and project settings can override them in sqlite.

## Dashboard Surface

### Agents page

The Agents page now shows:

- normal editable DB agent fields
- whether an agent is DB-only or markdown-backed
- out-of-sync state for changed markdown
- `Import` action for linked markdown agents
- `Sync All` action for pulling all out-of-sync local markdown back into sqlite
- agent preset management only; QA execution settings live under `Settings -> Agents`

### Sprints page

The sprint creation modal now supports:

- `Improve with AI`
- `Plan & Start`
- `Plan Only`
- `Save Draft`

Both `Improve with AI` and planning actions are worker-backed via the Planning agent.

## Default Agent

This repository now includes the default built-in agent file:

- `.sprint-os/agents/planning_agent.md`
- `.sprint-os/agents/project_manager.md`
- `.sprint-os/agents/quality_assurance_agent.md`
- `.sprint-os/agents/worker.md`

These files are auto-imported when this repository is used as the selected project and no DB record exists yet.

The repository also now includes:

- `.sprint-os/agents/worker.md`
