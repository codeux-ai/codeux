# Sprint Imports

Sprint imports support production paths from the Sprints page and MCP: structured markdown bundles, GitHub/GitLab issue imports, Jira issue imports, read-only linked-scope imports from Notion, Asana, and Linear, and read-only collaborative canvas imports from Miro, Lucid, Figma/FigJam, and Mural.

Internal MCP clients use the same importer services through `manage_sprints` action `import_issues`. For payload examples covering search-only imports, assigned-work searches, explicit Jira keys, explicit GitHub/GitLab issue numbers, explicit external IDs, canvas identifiers, sprint attachment, and plan-after-import flows, see [MCP Tools and Contracts: `manage_sprints import_issues`](../mcp/tools-and-contracts.md#manage_sprints-import_issues).

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

The sprint title is optional when creating a sprint from the dashboard, MCP, quicksprint, or import flows. If the title is omitted, Code UX stores a deterministic placeholder and the Planning agent may replace it with a generated title after it returns a structured plan. A custom user-supplied title is preserved during planning and replanning.

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

Use `Import -> GitHub Issues` or `Import -> GitLab Issues` to browse the selected project's remote backlog. Each provider has its own menu entry, and the entry opens the shared issue importer with that provider selected. The redesigned default view keeps the first screen low-noise: a provider switcher, host input, `owner/repository` input, text search, state, sort field, sort direction, bounded result limit, search action, compact summary rail, active filter summary, result list, and import footer. Labels, assignee, author, milestone, updated-date windows, and quick presets live behind the advanced filter toggle so operators can progressively refine the search only when the default browse-and-search path is too broad.

The importer result list shows the current sort, active filter chips, visible result count, selected result count, multi-select controls, `Select all visible results`, `Clear selection`, and per-card `Append Conversation` controls. Active filter chips distinguish always-visible targeting values, such as provider, host, repository, state, and limit, from filters the operator changed during the session. Selected issue summaries remain visible in the footer so operators can review the issue key, title, and conversation state before importing.

Result cards preserve the imported issue title, preview body, repository, issue key, labels, assignees, source link, and provider metadata such as authors, milestones, timestamps, and comment counts when the provider returns those fields.

The shared importer primitives provide compact provider-neutral summaries for all issue import modals. The view-model layer builds ordered filter chips, active-filter counts, default sort labels, and selected-result labels without depending on GitHub, GitLab, or Jira payload shapes. The shell supports a concise header, a compact summary rail, an optional collapsed advanced-filter region, a responsive content width, and an `aria-live` result/status slot so provider-specific modals can progressively simplify their default views without changing backend search payloads.

Importer forms can use the shared field primitives under `dashboard/src/v2/components/sprints/importer/` for text, date, number, select, multi-select wrapper, and textarea controls. These wrappers keep label typography, hints, disabled states, responsive sizing, and provider focus rings consistent with the Warm Void design system while leaving provider-specific search state in the modal.

Quick presets are available for common triage flows: open backlog, recently updated work, assigned-to-me or text-user matches, security-labeled items, quality and tech-debt items, failed-CI follow-ups, and merge-conflict follow-ups.

For local projects, the dashboard reads the repository's `remote.origin.url` from `.git/config` when available. This pre-fills the provider and `owner/repository` target for projects that were added from a local checkout instead of a Git clone URL.

Imported issues appear in the sprint composer under the Sprint Prompt field as linked issue cards. Each card shows the provider, repository or Jira project key, issue key, title, state, labels, assignees, source link, conversation-included state, and a remove control for pruning imported scope before submission. The import view includes an `Append Conversation` toggle on each issue card. When enabled, the sprint prompt receives the full issue body plus issue comments or notes; when disabled, it receives the full issue body without the conversation.

When the sprint is submitted, selected issues are persisted as linked sprint issue records and the sprint prompt receives a structured `Linked Issues` markdown section. Each imported issue is appended with source metadata, labels, assignees, author and timestamps when available, the complete issue body, and the selected conversation context. This gives the Planning agent and task agents the actual issue text instead of only a remote link.

Sprint completion PR descriptions also summarize persisted linked issues in the summary section so the final PR body references the source work being completed. Jira tickets render by their issue key and stored Jira URL, while GitHub and GitLab issues render by their issue key or number and stored issue URL. Sprints without linked issues omit that PR section entirely.

Repository issues have two import modes. `Import as linked issues` creates linked sprint issue records and appends the selected issue bodies to the sprint prompt. The special-task actions create imported sprint tasks instead: security, quality, merge-conflict, and failed-CI selections bypass planning prose and land directly on the sprint through the imported-task endpoint. The composer shows linked issues below the Sprint Prompt field and special imported tasks in a separate tray with task kind, source, priority, and removal controls so operators can review both kinds of scope before the sprint is created or updated.

Issue import uses the saved integration tokens:
- GitHub: system/project effective `git.githubToken`, usually configured in Settings -> Integrations.
- GitLab: system/project effective `git.gitlabToken`, usually configured in Settings -> Integrations or seeded from `GITLAB_TOKEN` / `GLAB_TOKEN` host hints.
- Notion: system/project effective `notion.apiToken`; `databaseId` can narrow search or explicitly import a database.
- Asana: system/project effective `asana.apiToken`; workspace search uses `workspaceId`, while project fallback uses `projectId`.
- Linear: system/project effective `linear.apiToken`; `teamId`, `teamKey`, and `projectId` can narrow issue search.
- Miro: system/project effective `miro.apiToken`; `boardId` identifies the board used for readable board items, and `itemTypes` can narrow returned board item types.
- Lucid: system/project effective `lucid.apiToken`; `documentId` identifies a Lucidchart or Lucidspark document for readable contents, while `search` can discover documents.
- Figma/FigJam: system/project effective `figma.apiToken`; `fileKey` is required because the Figma API does not expose a general file search endpoint for this importer.
- Mural: system/project effective `mural.apiToken`; `workspaceId` lists workspace murals, while `muralId` or the shared `mural.boardId` setting fetches a specific mural.

When the GitHub token is empty, GitHub issue search, issue context loading, and auto-close fail with a token-required error. Code UX does not fall back to local `gh` or `glab` CLI authentication for dashboard or MCP importer workflows; Docker auth-copy mount settings help worker containers, but issue search, explicit import, linked sprint attachment, planning imports, and close operations need saved GitHub/GitLab tokens.

External importer workflows use direct provider APIs through `fetch` and require saved tokens before any network request is made. They are read/attach only: Code UX searches, fetches readable context, persists local linked-source records, enriches sprint prompts, and can plan from that imported scope, but it does not archive Notion pages, complete Asana tasks, transition Linear issues, mutate canvas boards/files/documents/murals, write comments, or close those external items.

Provider-specific search behavior:
- Notion uses `POST https://api.notion.com/v1/search` with `Authorization: Bearer` and `Notion-Version`, maps pages and databases, and reads page/database block children into prompt markdown when blocks are readable.
- Asana uses `GET https://app.asana.com/api/1.0/workspaces/{workspace_gid}/tasks/search` for workspace task search and falls back to project tasks when a project id is supplied. When conversation context is requested, task stories/comments are appended to prompt markdown.
- Linear uses `POST https://api.linear.app/graphql` for issue search/filter queries and explicit issue fetches. Results include description, labels, state, team/project, assignee, URL, and comments when conversation context is requested.
- Miro uses `GET https://api.miro.com/v2/boards` for board discovery and `GET https://api.miro.com/v2/boards/{boardId}/items` for readable board items. Results map board/item ids, titles, item types, URLs, modified timestamps, and readable text/data fields into prompt markdown.
- Lucid uses `POST https://api.lucid.co/documents/search` for document search and `GET https://api.lucid.co/v1/documents/{id}/contents` for readable Lucidchart/Lucidspark contents. Requests use `Authorization: Bearer` and `Lucid-Api-Version: 1`.
- Figma/FigJam uses `GET https://api.figma.com/v1/files/{fileKey}` and, when `includeConversation` is true, `GET https://api.figma.com/v1/files/{fileKey}/comments` with `X-Figma-Token`. Results include file name, last modified timestamp, top-level pages/nodes, and comments.
- Mural uses `https://app.mural.co/api/public/v1`, `GET /workspaces/{workspaceId}/murals` for listing, and `GET /murals/{muralId}` for mural metadata/content available to the token. Mural public API support is beta/limited, so imported prompt context may contain only metadata and readable content the token can access.

## Notion, Asana, And Linear Scope Import

Use `Import -> Notion`, `Import -> Asana`, or `Import -> Linear` from the Sprints page import menu to attach project-management scope to the sprint composer. These entries open provider-specific search modals that share the same linked-issue import path as GitHub, GitLab, and Jira: selected results are fetched through the prompt-context endpoint, shown as linked issue cards in the composer, and merged into the sprint prompt as structured linked-source markdown when the sprint is submitted.

The PM importers are read-only linked-scope importers. They do not create special imported tasks, archive Notion pages, complete Asana tasks, transition Linear issues, close external work, or mutate provider state. The only write is local Code UX sprint state: linked-source metadata, selected conversation inclusion, and prompt context.

Each modal loads system/project effective settings before its first search:

- Notion requires `notion.apiToken`; `notion.databaseId` is optional and narrows search to pages or databases under that database. Advanced filters also accept exact external object IDs for pages or databases.
- Asana requires `asana.apiToken` plus either `asana.workspaceId` for workspace task search or `asana.projectId` for project task listing. The modal supports task text search, status, labels, assignee, exact task GIDs, result limit, and workspace/project overrides.
- Linear requires `linear.apiToken`; `linear.teamId`, `linear.teamKey`, and `linear.projectId` are optional narrowing defaults. The modal supports issue text search, workflow state, status/state type, labels, assignee, exact issue IDs or identifiers, result limit, and team/project overrides.

Missing tokens, missing Asana workspace/project targeting, provider API failures, and malformed backend responses are surfaced in the modal error panel with the backend message intact. Empty searches use provider-specific copy (`items` for Notion, `tasks` for Asana, `issues` for Linear) so operators can tell whether the search ran but returned no importable results.

Result cards support multi-select, `Select all visible`, `Clear selection`, per-card `Append Conversation`, and a bulk append-conversation toggle for the selected set. Notion pages and databases attach readable block markdown when available. Asana and Linear attach descriptions by default and include stories/comments only when conversation is enabled for the selected result.

## Collaborative Canvas Scope Import

Use `Import -> Miro`, `Import -> Lucid`, `Import -> Figma / FigJam`, or `Import -> Mural` from the Sprints page import menu to attach canvas, whiteboard, diagram, or design scope to the sprint composer. The menu groups these entries under canvas/whiteboard imports so they are distinct from issue and work-item imports.

Canvas importers are read-only linked-scope importers. They do not render live canvas previews, mutate provider content, write comments, close external work, or synchronize provider state. Selected results are compact metadata cards; importing selected cards loads prompt context through `/api/projects/:projectId/issues/context`, preserves `externalId`, `sourceKind`, and `sourceProvider`, and adds linked-source cards below the sprint prompt just like PM imports.

Provider targets:

- Miro: paste a `boardId` to import a board-level source plus readable board items, or use `search` to discover boards. Optional `itemTypes` narrows readable item imports.
- Lucid: paste a `documentId` for an exact Lucidchart/Lucidspark import, use `search` to discover documents, or provide exact document IDs as external IDs.
- Figma/FigJam: paste a `fileKey` from the file URL or provide exact file keys as external IDs. General Figma file search is not available for this importer.
- Mural: paste a `workspaceId` to list workspace murals or a `muralId` for an exact import. The saved `mural.boardId` setting is treated as the default mural ID. Mural public API support is limited, so imports may contain only metadata and readable content available to the token.

The canvas modal loads saved project-effective settings before search and validates required identifiers in the browser before calling the backend. Missing tokens and provider API failures still surface through the backend error panel with the provider's actionable message intact.

Miro, Lucid, and Mural currently import readable body/metadata only. Figma/FigJam also supports comment context: enable `Append comments` before search to request file comments, then use the per-card or bulk comment toggles to decide whether comments are included in the imported prompt context.

## Project-Management And Canvas Integration Settings

Code UX carries shared typed settings for additional importer providers: Notion, Asana, Linear, Miro, Lucid, Figma, and Mural. These providers have API-backed read-only sprint importers. Jira continues to use the existing `jira` settings block, and GitHub/GitLab continue to use `git.githubToken` and `git.gitlabToken`.

Each new provider settings block stores only strings and a bounded numeric search limit:

- `enabled`
- `apiToken`
- `apiSecret`
- `baseUrl`
- `workspaceId`
- `teamId`
- `teamKey`
- `projectId`
- `databaseId`
- `boardId`
- `documentId`
- `fileKey`
- `defaultSearchLimit`

The fields are intentionally generic across project-management and collaborative-canvas systems. Provider-specific importer UI can use only the identifiers it needs, while reset, save, sanitize, and effective-settings preview paths preserve the complete block.

Accepted canvas identifiers:
- `boardId`: Miro board id. For Mural, the existing shared `boardId` setting is also accepted as the default mural id until a dedicated settings field exists.
- `documentId`: Lucidchart or Lucidspark document id.
- `fileKey`: Figma or FigJam file key from the file URL.
- `workspaceId`: Mural workspace id for listing murals; also used by Asana for task search.
- `muralId`: explicit Mural id in route/MCP payloads.
- `externalIds`: explicit provider object ids. For canvas imports this can hold Miro item ids, Lucid document ids, Figma file keys, or Mural ids.
- `itemTypes`: optional Miro item type filters such as `sticky_note` or `text`.

## Linked Source Persistence

Persisted sprint scope can represent both numeric repository issues and non-numeric external objects.

GitHub, GitLab, and Jira imports keep the existing numeric behavior: linked rows store `provider`, `hostDomain`, `repository`, `issueNumber`, `issueKey`, title, URL, state, labels, assignees, close state, and timestamps. The numeric uniqueness key remains scoped by sprint/provider/host/repository/issue number, so existing prompt context, auto-close, and PR description summaries continue to work.

New linked-source providers can omit `issueNumber` and instead store:

- `externalId`: the provider object id, such as a Notion page id, Linear issue id, Figma file key, or Miro board id.
- `sourceKind`: the object category, such as `issue`, `task`, `page`, `database`, `board`, `document`, `file`, or `canvas`.
- `sourceProvider`: the provider name surfaced through backend and dashboard contracts.

The database has nullable `external_id` and `source_kind` columns plus a unique external-source index for sprint/provider/host/repository/external id. Existing rows migrate without changing their numeric issue identity.

## Jira Issue Import

Use `Import -> Jira Issues` to search Jira with guided filters, multi-select issues, and attach them to the sprint composer. The Jira modal opens on the common search path first: project key, exact issue key lookup, free-text search, status, sort field, sort direction, a bounded result limit, and a `Hide in Work` visibility checkbox. The default view calls out the normal open-issues, recently-updated-first behavior, active filter summary, visible result count, selected linked count, selected special-task count, and selected issue cards with their current mode.

Advanced Jira filters are grouped behind an `Advanced Jira filters` toggle. People filters hold assignee and reporter text, classification filters hold issue type, priority, and labels, the updated window uses date inputs, and the explicit JQL override uses a textarea. Project and issue-key inputs are normalized to uppercase, labels use the shared multi-select control, and the advanced JQL override remains optional. When JQL is present, it replaces the guided Jira filters for search construction.

Jira results use compact selectable issue cards with source links, Jira-specific metadata, a visible per-card import mode label, `Select all visible`, `Clear selection`, bulk conversation selection, and per-card `Append Conversation` toggles. Selected Jira issues default to linked sprint context and show `Linked issue` until the operator changes mode. When special task creation is available, operators can explicitly switch the selected Jira issues to security or quality task mode before importing.

The `Hide in Work` checkbox is enabled by default and filters the fetched Jira results in the browser by hiding issues whose Jira status text is exactly `In Work` after normalization. It does not change the Jira query, status dropdown, or default open-issues search. Turning the checkbox off immediately shows matching fetched `In Work` issues again; turning it back on prunes hidden issues from selection, conversation toggles, and linked or special-task import modes so they cannot be imported accidentally. The compact filter chips show `Hide in Work` while the visibility filter is active.

The assignee field accepts a Jira user full name, email address, or account ID. It also accepts `me` / `currentUser()` for the connected Jira account and `unassigned` / `empty` for issues without an assignee. The server builds the Jira query from the selected filters, defaults to open issues sorted by recent updates, and uses `Settings -> Integrations -> Jira -> Default project` to prefill the project key when available. Clearing the project key browses all Jira issues the saved credentials can see.

The search endpoint also honors an exact issue key, user text, issue type, priority, labels, updated-date windows, sort field, sort direction, and a bounded result limit. Code UX can load the actual statuses configured for the selected Jira project through `GET /api/projects/:projectId/jira/statuses?projectKey=KEY`; when callers pass selected status labels, Jira search uses an exact `status in (...)` JQL clause instead of the broader status-category filter. Jira import requests use the same trimming, label deduplication, malformed-limit rejection, and pre-client result-limit clamp as repository issue search. Advanced users can open the JQL override and replace the guided query entirely; when JQL is present, it overrides the other filters.

Jira uses system-scoped settings from `Settings -> Integrations -> Jira`:
- site URL, for example `https://company.atlassian.net`
- account email for Jira Cloud basic auth
- API token
- default project key
- import transition toggle
- import transition name, defaulting to `In Work`
- close transition name, defaulting to `Done`
- Jira-specific auto-close toggle

Jira dashboard and MCP importer workflows require those saved Jira settings. They do not use browser sessions, Atlassian CLI state, or local git configuration as an authentication fallback.

Selected Jira issues are loaded through the same prompt-context path as GitHub/GitLab imports. The sprint prompt receives the Jira description and, when `Append Conversation` is enabled, Jira comments. Imported Jira cards are persisted as linked sprint issues with provider `jira`, host extracted from the Jira URL, project key, repository fallback, parsed issue number from keys such as `OPS-42`, issue key, labels, assignees, status, source URL, and the selected conversation flag. The import result cards also surface Jira issue type, priority, reporter, assignee, labels, status, updated timestamps, and a description preview when Jira returns those fields.

When Jira issues are imported as linked sprint issues, Code UX attempts to move each linked Jira issue through the configured import transition. The default is enabled and uses `In Work`. Transition lookup is case-insensitive. This import transition setting is separate from the Jira modal's `Hide in Work` checkbox: the checkbox only controls which fetched issues are visible and selectable before import, while the transition setting controls what Code UX asks Jira to do after linked issues are imported. Import transition failures are non-destructive: the linked issue remains persisted locally, the dashboard or MCP result includes a warning with the Jira key and failure message, and the failure is logged for operators. This import-time transition is separate from sprint-completion auto-close and does not change the `Done` close transition behavior.

When operators mark selected Jira issues as security or quality task mode, the dashboard emits imported task payloads instead of linked issue contexts. Those special tasks are created directly on the sprint and bypass planning prose, while ordinary Jira issues still become linked issues that feed the sprint prompt and linked issue records. Jira issue labels, issue type, priority, title, or description text do not automatically convert an issue into a special task.

The Jira import modal keeps each selected card's stored mode choice across result refreshes and uses that saved mode at import time, so a task that was marked special does not drift back to linked just because the search results were refreshed.

## Auto-Close

`Settings -> Sprint -> Git Flow -> Auto-close linked issues` controls whether imported GitHub/GitLab issues are closed automatically. `Settings -> Integrations -> Jira -> Auto-close Jira issues` separately controls Jira transitions.

When enabled, the sprint loop closes linked issues only after the sprint reaches terminal completion and the main merge gate is no longer blocking. GitHub and GitLab issues are closed through their configured host APIs using saved tokens; Jira issues are moved through the configured transition using saved Jira settings. Closing failures are recorded per issue and surfaced in the sprint completion report without hiding the sprint result.
