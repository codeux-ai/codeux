# Node workflow persistence

Node workflows are the durable Code UX-native graph model for future workflow APIs, MCP tools, schedulers, execution paths, and dashboard surfaces. This foundation is persistence-only: it does not dispatch providers, create HTTP routes, expose MCP tools, or render dashboard pages.

## Source files

- `src/contracts/node-workflow-types.ts` defines the shared TypeScript contracts.
- `src/repositories/node-workflow-repository.ts` owns SQLite persistence and validation.
- `src/repositories/db/app-db-schema.ts` defines the fresh database schema.
- `src/repositories/db/app-db-migrations.ts` replays idempotent startup migrations.

## Tables

| Table | Purpose |
| --- | --- |
| `node_workflows` | Project-owned workflow records with typed graph, widget, and metadata JSON payloads. |
| `node_workflow_agent_attachments` | Optional node-to-agent bindings. Project and workflow deletion cascades remove attachments; `agent_preset_id` uses `ON DELETE SET NULL`. |
| `node_workflow_runs` | Workflow execution attempts. Project and workflow deletion cascades remove run rows. |
| `node_workflow_run_steps` | Per-node step attempts within a workflow run. Project, workflow, and run deletion cascades remove step rows; agent references use `ON DELETE SET NULL`. |

The repository stores nodes, edges, widget definitions, widget values, and free-form metadata as JSON inside `node_workflows`. Agent attachments and run history are relational because they need independent lookup, cascade behavior, and recency indexes.

## Contract shape

Workflow records include:

- `status`: `draft`, `active`, or `archived`.
- `version`: a positive integer for future graph migrations.
- `widgetDefinitions` and `widgetValues`: workflow-level editable configuration.
- `nodes`: Code UX-native node records with their own widget definitions, widget values, positions, and metadata.
- `edges`: directed execution edges between node ids.

Widget definitions support generated specialist-node inputs for `text`, `textarea`, `number`, `boolean`, `select`, `multiselect`, `secret`, `url`, `json`, `code`, `key_value_list`, `file_path`, `directory_path`, and generic `path` fields. Definitions carry labels, descriptions, defaults, required flags, options, validation hints, grouping metadata, ordering, and metadata.

## Validation boundary

`NodeWorkflowRepository` validates workflow graph and widget payloads before writes:

- Node ids must be present and unique.
- Edge ids must be unique.
- Edge source and target node ids must exist.
- Directed workflow graphs must be acyclic for execution.
- Widget values are checked against definitions when the type is known.
- Agent attachments must reference a node in the same workflow when `nodeId` is present.
- Agent preset references must belong to the same project.
- Step runs must reference a node in the workflow snapshot.

Read mapping is defensive. Invalid persisted JSON for workflow graph, widget, attachment, run, or step payloads raises a clear repository error that identifies the row and JSON field instead of silently producing partial records.

## Indexes

Workflow tables include indexes for project workflow lists, project/status lists, workflow attachments, agent attachment lookups, project and workflow recent runs, run status scans, and step lookup by run/node.

These indexes are intentionally narrow. Later API and dashboard pages can add measured indexes when their query shapes are known.
