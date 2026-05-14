1. **Create `src/services/planning-task-persistence.ts`**:
   - Create a module that exposes a function (e.g., `persistPlannedTasks`) taking `projectId`, `sprintId`, `tasks` (from `PlannedSprintPayload`), and the `ProjectManagementRepository`.
   - The function will encapsulate the task creation loop logic: iteration, dependency resolution, `dependsOnTaskIds` population, `isIndependent` determination, and `createTask` calls.
   - It will return an object with `{ createdTaskIds: string[], taskIdsByKey: Map<string, string> }`.
   - It should not mutate the incoming `tasks` array. It should maintain the required defaults (e.g., `priority: "medium"`, `executorType: "auto"`, `status: "pending"`).
   - Any dependency not found in previously defined keys should throw a clear error message.

2. **Refactor `src/services/planning-agent-service.ts`**:
   - Import the new helper function in `src/services/planning-agent-service.ts`.
   - Replace the task creation loop in `planSprint` (lines 284-307) with a call to this new helper function.
   - Use the returned `createdTaskIds` to populate the `PlanSprintResult`.
   - Ensure the repository and all required dependencies are correctly passed.

3. **Create `tests/backend/services/planning-task-persistence.test.ts`**:
   - Write tests for the newly created `persistPlannedTasks` function.
   - Include tests for mapping tasks properly, dependency resolution correctness, throwing errors on missing dependencies, duplicate key rejection (if applicable/enforced in persistence), and maintaining the correct sort order and `isIndependent` flag.
   - Use a mock `ProjectManagementRepository` or use the existing in-memory/DB ones used in other tests.

4. **Run Verification Gates**:
   - Run `pnpm vitest tests/backend/services/planning-task-persistence.test.ts`.
   - Run `pnpm vitest tests/backend/services/planning-agent-service.test.ts`.
   - Verify type checking (`pnpm run typecheck`) and linting (`pnpm run lint`).

5. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**

6. **Submit**:
   - Submit the change with an appropriate commit message.
