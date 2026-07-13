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

The batched query selects the latest `ci_gate_status` event for each task and the latest `main_merge_gate_status` event for each sprint. Selection is deterministic by event timestamp and event identity. It also reads active `open` or `claimed` CI repair attention rows, but returns only task/sprint failure membership; attention payloads and failed logs never cross the compact contract.

Task resolution follows these rules:

1. A durable `merge_indicator = CI` without a newer usable gate detail is `pending`.
2. A latest gate detail that is waiting on checks is `running`.
3. Failed checks, a blocked task gate, or active task-scoped CI repair attention is `failed`.
4. A settled task or a newer settled/non-CI gate detail returns `null`, even if older waiting or failure events remain in history.

Sprint resolution aggregates task results with its latest main-merge gate and active main-merge CI attention. Precedence is `failed`, then `running`, then `pending`.

The dashboard expands this compact persisted state with project-scoped execution evidence at each page boundary. Tasks and Live derive task-scoped pull-request, checks, and merge steps; the Sprint gallery and ledger share the sprint-scoped aggregation. Every step uses outcome text in addition to its icon and tone. Successful pull-request evidence is announced as `Pull request ready`, running checks as `Checks running`, failed checks as `Checks failed`, and recovered checks as `Checks passed`, so assistive technology never receives raw enum values as the status label.

Cross-surface integration coverage lives in `tests/dashboard/v2/qa-ci-card-status.integration.test.tsx`. Its deterministic fixture exercises pull-request creation, running checks, failure, recovery, active attention precedence, unrelated-event isolation, reconnect replay, and keyboard-only QA/CI disclosures across Task, Live, Sprint gallery, and Sprint ledger cards without Docker, provider CLIs, Git hosting, or a database.

## Configuration and defaults

There is no new setting and no database migration. The projection uses existing task rows, task-run events, sprint-run events, and project attention rows. Consumers that do not understand `ciStatus` remain compatible because the contract field is optional and nullable.

## Failure cases and troubleshooting

- Malformed event or attention JSON is ignored safely; a durable task `CI` indicator still produces `pending` when no usable detail exists.
- A stale badge usually means the producer did not append a settled gate event or did not resolve active CI attention. Inspect the latest event ordered by `created_at DESC, id DESC` and the attention row status.
- Resolved, dismissed, or expired attention rows do not contribute failure state.
- Project-management reads must not call GitHub, GitLab, `gh`, or the full Git status projection to repair missing evidence.

## Related links

- [Atomic Sprint Loop](../sprint-loop/atomic-loop.md)
- [Project Management Implementation](./project-management-implementation.md)
- [Project Runtime Integration](./project-runtime-integration.md)
- [Project Attention Foundation](./project-attention-foundation.md)
