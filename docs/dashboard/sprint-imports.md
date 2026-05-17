# Sprint Imports

Sprint imports support two production paths from the Sprints page: structured markdown bundles and GitHub/GitLab issue imports.

## Markdown Import

Use `Import -> Markdown` to create a sprint from a sprint metadata document plus an optional task bundle.

Sprint markdown supports:

```md
name: Runtime hardening
number: 12
status: idle
goal:
Stabilize the dashboard runtime, reduce noisy retries, and verify health endpoints.
```

Task bundles use file markers. Each marker becomes one task, preserving order and dependency keys:

```md
--- FILE: T01.md ---
title: Add request correlation logging
depends_on: []
is_independent: true
merged: false
prompt:
Objective: add correlation IDs across dashboard routes.

--- FILE: T02.md ---
title: Verify health endpoints
depends_on: ["T01"]
is_independent: false
merged: false
prompt:
Objective: add tests for /health and /ready behavior.
```

Supported task fields include `title`, `depends_on`, `is_independent`, `merged` / `is_merged`, `merge_indicator`, `status`, and `prompt`.

## Issue Import

Use `Import -> GitHub Issues` or `Import -> GitLab Issues` to search the selected project's remote backlog. The import modal supports provider selection, repository override, full-text search, state filtering, label filtering, and multi-select.

For local projects, the dashboard reads the repository's `remote.origin.url` from `.git/config` when available. This pre-fills the provider and `owner/repository` target for projects that were added from a local checkout instead of a Git clone URL.

Imported issues appear in the sprint composer under the Sprint Prompt field as linked issue cards. Each card shows the provider, repository, issue key, title, labels, assignees, and a direct link to the source issue. When the sprint is submitted, the selected issues are persisted as linked sprint issue records and the sprint prompt receives a `Linked Issues` markdown section so the Planning agent has the issue context.

Issue import uses the saved integration tokens:
- GitHub: system/project effective `git.githubToken`, usually configured in Settings -> Integrations.
- GitLab: system/project effective `git.gitlabToken`, also available through `GITLAB_TOKEN` / `GLAB_TOKEN` host hints.

When the GitHub token is empty, the server falls back to local `gh` CLI authentication for search and auto-close (`gh issue list` / `gh issue close`). This uses the dashboard host environment's GitHub auth; Docker auth-copy mount settings help worker containers, but the dashboard import itself needs either a saved token or a working local `gh auth login`.

## Auto-Close

`Settings -> Sprint -> Git Flow -> Auto-close linked issues` controls whether imported GitHub/GitLab issues are closed automatically.

When enabled, the sprint loop closes linked issues only after the sprint reaches terminal completion and the main merge gate is no longer blocking. Closing failures are recorded per issue and surfaced in the sprint completion report without hiding the sprint result.
