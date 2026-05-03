# Plan

1. **Update `src/repositories/execution-repository.ts`**
   - Implement `updateTaskRunsBatch(updates: { id: string; input: UpdateTaskRunInput }[]): TaskRunRecord[]`.
     - It will loop over `updates` inside a `this.db.transaction()`.
     - Update each `taskRun` using an update statement similar to `updateTaskRun`.
     - Make sure `this.notifyRealtime` is appropriately debounced or called for unique project IDs at the end. Since `notifyRealtime` actually just puts stuff into `pendingRealtimeProjectRefreshes` map and sets a `setTimeout`, it is inherently debounced. So we can just call it per updated record or per unique project ID at the end.
   - Implement `updateTaskDispatchesBatch(updates: { id: string; input: UpdateTaskDispatchInput }[]): TaskDispatchRecord[]`.
     - Similar approach: use `this.db.transaction()`.
     - Make sure `this.notifyRealtime` is called appropriately for the updated dispatches.

2. **Refactor `CycleStateCoordinator.syncAutoInterventionExecutionState`**
   - Rather than calling `updateTaskRun` and `updateTaskDispatch` repeatedly in a loop, gather the needed updates.
   - It will iterate over `subtasks` just as it does now to check conditions and identify the required `taskRun` and `dispatch` updates.
   - It will accumulate `taskRunUpdates` and `dispatchUpdates` arrays.
   - After the loop, it will make single batch calls: `this.deps.executionRepository.updateTaskRunsBatch(taskRunUpdates)` and `this.deps.executionRepository.updateTaskDispatchesBatch(dispatchUpdates)`.

3. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
   - Call `pre_commit_instructions` and follow them.

4. **Submit changes**
   - Call `submit` to push the changes.
