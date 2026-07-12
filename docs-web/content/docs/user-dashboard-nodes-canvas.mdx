# Nodes Automation Workspace

The **Nodes** page (`/nodes`) is a project-scoped automation workspace backed by the canonical node-flow repository. Browser storage is not a workflow database and edits are never auto-saved locally.

## Legacy canvas import

On the first load for a selected project, the dashboard checks the former `codeux:nodes-canvas:v1` key. When present, it normalizes the payload to Graph v2, creates an **Imported Nodes Canvas** backend draft, records a project-specific migration marker, and removes the legacy graph value. A failed import leaves the value available for retry. The marker prevents duplicates, so browser storage is a one-time migration source rather than a second workflow database.

Legacy planning nodes map to registered definitions and handles: `trigger` becomes `input`, `agent` becomes `set_fields`, `task` becomes `template`, and `condition` and `output` use their matching definitions. The original JSON-safe browser snapshot is retained in non-executable graph migration metadata for review. Secret-shaped keys and custom source fields remain visible to backend validation and cause the import to be rejected instead of being silently discarded.

## Governed editing

The registry supplies executable state, typed ports, widget schemas, capabilities, credential slots, side-effect classification, and default policy. The graph stores only a type/version reference and configuration; it never stores custom source or credential values.

Draft saves use `draftRevision`. A concurrent update returns a visible conflict. Validation, policy findings, credential status, dry runs, publication, version comparison, and rollback use the governed draft APIs.

## Operations

Only published versions run. The debugger shows redacted run output, graph and node states, attempts, retry classifications and decisions, invocation links, timing, cancellation, and safe retry controls. Scheduling is entered through the Scheduler page.
