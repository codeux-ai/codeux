1. **Explore & Verify Scope**
   - We need to create a helper inside `dashboard/src/v2/lib/tasks/task-card-view-model.ts`
   - It will map `Task` into a view model suitable for the `TaskCard` component.
   - The view model should extract UI specifics currently inside `TasksPage.tsx`: `timeAgo`, `EXECUTOR_LABEL`.
   - Dependency items should be fetched based on `dependsOnTaskIds` mapped to `status` and `id`.
   - Export through `dashboard/src/v2/lib/tasks/index.ts`.
   - Add tests to `tests/dashboard/v2/lib/tasks/task-card-view-model.test.ts`.
2. **Implementation: View Model Builder**
   - Create `task-card-view-model.ts`.
   - Functions `formatTimeAgo` and `getExecutorLabel`.
   - Type `DependencyIndicator` -> `{ id: string; status: TaskStatus; title?: string }`.
   - Type `TaskCardViewModel` -> `Task` + `humanizedCreatedAt`, `executorLabel`, `dependencyIndicators`.
   - Function `buildTaskCardViewModel(task: Task, taskLookup: Map<string, Task>): TaskCardViewModel`.
3. **Tests**
   - Setup Vitest DOM or node test for the mappers.
   - Test `formatTimeAgo` outputs "Xm ago", "Xh ago", "Xd ago".
   - Test `getExecutorLabel` defaults.
   - Test dependencies map with valid and missing lookups.
4. **Wiring**
   - Create `dashboard/src/v2/lib/tasks/index.ts`.
