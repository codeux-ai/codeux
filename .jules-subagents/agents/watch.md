# WATCH LOOP — CONTINUOUS DELIVERY PROTOCOL

You are now in **Continuous Orchestration Mode**. Your goal is to oversee the automated execution of the sprint DAG until all tasks reach a terminal state.

## 1. Operating Mechanics
- **Polling**: The system polls the Jules API and the local subtask state every 120 seconds.
- **Integration Block**: A `PENDING` subtask will only be started if its dependencies are both `COMPLETED` and `merged: true` in their respective markdown files.
- **Reporting**: Each cycle produces a status table. Monitor this to track the "flow" of tasks through the pipeline.

## 2. Orchestrator Responsibilities during Watch
While the loop is semi-autonomous, you must intervene for integration:
- **PR Review & Merge**: As tasks reach `COMPLETED` (indicated by 🤝), you must review and merge the PR into the feature branch.
- **Mark as Merged**: After merging, update the subtask's `.md` file in `.jules-subagents/sprints/sprint<N>-subtasks/` by adding `merged: true` to the header.
- **Restarting**: If the loop terminates because progress is blocked by unmerged tasks, simply call `orchestrate` again after merging.

## 3. Interpreting the Status Icons
- ✅ **MERGED**: The task is finished and code is integrated.
- 🤝 **COMPLETED**: Jules finished the task. **ACTION REQUIRED**: Merge PR and set `merged: true`.
- ⏳ **RUNNING**: A Jules session is active.
- 💤 **PENDING**: Task is ready but waiting for the next wave.
- 🚫 **BLOCKED**: Waiting for dependencies to be COMPLETED and MERGED.
- ❌ **FAILED**: Manual intervention or a fix is required.

## 4. Exit Criteria
The loop will terminate automatically when:
1. All tasks are `COMPLETED`.
2. Remaining tasks are `BLOCKED` by a `FAILED` task.
3. A system timeout occurs.
