# Nodes

The **Nodes** page (`/nodes`) opens the browser-local Nodes Canvas workspace for drafting Code UX workflow graphs. It does not require a selected project and does not call the node-flow backend APIs.

Use it to:

- add trigger, agent, task, condition, and output nodes from the palette
- select and move nodes on the canvas
- edit selected node labels, descriptions, metadata intents, and config fields in the inspector
- inspect selected edge source and target wiring
- review local structural validation issues
- import and export deterministic graph JSON
- view command-friendly graph metadata for agent workflows

The graph is saved to browser `localStorage` under `codeux:nodes-canvas:v1`. There is no cloud sync, database persistence, or real workflow execution on this page.

For the full local canvas contract, see [Nodes Canvas](./nodes-canvas.md). For the saved project-scoped runtime, validation API, manual runs, scheduling, and agent-skill attachments, see [Node Flows Dashboard](./node-flows.md).
