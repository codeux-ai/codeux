# CLI Commands Reference

The `codeux` CLI exposes the same management surface as the MCP tool handlers, but with a shell-friendly command layout for local operators and scripts.

## Runtime Startup

The same package also ships runtime entrypoints:

```bash
codeux
codeux --headless
codeux --server-mode --mcp-http-auth-token "$MCP_HTTP_AUTH_TOKEN"
codeux-worker --server-url http://SERVER_HOST:4445/mcp --auth-token "$CODE_UX_WORKER_AUTH_TOKEN" --project-id project-id
```

Use `--server-mode` for secure headless MCP HTTP deployments. It disables dashboard routes and websockets, starts MCP HTTP by default, and requires an explicit bearer token. Use `codeux-worker` for external worker hosts; the worker connects to the server-mode control plane and starts its own local `worker-host` execution runtime.

For full server-mode flags, health checks, token rotation, settings synchronization, and cluster worker troubleshooting, see [Secure Headless Server Mode](../operations/server-mode.md).

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
- `--payload-json` properties merge with explicitly passed command-line flags. For the `manage` passthrough, it can carry `domain`, `action`, `payload`, and `approval`. For direct domain commands, it acts as a base payload.
- Destructive actions require an approval retry. The first call returns an approval request, and the exact same action must be sent again with approval confirmation via `--payload-json '{"approval":{"confirmed":true}}'`.

## Startup Behavior

Before parsing regular management commands, the CLI intercepts startup flags.
- `--help` and `-h` show global help. However, if they are placed after a management command (e.g. `codeux projects --help`), the CLI intercepts it as domain-specific help.
- The CLI parses global start-up flags with values (e.g. `--api-key`, `--runtime-role`) before routing to the management handler.

## Flag Coercion

The CLI parser automatically coerces certain flags into appropriate types before forwarding them to the management handlers:
- **Booleans**: Flags like `--auto-start`, `--replan`, or `--no-task-limit` will be parsed as true/false depending on value (e.g. `true`, `yes`, `1`, `on` vs `false`, `no`, `0`, `off`).
- **Numbers**: Numeric flags like `--tasks` (`taskCount`), `--limit`, or `--min-similarity` are parsed as finite numbers.
- **Arrays**: Certain flags accept array values by repeating the flag multiple times. For example: `--memory-ids mem-1 --memory-ids mem-2` will be merged into an array `["mem-1", "mem-2"]`.

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
- `force-cancel` -> `force_cancel`
- `inspect-run` -> `inspect_run`
- `import-issues` -> `import_issues`
- `start-reembed` -> `start_reembed`
- `model-status` -> `model_status`
- `get-system` -> `get_system`
- `get-project-override` -> `get_project_override`
- `resolve-project-effective` -> `resolve_project_effective`
- `get-sprint-override` -> `get_sprint_override`
- `resolve-sprint-effective` -> `resolve_sprint_effective`
- `replace-system-settings` -> `replace_system_settings`
- `patch-system-setting` -> `patch_system_setting`
- `replace-project-settings` -> `replace_project_settings`
- `patch-project-setting` -> `patch_project_setting`
- `reset-project-settings` -> `reset_project_settings`
- `replace-sprint-settings` -> `replace_sprint_settings`
- `patch-sprint-setting` -> `patch_sprint_setting`
- `reset-sprint-settings` -> `reset_sprint_settings`
- `start-session` -> `start_session`
- `rebuild-session` -> `rebuild_session`
- `stop-session` -> `stop_session`
- `remove-session` -> `remove_session`
- `get-script` -> `get_script`
- `get-logs` -> `get_logs`
- `get-url` -> `get_url`
- `get-project-execution-snapshot` -> `get_project_execution_snapshot`
- `get-project-stats-snapshot` -> `get_project_stats_snapshot`
- `list-sprint-runs` -> `list_sprint_runs`
- `list-task-dispatches` -> `list_task_dispatches`
- `list-execution-invocations` -> `list_execution_invocations`
- `list-execution-invocation-messages` -> `list_execution_invocation_messages`

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
- Memory: `--project` plus `--query` for `search`; `--project` plus `--content` for `create`; `--project` plus `--memory-ids` for `promote`; `--memory` for `get`, `update`, and `delete`; claim actions use `--project` plus `--claim-id` where applicable and are easiest to automate with `--payload-json` for numeric fields such as `confidence`, `durability`, and evidence `weight`
- Preview: `--project` for `list_sessions`; `--project` plus `--sprint` for `start_session` and `get_script`; `--session` for `rebuild_session`, `stop_session`, `remove_session`, `get_logs`, and `get_url`
- Telemetry: `--project` for `get_project_execution_snapshot`, `get_project_stats_snapshot`, and `list_execution_invocations`; `--project` plus `--sprint` for `list_sprint_runs`; add `--task` for `list_task_dispatches`; `--invocation` for `list_execution_invocation_messages`

## Destructive Approval Handling

Some commands intentionally block on approval before they mutate state:

- `delete_*` actions
- `reset_*` settings actions
- `replace_*` settings actions
- selected scheduler delete operations

When one of those commands runs without approval, Code UX returns an approval request instead of mutating anything. Re-run the same command with `--payload-json '{"approval":{"confirmed":true}}'` once the user approves the change.

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
codeux memory promote --project proj-1 --memory-ids mem-1 --memory-ids mem-2
codeux memory start_reembed --project proj-1
codeux manage --payload-json '{"domain":"memory","action":"create_claim","payload":{"projectId":"proj-1","claim":"Use dependency factory composition for service wiring.","category":"patterns","confidence":0.9,"durability":0.85}}'
```

Durable claim actions exposed through the management surface are `create_claim`, `list_claims`, `get_claim`, `update_claim`, `add_claim_evidence`, and `deprecate_claim`. `deprecate_claim` follows the destructive approval flow: the first call returns an approval request, and the confirmed retry must include `--payload-json '{"approval":{"confirmed":true}}'`.

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
