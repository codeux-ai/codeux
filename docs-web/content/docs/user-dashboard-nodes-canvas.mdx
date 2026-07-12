# Nodes Canvas

The **Nodes Canvas** page (`/nodes`) is a browser-local workspace for drafting Code UX workflow graphs. It combines the canvas, palette, inspector, validation panel, JSON exchange controls, and agent command summary without calling backend APIs or writing to the database.

This page does not synchronize graphs to projects, execute n8n workflows, or run node flows through the Code UX runtime.

## Local persistence

The page saves the current graph to browser `localStorage` under `codeux:nodes-canvas:v1`. Reloading `/nodes` restores that graph when it can be parsed through the canvas contract. Malformed persisted data falls back to the starter graph.

The inspector's enabled switch is an editing-session flag only and is not persisted in the graph JSON.

## Node types

| Type | Purpose |
| --- | --- |
| `trigger` | Starts the graph from a manual or scheduled event source. |
| `agent` | Routes downstream work to a planning, implementation, review, or QA agent intent. |
| `task` | Captures a concrete task prompt and task intent. |
| `condition` | Branches based on an expression such as a validation result. |
| `output` | Collects the final graph result. |

## Validation behavior

Validation runs locally after each graph change. It checks duplicate node ids, missing edge nodes or ports, self-connections, input/output direction mismatches, incompatible port types, empty required values, and invalid agent or task intent metadata.

The status strip reports the issue count. The validation panel groups issues by node or edge and provides select/focus actions. Valid JSON imports can still contain validation issues so users can repair them on the canvas.

## Import and export format

`Export JSON` writes the deterministic graph JSON into the exchange textarea. The JSON contains `nodes`, `edges`, and `selection`.

`Import JSON` applies the textarea content through the agent `replace_graph` command helper. Invalid JSON leaves the current graph unchanged and reports a live error. Valid JSON is normalized, loaded into the canvas, saved locally, and revalidated.

## Agent command surface

Agents should use the node canvas agent helper contract rather than driving the UI. Supported commands are `add_node`, `patch_node`, `connect_ports`, `delete_entities`, `select_entities`, and `replace_graph`.

The page displays a deterministic graph summary for command workflows, including node and edge counts, selected ids, ports, config values, and validation blockers.

## Empty and reset states

`Clear` empties the canvas while keeping the palette available. `Reset` restores the starter trigger -> agent -> task -> condition -> output graph. The layout collapses to a single column at smaller widths so controls remain reachable without overlapping.

## Graph v2 migration

Serialization writes `schemaVersion: 2`. Legacy browser v1 values migrate deterministically with their untouched snapshot retained separately. Trigger, agent, task, condition, and output are planning concepts; executable definitions are limited to `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output`.
