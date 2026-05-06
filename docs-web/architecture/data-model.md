# Data model

This page describes the entities Code UX persists and how they relate. The default backend is SQLite; a Postgres migration is planned but not yet shipped.

The on-disk markdown form for sprints and subtasks is documented separately in [Sprint format](../developer/sprint-format.md).

## Entity overview

```
Project
├── Sprint
│   ├── Subtask (Task)
│   │   ├── TaskRun
│   │   │   └── TaskDispatch
│   │   └── Activity (per session)
│   ├── SprintRun
│   │   └── ExecutionInvocation
│   └── PreviewSession
├── AgentPreset
├── Memory
│   ├── short-term (sprint-scoped)
│   └── long-term (project-scoped)
├── ConversationThread
│   └── ConversationMessage
├── QuicksprintTemplate
├── AttentionItem
└── WorkerEndpoint / Connection
```

## Project

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Primary key. |
| `name` | string | Human label. |
| `repositoryPath` | string | Absolute path. |
| `defaultBranch` | string | e.g. `main`. |
| `featureBranchPrefix` | string | e.g. `feature/codeux/`. |
| `githubMode` | enum | `REMOTE` or `LOCAL`. |
| `description` | string | Optional. |
| `selectedSprintId` | string | Currently selected sprint (UI hint). |
| `preferredWorkerEndpointId` | string | Routing hint. |
| `createdAt`, `updatedAt` | datetime | – |

Has-many: sprints, agent presets, memories, conversation threads, attention items, settings overrides.

## Sprint

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Primary key. |
| `projectId` | string | FK. |
| `name` | string | – |
| `number` | int | Unique within project. |
| `goal` | text | Free-form. |
| `featureBranch` | string | – |
| `status` | enum | `idle`/`running`/`paused`/`completed`/`failed`/`cancelled`. |
| `startDate`, `endDate` | date | Informational. |
| `showcasePinned` | bool | Pinned to overview. |
| `createdAt`, `updatedAt` | datetime | – |

Has-many: subtasks, sprint runs, preview sessions, settings overrides.

## Subtask (Task)

| Field | Type | Notes |
| --- | --- | --- |
| `id` *(record_id)* | string | Primary key. |
| `projectId`, `sprintId` | string | FK. |
| `taskId` | string | Human-readable URL-safe ID (matches markdown filename). |
| `title` | string | – |
| `prompt` | text | – |
| `dependsOnTaskIds` | string[] | Task IDs (not record IDs). |
| `isIndependent` | bool | Defaults true. |
| `status` | enum | `PENDING`/`RUNNING`/`CODING_COMPLETED`/`COMPLETED`/`FAILED`/`BLOCKED`/`QUOTA`/`QA_REVIEW_FAILED`. |
| `mergeIndicator` | enum | `CI`/`AUTOMERGE`/`MERGED`/`MERGE_BLOCKED`/`MERGE_CONFLICT`/`PR_ONLY`/`QA_PENDING`. |
| `isMerged` | bool | – |
| `provider` | enum | Provider that ran this task. |
| `sessionId`, `sessionName`, `sessionState` | string | Linked agent session. |
| `workerBranch`, `prUrl` | string | Git outputs. |
| `interventionOwner` | enum | `HUMAN` or `AGENT`. |
| `interventionHint` | string | – |
| `qaReview` | json | QA agent output blob. |
| `priority` | int | Tiebreaker for scheduling. |
| `createdAt`, `updatedAt` | datetime | – |

Has-many: TaskRuns (one per execution attempt). Each TaskRun has-many TaskDispatches.

## SprintRun

A specific execution attempt of a sprint.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `sprintId` | string | FK. |
| `status` | enum | `running`/`paused`/`cancel_requested`/`cancelled`/`completed`/`failed`. |
| `startedAt`, `endedAt` | datetime | – |
| `leaseToken` | string | Heartbeat lease. |
| `leaseExpiresAt` | datetime | – |

Has-many: ExecutionInvocations (granular events).

## TaskDispatch

One invocation of a worker for a task.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `taskRunId` | string | FK. |
| `executorType` | enum | `jules`/`docker_cli`/`host_cli`. |
| `provider`, `model` | string | – |
| `state` | enum | Provider-side dispatch state. |
| `controlAction` | enum | `null`/`cancel`/`pause`. |
| `workerEndpointId` | string | Which connection ran it. |
| `worktreePath` | string | – |
| `startedAt`, `endedAt`, `durationMs` | – | – |
| `failureReason` | string | – |

## ExecutionInvocation

A granular event in a sprint run (cycle start, task transition, gate decision, MCP call). Used by `/api/execution/invocations` and the timeline.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `projectId`, `sprintId`, `sprintRunId`, `taskId` | string | FK (some optional). |
| `type` | string | e.g. `cycle.start`, `task.transition`, `ci_gate`, `mcp.call`. |
| `payload` | json | Event-specific. |
| `at` | datetime | – |

## AgentPreset

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `projectId` | string | FK. |
| `name` | string | Unique within project. |
| `instructionMarkdown` | text | The persona prompt. |
| `labels` | string[] | – |
| `avatarConfig` | json | Procedural avatar seed. |
| `memoryTemplateOverrideEnabled` | bool | – |
| `memoryTemplateMarkdown` | text | If override is on. |
| `createdAt`, `updatedAt` | datetime | – |

## Memory

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `projectId` | string | FK. |
| `scope` | enum | `project`/`sprint`/`agent`. |
| `sprintId` | string | If scope=sprint. |
| `agentPresetId` | string | If scope=agent. |
| `content` | text | – |
| `category` | string | `context`/`architecture`/`codebase`/etc. |
| `strength` | float | Weighting (0..n). |
| `embeddingModelId` | string | The model used for vectorisation. |
| `embedding` | float[] | Vector. |
| `createdAt`, `updatedAt` | datetime | – |

Memories with mismatched `embeddingModelId` are excluded from search; trigger re-embed to bring them back in.

## ConversationThread / ConversationMessage

| Field | Type | Notes |
| --- | --- | --- |
| Thread `id` | string | – |
| Thread `projectId` | string | FK. |
| Thread `title` | string | Editable. |
| Thread `routeConfig` | json | Provider/agent routing. |
| Message `id` | string | – |
| Message `threadId` | string | FK. |
| Message `role` | enum | `user`/`assistant`/`tool`. |
| Message `bodyMarkdown` | text | – |
| Message `metadata` | json | – |
| Message `at` | datetime | – |

## QuicksprintTemplate

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `projectId` | string | FK. |
| `name`, `description` | string | – |
| `promptTemplate` | text | With `{{key}}` placeholders. |
| `defaultSprintNameTemplate` | string | – |
| `variables` | json[] | `{ key, label, type, default, options }`. |
| `tags` | string[] | – |

## AttentionItem

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `projectId` | string | FK. |
| `sprintRunId`, `taskId` | string | Optional FK. |
| `category` | enum | `merge_conflict`/`ci_failure`/`action_required`/`qa_review_failed`/etc. |
| `claimantConnectionId` | string | – |
| `claimedAt`, `resolvedAt` | datetime | – |
| `payload` | json | Category-specific. |

## WorkerEndpoint / Connection

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `endpointKey` | string | Stable client-supplied ID. |
| `displayName` | string | – |
| `role` | enum | `project_manager`/`worker`/`listener`. |
| `transport` | enum | `stdio`/`http`/`internal`. |
| `capabilities` | json | – |
| `status` | enum | `connected`/`disconnected`. |
| `boundProjectIds`, `activeProjectIds` | string[] | – |
| `lastActivityAt` | datetime | – |

Ephemeral virtual workers also use this table — their endpoints have prefix `virtual:` and are deleted post-dispatch.

## PreviewSession

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | – |
| `projectId`, `sprintId` | string | FK. |
| `status` | enum | `starting`/`running`/`stopped`/`failed`. |
| `containerId` | string | Docker container ID. |
| `portMappings` | json[] | `{ container, host }`. |
| `startedAt`, `stoppedAt` | datetime | – |
| `lastHealthAt` | datetime | – |

## Settings overrides

Three tables: `system_settings` (singleton), `project_settings_overrides` (per project), `sprint_settings_overrides` (per sprint).

Each row is a sparse JSON document — only overridden fields are stored. Effective settings are computed by merging defaults → system → project → sprint at read time.

## Index summary

Primary indexes (besides PKs):

- `subtasks.sprintId`
- `subtasks.status` (for "currently RUNNING" queries)
- `task_runs.taskId`
- `task_dispatches.taskRunId, startedAt`
- `execution_invocations.projectId, sprintRunId, at`
- `memories.projectId, embeddingModelId`
- `attention_items.projectId, resolvedAt`
- `worker_endpoints.endpointKey` (unique)
