1. Update `tests/backend/services/cli-workflow-service.test.ts`:
  - Add tests for `runTaskWorkflow` error path (e.g., throwing error in `executePrepareStage`).
  - Add test for `runTaskWorkflow` normal path returning correctly.
  - Add tests testing the `resumeFailedTaskInSameWorkspace` functionality.
2. Update `tests/backend/services/git-status-service.test.ts`:
  - Add tests for `enrichFailedRunDetails` and its dependencies (`fetchFailedRunJobs`, `fetchFailedJobLogExcerpt`). This involves sending in failed CI runs and mocking `gh run view <runId> --job <jobId> --log-failed`.
  - Add test paths that return warnings when GitHub CLI fetching errors occur or PRs have conflicts.
  - Add tests that branch onto different warning states like 'No open PRs are currently targeting the active feature branch.'
  - Add tests to hit the `hasChanges = false` short circuit path.
3. Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
4. Push to branch `feature/sprint3-test-coverage`.
