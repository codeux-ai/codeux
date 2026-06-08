# Sprint Imports

Sprint imports support three production paths from the Sprints page: structured markdown bundles, GitHub/GitLab issue imports, and Jira issue imports.

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

## GitHub/GitLab Issue Import

Use `Import -> GitHub Issues` or `Import -> GitLab Issues` to search the selected project's remote backlog. The import modal supports provider selection, repository override, full-text search, state filtering, label filtering, and multi-select.

For local projects, the dashboard reads the repository's `remote.origin.url` from `.git/config` when available. This pre-fills the provider and `owner/repository` target for projects that were added from a local checkout instead of a Git clone URL.

Imported issues appear in the sprint composer under the Sprint Prompt field as linked issue cards. Each card shows the provider, repository, issue key, title, labels, assignees, and a direct link to the source issue. The import view includes an `Append Conversation` toggle on each issue card. When enabled, the sprint prompt receives the full issue body plus issue comments/notes; when disabled, it receives the full issue body without the conversation.

When the sprint is submitted, selected issues are persisted as linked sprint issue records and the sprint prompt receives a structured `Linked Issues` markdown section. Each imported issue is appended with source metadata, labels, assignees, author/timestamps when available, the complete issue body, and the selected conversation context. This gives the Planning agent and task agents the actual issue text instead of only a remote link.

Issue import uses the saved integration tokens:
- GitHub: system/project effective `git.githubToken`, usually configured in Settings -> Integrations.
- GitLab: system/project effective `git.gitlabToken`, also available through `GITLAB_TOKEN` / `GLAB_TOKEN` host hints.

When the GitHub token is empty, GitHub issue search, issue context loading, and auto-close fail with a token-required error. Code UX does not fall back to local `gh` CLI authentication for dashboard issue workflows; Docker auth-copy mount settings help worker containers, but dashboard import and close operations need saved GitHub/GitLab tokens.

## Jira Issue Import

Use `Import -> Jira Issues` to search Jira with guided filters, multi-select issues, and attach them to the sprint composer. The Jira modal follows the same interaction model as the GitHub/GitLab importer: project key, search text, status, assignee text, optional labels, selectable issue cards, source links, and per-issue `Append Conversation` toggles.

Operators do not need to write JQL in the dashboard. The server builds the Jira query from the selected filters, defaults to open issues sorted by recent updates, and uses `Settings -> Integrations -> Jira -> Default project` to prefill the project key when available.

The assignee field accepts a Jira user full name, email address, or account ID. It also accepts `me` / `currentUser()` for the connected Jira account and `unassigned` / `empty` for issues without an assignee.

Jira uses system-scoped settings from `Settings -> Integrations -> Jira`:
- site URL, for example `https://company.atlassian.net`
- account email for Jira Cloud basic auth
- API token
- default project key
- close transition name, defaulting to `Done`
- Jira-specific auto-close toggle

Selected Jira issues are loaded through the same prompt-context path as GitHub/GitLab imports. The sprint prompt receives the Jira description and, when `Append Conversation` is enabled, Jira comments. Imported Jira cards are persisted as linked sprint issues with provider `jira`, project key, issue key, labels, assignees, status, and source URL. The import result cards also surface Jira issue type, priority, assignee, labels, status, and a description preview when Jira returns those fields.

## Auto-Close

`Settings -> Sprint -> Git Flow -> Auto-close linked issues` controls whether imported GitHub/GitLab issues are closed automatically. `Settings -> Integrations -> Jira -> Auto-close Jira issues` separately controls Jira transitions.

When enabled, the sprint loop closes linked issues only after the sprint reaches terminal completion and the main merge gate is no longer blocking. GitHub/GitLab issues are closed through their host APIs or `gh`; Jira issues are moved through the configured transition. Closing failures are recorded per issue and surfaced in the sprint completion report without hiding the sprint result.
