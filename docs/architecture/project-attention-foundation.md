# Project Attention Foundation

## Status
In Progress

## Purpose

`project_attention_items` is the first structured supervision queue for multi-project orchestration.

Before this slice, worker-visible problems such as lease expiry, blocked worker dispatches, and stalled cancellation existed only as dispatch state, runtime events, or log lines. There was no first-class queue that could be assigned, listed, and resolved independently from ordinary task execution.

## Current Implementation

Implemented on March 12, 2026:

- added `project_attention_items` to `app.db`
- added `ProjectAttentionRepository`
- added `ProjectAttentionService`
- active project execution snapshots now include `attentionItems`
- attention items now open from:
  - worker lease expiry during runtime cleanup
  - stale cancel-request timeout cleanup
  - worker dispatch updates that end in `BLOCKED`
  - merge-required tasks emitted by the sprint protocol step
  - blocked action-required tasks emitted by the sprint protocol step
  - watch-loop completion that pauses a sprint for true manual attention
- dispatch retry now resolves active attention items for that dispatch
- sprint cycles now resolve stale task-scoped merge/action items when the blocker clears

Primary files:

- `src/contracts/project-attention-types.ts`
- `src/repositories/project-attention-repository.ts`
- `src/domain/workers/project-attention-service.ts`
- `src/services/runtime-cleanup-service.ts`
- `src/services/worker-task-dispatch-service.ts`
- `src/services/execution-control-service.ts`

## Data Model

Each attention item stores:

- project scope
- optional sprint/task/dispatch references
- attention type
- severity
- owner type
- lifecycle status
- optional assigned worker endpoint
- title and markdown summary
- structured payload
- open/update/resolve timestamps

Current status values:

- `open`
- `claimed`
- `resolved`
- `dismissed`
- `expired`

Current owner types:

- `worker`
- `human`
- `system`

## Current Routing Rules

When an item is opened with `ownerType = worker`:

- prefer the current primary assigned worker for the project
- otherwise use an overflow assignment that can supervise projects
- otherwise leave the item unassigned
- a preferred worker endpoint is only kept when that endpoint is still effectively live; heartbeat-aged `stale` and `offline` workers are skipped immediately instead of waiting for a background cleanup rewrite

Worker listen-mode supervision now backfills that assignment path:

- when a worker enters `listen` for a project, Code UX ensures a project-worker assignment for that active project scope even if the worker has not claimed a task dispatch yet
- this lets worker-owned items that were opened before any dispatch activity still reach the connected worker through `listen`

This keeps the sticky-worker behavior intact without forcing a worker connection to be online at open time.

## Current Openers

### Worker lease expiry

When runtime cleanup finds an expired worker dispatch lease:

- the dispatch is moved to `blocked`
- the task run becomes `BLOCKED`
- the task resets to `pending`
- an attention item opens with type `worker_lease_expired`

### Stale cancel-request timeout

When runtime cleanup force-cancels a stale `cancel_requested` worker dispatch:

- an attention item opens with type `dispatch_cancel_stalled`

### Worker-reported blocked dispatch

When a worker updates a dispatch with terminal state `BLOCKED`:

- an attention item opens with type `worker_dispatch_blocked`

### Merge-required protocol tasks

When the sprint protocol detects a completed task that still needs merge handling:

- a task-scoped attention item opens with type `merge_required`
- the payload includes `repoPath`, feature branch, worker branch, and PR URL context
- owner routing stays with the assigned project worker

### Merge-conflict escalation

When CI intelligence sees a feature PR in `DIRTY` merge state and `ciIntelligence.resolveMergeConflicts` is enabled:

- the protocol opens a task-scoped attention item with type `merge_conflict`
- the item stays worker-owned so the connected worker receives it through `listen`
- the payload includes:
  - `repoPath` and `workingDirectoryHint`
  - conflicting source and target branches
  - PR number, URL, and merge-state metadata
  - the current task key, title, and main prompt
  - the prompts for merged tasks already present on the feature branch
- generic `merge_required` attention for the same task is resolved automatically so the queue shows one clear conflict item
- these worker-owned conflict items do not count as human merge protocol anymore, so the watch loop keeps running instead of pausing for operator merge work
- once a worker-owned `merge_conflict` item exists for a task, the orchestrator keeps that routing sticky across later loops until the blocker clears; a stale or incomplete PR snapshot no longer downgrades the task back into manual `merge_required` pause flow
- feature PR auto-merge failures now also promote into the same worker-owned `merge_conflict` path when the merge command reports a real merge conflict, even if the last PR snapshot had not yet surfaced `DIRTY`
- the watch loop now also trusts the active worker-owned `merge_conflict` queue directly, so an already-open conflict item cannot regress into `no further action possible` if one cycle returns incomplete merge classification
- assignment for these conflict items now uses effective heartbeat status, not just persisted worker status, so a dead primary worker cannot keep conflict items pinned away from the live connected worker
- the same watch-loop guard now applies to any open or claimed worker-owned attention item, not just merge conflicts, so worker-managed `action_required` and `worker_dispatch_blocked` states no longer collapse into the generic `manual_attention` sprint pause while the worker still has actionable supervision work

When the main merge PR (`feature -> default`) is in `DIRTY` state and `ciIntelligence.resolveMainMergeConflicts` is enabled:

- the completion path opens a sprint-scoped worker-owned `merge_conflict` item
- the payload includes `repoPath`, working-directory hint, conflicting branches, PR metadata, sprint identity, and merged task prompts already present on the feature branch
- this keeps main-branch conflict handling on the connected worker instead of downgrading it into a dashboard/operator blocker by default

### Blocked action-required protocol tasks

When the sprint protocol detects a blocked task that still requires intervention:

- a task-scoped attention item opens with type `action_required`
- owner routing follows intervention ownership:
  - `worker` for agent-managed recovery
  - `human` for operator-only decisions
- the payload includes `repoPath`, session state, provider, and intervention owner
- clarification auto-reply dedupe is not treated as a new `action_required` attention state; once Code UX has answered the latest clarification prompt, the task remains in automated recovery and repeated cycles skip the same clarification until Jules emits a different request

### Watch-loop manual attention pause

When the watch loop finishes because no further automatic progress is possible:

- a sprint-scoped attention item opens with type `manual_attention`
- the payload includes `repoPath`, feature branch, and the blocked/running/ready task summary
- this gives the assigned worker one sprint-level queue item even when the pause reason is broader than a single dispatch
- pure dependency progression does not trigger this pause: if a task automerge or other CI-gate transition makes downstream tasks ready, Code UX re-derives readiness before deciding that manual attention is required

## Current Resolution Rule

When an operator retries a dispatch through execution control:

- all active attention items for that dispatch resolve automatically

When the sprint loop later observes that a task is no longer awaiting merge or action-required intervention:

- the matching task-scoped attention items resolve automatically

When the watch loop finishes in any state other than manual-attention pause:

- sprint-level `manual_attention` items for that sprint run resolve automatically

When dashboard GitHub polling later observes that a merge-conflict-derived attention item now points at a PR that is merged or no longer `DIRTY`:

- the matching `merge_conflict`, `human_escalation_required`, or `dashboard_reply_required` item resolves automatically
- this applies even after the sprint run is already completed, so stale main-merge conflict escalations do not persist forever once GitHub state has moved on

This prevents stale queue entries after the system has been told to attempt recovery.

## Worker Action Tools

Implemented on March 13, 2026:

- `claim_attention_item`
  - worker-only tool
  - marks a worker-owned item as `claimed`
  - stamps `claimedAt`, `assignedWorkerEndpointId`, and claim metadata in payload
- `resolve_attention_item`
  - available to workers and the project-manager runtime
  - resolves or dismisses one queue item explicitly
  - stamps `resolvedAt`, optional replacement summary markdown, and resolution metadata in payload
- `report_attention_outcome`
  - worker-only tool
  - records a structured supervision outcome for a claimed worker item
  - supports:
    - `handled_locally`
    - `needs_dashboard_reply`
    - `needs_human_escalation`
  - when operator follow-up is required, it creates a project conversation thread bound to the same worker connection, posts a system-authored handoff message, resolves the original worker item, and opens a human-owned handoff attention item

Current worker ownership guardrails:

- only `ownerType = worker` items are claimable by workers
- if an attention item is already assigned to another worker endpoint, claim/resolve attempts are rejected
- claimed items are not re-delivered through the worker listen loop

Current worker runtime behavior:

- the in-repo worker client now treats `attention_item` as actionable supervision work, not just a log event
- when a worker receives an open worker-owned item, it immediately calls `claim_attention_item`
- after claim, the worker now reports a structured outcome instead of holding the item indefinitely:
  - `merge_required`, `action_required`, and `manual_attention` currently map to escalation-style outcomes in the in-repo worker client
  - `merge_conflict` is claimed and then left worker-owned so the conflict stays assigned to the connected worker instead of being immediately re-routed into human escalation
  - other current worker queue items map to `needs_dashboard_reply`
- the worker keeps a local supervision map keyed by project so future `listen` calls carry the currently active supervised projects
- assignment changes and claimed attention items now update that local project context, including `repoPath` and `workingDirectoryHint`

Current human handoff types:

- `dashboard_reply_required`
  - human-owned queue item opened when the worker needs a dashboard/operator reply
- `human_escalation_required`
  - human-owned queue item opened when the worker concludes the blocker needs direct operator intervention

## Dashboard Controls

Implemented on March 13, 2026:

- the live runtime dashboard now renders the active project attention queue from `execution.attentionItems`
- operators can:
  - claim a worker-owned item for the assigned project worker
  - resolve an item from the queue
  - dismiss an item from the queue
- dashboard actions use:
  - `POST /api/projects/:projectId/attention-items/:attentionItemId/claim`
  - `POST /api/projects/:projectId/attention-items/:attentionItemId/resolve`

Current dashboard behavior:

- claim prefers the item's current assigned worker endpoint
- if the item is unassigned, claim falls back to the project's primary supervising worker, then overflow worker
- resolved and dismissed items drop out of the active execution snapshot because the dashboard only shows `open` and `claimed` items
- attention open/claim/resolve mutations now trigger a direct project execution realtime refresh, so the Live view updates immediately instead of waiting for adjacent execution events

## Current Limitation

This is still the first structured queue, not the final supervision product.

Still pending:

- richer worker-side automation after an `attention_item` is delivered
- human-only and system-only queue surfaces
- reopen and expiry policy beyond current dispatch/task/sprint-run resolution rules
