1. **Create `src/repositories/execution/task-dispatch-claim-query.ts`**:
   - Write a new query helper `queryNextTaskDispatchIdToClaim` to find the highest-priority eligible dispatch ID.
   - The query will sort by `priority DESC, queued_at ASC, created_at ASC` and use `LIMIT 1`.
   - The query needs to filter by `project_id`, `executor_type = ?`, `status = 'queued'`, and optionally `sprint_id` and `sprint_run_id`.
   - Then implement a function `claimNextTaskDispatch` in this helper file to wrap the process in a transaction.
   - It will find the dispatch ID, and then attempt to update it to `status = 'claimed'` WHERE `id = ? AND status = 'queued'`.

2. **Update `src/repositories/execution-repository.ts`**:
   - In `claimNextTaskDispatch()`, use the transaction-based helper from the new file rather than `listTaskDispatches` which loads everything into memory.
   - Remove the `listTaskDispatches().filter(...)` call in `claimNextTaskDispatch()`.
   - Read the updated record to return using `this.requireTaskDispatch(updatedId)`. Let the transaction ensure atomic claiming.

3. **Update `tests/backend/repositories/execution-repository.test.ts`**:
   - Add new tests in a dedicated `describe("claimNextTaskDispatch")` block.
   - Test priority ordering (ensure a higher priority task is claimed before a lower one).
   - Test sprint/run filtering.
   - Test that double claims are prevented (e.g. queue one task, attempt to claim twice, verify the second claim returns null).
   - Test claiming when queue is empty returns null.

4. **Verify Constraints**:
   - Ensure `npm run typecheck` passes.
   - Ensure `npx vitest run tests/backend/repositories/execution-repository.test.ts` passes.
   - Verify `listTaskDispatches()` is no longer used in `claimNextTaskDispatch`.

5. **Pre-commit**: Use `pre_commit_instructions` tool to execute pre commit verifications.
