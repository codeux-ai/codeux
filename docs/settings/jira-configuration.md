# Jira Configuration

Connects Jira issue search, import transitions, and completion transitions.

> Settings area: `jira-configuration`
> Dashboard documentation route: `/docs/settings-jira-configuration`

## What This Area Is For

Connects Jira issue search, import transitions, and completion transitions. This page expands the short Settings-page help text into an operator reference for deciding when to change this area, what behavior the controls affect, and what to verify after saving.

Use it when you are configuring a new project, auditing inherited settings, or debugging behavior that changed after a system, project, or sprint override was saved.

## Controls And Runtime Effect

Site URL, account email, API token, project key, transition names, and move/close toggles drive Jira automation.

| Control Surface | Runtime Effect | Review Before Saving |
| --- | --- | --- |
| Settings card fields | Updates the active Settings scope after you save the page. | Confirm whether you are editing System or Project scope. |
| Inherited values | Values can flow from system defaults into project and sprint behavior. | Check the source badge before assuming a value is project-specific. |
| Related runtime paths | The affected service reads the saved settings during planning, dispatch, dashboard rendering, or maintenance work. | Re-run the affected workflow after changing operational settings. |

## Import Behavior

Jira issue imports use the saved site URL, account email, API token, and default project key when operators search from the dashboard or call MCP `manage_sprints import_issues`. Guided Jira searches, assigned-work searches, and explicit issue-key imports all attach the selected issue descriptions to the sprint as linked issue context. When conversation import is enabled, Jira comments are appended to the imported description.

Search result cards show concise description previews, but selected Jira issues contribute the full description markdown to planner scope. Imported linked issue context is stored with the sprint issue record, so reloads, prompt edits, and replanning keep the Jira description available to planning without requiring the original search results to be present again.

The import transition controls only the optional move that happens after a Jira issue is imported as linked sprint scope. It is separate from the sprint-completion close transition and from the importer's `Hide in Work` visibility filter. Code UX does not write comments or otherwise mutate Jira issues during import beyond the configured import transition.

## Recommended Configuration

Use a dedicated API token and test transition names against the target Jira workflow.

A practical review flow is:

1. Start from the inherited default and change only the fields that solve a concrete operational problem.
2. Save the smallest scope that should own the change. Use System for defaults that every project should inherit, and Project for repository-specific behavior.
3. Reopen the Settings page after saving when the value controls startup behavior, provider routing, preview runtime, or destructive maintenance.

## Risks And Gotchas

Wrong transition names prevent issue movement; broad tokens expose more Jira scope than needed.

Before applying changes, check:

- Whether the value affects provider credentials, Docker runtime behavior, Git automation, memory retention, or destructive cleanup.
- Whether a project override is masking the system value you expected to change.
- Whether a running sprint needs to be paused, restarted, or allowed to finish before the new value can be observed.

## Troubleshooting

If the saved setting does not appear to take effect:

- Verify the active Settings scope in the sticky command bar.
- Check for a project or sprint override that takes precedence over the system value.
- Refresh the affected dashboard page if the setting controls a rendered surface.
- Restart the local runtime only when the setting explicitly controls startup, listener, or process-level behavior.

## Related Documentation

- [Settings overview](./index.md)
- [Dashboard Settings](../../dashboard/design-system-settings.md)
- [Sprint Imports](../../dashboard/sprint-imports.md)
- [Security Hardening](../../operations/security-hardening.md)
