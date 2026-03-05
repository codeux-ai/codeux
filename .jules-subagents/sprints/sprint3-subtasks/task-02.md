title: Improve Coverage for src/app/dependency-factory/
depends_on: []
is_independent: true
merged: true
prompt:
# Task Specification: T02 - Sprint 3

## Objective
Improve test coverage for the dependency factory modules to >= 80%.

## Files to Modify
- `tests/backend/app/dependency-factory/dashboard-factory.test.ts`
- `tests/backend/app/dependency-factory/mcp-factory.test.ts`
- `tests/backend/app/dependency-factory/sprint-factory.test.ts`

## Technical Details & Research Findings
- `dashboard-factory.ts`, `mcp-factory.ts`, and `sprint-factory.ts` have low coverage (16-27%).
- These factories are responsible for wiring and returning service instances.
- Mocks should be used for all dependencies to isolate the factory logic.

## Execution Steps
1. Create new test files if they don't exist.
2. For each factory, write unit tests that:
    - Verify the factory returns an instance of the correct class.
    - Mock all dependencies passed to the factory.
    - Verify that the dependencies are called correctly by the created instance.
3. Run the tests and ensure they pass.
4. Run the coverage report and ensure each factory file has >= 80% line coverage.

## Verification Requirements
- Run `npm test -- tests/backend/app/dependency-factory/`
- Run `npm run test:coverage` and verify that `dashboard-factory.ts`, `mcp-factory.ts`, and `sprint-factory.ts` coverage is >= 80%.

## Engineering Standard
- Use the feature branch: `feature/sprint3-test-coverage`
- Ensure all tests pass before completing.