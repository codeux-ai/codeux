# The Dashboard

The Code UX dashboard is a real-time Preact application served at `http://localhost:4444` (configurable with `DASHBOARD_PORT`). It is the primary interface for humans operating Code UX.

This page mirrors the canonical dashboard guide and the active v2 page files, where v2 is the active UI backed directly by `dashboard/src/v2/*Page.tsx`. Each subsection links to a dedicated page.

## Layout

The dashboard uses a **dock-based navigation** by default:

- **Dock** *(desktop)* — A floating dock at the screen edge with one icon per page plus a settings button.
- **Sidebar** *(mobile or user preference)* — A collapsible left sidebar.
- **Top bar** — Project selector, global search, tech-stack guidance selector, styleguide selector, sprint selector, theme toggle, mobile menu.

A choice of theme (Light / Dark / System) is in the top bar; navigation mode override is in **Settings → Appearance**. During onboarding, Appearance choices preview immediately and the setup shell follows the selected Light, Dark, or System theme instead of forcing dark mode. Background Mode, Static Color, and supported Zoom Level also preview before save, while advanced background controls such as Animation Style, Pattern Overlay, and custom background image remain in **Settings → Appearance**.

Primary navigation also follows the persisted experience mode in **Settings → Appearance**:

- **Easy** — Chat, Browser, Stats, Settings/Config, and external Docs.
- **Standard** — Chat, Overview, Sprints, Tasks, Agents, Stats, Browser, Docs, and Settings/Config.
- **Expert** — the full navigation, and the default for new or legacy settings.

Hidden pages remain registered routes, Docs opens the external project docs, and Browser still follows the project sprint-preview visibility settings.

When a project is active, the top bar shows tech-stack guidance and styleguide selectors beside global search. Imported and existing projects can remain at **None** until guidance is explicitly selected. Choosing an entry saves the project guidance override immediately; use [Styleguides and Tech Stacks](./styleguides-and-tech-stacks.md) for the full workflow.

The background is an animated Three.js scene ("Deep Ocean") that lazy-loads after the main UI is interactive, so it never blocks first paint. Onboarding can preview Theme, Navigation Mode, Reduced Motion, Background Mode, Static Color, and supported Zoom Level; advanced background controls such as Animation Style, Pattern Overlay, and custom background image remain in **Settings → Appearance**.

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
| `/nodes` | [Node Flows](./node-flows.md) | Create, validate, run, schedule, and attach repeatable node workflows |
| `/scheduler` | [Scheduler](./scheduler.md) | Scheduled sprints, quicksprints, node flows, messages, and memory remediation |
| `/memory` | [Memory](./memory.md) | Short/long-term memory, embedding model management, semantic search |
| `/knowledge` | [Knowledge](./knowledge.md) | Project knowledge base — documents, embeddings, semantic search |
| `/files` | [File Browser](./file-browser.md) | Browse project files and review sprint Git changes |
| `/browser` | [Sprint Preview Browser](./browser-preview.md) | Docker-backed live previews per sprint |
| `/stats` | [Stats](./stats.md) | Execution analytics, time-window filtering, trends |
| `/custom-dashboards` | [Custom Dashboards](./custom-dashboards.md) | Agent-generated project dashboards with detached validation and gated publication |
| `/config` | [Settings](./settings.md) | System / project / sprint settings hierarchy |
| `/config?category=guidance#guidance` | [Styleguides and Tech Stacks](./styleguides-and-tech-stacks.md) | Tech-stack guidance, styleguide catalogs, and custom worker instructions |

## Overview telemetry

The Overview telemetry rail combines cross-project runtime health with selected-project detail:

- Cross-project intervention cards still show active projects that need human attention.
- Active sprint cards and the runtime timeline continue to summarize work across active projects.
- When the top bar has a project selected and that project's live snapshot contains active attention items, Overview shows a compact **Selected Sprint Attention Queue** inside the telemetry panel.

The Overview queue follows the same selected sprint scope as the Live page. If a sprint is selected in the top navigation, the queue shows only the active attention items returned by the selected-sprint live snapshot; unrelated sprint blockers are not reconstructed in the browser. Overview renders the queue read-only, so claim, resolve, and dismiss actions remain on the Live page.

## Real-time data

The dashboard maintains a live connection to the server using a custom WebSocket protocol via `GET /api/realtime` (e.g., `ws://localhost:4444/api/realtime` for local HTTP dashboards, and `wss://<host>/api/realtime` for HTTPS deployments). On the server side, `DashboardRealtimeService` in `src/services/dashboard-realtime-service.ts` coordinates events, and the websocket upgrade/transport is handled in `src/server/dashboard-realtime-websocket-server.ts`. The connection:

- Subscribes to *scopes* (e.g. `project:<id>`, `execution`, `git-status`).
- Receives push events for sprint/task transitions, attention items, memory updates, Git status changes.
- Tracks a `lastSequence` for resumable reconnection.
- Falls back to polling if the WebSocket cannot be established.

Per-resource polling intervals (used as backup or for snapshot endpoints):

| Resource | Cadence |
| --- | --- |
| `/api/git-status` | 10 s cache TTL |
| `/api/live` snapshot | 30 s background refresh |

## Accessibility

The dashboard targets WCAG 2.1 AA:

- Every interactive surface is reachable via keyboard.
- Visible focus rings on focusable elements.
- ARIA labels on iconography.
- Sufficient contrast in both Light and Dark themes.

If you discover a regression, file an issue with the page path and the assistive technology used.
