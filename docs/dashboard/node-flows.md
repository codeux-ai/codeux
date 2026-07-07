# Node Flows Dashboard

The **Nodes** page (`/nodes`) is the dashboard surface for creating, editing, validating, running, scheduling, and attaching project node flows. It is project-scoped: no project means no flow library, no agent attachments, and no run history.

For the shorter page contract, see [Nodes](./nodes.md). For persistence and runtime details, see [Node Flows](../architecture/node-flows.md).

## Flow Library

When a project is selected, the page loads saved flows from `GET /api/projects/:projectId/node-flows`. The library shows the current flow title, description, version, node count, edge count, and update recency. Selecting a flow opens a local draft for the canvas and inspector.

Create and update operations write through the node-flow HTTP routes and increment the saved version on update. Deleting a flow removes the current flow, versions, attachments, and run rows through database cascade behavior.

## Canvas Editing

The editor manages the draft graph in the dashboard before saving:

- nodes have stable ids, titles, types, positions, and JSON `data`
- edges connect `fromNodeId` to `toNodeId`
- node selection is keyboard-focusable and labeled for assistive technology
- pointer movement edits node positions without adding a graph-rendering dependency
- unsaved draft state is shown separately from validation state

Editable node-canvas work that has not yet been persisted through the node-flow API should use the pure state helpers in `dashboard/src/v2/lib/nodes-canvas-state.ts`. That module defines typed canvas nodes, input and output ports, port-connected edges, config fields, selection state, reducer actions, deterministic layout, JSON serialization recovery, and the starter trigger -> agent -> task -> condition -> output graph. It is UI-free so canvas, inspector, and import surfaces can share one deterministic graph foundation.

The `/nodes` side-panel components use that same state contract without owning global state. `NodePalette`
emits typed `add_node` actions for trigger, agent, task, condition, and output templates. `NodeInspector`
renders node and edge selection details, controlled edits for label, description, metadata intents, config
fields, and enabled state, plus `NodePortList` wiring hints. `NodeValidationPanel` runs
`validateNodeCanvasGraph`, groups issues by affected entity, and exposes select/focus callbacks for the
canvas shell.

The canvas is intentionally Code UX-specific. It should not present imported n8n workflows as if every external node type can run locally.

## Dynamic Widget Inspector

The inspector renders each selected node's `widgetSchema` fields and writes values into the node's JSON data:

| Widget type | Dashboard behavior |
| --- | --- |
| `text` / `textarea` | Plain string input. |
| `number` | Finite numeric input, respecting optional min/max/step where present. |
| `boolean` | Toggle or checkbox-style boolean control. |
| `select` | Choice from declared options. |
| `json` | JSON value parsed before save or run input submission. |
| `secretRef` | Reference string only, not a raw secret value. |
| `keyValue` | Object with string values. |

Graph-level `inputSchema` describes manual and scheduled run input. Per-node widget schemas describe editable node configuration. Secret-bearing values should be represented as stable references that runtime services resolve elsewhere, not as inline credentials.

## Validation States

Validation posts the draft graph to `POST /api/node-flows/:flowId/validate`. The backend returns `valid`, `errors` with `field`, `code`, and `message`, and a normalized `graph` plus `executionOrder` when valid.

The page surfaces field-level issues without saving. A graph can be structurally valid and still contain node types that the runtime cannot execute; runtime-supported node types are documented in [Node Flows](../architecture/node-flows.md#runtime).

## Manual Run Panel

The run panel accepts JSON object input and calls `POST /api/node-flows/:flowId/run` with `projectId`, `input`, and optional trigger metadata. Blank input is treated as `{}`. Invalid JSON is rejected before submission.

Run history is read through:

- `GET /api/node-flows/:flowId/runs`
- `GET /api/node-flow-runs/:runId`
- `GET /api/node-flow-runs/:runId/node-runs`

The panel displays flow status, node status, linked execution invocation ids when present, error messages, and redacted JSON output. Secret-shaped keys are masked before display.

## Agent Attachment

The inspector can attach the selected flow to project agent presets through:

- `GET /api/node-flows/:flowId/agent-skills`
- `POST /api/node-flows/:flowId/agent-skills`
- `DELETE /api/node-flows/:flowId/agent-skills`

Attachment exposes the flow as a repeatable agent skill with a skill name and description. Detaching removes only the binding for that agent; it does not delete the flow or its run history.

## Scheduling

Operators can schedule a saved node flow from the Scheduler page. The scheduler form selects a project-owned flow and accepts optional JSON object input. Recurrence, pause/resume, failure status, and due-run behavior follow the scheduler contract in [Scheduler](./scheduler.md#node-flow-schedules).

## Responsive And Accessibility Expectations

Nodes must stay usable on desktop and mobile:

- the library, canvas, inspector, run panel, and attachment controls must reflow without overlapping text or controls
- selection, validation, save, run, attach, detach, pause, and destructive actions must be keyboard reachable
- icon-only controls need accessible labels
- validation and run errors must be text, not color-only
- focus order should follow library -> canvas -> inspector -> run/attachment panels
- JSON editors and textareas should preserve visible labels and error messages on small screens
