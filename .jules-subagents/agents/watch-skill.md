# SKILL: Watch Sprint Orchestration

Use this skill when you need to re-enter the continuous orchestration loop for an ongoing sprint.

## When to use
- After a manual intervention or fix.
- If the previous watch loop timed out or was interrupted.
- To resume monitoring an active sprint.

## How to use
Call the `sprint_agent` tool with the following parameters:
- `action`: "orchestrate"
- `wait`: true
- `sprint_number`: <The current sprint number>
- `repo_path`: <The local repository path>
- `source_id`: <The Jules source ID>
- `feature_branch`: <The sprint's feature branch>

## Protocol
1.  **Sync**: Ensure your local state is synced with the remote feature branch.
2.  **Integrate**: Review the status of completed tasks. If any task is COMPLETED but not MERGED (indicated by 🤝), use `git_manager` flow to merge into the feature branch. In REMOTE mode, run `gh pr checks <number> --watch` before merging. Then update its `.md` file with `merged: true`.
3.  **Trigger**: Execute the tool call.
4.  **Monitor**: Follow the `watch.md` protocol once the loop starts.
