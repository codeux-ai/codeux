title: Close Gaps in CliWorkflowService and GitStatusService
depends_on: []
is_independent: true
merged: false
prompt:
# Task Specification: T08 - Sprint 3

## Objective
Close test coverage gaps in `cli-workflow-service.ts` and `git-status-service.ts` to >= 80%.

## Files to Modify
- `tests/backend/services/cli-workflow-service.test.ts`
- `tests/backend/services/git-status-service.test.ts`

## Technical Details & Research Findings
- `cli-workflow-service.ts` (53.65%) and `git-status-service.ts` (50.66%) have significant coverage gaps.
- `CliWorkflowService` manages the lifecycle of tasks run through the CLI.
- `GitStatusService` fetches remote git status and enriches PRs.

## Execution Steps
1. Expand the existing test suites for both services.
2. For `CliWorkflowService`, add tests for:
    - Task starting and resuming logic.
    - Error handling during task execution.
3. For `GitStatusService`, add tests for:
    - Remote status fetching logic.
    - PR enrichment logic.
    - Error handling when interacting with the git API.
4. Run the tests and ensure they pass.
5. Run the coverage report and ensure each file has >= 80% line coverage.

## Verification Requirements
- Run `npm test -- tests/backend/services/`
- Run `npm run test:coverage` and verify that `cli-workflow-service.ts` and `git-status-service.ts` coverage is >= 80%.

## Engineering Standard
- Use the feature branch: `feature/sprint3-test-coverage`
- Ensure all tests pass before completing.
