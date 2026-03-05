title: Complete Coverage for WorkspaceManager
depends_on: []
is_independent: true
merged: true
prompt:
# Task Specification: T05 - Sprint 3

## Objective
Complete test coverage for `workspace-manager.ts` to >= 80%.

## Files to Modify
- `tests/backend/infrastructure/git/workspace-manager.test.ts`

## Technical Details & Research Findings
- `workspace-manager.ts` is at 20% coverage.
- This class manages git worktrees for running tasks in isolation.
- Tests should cover all public and private methods, including worktree preparation, removal, and path resolution.

## Execution Steps
1. Expand the existing tests for `WorkspaceManager`.
2. Add tests for the `prepareWorktree` method, covering all execution modes.
3. Add tests for the `removeWorktree` method.
4. Add tests for the path resolution logic.
5. Verify error handling for all methods.
6. Run the tests and ensure they pass.
7. Run the coverage report and ensure the file has >= 80% line coverage.

## Verification Requirements
- Run `npm test -- tests/backend/infrastructure/git/workspace-manager.test.ts`
- Run `npm run test:coverage` and verify that `workspace-manager.ts` coverage is >= 80%.

## Engineering Standard
- Use the feature branch: `feature/sprint3-test-coverage`
- Ensure all tests pass before completing.
