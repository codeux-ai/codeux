# Git Flow

Controls branch naming, task PR title naming, PR creation, issue closure, and cleanup for sprint work.

## What It Controls

Git mode, default branch, prefixes, sprint key, branch template, task PR title template, PR toggles, linked issue closure, and branch deletion define the workflow. The Task PR title scheme accepts `{sprint_tag}`, `{sprint_key}`, `{sprint_number}`, `{sprint_title}`, `{task_key}`, `{task_title}`, and `{provider}`.

## Recommended Defaults

Use Remote mode for PR/CI automation and Local mode for repositories where Code UX must not touch remotes.

## Risks And Gotchas

Wrong default branches can disrupt expected repository flow, and overly terse task PR title schemes can make automated pull requests harder to scan.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#git-flow`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Operations Runbook](../../operations/runbook.md)
- [Instruction Template System](../../instructions/markdown-template-system.md)
