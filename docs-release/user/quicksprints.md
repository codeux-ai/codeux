# Quicksprint templates

A **quicksprint template** is a reusable, parameterised sprint definition that you can spawn into a project with one click.

Use them when a particular shape of sprint recurs — e.g. *"add a CRUD endpoint"*, *"migrate one model from Sequelize to Prisma"*, *"audit a directory for performance regressions"*.

## Where they live

Quicksprint templates are scoped to a **project**. They are stored in the database and (optionally) mirrored on disk under `<repo>/.quicksprints/<template-id>.md`.

The dashboard surface for them is the **Quicksprint panel** on the **Sprints** page.

## Anatomy of a template

A template has:

- **Name** — A short label.
- **Description** — One-line summary shown on cards.
- **Prompt template** — The sprint prompt body. May contain `{{placeholder}}` slots for runtime substitution.
- **Default sprint name template** — Used when generating the sprint name from a single execution.
- **Variables** — A typed list of placeholders the user fills before execution.
- **Tags** — Used for filtering on the panel.

## Creating a template

From the Quicksprint panel, click **+ New template**. The editor lets you write the prompt body and define variables. Each variable has:

- `key` (matches `{{key}}` in the prompt).
- `label` (UI label).
- `type` — `text`, `multiline`, `select`.
- `default` — pre-filled value.
- `options` — for `select` type.

Save persists the template and broadcasts a real-time event.

## Executing a template

Click any template card. A modal opens prompting for variable values. On **Run**:

1. Code UX substitutes `{{key}}` placeholders with your values.
2. Creates a new sprint in the active project.
3. Plans the sprint via the planning agent (using the substituted prompt).
4. Optionally orchestrates immediately (toggle in the modal).

The resulting sprint is identical to one created manually — you can edit subtasks before running.

## Editing & deleting

From the **⋯** menu on a template card:

- **Edit** — Update name, description, prompt, variables.
- **Delete** — Destructive; confirm to remove.

## REST API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/projects/:projectId/quicksprints/templates` | List templates |
| GET | `/api/projects/:projectId/quicksprints/templates/:templateId` | Get one |
| POST | `/api/projects/:projectId/quicksprints/templates` | Create |
| PATCH | `/api/projects/:projectId/quicksprints/templates/:templateId` | Update |
| DELETE | `/api/projects/:projectId/quicksprints/templates/:templateId` | Delete |
| POST | `/api/projects/:projectId/quicksprints/execute` | Execute (returns the new sprint) |

## Examples

### "Add CRUD endpoint" template

```text
Add a complete CRUD endpoint for the `{{model}}` model.

Requirements:
- POST /api/{{model_plural}} — create
- GET /api/{{model_plural}} — list (paginated)
- GET /api/{{model_plural}}/:id — read
- PATCH /api/{{model_plural}}/:id — update
- DELETE /api/{{model_plural}}/:id — delete (soft, unless {{soft_delete}} is "no")

Include input validation, integration tests, and an OpenAPI snippet.
```

Variables: `model`, `model_plural`, `soft_delete` (select: yes/no).

### "Dependency upgrade" template

```text
Upgrade `{{package}}` from {{from_version}} to {{to_version}}.

Steps:
- Bump version in package.json / requirements.txt / equivalent.
- Run package manager install.
- Read the changelog for breaking changes between versions.
- Apply codemods or manual fixes as needed.
- Update tests; ensure the suite is green.
- Document the upgrade in CHANGELOG.md.
```

Variables: `package`, `from_version`, `to_version`.

## Tips

- Keep templates short and prescriptive. The planner agent will produce better subtasks from a focused prompt.
- Use `multiline` variables for free-form context (linked tickets, design docs).
- Tag templates so you can filter "build" vs "maintenance" vs "investigation".
