title: Add Tests for ActivityCacheService
depends_on: []
is_independent: true
merged: true
prompt:
# Task Specification: T06 - Sprint 3

## Objective
Add unit tests for `activity-cache-service.ts` to >= 80%.

## Files to Modify
- `tests/backend/server/activity-cache-service.test.ts`

## Technical Details & Research Findings
- `activity-cache-service.ts` has 16.66% coverage.
- This service caches activity data to reduce load on the underlying API.
- Tests should verify cache insertion, retrieval, invalidation, and TTL logic.

## Execution Steps
1. Create a new test file for `ActivityCacheService`.
2. Write unit tests that:
    - Verify that `set` adds an item to the cache.
    - Verify that `get` retrieves an item from the cache.
    - Verify that items are invalidated after the TTL expires.
    - Verify that `invalidate` removes an item from the cache.
3. Use a mock timer to test the TTL logic.
4. Run the tests and ensure they pass.
5. Run the coverage report and ensure the file has >= 80% line coverage.

## Verification Requirements
- Run `npm test -- tests/backend/server/activity-cache-service.test.ts`
- Run `npm run test:coverage` and verify that `activity-cache-service.ts` coverage is >= 80%.

## Engineering Standard
- Use the feature branch: `feature/sprint3-test-coverage`
- Ensure all tests pass before completing.
