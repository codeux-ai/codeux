- **Task {{task_id}}**: Use `git_manager` ({{git_manager_skill}}) to merge the Jules PR/branch into `{{feature_branch}}`.
{{feature_ci_wait_line}}{{feature_comments_line}}- Update `{{subtask_file}}` with `merged: true`.
- Rerun `sprint_agent(action: "orchestrate", wait: true)`.
