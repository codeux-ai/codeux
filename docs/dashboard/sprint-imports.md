# Sprint Imports

Sprint imports support three production paths from the Sprints page: structured markdown bundles, GitHub/GitLab issue imports, and Jira issue imports.

Internal MCP clients use the same importer services through `manage_sprints` action `import_issues`. For payload examples covering search-only imports, assigned-work searches, explicit Jira keys, explicit GitHub/GitLab issue numbers, sprint attachment, and plan-after-import flows, see [MCP Tools and Contracts: `manage_sprints import_issues`](../mcp/tools-and-contracts.md#manage_sprints-import_issues).

## Markdown Import

Use `Import -> Markdown` to create a sprint from a sprint metadata document plus an optional task bundle.

The Import flyout renders as a viewport-level overlay while open, so it remains above the sprint gallery cells and their hover controls instead of being trapped by animated page stacking contexts.

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

Use `Import -> GitHub Issues` or `Import -> GitLab Issues` to browse the selected project's remote backlog. Each menu entry opens the shared importer on its selected provider while still allowing provider switching, repository override, text search, state filtering, label filtering, and bulk selection.

The dashboard keeps a shared importer UI foundation under `dashboard/src/v2/components/sprints/importer/` with provider-neutral modal, summary rail, result card, loading, error, and empty-state primitives. Pure view-model helpers in `dashboard/src/v2/lib/issue-import-view-models.ts` provide provider display metadata, selection labels, metadata rows, safe copy, and truncation helpers for GitHub, GitLab, and Jira without making API calls. The GitHub/GitLab modal composes those shared primitives for its chrome, status states, result cards, selected-count affordances, and responsive filter layout.

The issue search layer also exposes the advanced fields that the dashboard renders in the modal: assignee, author or reporter text, milestone, exact issue-number lookup, created and updated date windows, sort field, sort direction, and bounded result limits. Importer requests trim empty text fields, deduplicate labels, reject malformed limits, and clamp valid result limits before reaching GitHub or GitLab. The result cards preserve the imported issue title, preview body, repository, issue key, labels, and assignee data while surfacing any extra metadata the provider returns, such as authors, milestones, timestamps, and comment counts.

Quick presets are available for the most common triage flows: open backlog, recently updated work, assigned-to-me or text-user matches, security-labeled items, quality and tech-debt items, failed-CI follow-ups, and merge-conflict follow-ups. The selection tray keeps linked issues and special remediation tasks separate, shows the selected count, supports selecting all visible results, supports clearing the selection, and lets each selected issue independently append or omit its conversation history before import.

For local projects, the dashboard reads the repository's `remote.origin.url` from `.git/config` when available. This pre-fills the provider and `owner/repository` target for projects that were added from a local checkout instead of a Git clone URL.

Imported issues appear in the sprint composer under the Sprint Prompt field as linked issue cards. Each card shows the provider, repository or Jira project key, issue key, title, state, labels, assignees, source link, conversation-included state, and a remove control for pruning imported scope before submission. The import view includes an `Append Conversation` toggle on each issue card. When enabled, the sprint prompt receives the full issue body plus issue comments or notes; when disabled, it receives the full issue body without the conversation.

When the sprint is submitted, selected issues are persisted as linked sprint issue records and the sprint prompt receives a structured `Linked Issues` markdown section. Each imported issue is appended with source metadata, labels, assignees, author and timestamps when available, the complete issue body, and the selected conversation context. This gives the Planning agent and task agents the actual issue text instead of only a remote link.

Special imported tasks selected from the same import flows appear in their own composer tray instead of the linked-issue markdown section. Security and quality selections still come from issue search results, but they are created as imported sprint tasks so they bypass planning prose and land directly on the sprint. Merge-conflict and failed-CI selections are also created directly as sprint tasks, using the imported-task endpoint, so they attach to the sprint immediately without being folded into the planning prompt. The composer shows the task kind, source, priority, and removal controls so operators can review remediation work before the sprint is created or updated.

Issue import uses the saved integration tokens:
- GitHub: system/project effective `git.githubToken`, usually configured in Settings -> Integrations.
- GitLab: system/project effective `git.gitlabToken`, also available through `GITLAB_TOKEN` / `GLAB_TOKEN` host hints.

When the GitHub token is empty, GitHub issue search, issue context loading, and auto-close fail with a token-required error. Code UX does not fall back to local `gh` or `glab` CLI authentication for dashboard or MCP importer workflows; Docker auth-copy mount settings help worker containers, but issue search, explicit import, linked sprint attachment, planning imports, and close operations need saved GitHub/GitLab tokens.

## Jira Issue Import

Use `Import -> Jira Issues` to search Jira with guided filters, multi-select issues, and attach them to the sprint composer. The Jira modal uses the same selection flow as the GitHub/GitLab importer, but its filters are Jira-specific: project key, exact issue key lookup, free-text search, status, assignee text, reporter text, issue type, priority, labels, updated-date windows, sort controls, bounded result limits, selectable issue cards, source links, and per-issue `Append Conversation` toggles.

The assignee field accepts a Jira user full name, email address, or account ID. It also accepts `me` / `currentUser()` for the connected Jira account and `unassigned` / `empty` for issues without an assignee. The server builds the Jira query from the selected filters, defaults to open issues sorted by recent updates, and uses `Settings -> Integrations -> Jira -> Default project` to prefill the project key when available. Clearing the project key browses all Jira issues the saved credentials can see.

The search endpoint also honors an exact issue key, user text, issue type, priority, labels, updated-date windows, sort field, sort direction, and a bounded result limit. Jira import requests use the same trimming, label deduplication, malformed-limit rejection, and pre-client result-limit clamp as repository issue search. Advanced users can open the JQL override and replace the guided query entirely; when JQL is present, it overrides the other filters.

Jira uses system-scoped settings from `Settings -> Integrations -> Jira`:
- site URL, for example `https://company.atlassian.net`
- account email for Jira Cloud basic auth
- API token
- default project key
- close transition name, defaulting to `Done`
- Jira-specific auto-close toggle

Jira dashboard and MCP importer workflows require those saved Jira settings. They do not use browser sessions, Atlassian CLI state, or local git configuration as an authentication fallback.

Selected Jira issues are loaded through the same prompt-context path as GitHub/GitLab imports. The sprint prompt receives the Jira description and, when `Append Conversation` is enabled, Jira comments. Imported Jira cards are persisted as linked sprint issues with provider `jira`, project key, issue key, labels, assignees, status, and source URL. The import result cards also surface Jira issue type, priority, reporter, assignee, labels, status, updated timestamps, and a description preview when Jira returns those fields.

When the dashboard detects Jira issues that look like security or quality follow-ups, it can emit imported task payloads instead of linked issue contexts. Those special tasks are created directly on the sprint and bypass planning prose, while ordinary Jira issues still become linked issues that feed the sprint prompt and linked issue records.

The Jira import modal keeps each selected card's stored mode choice across result refreshes and uses that saved mode at import time, so a task that was marked special does not drift back to linked just because the search results were refreshed.

## Auto-Close

`Settings -> Sprint -> Git Flow -> Auto-close linked issues` controls whether imported GitHub/GitLab issues are closed automatically. `Settings -> Integrations -> Jira -> Auto-close Jira issues` separately controls Jira transitions.

When enabled, the sprint loop closes linked issues only after the sprint reaches terminal completion and the main merge gate is no longer blocking. GitHub/GitLab issues are closed through their host APIs or `gh`; Jira issues are moved through the configured transition. Closing failures are recorded per issue and surfaced in the sprint completion report without hiding the sprint result.
