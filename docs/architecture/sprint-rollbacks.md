# Sprint Rollbacks

Sprint rollback is a first-class orchestration mode that reverses an integrated sprint without rewriting the source sprint or Git history. Every request creates a dedicated rollback sprint and rollback branch. Remote projects deliver that branch through a pull request; local projects merge it directly into the configured local default branch during normal sprint finalization.

## Safety contract

A rollback is eligible only when all of these conditions hold:

- the source belongs to the selected project and is a completed standard sprint;
- the repository path and recorded source feature branch are available;
- no active or completed rollback sprint already targets the source.

Code UX recommends the automatic path only when it can additionally prove that:

- no later non-rollback sprint has started or completed;
- the current default-branch tip (`origin/<default>` in remote mode or `refs/heads/<default>` in local mode) is an isolated merge commit;
- the merge message or second parent proves that the merge belongs to the source feature branch.

These checks are intentionally conservative. An ambiguous history is not an automatic failure: it selects the agent-assisted path.

## Automatic path

`SprintRollbackService` refreshes the remote default branch when required, creates a detached temporary worktree, creates a unique `rollback/<source>-<suffix>` branch, and runs `git revert -m 1` against the proven integration merge. Temporary worktree commands remain rooted in the source repository and address the worktree with `git -C`, preserving the containerized Git helper's metadata paths. In remote mode the branch is pushed to `origin` only after the revert succeeds. In local mode no remote is fetched or pushed; the branch remains local for the orchestrator's final branch-to-default merge. The visible checkout and uncommitted user work are never changed.

The rollback sprint receives one already-settled audit task and starts normal finalization. Automatic rollback cycles have a hard dispatch boundary: they skip task dispatch, task QA, agent intervention, completion QA, and memory-remediation invocation even if a stale runtime projection temporarily presents the audit task as pending. Remote rollbacks still use the normal main-merge gate for PR creation, CI observation, conflict repair, and final completion. Local rollbacks use the existing temporary-worktree final merge, including dirty-checkout preservation and merge-conflict attention handling.

If the deterministic revert conflicts or any Git step cannot complete safely, the same rollback sprint is changed to `agent_assisted` and receives a pending rollback task.

## Agent-assisted path

An agent is always used when:

- later sprint work may depend on the source;
- the integration merge cannot be proven;
- the automatic revert fails;
- the user enters rollback instructions, including a partial request such as “remove only feature XY.”

The generated task prompt includes the source sprint key and branch, rollback branch, safety findings, requested scope, preservation requirements, tests, and a prohibition on merging directly to the default branch. Remote tasks commit and push for PR finalization. Local tasks commit without pushing or creating a PR, then use the existing local final-merge path.

## Delivery invariant

Remote rollback finalization forces PR monitoring even if ordinary sprint monitoring is disabled. Automatic remote rollbacks use `WHEN_GREEN` finalization unless the project already uses `ALWAYS`: Code UX creates the PR, waits for green checks, merges it automatically, and completes only after the Git host reports the merge. Agent-assisted remote rollbacks retain configured merge behavior; `mainBranchAutoMergeMode=OFF` becomes `CREATE_PR` so they still cannot bypass the PR boundary.

Local rollback finalization does not enable PR monitoring, fetch a remote, push the rollback branch, or create a PR. Once its rollback task is settled, Code UX merges the rollback branch into the configured local default branch through the standard isolated local worktree flow and completes only after that merge succeeds.

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
