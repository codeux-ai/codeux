# Nodes

The **Nodes** page (`/nodes`) is the project-scoped dashboard surface for node-flow workflows.
It lists saved flows for the selected project, opens an editable graph canvas, renders each node's
dynamic widget schema, manages agent attachments, validates graphs, and shows persisted run history.

## Project scope

Node flows are tied to the active project. When no project is selected, the page renders the same
project-required placeholder pattern used by other v2 pages. Selecting a project loads:

- node-flow records from `/api/projects/:projectId/node-flows`
- project agent presets for attachment controls
- agent-skill attachments and recent persisted runs for the selected flow

## Editor

The editor keeps a local draft of the selected flow title, description, graph nodes, edges, positions,
and widget data. The canvas is built in-house without React Flow or a diagram dependency. Nodes have
stable dimensions, keyboard-focusable selection, accessible labels, and pointer-based position edits.

The editable canvas side panels are controlled dashboard components. The palette creates trigger,
agent, task, condition, and output node actions from the typed canvas reducer contract. The inspector
edits selected node labels, descriptions, metadata intents, config fields, and enabled state through
callbacks, or shows read-only source/target details when an edge is selected. Port lists separate input
and output ports and include wiring hints so human operators and autonomous agents can understand which
connections are valid without leaving the canvas.

The inspector renders each selected node's `widgetSchema` fields:

- text and textarea values
- finite numeric inputs
- booleans
- select options
- JSON payloads parsed with `JSON.parse`
- secret references as reference strings only
- key-value string records

Widget values are stored as JSON data on the node. The dashboard never executes widget content.

## Validation and saving

Validation posts the draft graph to `/api/node-flows/:flowId/validate` and displays field-level issues
returned by the backend validator. Saving patches `/api/node-flows/:flowId` with the current draft.
The page marks unsaved edits separately from validation state so operators can see when a previously
valid graph has changed.

For dashboard-only draft canvases, `validateNodeCanvasGraph` groups structural issues by affected node
or edge before save. Each validation entry includes a severity label plus select/focus actions so the
canvas can move directly to the affected entity.

## Agent attachments

The inspector can attach a flow to project agent presets through the existing node-flow agent-skill
routes. Attachments expose the flow as a reusable skill for the agent. Detaching removes only the
agent-skill binding; it does not delete the flow.

## Runs

The run panel accepts project-safe JSON input from the flow `inputSchema` and calls the manual run API
with the active `projectId`. The response is a run summary containing the parent run, per-node run rows,
and the final output object, so the dashboard can update history and node status immediately after a
run completes.

Persisted flow runs and per-node run rows remain readable from the node-flow run routes. The panel shows
the parent run id separately from linked execution invocation ids, and per-node rows display
`executionInvocationId` when a provider or HTTP node created an observable invocation. Output JSON is
redacted for secret-shaped keys such as `token`, `password`, `secret`, and `apiKey` before rendering.
