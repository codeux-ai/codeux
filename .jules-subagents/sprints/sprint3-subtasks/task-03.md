title: Add Tests for Lifecycle Services
depends_on: []
is_independent: true
merged: true
prompt:
# Task Specification: T03 - Sprint 3

## Objective
Add unit tests for the lifecycle service modules to >= 80%.

## Files to Modify
- `tests/backend/app/lifecycle/dashboard-lifecycle-service.test.ts`
- `tests/backend/app/lifecycle/mcp-lifecycle-service.test.ts`
- `tests/backend/app/lifecycle/settings-lifecycle-service.test.ts`

## Technical Details & Research Findings
- `src/app/lifecycle/` has 0% coverage.
- These services manage the start and stop sequences of different parts of the application.
- Tests should verify the correct order of operations and error handling.

## Execution Steps
1. Create new test files for each lifecycle service.
2. For each service, write unit tests that:
    - Verify the `start` method calls the correct dependencies in the correct order.
    - Verify the `stop` method calls the correct dependencies in the correct order.
    - Verify that errors from dependencies are handled gracefully.
3. Run the tests and ensure they pass.
4. Run the coverage report and ensure each service file has >= 80% line coverage.

## Verification Requirements
- Run `npm test -- tests/backend/app/lifecycle/`
- Run `npm run test:coverage` and verify that `dashboard-lifecycle-service.ts`, `mcp-lifecycle-service.ts`, and `settings-lifecycle-service.ts` coverage is >= 80%.

## Engineering Standard
- Use the feature branch: `feature/sprint3-test-coverage`
- Ensure all tests pass before completing.
