# Quicksprint templates

A **quicksprint template** is a reusable, parameterised sprint definition that you can spawn into a project with one click.

Use them when a particular shape of sprint recurs — e.g. *"add a CRUD endpoint"*, *"migrate one model from Sequelize to Prisma"*, *"audit a directory for performance regressions"*.

## Where they live

Quicksprint templates are scoped to a **project**. They are stored in the database and mirrored on disk under `<repo>/.code-ux/quicksprints/templates/<template-id>.md`.

The dashboard surface for them is the **Quicksprint panel** on the **Sprints** page.

The panel follows the dashboard language for controls, validation, planning progress, scheduling, failures, and screen-reader announcements. Switching to German does not translate or rewrite template names, descriptions, agent instructions, extra run instructions, provider/model selections, or the generated planning prompt.

The bundled catalog includes repository-aware **Create Web App**, **Create Desktop App**, **Create Onlineshop**, **Create Portfolio**, and **Create Game** templates. Their prompts inspect the selected repository, apply the experience guidance chosen by the create-app catalog, and produce an implementation-ready dependency DAG without assuming a generic stack.

## Anatomy of a template

A template has:

- **Name** — A short label.
- **Description** — One-line summary shown on cards.
- **Icon** — An icon identifier.
- **Category** — Used for grouping/filtering.
- **Category Color** *(optional)* — Color code for the category badge.
- **Agent Instructions** — The sprint prompt body.
- **Default Task Count** *(optional)* — The default number of subtasks to generate.

## Creating a template

From the Quicksprint panel, click **+ New template**. The editor lets you write the prompt body and define the metadata (Name, Description, Icon, Category, Default Task Count).

Save persists the template and broadcasts a real-time event.

## Executing a template

Click any template card. A sidebar opens where you can configure the run:

1. Code UX prepares to plan the sprint.
2. You can override the model, or route.
3. You can use the slider to choose the number of subtasks (up to 30), or toggle **No limit** to let the planner decide.
4. Click **Plan & Start** to immediately orchestrate after planning, or **Plan Only** to review the plan first.

The resulting sprint is identical to one created manually — you can edit subtasks before running.

## Editing & deleting

From the **⋯** menu on a template card:

- **Edit** — Update name, description, instructions, category, icon, etc.
- **Delete** — Destructive; confirm to remove. Deleting a built-in template writes a local tombstone marker so it's hidden for the project.

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
Add a complete CRUD endpoint for the specified model.

Requirements:
- POST /api/models — create
- GET /api/models — list (paginated)
- GET /api/models/:id — read
- PATCH /api/models/:id — update
- DELETE /api/models/:id — delete

Include input validation, integration tests, and an OpenAPI snippet.
```

### "Dependency upgrade" template

```text
Upgrade the specified package.

Steps:
- Bump version in package.json / requirements.txt / equivalent.
- Run package manager install.
- Read the changelog for breaking changes between versions.
- Apply codemods or manual fixes as needed.
- Update tests; ensure the suite is green.
- Document the upgrade in CHANGELOG.md.
```

## Tips

- Keep templates short and prescriptive. The planner agent will produce better subtasks from a focused prompt.
- Tag templates so you can filter them.
