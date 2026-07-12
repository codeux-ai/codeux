# Nodes Canvas

The **Nodes Canvas** page (`/nodes`) is a browser-local workspace for drafting Code UX workflow graphs. It composes the in-house node canvas, palette, inspector, validation panel, and agent command helpers without calling backend APIs or writing to the database.

This page is a draft and exchange surface. It does not synchronize graphs to projects, execute n8n workflows, or run node flows through the Code UX runtime.

## Local persistence

The page saves the current graph to browser `localStorage` under:

```text
codeux:nodes-canvas:v1
```

The stored value is the deterministic JSON produced by `serializeNodeCanvasGraph`. Reloading `/nodes` restores that graph when it can be parsed through the same canvas contract. Malformed persisted data falls back to the starter graph.

The enabled switch in the inspector is an editing-session flag only. It is not part of the persisted graph contract.

## Node types

The palette creates five node templates:

| Type | Purpose |
| --- | --- |
| `trigger` | Starts the graph from a manual or scheduled event source. |
| `agent` | Routes downstream work to a planning, implementation, review, or QA agent intent. |
| `task` | Captures a concrete task prompt and task intent. |
| `condition` | Branches based on an expression such as a validation result. |
| `output` | Collects the final graph result. |

Each node has stable input and output ports, editable labels and descriptions, typed config fields, metadata intents where applicable, and a fixed canvas position.

## Validation behavior

The page runs `validateNodeCanvasGraph` after every graph change. Validation is local and structural. It checks for:

- duplicate node ids
- missing edge source or target nodes
- missing edge source or target ports
- self-connections
- input/output direction mismatches
- incompatible port types
- empty required labels or config values
- invalid agent or task intent metadata

The status strip reports the current issue count. The validation panel groups issues by affected node or edge and exposes select/focus actions so operators can move directly to the problem entity. Validation errors do not prevent export; invalid imported graphs can be loaded when the JSON shape is valid so users can repair them on the canvas.

## Import and export format

`Export JSON` writes the current serialized graph into the exchange textarea. The JSON contains:

- `nodes`: node ids, kinds, labels, descriptions, positions, ports, config fields, and metadata
- `edges`: edge ids plus source and target node/port endpoints
- `selection`: selected node and edge ids

`Import JSON` routes the textarea content through the agent helper `replace_graph` command. Invalid JSON leaves the current graph unchanged and reports a live error. Valid JSON is normalized before it replaces the canvas and is immediately revalidated.

## Agent command surface

Agents should use `dashboard/src/v2/lib/nodes-agent-surface.ts` instead of driving the UI. The supported command names are:

- `add_node`
- `patch_node`
- `connect_ports`
- `delete_entities`
- `select_entities`
- `replace_graph`

The page displays the deterministic `buildNodeCanvasAgentSummary` output so agents can inspect node counts, edge counts, selected ids, ports, config values, and validation blockers in a command-friendly shape. Import uses the same command path, so autonomous graph changes and human JSON exchange share reducer-backed normalization and validation.

## Empty, reset, and no-selection states

`Clear` replaces the graph with an empty canvas. The canvas and inspector show empty/no-selection states, while the palette remains available for recovery. `Reset` restores the starter trigger -> agent -> task -> condition -> output graph and refreshes the exchange JSON.

The page uses responsive grid columns that collapse into a single column at smaller widths so the palette, canvas, inspector, validation panel, and JSON exchange controls remain reachable without overlapping.

## Graph v2 migration

Serialization writes `schemaVersion: 2`. Importing a legacy browser v1 value deterministically normalizes it and retains the untouched snapshot separately. Trigger, agent, task, condition, and output palette entries are planning concepts; executable definitions are limited to `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output`.
