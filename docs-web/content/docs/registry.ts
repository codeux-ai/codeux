import type { PageMeta } from '../../lib/page-meta'

export type DocsSection = 'Getting Started' | 'User Guide' | 'Developer Reference' | 'Architecture'

export type DocsSlug =
  | 'docs-overview'
  | 'user-introduction'
  | 'user-installation'
  | 'user-quickstart'
  | 'user-overview'
  | 'user-mcp-clients'
  | 'user-sprint-orchestration'
  | 'user-providers-and-models'
  | 'user-automation-and-ci'
  | 'user-quicksprints'
  | 'user-troubleshooting'
  | 'user-dashboard-overview'
  | 'user-dashboard-projects'
  | 'user-dashboard-sprints'
  | 'user-dashboard-tasks'
  | 'user-dashboard-live-session'
  | 'user-dashboard-chat'
  | 'user-dashboard-agents'
  | 'user-dashboard-nodes'
  | 'user-dashboard-node-flows'
  | 'user-dashboard-scheduler'
  | 'user-dashboard-memory'
  | 'user-dashboard-knowledge'
  | 'user-dashboard-file-browser'
  | 'user-dashboard-browser-preview'
  | 'user-dashboard-stats'
  | 'user-dashboard-settings'
  | 'user-dashboard-styleguides-and-tech-stacks'
  | 'developer-overview'
  | 'developer-mcp-tools'
  | 'developer-management-actions'
  | 'developer-http-api'
  | 'developer-websocket-realtime'
  | 'developer-configuration'
  | 'developer-settings-reference'
  | 'developer-sprint-format'
  | 'developer-building-from-source'
  | 'developer-testing'
  | 'architecture-overview'
  | 'architecture-system-overview'
  | 'architecture-mcp-server'
  | 'architecture-sprint-engine'
  | 'architecture-virtual-workers'
  | 'architecture-ci-integration'
  | 'architecture-dashboard-architecture'
  | 'architecture-data-model'
  | 'architecture-external-chat-providers'
  | 'architecture-configuration-resolution'
  | 'architecture-security'
  | 'settings-subcategories-display-settings'
  | 'settings-subcategories-guidance'
  | 'settings-subcategories-onboarding'

export interface DocsRegistryEntry extends Partial<Omit<PageMeta, 'title' | 'description'>> {
  id: DocsSlug
  path: string
  section: DocsSection
  title: string
  description: string
}

export const docsRegistry: Record<DocsSlug, DocsRegistryEntry> = {
  'docs-overview': {
    id: 'docs-overview',
    path: '/docs/docs-overview',
    section: 'Getting Started',
    title: "Code UX Documentation",
    description: "Code UX is a local-first, container-first multi-provider runtime. It turns a goal into a managed sprint — planned, routed to the right agent, executed in isolated Docker workspaces, reviewed through Git and CI, and tr...",
  },
  'user-introduction': {
    id: 'user-introduction',
    path: '/docs/user-introduction',
    section: 'Getting Started',
    title: "Introduction",
    description: "Code UX is an open-source, container-first agentic coding runtime. You describe a piece of work — a feature, refactor, migration, QA pass, or CI repair — and Code UX turns it into a managed sprint: planned into depend...",
  },
  'user-installation': {
    id: 'user-installation',
    path: '/docs/user-installation',
    section: 'Getting Started',
    title: "Installation",
    description: "Code UX runs entirely on your machine. You can install it as a desktop app or build it from source — both ship the same runtime, dashboard, and MCP server. You can install and start Code UX with no configuration; prov...",
  },
  'user-quickstart': {
    id: 'user-quickstart',
    path: '/docs/user-quickstart',
    section: 'Getting Started',
    title: "Quickstart",
    description: "This guide takes you from a clean install to a finished sprint in about ten minutes. You will start Code UX, create a project, plan a small sprint with the AI planner, run it, and watch it merge.",
  },
  'user-overview': {
    id: 'user-overview',
    path: '/docs/user-overview',
    section: 'User Guide',
    title: "User Guide",
    description: "Welcome to Code UX — a local-first, container-first multi-provider runtime. This section is for people running sprints, whether from the local dashboard or an MCP client.",
  },
  'user-mcp-clients': {
    id: 'user-mcp-clients',
    path: '/docs/user-mcp-clients',
    section: 'User Guide',
    title: "Connecting MCP clients",
    description: "Besides its dashboard, Code UX is also a Model Context Protocol (MCP) server. Any MCP-compatible client can connect to it and call its tools — so you can drive projects and sprints from the Gemini CLI, Codex, Claude C...",
  },
  'user-sprint-orchestration': {
    id: 'user-sprint-orchestration',
    path: '/docs/user-sprint-orchestration',
    section: 'User Guide',
    title: "Sprint orchestration in depth",
    description: "This page is the canonical reference for how a sprint runs end to end. It is written for users who want to understand and tune the orchestrator — not just drive it.",
  },
  'user-providers-and-models': {
    id: 'user-providers-and-models',
    path: '/docs/user-providers-and-models',
    section: 'User Guide',
    title: "Providers and models",
    description: "Code UX dispatches work across seven providers, each accepting one or more models. This page is the catalog plus the routing system that decides which provider answers which kind of work.",
  },
  'user-automation-and-ci': {
    id: 'user-automation-and-ci',
    path: '/docs/user-automation-and-ci',
    section: 'User Guide',
    title: "Automation, CI and merge policy",
    description: "Code UX integrates with your existing GitHub-based CI to gate merges, automatically retry CI fixes, and surface the rest as attention items. This page describes those policies and how to tune them.",
  },
  'user-quicksprints': {
    id: 'user-quicksprints',
    path: '/docs/user-quicksprints',
    section: 'User Guide',
    title: "Quicksprint templates",
    description: "A quicksprint template is a reusable, parameterised sprint definition that you can spawn into a project with one click.",
  },
  'user-troubleshooting': {
    id: 'user-troubleshooting',
    path: '/docs/user-troubleshooting',
    section: 'User Guide',
    title: "Troubleshooting",
    description: "Solutions to the most common issues. If your problem is not covered here, see the system overview, the MCP client guide, or open an issue.",
  },
  'user-dashboard-overview': {
    id: 'user-dashboard-overview',
    path: '/docs/user-dashboard-overview',
    section: 'User Guide',
    title: "The Dashboard",
    description: "The Code UX dashboard is a real-time Preact application served at http://localhost:4444 (configurable with DASHBOARD_PORT). It is the primary interface for humans operating Code UX.",
  },
  'user-dashboard-projects': {
    id: 'user-dashboard-projects',
    path: '/docs/user-dashboard-projects',
    section: 'User Guide',
    title: "Projects",
    description: "The Projects page (/projects) lists every project Code UX manages and lets you create, edit, select, and delete them. Each card now surfaces the source badge, repository URL, local workspace directory, creation and up...",
  },
  'user-dashboard-sprints': {
    id: 'user-dashboard-sprints',
    path: '/docs/user-dashboard-sprints',
    section: 'User Guide',
    title: "Sprints",
    description: "The Sprints page (/sprints) is where you plan, manage, and launch sprint runs.",
  },
  'user-dashboard-tasks': {
    id: 'user-dashboard-tasks',
    path: '/docs/user-dashboard-tasks',
    section: 'User Guide',
    title: "Tasks",
    description: "The Tasks page (/tasks) is a Kanban-style task board for the active project. It organizes tasks into Queued, In Progress, and Completed lanes, with sprint scope, status, priority, and search controls above the board.",
  },
  'user-dashboard-live-session': {
    id: 'user-dashboard-live-session',
    path: '/docs/user-dashboard-live-session',
    section: 'User Guide',
    title: "Live Session",
    description: "The Live Session page (/live) is the real-time control room for an active sprint run.",
  },
  'user-dashboard-chat': {
    id: 'user-dashboard-chat',
    path: '/docs/user-dashboard-chat',
    section: 'User Guide',
    title: "Chat",
    description: "The Chat page (/chat) is a thread-based conversation surface that lets you talk to agents for project-backed Q&A, inspect execution invocation transcripts and MCP tool invocations, and get local onboarding help before...",
  },
  'user-dashboard-agents': {
    id: 'user-dashboard-agents',
    path: '/docs/user-dashboard-agents',
    section: 'User Guide',
    title: "Agents",
    description: "The Agents page (/agents) manages the agent presets available to the active project.",
  },
  'user-dashboard-nodes': {
    id: 'user-dashboard-nodes',
    path: '/docs/user-dashboard-nodes',
    section: 'User Guide',
    title: "Nodes",
    description: "The Nodes page (/nodes) manages project-scoped workflow graphs for editing, widget configuration, agent attachments, validation, and persisted run inspection.",
  },
  'user-dashboard-node-flows': {
    id: 'user-dashboard-node-flows',
    path: '/docs/user-dashboard-node-flows',
    section: 'User Guide',
    title: "Node Flows",
    description: "Create and operate saved node-flow workflows for the active project, including dynamic widgets, validation, manual runs, scheduling, run inspection, and agent skill attachments.",
  },
  'user-dashboard-scheduler': {
    id: 'user-dashboard-scheduler',
    path: '/docs/user-dashboard-scheduler',
    section: 'User Guide',
    title: "Scheduler",
    description: "The Scheduler page (dock label Schedule, /scheduler) runs Code UX work on a timetable. Schedule a sprint, a quicksprint template, a project message, or memory remediation to fire once or on a recurring cadence — usefu...",
  },
  'user-dashboard-memory': {
    id: 'user-dashboard-memory',
    path: '/docs/user-dashboard-memory',
    section: 'User Guide',
    title: "Memory",
    description: "The Memory page (/memory) manages Code UX's two-tier semantic memory system and the embedding models that power it.",
  },
  'user-dashboard-knowledge': {
    id: 'user-dashboard-knowledge',
    path: '/docs/user-dashboard-knowledge',
    section: 'User Guide',
    title: "Knowledge",
    description: "The Knowledge page (/knowledge) is a per-project knowledge base. You add documents, Code UX chunks and embeds them, and agents can retrieve the relevant pieces during planning and coding — giving them grounded project...",
  },
  'user-dashboard-file-browser': {
    id: 'user-dashboard-file-browser',
    path: '/docs/user-dashboard-file-browser',
    section: 'User Guide',
    title: "File Browser",
    description: "The File Browser page (dock label Files, /files) lets you inspect a project's files and review a sprint's Git changes from inside the dashboard, without switching to a terminal or editor.",
  },
  'user-dashboard-browser-preview': {
    id: 'user-dashboard-browser-preview',
    path: '/docs/user-dashboard-browser-preview',
    section: 'User Guide',
    title: "Sprint Preview Browser",
    description: "The Browser page (/browser) lets you spin up a Docker container per sprint that runs your application — and view it through an embedded browser-like surface inside the dashboard.",
  },
  'user-dashboard-stats': {
    id: 'user-dashboard-stats',
    path: '/docs/user-dashboard-stats',
    section: 'User Guide',
    title: "Stats",
    description: "The Stats page (/stats) is the analytics surface for the active project. It shows project execution, usage, cost, Git, and invocation telemetry in one workspace with visual-mode navigation, responsive layouts, and lig...",
  },
  'user-dashboard-settings': {
    id: 'user-dashboard-settings',
    path: '/docs/user-dashboard-settings',
    section: 'User Guide',
    title: "Settings",
    description: "The Settings page (/config) is the unified configuration surface. It exposes every tunable in the engine, organised into a category rail and content panels.",
  },
  'user-dashboard-styleguides-and-tech-stacks': {
    id: 'user-dashboard-styleguides-and-tech-stacks',
    path: '/docs/user-dashboard-styleguides-and-tech-stacks',
    section: 'User Guide',
    title: "Styleguides and Tech Stacks",
    description: "Code UX uses guidance selections to tell workers what implementation stack and product style they should respect.",
  },
  'developer-overview': {
    id: 'developer-overview',
    path: '/docs/developer-overview',
    section: 'Developer Reference',
    title: "Developer Reference",
    description: "This section is the precise contract reference for everyone integrating with Code UX — whether you are wiring it into an MCP client, building a dashboard plugin, or extending the engine.",
  },
  'developer-mcp-tools': {
    id: 'developer-mcp-tools',
    path: '/docs/developer-mcp-tools',
    section: 'Developer Reference',
    title: "MCP tools",
    description: "Code UX is also an MCP server. When connected, it advertises a set of management tools that an MCP client (or another agent) can call to drive projects, sprints, tasks, agents, node flows, memory, persistent skills...",
  },
  'developer-management-actions': {
    id: 'developer-management-actions',
    path: '/docs/developer-management-actions',
    section: 'Developer Reference',
    title: "Management actions",
    description: "Code UX exposes one MCP tool per management domain — manage_projects, manage_sprints, manage_tasks, manage_quicksprints, manage_scheduler, manage_agents, manage_node_flows, manage_memory, manage_settings, manage_preview...",
  },
  'developer-http-api': {
    id: 'developer-http-api',
    path: '/docs/developer-http-api',
    section: 'Developer Reference',
    title: "HTTP API reference",
    description: "The Code UX dashboard process exposes a REST API on the same port as the dashboard UI (default 4444). All endpoints return JSON unless otherwise noted.",
  },
  'developer-websocket-realtime': {
    id: 'developer-websocket-realtime',
    path: '/docs/developer-websocket-realtime',
    section: 'Developer Reference',
    title: "Realtime WebSocket protocol",
    description: "The dashboard subscribes to /api/realtime (WebSocket) for push updates. This page documents the wire protocol for clients that want to consume the same stream programmatically.",
  },
  'developer-configuration': {
    id: 'developer-configuration',
    path: '/docs/developer-configuration',
    section: 'Developer Reference',
    title: "Configuration & CLI",
    description: "This page is the precise reference for every CLI flag, environment variable, and configuration file Code UX consumes.",
  },
  'developer-settings-reference': {
    id: 'developer-settings-reference',
    path: '/docs/developer-settings-reference',
    section: 'Developer Reference',
    title: "Settings schema reference",
    description: "This page enumerates every settings field, its type, default, range (if applicable), and the JSON path you would use with manage_settings → patch_*_setting.",
  },
  'developer-sprint-format': {
    id: 'developer-sprint-format',
    path: '/docs/developer-sprint-format',
    section: 'Developer Reference',
    title: "Sprint and subtask file format",
    description: "Code UX sprints are stored both in a database and as on-disk markdown files. The markdown form is the portable, human-editable, source-of-truth representation. Importing/exporting a sprint round-trips through these fi...",
  },
  'developer-building-from-source': {
    id: 'developer-building-from-source',
    path: '/docs/developer-building-from-source',
    section: 'Developer Reference',
    title: "Building from source",
    description: "Code UX is a TypeScript monorepo with a server (src/), a Preact dashboard (dashboard/), and an extensive test suite (tests/).",
  },
  'developer-testing': {
    id: 'developer-testing',
    path: '/docs/developer-testing',
    section: 'Developer Reference',
    title: "Testing & quality gates",
    description: "Code UX uses Vitest as its single test runner across server and dashboard. CI gates enforce coverage thresholds and a full clean build.",
  },
  'architecture-overview': {
    id: 'architecture-overview',
    path: '/docs/architecture-overview',
    section: 'Architecture',
    title: "Architecture",
    description: "This section documents the internals of Code UX — the engine, the data model, the runtime topology, and the design trade-offs behind each.",
  },
  'architecture-system-overview': {
    id: 'architecture-system-overview',
    path: '/docs/architecture-system-overview',
    section: 'Architecture',
    title: "System overview",
    description: "Code UX is a single Node process that hosts multiple cooperating services. This page describes that process model, the major services, and how data flows through them.",
  },
  'architecture-mcp-server': {
    id: 'architecture-mcp-server',
    path: '/docs/architecture-mcp-server',
    section: 'Architecture',
    title: "MCP server internals",
    description: "The MCP server is the protocol-level interface between MCP clients (Gemini CLI, Codex CLI, Claude Desktop, custom integrations) and Code UX's services.",
  },
  'architecture-sprint-engine': {
    id: 'architecture-sprint-engine',
    path: '/docs/architecture-sprint-engine',
    section: 'Architecture',
    title: "Sprint engine",
    description: "The sprint engine is the heart of Code UX. It schedules, dispatches, monitors, gates, and finalises every unit of work.",
  },
  'architecture-virtual-workers': {
    id: 'architecture-virtual-workers',
    path: '/docs/architecture-virtual-workers',
    section: 'Architecture',
    title: "Virtual workers",
    description: "A virtual worker is an ephemeral, on-demand agent process that handles work outside the hosted Jules API — coding tasks, CI fixes, merge conflict resolution, and other attention items.",
  },
  'architecture-ci-integration': {
    id: 'architecture-ci-integration',
    path: '/docs/architecture-ci-integration',
    section: 'Architecture',
    title: "CI integration",
    description: "The CI gate is the bridge between Code UX's task graph and your real GitHub-based CI. It decides when each subtask's PR can be merged and how to react when CI is unhappy.",
  },
  'architecture-dashboard-architecture': {
    id: 'architecture-dashboard-architecture',
    path: '/docs/architecture-dashboard-architecture',
    section: 'Architecture',
    title: "Dashboard architecture",
    description: "The dashboard is a Preact + Vite + Tailwind v4 single-page application served by the Express dashboard server. It is the primary interface for humans operating Code UX.",
  },
  'architecture-data-model': {
    id: 'architecture-data-model',
    path: '/docs/architecture-data-model',
    section: 'Architecture',
    title: "Data model",
    description: "This page describes the entities Code UX persists and how they relate. The default backend is SQLite; a Postgres migration is planned but not yet shipped.",
  },
  'architecture-external-chat-providers': {
    id: 'architecture-external-chat-providers',
    path: '/docs/architecture-external-chat-providers',
    section: 'Architecture',
    title: "External chat connectors",
    description: "Code UX persists external chat provider configuration separately from MCP listener connections and dashboard conversation messages. The runtime stays adapter-neutral: it records provider setup, bridge mode, channel ro...",
  },
  'architecture-configuration-resolution': {
    id: 'architecture-configuration-resolution',
    path: '/docs/architecture-configuration-resolution',
    section: 'Architecture',
    title: "Configuration resolution",
    description: "This page documents how Code UX assembles the effective configuration at runtime — combining CLI flags, environment variables, on-disk JSON files, and the database settings tree.",
  },
  'architecture-security': {
    id: 'architecture-security',
    path: '/docs/architecture-security',
    section: 'Architecture',
    title: "Security model",
    description: "Code UX is designed to run as a single-user trusted process on a developer's workstation or a dedicated server. This page documents what is and is not protected, the threat model, and the recommended deployment posture.",
  },
  'settings-subcategories-display-settings': {
    id: 'settings-subcategories-display-settings',
    path: '/docs/settings-subcategories-display-settings',
    section: 'User Guide',
    title: "Display Settings",
    description: "Controls the dashboard shell layout, experience mode, theme, motion preference, and desktop zoom when available.",
  },
  'settings-subcategories-guidance': {
    id: 'settings-subcategories-guidance',
    path: '/docs/settings-subcategories-guidance',
    section: 'User Guide',
    title: "Guidance",
    description: "Manages active tech-stack guidance, active styleguide guidance, and custom instruction entries for the current settings scope.",
  },
  'settings-subcategories-onboarding': {
    id: 'settings-subcategories-onboarding',
    path: '/docs/settings-subcategories-onboarding',
    section: 'User Guide',
    title: "Onboarding",
    description: "Reopens the guided setup flow without changing saved settings by itself.",
  },
}

export const orderedDocs: DocsRegistryEntry[] = [
  docsRegistry['docs-overview'],
  docsRegistry['user-introduction'],
  docsRegistry['user-installation'],
  docsRegistry['user-quickstart'],
  docsRegistry['user-overview'],
  docsRegistry['user-mcp-clients'],
  docsRegistry['user-sprint-orchestration'],
  docsRegistry['user-providers-and-models'],
  docsRegistry['user-automation-and-ci'],
  docsRegistry['user-quicksprints'],
  docsRegistry['user-troubleshooting'],
  docsRegistry['user-dashboard-overview'],
  docsRegistry['user-dashboard-projects'],
  docsRegistry['user-dashboard-sprints'],
  docsRegistry['user-dashboard-tasks'],
  docsRegistry['user-dashboard-live-session'],
  docsRegistry['user-dashboard-chat'],
  docsRegistry['user-dashboard-agents'],
  docsRegistry['user-dashboard-nodes'],
  docsRegistry['user-dashboard-node-flows'],
  docsRegistry['user-dashboard-scheduler'],
  docsRegistry['user-dashboard-memory'],
  docsRegistry['user-dashboard-knowledge'],
  docsRegistry['user-dashboard-file-browser'],
  docsRegistry['user-dashboard-browser-preview'],
  docsRegistry['user-dashboard-stats'],
  docsRegistry['user-dashboard-settings'],
  docsRegistry['user-dashboard-styleguides-and-tech-stacks'],
  docsRegistry['developer-overview'],
  docsRegistry['developer-mcp-tools'],
  docsRegistry['developer-management-actions'],
  docsRegistry['developer-http-api'],
  docsRegistry['developer-websocket-realtime'],
  docsRegistry['developer-configuration'],
  docsRegistry['developer-settings-reference'],
  docsRegistry['developer-sprint-format'],
  docsRegistry['developer-building-from-source'],
  docsRegistry['developer-testing'],
  docsRegistry['architecture-overview'],
  docsRegistry['architecture-system-overview'],
  docsRegistry['architecture-mcp-server'],
  docsRegistry['architecture-sprint-engine'],
  docsRegistry['architecture-virtual-workers'],
  docsRegistry['architecture-ci-integration'],
  docsRegistry['architecture-dashboard-architecture'],
  docsRegistry['architecture-data-model'],
  docsRegistry['architecture-external-chat-providers'],
  docsRegistry['architecture-configuration-resolution'],
  docsRegistry['architecture-security'],
  docsRegistry['settings-subcategories-display-settings'],
  docsRegistry['settings-subcategories-guidance'],
  docsRegistry['settings-subcategories-onboarding'],
]

export const groupedDocs = orderedDocs.reduce<Record<DocsSection, DocsRegistryEntry[]>>(
  (acc, doc) => {
    if (!acc[doc.section]) {
      acc[doc.section] = []
    }
    acc[doc.section].push(doc)
    return acc
  },
  {} as Record<DocsSection, DocsRegistryEntry[]>
)
