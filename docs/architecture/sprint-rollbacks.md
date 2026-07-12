# Sprint Rollbacks

Sprint rollback is a first-class orchestration mode that reverses an integrated sprint without rewriting the source sprint or the default branch. Every request creates a dedicated rollback sprint, rollback branch, and remote pull request.

## Safety contract

A rollback is eligible only when all of these conditions hold:

- the source belongs to the selected project and is a completed standard sprint;
- the project uses `REMOTE` git mode;
- the repository path and recorded source feature branch are available;
- no active or completed rollback sprint already targets the source.

Code UX recommends the automatic path only when it can additionally prove that:

- no later non-rollback sprint has started or completed;
- the current `origin/<default>` tip is an isolated merge commit;
- the merge message or second parent proves that the merge belongs to the source feature branch.

These checks are intentionally conservative. An ambiguous history is not an automatic failure: it selects the agent-assisted path.

## Automatic path

`SprintRollbackService` fetches the default branch, creates a detached temporary worktree, creates a unique `rollback/<source>-<suffix>` branch, and runs `git revert -m 1` against the proven integration merge. The branch is pushed to `origin` only after the revert succeeds. The visible checkout and uncommitted user work are never changed.

The rollback sprint receives one already-settled audit task and starts normal finalization. Automatic rollbacks skip task/sprint provider work, completion QA, and memory-remediation invocation. They still use the normal remote main-merge gate for PR creation, CI observation, conflict repair, and final completion.

If the deterministic revert conflicts or any Git step cannot complete safely, the same rollback sprint is changed to `agent_assisted` and receives a pending rollback task.

## Agent-assisted path

An agent is always used when:

- later sprint work may depend on the source;
- the integration merge cannot be proven;
- the automatic revert fails;
- the user enters rollback instructions, including a partial request such as “remove only feature XY.”

The generated task prompt includes the source sprint key and branch, rollback branch, safety findings, requested scope, preservation requirements, tests, and a prohibition on merging directly to the default branch. The task runs through the existing coding, QA, Git, and CI pipeline.

## Pull-request invariant

Rollback finalization forces remote PR monitoring even if ordinary sprint monitoring is disabled. For a rollback sprint, `mainBranchAutoMergeMode=OFF` behaves as `CREATE_PR`: Code UX creates the PR and pauses until a human merges it. Other configured modes retain their normal CI and auto-merge behavior. A rollback run is not marked complete until the Git host reports the rollback PR merged.

## Persistence

The `sprints` record keeps immutable rollback lineage and execution intent:

- `kind`: `standard` or `rollback`;
- `rollback_source_sprint_id`;
- `rollback_mode`: `automatic` or `agent_assisted`;
- `rollback_instructions`;
- `rollback_safety_reason`.

The source sprint cannot be deleted while a rollback sprint references it. This preserves audit history and lets the dashboard link the corrective sprint to its cause.

## HTTP surface

- `GET /api/projects/:projectId/sprints/:sprintId/rollback/assessment`
- `POST /api/projects/:projectId/sprints/:sprintId/rollback` with optional `{ "instructions": "..." }`

The assessment returns eligibility, the recommended mode, and user-facing safety reasons. Creation returns the dedicated rollback sprint, selected mode, and final assessment; HTTP `202` means orchestration was accepted.

## Verification

```bash
pnpm exec vitest run tests/backend/services/sprint-rollback-service.test.ts tests/backend/server/sprint-rollback-routes.test.ts
pnpm exec vitest run dashboard/src/v2/components/sprints/__tests__/SprintRollbackModal.test.tsx dashboard/src/v2/components/sprints/__tests__/SprintCell.visual.test.tsx
pnpm run lint
pnpm run build
```
