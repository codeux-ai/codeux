# SKILL: Watch Sprint Orchestration

Use this skill when you need to re-enter the continuous orchestration loop for an ongoing sprint.

## When to use
- After a manual intervention or fix.
- If the previous watch loop timed out or was interrupted.
- To resume monitoring an active sprint.

## How to use
Use the dashboard to resume the sprint and keep the worker connected with `listen` so it can continue supervision and dispatch work for the current project.

## Protocol
1.  **Sync**: Ensure your local state is synced with the remote feature branch.
2.  **Integrate**: Review the status of completed tasks. If any task is COMPLETED but not MERGED (indicated by 🤝), use `git_manager` flow to merge into the feature branch. In REMOTE mode, run `gh pr checks <number> --watch` before merging. Then mark the task merged in Code UX if it was not auto-updated.
3.  **Trigger**: Resume the sprint from the dashboard.
4.  **Monitor**: Follow the `watch.md` protocol once the loop starts.
