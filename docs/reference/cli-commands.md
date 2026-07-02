# CLI Commands Reference

`codeux` exposes the same management handlers used by MCP, plus a generic `manage` passthrough for raw MCP-shaped payloads.

## Invocation Forms

- `codeux <domain> <action> [flags]`
- `codeux manage --payload-json '<json>'`

Supported management domains:

- `projects`
- `sprints`
- `tasks`
- `quicksprints`
- `scheduler`
- `settings`
- `agents`
- `memory`
- `preview`
- `telemetry`

Direct domain commands and `manage` both call the same backend handlers. The only difference is how the payload is supplied.

## Common Flags

The CLI accepts the common human aliases below and normalizes them into the internal management payload:

| Canonical flag | Common aliases |
| --- | --- |
| `--project` | `--project-id` |
| `--sprint` | `--sprint-id` |
| `--sprint-run` | `--sprint-run-id`, `--sprintrun`, `--sprintrunid` |
| `--task` | `--task-id` |
| `--template` | `--template-id` |
| `--entry` | `--entry-id` |
| `--preset` | `--preset-id` |
| `--memory` | `--memory-id` |
| `--session` | `--session-id` |
| `--invocation` | `--invocation-id` |
| `--at` | `--scheduled-for` |
| `--tasks` | `--task-count` |
| `--settings-json` | `--settings-json` |
| `--payload-json` | `--payload-json` |
| `--memory-ids` | `--memory-ids` |
| `--json` | `--json` |

Hyphenated action aliases are also accepted and normalized to snake_case. Common examples include:

- `schedule-sprint`, `schedule-quicksprint`, `schedule-chat`
- `list-templates`, `get-template`, `create-template`, `update-template`, `delete-template`
- `get-system`, `get-project-override`, `resolve-project-effective`
- `replace-system-settings`, `patch-project-setting`, `reset-sprint-settings`
- `start-session`, `rebuild-session`, `stop-session`, `remove-session`, `get-url`
- `get-project-execution-snapshot`, `get-project-stats-snapshot`, `list-execution-invocations`

## Interactive Prompting

- Missing required flags are prompted only when `stdin` is interactive.
- Prompts use the same human labels as the underlying action, so the CLI can ask for project, sprint, template, task, memory, or JSON payload values without a separate wrapper command.
- When `stdin` is not interactive, the CLI fails fast with the missing flag list instead of waiting for input.

## JSON Output And Passthrough

- `--json` prints the raw JSON envelope returned by the management handler.
- Without `--json`, the CLI prints a human-readable summary of the envelope.
- `--payload-json` accepts a raw MCP-shaped payload. The value can include `domain`, `action`, `payload`, and `approval`, or it can be a plain object that becomes the payload when those keys are absent.
- When `--payload-json` is used together with direct flags, the CLI merges the flag values into the payload before dispatching the handler.

## Approval-Gated Work

- Destructive actions still require explicit approval in the underlying handler.
- `delete_*`, `reset_*`, and `replace_*` settings actions queue a confirmation step first; the CLI does not auto-confirm them.
- Settings mutations are one-use approvals: the first call records the exact payload, and only the same action plus the same payload can run once with `approval.confirmed: true` within the approval window.
- When the handler returns `approvalRequired: true`, rerun the exact same command after confirming the change with the user.

## Examples

| Domain | Example |
| --- | --- |
| `projects` | `codeux projects list` |
| `sprints` | `codeux sprints start --project <id> --sprint <id>` |
| `quicksprints` | `codeux quicksprints start --project <id> --template <id> --tasks 5` |
| `scheduler` | `codeux scheduler schedule-quicksprint --project <id> --template <id> --at <iso>` |
| `settings` | `codeux settings patch-project-setting --project <id> --path git.defaultBranch --value main` |
| `agents` | `codeux agents delete --project <id> --preset <id>` |
| `memory` | `codeux memory promote --project <id> --memory-ids '["mem-1","mem-2"]'` |
| `preview` | `codeux preview get-url --session <id> --path /` |
| `telemetry` | `codeux telemetry list-execution-invocations --project <id>` |

## Manage Passthrough

The generic passthrough is useful when you already have the MCP-shaped payload:

```bash
codeux manage --payload-json '{"domain":"projects","action":"list","payload":{}}'
codeux manage --domain sprints --action start --payload-json '{"projectId":"p1","sprintId":"s1"}'
```

Because the passthrough talks to the same handler, it supports the same domain-specific validation, approval requirements, and output formatting as the direct domain commands.
