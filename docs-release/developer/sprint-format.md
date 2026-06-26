# Sprint and subtask file format

Code UX sprints are stored both in a database and as on-disk markdown files. The markdown form is the **portable, human-editable, source-of-truth** representation. Importing/exporting a sprint round-trips through these files.

This page is the exact format reference.

## Directory layout

```
<repo>/.code-ux/
└── sprints/
    └── sprint-<n>/
        ├── sprint.md          # sprint header
        ├── <task-id>.md       # one file per subtask
        ├── <task-id>.md
        ├── …
        └── preview.sh         # optional preview container script
```

`<n>` is the sprint number; `<task-id>` is a stable URL-safe slug (e.g. `setup-db`, `auth-login`).

## `sprint.md` — sprint header

```markdown
name: Add health endpoint
number: 3
status: idle
start_date: 2026-05-04
end_date: 2026-05-10
feature_branch: feature/codeux/sprint-3-health-endpoint
goal:
Add /health and /ready endpoints with uptime, build hash, and dependency check.
Include unit tests and a runbook section.
```

### Fields

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Sprint label. |
| `number` | int | ✅ | Sprint number. Unique per project. |
| `status` | enum | – | `idle` \| `running` \| `paused` \| `completed` \| `failed` \| `cancelled`. Defaults to `idle`. |
| `start_date` | YYYY-MM-DD | – | Informational. |
| `end_date` | YYYY-MM-DD | – | Informational. |
| `feature_branch` | string | – | If omitted, derived from `<featureBranchPrefix>sprint-<n>-<slug(name)>`. |
| `goal` | multi-line | – | Everything after `goal:` to EOF. |

### Parsing rules

- Keys are case-insensitive.
- Values are trimmed.
- `goal:` is a *body marker* — content continues to end of file.
- Blank lines around values are tolerated.
- Unknown keys are preserved on round-trip but ignored by the engine.

## `<task-id>.md` — subtask

```markdown
title: Implement /health endpoint
depends_on: ["setup-routing"]
is_independent: false
merged: false
prompt:
Add GET /health to the Express router.
Return 200 with JSON { uptime, buildHash, deps: { db: "ok"|"down", redis: "ok"|"down" } }.
Implement deps check using existing `pingService` helpers.
Include unit tests covering ok and degraded states.
```

### Fields

| Key | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `title` | string | ✅ | – | Human-readable task title. |
| `depends_on` | array of strings | – | `[]` | Task IDs this task depends on. Quoted or unquoted; comma-separated. |
| `is_independent` | bool | – | `true` | Set to `false` if `depends_on` is non-empty. |
| `merged` | bool | – | `false` | Whether the task's PR has been merged into the feature branch. |
| `prompt` | multi-line | ✅ | – | Everything after `prompt:` to EOF. |

### Accepted `depends_on` syntaxes

```yaml
depends_on: ["setup-db", "auth-base"]
depends_on: [setup-db, auth-base]
depends_on:
  - setup-db
  - auth-base
```

All three are parsed equivalently. The serializer always emits the bracketed form with quoted keys.

### Status & merge fields

The on-disk format intentionally exposes only `merged` (to allow manual flagging) and not derived fields like `status`, `session_id`, `pr_url`. Those live in the database and are *projected* into the file on export but ignored on import.

If you want to *force* a status manually, edit it in the database via the dashboard's **Tasks** page or via `manage_code_ux` → `tasks` → `update`.

## Naming conventions

- Task IDs (the filename) **must** be URL-safe: `[a-z0-9-]+`.
- Task IDs **must** be unique within a sprint.
- Sprint directories **must** be `sprint-<n>`. The `<n>` is parsed as an integer.

## Round-tripping

- **Export** (`GET /api/projects/:id/sprints/:id/export`) emits a tar/zip bundle with `sprint.md` and one file per subtask.
- **Import** (`POST /api/projects/:id/sprints/import`) parses, validates, and creates the sprint.

Round-trip preserves: titles, prompts, dependencies, `merged`, `is_independent`, sprint name, number, goal, dates, feature branch.

Round-trip does **not** preserve: per-run state, dispatches, activity logs (those are run-scoped DB rows).

## Sample sprint

```
sprint-3/
├── sprint.md
├── setup-routing.md
├── health.md
├── ready.md
└── docs-update.md
```

`sprint.md`:
```markdown
name: Add health and readiness endpoints
number: 3
status: idle
goal:
Add GET /health and GET /ready endpoints. Update the runbook.
```

`setup-routing.md`:
```markdown
title: Wire base health router
depends_on: []
is_independent: true
merged: false
prompt:
Create src/routes/health.ts with an empty Express router and mount at /health in app.ts.
```

`health.md`:
```markdown
title: Implement /health
depends_on: ["setup-routing"]
is_independent: false
merged: false
prompt:
Add the actual /health handler returning uptime and build hash.
```

`ready.md`:
```markdown
title: Implement /ready
depends_on: ["setup-routing"]
is_independent: false
merged: false
prompt:
Add /ready returning component readiness for db and redis. Use pingService.
```

`docs-update.md`:
```markdown
title: Update README and runbook
depends_on: ["health", "ready"]
is_independent: false
merged: false
prompt:
Add a "Health checks" section to README and a runbook entry under docs/operations/runbook.md.
```

`docs-update` runs last because it depends on the two endpoint tasks. `health` and `ready` run in parallel because they share only the `setup-routing` dependency.
