# Card CI Status Projection

## Purpose and scope

Task, Sprint, and Live cards expose the same compact persisted `ciStatus` value without loading the remote `GitTrackingStatus` snapshot. The optional value is `pending`, `running`, `failed`, or `null` after the relevant gate settles.

This projection is a read model only. It does not poll a Git host, change orchestration decisions, or persist a second CI state table.

## Source files

- `src/contracts/app-types.ts` and `src/contracts/project-management-types.ts` define `CardCiStatus` and the card response fields.
- `src/domain/sprint/card-ci-status.ts` contains the pure task, main-merge, and sprint resolvers.
- `src/repositories/project-management/card-ci-status-query.ts` batch-loads persisted gate and attention evidence.
- `src/repositories/project-management-repository.ts` projects task and sprint card responses.
- `src/repositories/project-runtime/runtime-status-projection.ts` projects the same state onto Live subtasks.

## Data flow

The batched query selects the latest `ci_gate_status` event for each task within its sprint's latest run and the latest `main_merge_gate_status` event from that run. Selection is deterministic by event timestamp and event identity. Scoping task/main-merge gates and run-linked CI attention to the latest run prevents failed or pending evidence from a prior attempt from becoming the current run's stage. Unlinked evidence remains compatible when it was recorded after the latest run began, while unlinked attention remains available for durable/manual handoffs. The query returns only task/sprint failure membership; attention payloads and failed logs never cross the compact contract.

Task resolution follows these rules:

1. A durable `merge_indicator = CI` without a newer usable gate detail is `pending`.
2. A latest gate detail that is waiting on checks is `running`.
3. Failed checks, a blocked task gate, or active task-scoped CI repair attention is `failed`.
4. A settled task or a newer settled/non-CI gate detail returns `null`, even if older waiting or failure events remain in history.

Sprint resolution aggregates task results with its latest main-merge gate and active main-merge CI attention. Precedence is `failed`, then `running`, then `pending`.

Sprint lifecycle and QA are projected with the same run boundary. A `cancel_requested` run remains active and is exposed as sprint/project `running` until its dispatches stop and the run reaches `cancelled`; compact active-task reads retain its tasks during that shutdown window. Active run states remain authoritative. After a run becomes terminal, a newer explicit sprint-row update, such as manual completion after runtime cleanup or a later operator pause, takes precedence so historical run state cannot overwrite the operator's newer state. Task- and sprint-completion `latestReview` values are selected from the latest sprint run; legacy or manual rows without a run link remain eligible only when they were created after that latest run began. Within one QA cycle, recovery attempts from the same reviewer collapse to that reviewer's latest row before blocking-state precedence is applied across distinct reviewers. A passing recovery therefore replaces its own interrupted/cancelled row without hiding a different reviewer's requested changes or provider failure. Starting a later run clears prior-run QA and main-merge stages from the current card without deleting their audit history.

A review-only `review_blocked` main-merge event does not produce a failed CI status. Explicit failed-check evidence (`state = failed_checks` or `hasFailedChecks = true`) and active main-merge CI repair attention still produce `failed`.

The dashboard expands this compact persisted state with project-scoped execution evidence at each page boundary. Task, Live, and Overview cards use the durable six-stage delivery projection Coding, Pull request, QA, CI, Merge, and Completion. Sprint gallery and ledger cards use the sprint-specific seven-stage projection Planning, Coding, QA, Pull request, CI, Merge, and Completion. Their Planning state comes from the latest sprint-scoped planning invocation, so an idle sprint with active planning lights the first stage before tasks are materialized. CI evidence enriches the later stages but is optional, so a refresh that omits historical gate events cannot unmount or flash away the workflow badge. A durably completed workflow settles missing historical PR, checks, and merge projections as successful instead of displaying contradictory pending stages. Every stage uses outcome text in addition to its icon and tone.

Active, task-matched human-only attention has presentation precedence over the ordinary lifecycle and gate summary: the trigger becomes red **Human needed** while its disclosure retains the task's six workflow stages or the sprint's seven workflow stages. This predicate requires explicit attention-item evidence: status must be `open` or `claimed`, ownership must be `human`/`user`, and the worker-assignment field must be explicitly `null`. Resolved, dismissed, expired, worker-owned, system-owned, worker-assigned, sibling-task, and sibling-sprint attention never activates this override. Sprint-run intervention summaries do not qualify because they omit status and assignment and may be synthesized from lifecycle events such as manual pause or runtime error.

The lean execution snapshot carries this evidence in `sprintWorkflowProjections`, separate from the bounded activity feeds. Planning is selected by invocation start/creation identity rather than heartbeat updates, and strict human intervention is queried across all active task attention rows rather than the 50-item dashboard feed. This keeps Planning and **Human needed** stable after feed stripping and on very large sprints.

The shared `WorkflowStatusBadge` renders the applicable six- or seven-stage flow as a circular rail with motion-safe dotted connectors. Generic lifecycle-only triggers and disclosures are announced as workflow status/details; CI-specific labels are used only when CI evidence is actually present. The trigger opens by hover or activation and repeated activation closes it. Its viewport-positioned interaction region uses one lightly translucent, blurred outer surface around the opaque Delivery flow card, floating responsive arrow, and optional opaque QA review card. Each status circle is vertically centered against its stage entry, and the connector begins from that shared center geometry. Requested changes use the blue `QA edits` treatment even when failed-check evidence also exists; red is reserved for actual provider/runtime/workflow failures and explicit **Human needed** intervention. Live replaces its separate task lifecycle and QA badges with this projection, while Task, Sprint, and Overview surfaces retain their surrounding lifecycle context and replace standalone QA/CI disclosures. During active planning, including failed or cancelled planning, stale task CI and QA evidence is suppressed from visible text, accessibility text, and data state. During active coding below 100%, a running sprint suppresses task-level gate aggregation so its badge remains on Coding instead of flipping as different child tasks enter PR, CI, or Merge. At 100%, current-run sprint QA and explicit final CI/merge evidence become visible; completion percentage alone never implies Merge. An active human-only intervention remains the higher-priority exception, and terminal lifecycle state wins over stale stage evidence.

Cross-surface integration coverage lives in `tests/dashboard/v2/qa-ci-card-status.integration.test.tsx`. Its deterministic fixture exercises pull-request creation, running checks, failure, recovery, active attention precedence, unrelated-event isolation, reconnect replay, and keyboard-only QA/CI disclosures across Task, Live, Sprint gallery, and Sprint ledger cards without Docker, provider CLIs, Git hosting, or a database.

## Configuration and defaults

There is no new setting and no database migration. The projection uses existing task rows, task-run events, sprint-run events, and project attention rows. Consumers that do not understand `ciStatus` remain compatible because the contract field is optional and nullable.

## Failure cases and troubleshooting

- Malformed event or attention JSON is ignored safely; a durable task `CI` indicator still produces `pending` when no usable detail exists.
- A stale badge usually means the producer did not append a settled gate event or did not resolve active CI attention. Inspect the latest event ordered by `created_at DESC, id DESC` and the attention row status.
- When a sprint has multiple attempts, inspect gate events and QA reviews on the latest sprint-run ID; earlier run evidence is intentionally historical and does not drive the current card.
- Resolved, dismissed, or expired attention rows do not contribute failure state.
- Project-management reads must not call GitHub, GitLab, `gh`, or the full Git status projection to repair missing evidence.

## Related links

- [Atomic Sprint Loop](../sprint-loop/atomic-loop.md)
- [Project Management Implementation](./project-management-implementation.md)
- [Project Runtime Integration](./project-runtime-integration.md)
- [Project Attention Foundation](./project-attention-foundation.md)
