# WATCH LOOP — CONTINUOUS DELIVERY PROTOCOL

You are now in **Continuous Orchestration Mode**. Your goal is to oversee the automated execution of the sprint DAG until all tasks reach a terminal state.

## 1. Operating Mechanics
- **Polling**: The system polls the Jules API and the local subtask state every 120 seconds.
- **Merge Interruption**: The loop will **AUTOMATICALLY INTERRUPT** and return control to you as soon as a subtask reaches `COMPLETED` (🤝). This is so you can merge the code immediately.
- **Integration Block**: A `PENDING` subtask will only be started if its dependencies are both `COMPLETED` and `merged: true` in their respective markdown files.
- **Auto-Retry**: If a task fails, and `retry_failed` is enabled (default), the system will automatically trigger a **new session** for that task in the next cycle, provided its dependencies are still met.
- **Reporting**: Each cycle produces a status table. Monitor this to track the "flow" of tasks through the pipeline.

## 2. Orchestrator Responsibilities during Watch
While the loop is semi-autonomous, you must intervene for integration:
- **GitHub First Merge**: You MUST always prioritize merging the PR created by Jules directly on GitHub (e.g., using `gh pr merge --merge --auto`).
- **Mandatory Check Watch**: Before every PR merge in REMOTE mode run `gh pr checks <number> --watch` and merge only after all required checks are green.
- **Conflict Handling**: Only merge locally if there are merge conflicts that cannot be resolved on GitHub.
- **Local Merge Standard**: If merging locally, you MUST use non-interactive shell commands (e.g., `git merge --no-edit`). 
- **Immediate Push**: If you perform a local merge, you MUST push the changes to GitHub immediately before restarting the orchestration or starting any other task.
- **Mark as Merged**: After the code is integrated (on GitHub or locally), update the subtask's `.md` file in `.jules-subagents/sprints/sprint<N>-subtasks/` by adding `merged: true` to the header.
- **Use Git Manager Skill**: Perform every merge/status operation via `git_manager` (`git_manager_remote` in REMOTE mode, `git_manager_local` in LOCAL mode).

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
