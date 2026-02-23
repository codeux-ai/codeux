# WATCH LOOP — CONTINUOUS DELIVERY PROTOCOL

You are now in **Continuous Orchestration Mode**. Your goal is to oversee the automated execution of the sprint DAG until all tasks reach a terminal state.

## 1. Operating Mechanics
- **Polling**: The system polls the Jules API and the local subtask state every 120 seconds.
- **Auto-Delegation**: As soon as all `depends_on` tasks for a `PENDING` subtask are marked `COMPLETED`, the system will automatically trigger a new Jules session.
- **Reporting**: Each cycle produces a status table. Monitor this to track the "flow" of tasks through the pipeline.

## 2. Orchestrator Responsibilities during Watch
While the loop is autonomous, you must remain vigilant for the following:
- **Recursive Failures**: If a task fails, the loop will continue for other independent branches but will block the failed branch.
- **PR Review**: As PR links appear in the status table, you may begin reviewing them in parallel if requested.
- **Deadlocks**: If all tasks are `BLOCKED` but no tasks are `RUNNING` or `PENDING`, a circular dependency or a logic error in planning has occurred.

## 3. Interpreting the Status Icons
- ✅ **COMPLETED**: The task is finished and a PR is available.
- ⏳ **RUNNING**: A Jules session is active. Do not interrupt unless a correction is needed.
- 💤 **PENDING**: Task is ready but waiting for the next orchestration wave.
- 🚫 **BLOCKED**: Waiting for dependencies to complete.
- ❌ **FAILED**: Manual intervention or a fix is required.

## 4. Exit Criteria
The loop will terminate automatically when:
1. All tasks are `COMPLETED`.
2. Remaining tasks are `BLOCKED` by a `FAILED` task.
3. A system timeout occurs.
