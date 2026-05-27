# Collaboration Guide

This guide explains how operators collaborate with connected workers (agents) in Sprint OS. It covers configuring worker assignments, resolving attention items (blockers), and managing chat routing.

---

## Workflow 1: Managing Project Worker Assignments

Assigning a primary worker ensures a stable, sticky relationship between a project and an agent, allowing it to supervise sprints and manage attention items effectively.

### Prerequisites
- You must have an active project selected in the dashboard.
- A live worker must be connected to Sprint OS via MCP, or you must have configured a virtual provider.

### Steps
1. Navigate to the **Projects** or **Live** view in the dashboard.
2. Locate the **Worker Assignment** or **Settings** panel.
3. Select your preferred worker endpoint from the available list of connected workers or virtual providers.
4. Save the configuration to set the worker as `primary` for the project.

### Constraints
- A project can only have one `primary` worker at a time.
- If the selected worker is already the primary worker for another project, it may be assigned as an `overflow` worker instead, depending on availability.

---

## Workflow 2: Resolving Attention Items

Attention items represent tasks that require collaboration between workers and human operators (e.g., merge conflicts, requests for human escalation).

### Prerequisites
- The active sprint must be running or paused.
- The project must have active attention items in the **Attention Queue**.

### Steps
1. Navigate to the **Live** view in the dashboard to view the active project's Attention Queue.
2. Review the list of open attention items.
   - **Worker-owned items** (e.g., `merge_conflict`): These are assigned to the connected worker. You can claim these items on behalf of the worker if manual intervention is needed.
   - **Human-owned items** (e.g., `human_escalation_required`, `dashboard_reply_required`): These explicitly require your input.
3. Click on an item to view its details, including the repository path and the specific issue.
4. Take the necessary action (e.g., resolve a merge conflict locally, reply in the chat).
5. Click **Resolve** or **Dismiss** to remove the item from the queue and allow the orchestrator to proceed.

### Constraints
- You cannot resolve an item if it is currently actively claimed and being processed by another worker endpoint.
- Automation continues for non-blocked tasks even if attention items are open.

---

## Workflow 3: Configuring Chat Routing and Handoffs

Chat threads in Sprint OS can dynamically shift between connected MCP workers and virtual providers, ensuring context is preserved during handoffs.

### Prerequisites
- You must have a chat session open in the **Chat** page.
- You must have provider API keys configured in settings for virtual routing, or an active MCP worker connection.

### Steps
1. In the **Chat** page, initiate a conversation with the default assigned worker or virtual provider.
2. If you need to switch execution backends (e.g., from a virtual provider to a connected MCP worker), use the route selector to choose the new worker endpoint or provider.
3. Post your next message. The system will automatically detect the route change.
4. The system will compact the previous conversation history and replay it to the newly assigned worker, ensuring it has the full context of the thread.

### Constraints
- Large conversation histories may be compacted into a markdown summary before being sent to the new worker to prevent context window exhaustion.

---

## Troubleshooting

### Worker Goes Offline During an Assignment
- **Issue:** The primary worker disconnects while supervising a project.
- **Resolution:** The assignment remains sticky for a brief grace period. If the worker does not reconnect, the lease expires, and any active attention items will eventually be reopened or reassigned. You can also manually reassign the project to an active worker.

### Stale Worker Assignments
- **Issue:** Attempting to assign a preferred worker fails.
- **Resolution:** Check the live connection status. The API validation rules reject assignments to stale or offline workers. Ensure the worker process is running and successfully sending heartbeats.

### Open Attention Items but No Worker Available
- **Issue:** The dashboard shows open attention items, but no connected worker is available to handle them.
- **Resolution:** The project will not completely stall unless the specific task is blocked. You can manually intervene and resolve the items yourself, or wait for a worker to connect and automatically claim the worker-owned items.
