# CLI Commands Reference

The `codeux` CLI exposes the same management surface as the MCP tool handlers, but with a shell-friendly command layout for local operators and scripts.

## Command Forms

There are two supported entry points:

```bash
codeux <domain> <action> [flags]
codeux manage --payload-json '{"domain":"projects","action":"list","payload":{}}'
```

The direct domain form is the preferred shell interface. The generic `manage` form is useful when you already have an MCP-shaped payload or want to forward a full JSON request without re-mapping the fields by hand.

## Common Rules

- Action names accept dash-case aliases and normalize to the internal snake_case action names.
- The CLI prompts for missing required flags only when `stdin` is a TTY.
- If required flags are missing in non-interactive mode, the command fails instead of guessing.
- `--json` prints the raw management envelope returned by the handler.
- `--payload-json` can carry `domain`, `action`, `payload`, and `approval` for the `manage` passthrough.
- Destructive actions require an approval retry. The first call returns an approval request, and the exact same action must be sent again with `approval.confirmed: true`.

## Common Aliases

These aliases are accepted and normalized before dispatch:

- `list-templates` -> `list_templates`
- `get-template` -> `get_template`
- `create-template` -> `create_template`
- `update-template` -> `update_template`
- `delete-template` -> `delete_template`
- `schedule-sprint` -> `schedule_sprint`
- `schedule-quicksprint` -> `schedule_quicksprint`
- `schedule-chat` -> `schedule_chat`
- `get-system` -> `get_system`
- `replace-system-settings` -> `replace_system_settings`
- `patch-project-setting` -> `patch_project_setting`
- `start-session` -> `start_session`
- `get-project-stats-snapshot` -> `get_project_stats_snapshot`

## Flag Conventions

The CLI accepts the same compact flag names used by the dashboard and MCP layers.

- `--project`
- `--sprint`
- `--task`
- `--template`
- `--entry`
- `--preset`
- `--memory`
- `--session`
- `--invocation`
- `--at` for `scheduledFor`
- `--tasks` for quicksprint task counts
- `--agent-instruction-markdown`
- `--body-markdown`
- `--settings-json`
- `--path`
- `--value`
- `--payload-json` for raw JSON input
- `--json` for raw JSON output

The CLI also prompts for missing required flags when it is connected to an interactive terminal. Empty answers fall back to the prompt default when the prompt defines one.

## Required Flags At A Glance

Use these core flags most often:

- Projects: `--project` for `get`, `update`, `select`, `setup`, and `delete`; `--name` for `create`
- Sprints: `--project` for `list`, `import_issues`, and `plan`; `--project` plus `--sprint` for `start` and `inspect_run`; `--sprint` for `get`, `update`, and `delete`
- Quicksprints: `--project` for `list_templates`; `--project` plus `--template` for `get_template`, `update_template`, `delete_template`, `start`, and `execute`; `create_template` also requires `--name`, `--description`, `--icon`, `--category`, and `--agent-instruction-markdown`
- Scheduler: `--project` plus `--scheduled-for` for `create` and `schedule_*`; add `--sprint`, `--template`, or `--body-markdown` depending on the target type; generic `create` also needs `--target-type` or a payload with `targetType`; `--entry` for `update` and `delete`
- Settings: `--settings-json` for replace actions; `--project` and `--sprint` when the scope is project or sprint specific; `--path` and `--value` for patch actions; `reset_project_settings` needs `--project` and `reset_sprint_settings` needs `--sprint`
- Agents: `--project` for `list`, `create`, and `sync`; `--project` plus `--preset` for `get`, `update`, and `delete`
- Memory: `--project` plus `--query` for `search`; `--project` plus `--content` for `create`; `--project` plus `--memory-ids` for `promote`; `--memory` for `get`, `update`, and `delete`
- Preview: `--project` for `list_sessions`; `--project` plus `--sprint` for `start_session` and `get_script`; `--session` for `rebuild_session`, `stop_session`, `remove_session`, `get_logs`, and `get_url`
- Telemetry: `--project` for `get_project_execution_snapshot`, `get_project_stats_snapshot`, and `list_execution_invocations`; `--project` plus `--sprint` for `list_sprint_runs`; add `--task` for `list_task_dispatches`; `--invocation` for `list_execution_invocation_messages`

## Destructive Approval Handling

Some commands intentionally block on approval before they mutate state:

- `delete_*` actions
- `reset_*` settings actions
- `replace_*` settings actions
- selected scheduler delete operations

When one of those commands runs without approval, Code UX returns an approval request instead of mutating anything. Re-run the same command with `approval.confirmed: true` once the user approves the change.

## Domain Examples

### Projects

```bash
codeux projects list
codeux projects get --project proj-1
codeux projects create --name "Website Refresh"
```

### Sprints

```bash
codeux sprints plan --project proj-1 --name "SPR-12" --goal "Ship the pricing page redesign"
codeux sprints start --project proj-1 --sprint sprint-1
codeux sprints import_issues --project proj-1
```

### Quicksprints

```bash
codeux quicksprints list_templates --project proj-1
codeux quicksprints start --project proj-1 --template qs-audit --tasks 5
codeux quicksprints execute --project proj-1 --template qs-ui --no-task-limit
```

### Scheduler

```bash
codeux scheduler list --project proj-1
codeux scheduler schedule-quicksprint --project proj-1 --template qs-ui --at 2026-06-01T12:00:00Z
codeux scheduler schedule-chat --project proj-1 --body-markdown "Standup check-in" --at 2026-06-01T13:00:00Z
codeux scheduler update --entry sched-1 --status paused
```

Minute-level recurrence is supplied through `--payload-json` or the dashboard/MCP payload using the same `recurrence.frequency = minutely` literal accepted by the API and MCP payloads.

### Settings

```bash
codeux settings get_system
codeux settings resolve_project_effective --project proj-1
codeux settings patch_project_setting --project proj-1 --path git.defaultBranch --value main
codeux settings replace_sprint_settings --project proj-1 --sprint sprint-1 --settings-json '{"git":{"autoCreatePr":true}}'
```

### Agents

```bash
codeux agents list --project proj-1
codeux agents sync --project proj-1
codeux agents update --project proj-1 --preset qa-agent --payload-json '{"instructionMarkdown":"Review for regressions"}'
```

### Memory

```bash
codeux memory search --project proj-1 --query "pricing page"
codeux memory promote --project proj-1 --memory-ids '["mem-1","mem-2"]'
codeux memory start_reembed --project proj-1
```

### Preview

```bash
codeux preview list_sessions --project proj-1
codeux preview start_session --project proj-1 --sprint sprint-1
codeux preview get_url --session preview-1 --path /
```

### Telemetry

```bash
codeux telemetry get_project_stats_snapshot --project proj-1
codeux telemetry list_execution_invocations --project proj-1
codeux telemetry list_execution_invocation_messages --invocation inv-1
```

## Notes

- `codeux manage` is the best fit when you already have an MCP-style payload.
- The direct domain commands are easier to discover interactively because required flags are surfaced through prompts.
- Use `--json` when another tool needs the raw envelope instead of the human-readable summary text.
