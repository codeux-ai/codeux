title: Harden Coverage for src/infrastructure/providers/cli/
depends_on: []
is_independent: true
merged: true
prompt:
# Task Specification: T04 - Sprint 3

## Objective
Harden test coverage for `docker-runner.ts` and `provider-runner.ts` to >= 80%.

## Files to Modify
- `tests/backend/infrastructure/providers/cli/docker-runner.test.ts`
- `tests/backend/infrastructure/providers/cli/provider-runner.test.ts`

## Technical Details & Research Findings
- `docker-runner.ts` (1.58%) and `provider-runner.ts` (4.65%) have very low coverage.
- These modules are responsible for running tasks in Docker containers and managing the provider lifecycle.
- Mocks should be used for the underlying command execution (`runShellCommand`).

## Execution Steps
1. Create new test files if they don't exist.
2. For `docker-runner.ts`, write unit tests that:
    - Verify the correct docker commands are constructed and executed.
    - Verify credential mounting logic.
    - Verify container lifecycle management (start, stop, cleanup).
3. For `provider-runner.ts`, write unit tests that:
    - Verify the provider setup and teardown logic.
    - Verify the prompt execution flow.
    - Verify error handling.
4. Run the tests and ensure they pass.
5. Run the coverage report and ensure each file has >= 80% line coverage.

## Verification Requirements
- Run `npm test -- tests/backend/infrastructure/providers/cli/`
- Run `npm run test:coverage` and verify that `docker-runner.ts` and `provider-runner.ts` coverage is >= 80%.

## Engineering Standard
- Use the feature branch: `feature/sprint3-test-coverage`
- Ensure all tests pass before completing.
