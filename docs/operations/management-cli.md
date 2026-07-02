# CLI Management Surface

Code UX exposes a direct command-line management surface for the same core resources that the MCP management tools cover.

The CLI routes through the existing `ManagementToolHandler`, so command behavior stays aligned with the MCP tools for:

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

## Examples

```bash
codeux projects list
codeux sprints start --project <id> --sprint <id>
codeux quicksprints start --project <id> --template <id> --tasks 5
codeux scheduler schedule-quicksprint --project <id> --template <id> --at <iso>
codeux manage --payload-json '{"domain":"projects","action":"list","payload":{}}'
```

## Behavior

- `--json` prints the raw JSON envelope returned by the management handler.
- When required flags are missing and the terminal is interactive, the CLI prompts for the missing values.
- When the terminal is not interactive, the CLI fails fast with a concise list of missing flags.
- Destructive or approval-gated operations still require explicit approval in the underlying handler; the CLI does not auto-confirm them.

