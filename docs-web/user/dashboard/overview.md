# The Dashboard

The Code UX dashboard is a real-time Preact application served at `http://localhost:4444` (configurable with `DASHBOARD_PORT`). It is the primary interface for humans operating Code UX.

This page introduces the layout. Each subsection links to a dedicated page.

## Layout

The dashboard uses a **dock-based navigation** by default:

- **Dock** *(desktop)* — A floating dock at the screen edge with one icon per page plus a settings button.
- **Sidebar** *(mobile or user preference)* — A collapsible left sidebar.
- **Top bar** — Project selector, theme toggle, mobile menu.

A choice of theme (Light / Dark / System) is in the top bar; navigation mode override is in **Settings → Appearance**.

The background is an animated Three.js scene ("Deep Ocean") that lazy-loads after the main UI is interactive, so it never blocks first paint.

## Pages

| Path | Page | What it does |
| --- | --- | --- |
| `/` | [Overview](./overview.md) | Cross-project metrics, recent activity, source list |
| `/projects` | [Projects](./projects.md) | Create, edit, delete, select projects |
| `/sprints` | [Sprints](./sprints.md) | Sprint board, AI planning, quicksprint templates, import/export |
| `/tasks` | [Tasks](./tasks.md) | Filterable list of tasks across the active project |
| `/live` | [Live Session](./live-session.md) | Real-time view of the active sprint run |
| `/chat` | [Chat](./chat.md) | Conversation threads with agents, plus invocation logs |
| `/agents` | [Agents](./agents.md) | Agent presets — system instructions, avatars, memory templates |
| `/memory` | [Memory](./memory.md) | Short/long-term memory, embedding model management, semantic search |
| `/browser` | [Sprint Preview Browser](./browser-preview.md) | Docker-backed live previews per sprint |
| `/stats` | [Stats](./stats.md) | Execution analytics, time-window filtering, trends |
| `/config` | [Settings](./settings.md) | System / project / sprint settings hierarchy |

## Real-time data

The dashboard maintains a live connection to the server using a custom WebSocket protocol at `wss://localhost:4444/api/realtime`. The connection:

- Subscribes to *scopes* (e.g. `project:<id>`, `execution`, `git-status`).
- Receives push events for sprint/task transitions, attention items, memory updates, Git status changes.
- Tracks a `lastSequence` for resumable reconnection.
- Falls back to polling if the WebSocket cannot be established.

Per-resource polling intervals (used as backup or for snapshot endpoints):

| Resource | Cadence |
| --- | --- |
| `/api/live-activities` | 10 s cache TTL |
| `/api/git-status` | 10 s cache TTL |
| `/api/live` snapshot | 30 s background refresh |

## Accessibility

The dashboard targets WCAG 2.1 AA:

- Every interactive surface is reachable via keyboard.
- Visible focus rings on focusable elements.
- ARIA labels on iconography.
- Sufficient contrast in both Light and Dark themes.

If you discover a regression, file an issue with the page path and the assistive technology used.
