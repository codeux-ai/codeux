# Sprint Preview Browser

The **Browser** page (`/browser`) lets you spin up a Docker container per sprint that runs your application — and view it through an embedded browser-like surface inside the dashboard.

This is invaluable for visually verifying changes a sprint has made (UI work, API endpoints, generated artefacts) before you merge anything to main.

## Concepts

| Term | Meaning |
| --- | --- |
| **Preview session** | A live Docker container running the sprint's working tree, plus a browser pane that connects to a chosen port inside it. |
| **Preview script** | A shell script associated with the sprint that the container runs at startup (`npm run dev`, `python manage.py runserver`, etc.). |
| **Port mapping** | The container's internal port → host port mapping that the browser pane uses. |

## Starting a preview

1. Open the **Browser** page.
2. Pick a sprint from the dropdown.
3. Click **Launch container**.
4. If no preview script exists yet, the **Preview script editor** opens. Write the startup script (defaults provided per language).
5. Save and click **Start**. Code UX:
   - Builds a container image based on `node:24-bookworm` (or your override).
   - Mounts the sprint's worktree.
   - Runs the script.
   - Maps the configured port to a host port.
6. The browser pane appears. Logs stream in a side panel.

## Using the browser pane

The pane is an iframe-like container with toolbar buttons:

- **Reload** — Refresh the embedded page.
- **Open in new tab** — Open the host URL externally.
- **Inspect logs** — Toggle a side log panel.
- **Restart container** — Rebuild from scratch.

The URL bar is read-only; it shows the host URL the container is exposing.

## Preview session sider

The **PreviewSessionSlider** at the top of the page shows all sessions currently running across this project — switch between them with one click.

## Stopping & removing

- **Stop** — Halts the container but keeps the session row, including logs and script.
- **Rebuild** — Stops, recreates from the latest worktree, and restarts.
- **Remove** — Destructive. Deletes the session row and pruning the container.

## Editing the preview script

The script lives in the project's `.code-ux/sprints/sprint-<n>/preview.sh`. Editing it via the dashboard saves directly to that file, so the script is portable across teammates.

## Quotas

The page shows the count of running preview containers. Code UX does not enforce a hard cap, but each container consumes host resources — close sessions you no longer need.

## Programmatic control

The MCP `preview` management domain provides equivalent controls — `list_sessions`, `start_session`, `rebuild_session`, `stop_session`, `remove_session`, `get_script`. See [Management actions → preview](../../developer/management-actions.md#preview).
