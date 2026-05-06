# System overview

Code UX is a single Node process that hosts multiple cooperating services. This page describes that process model, the major services, and how data flows through them.

## Process topology

```
┌──────────────────────────────────────────────────────────────────┐
│                  jules-subagents (single Node process)           │
│                                                                  │
│  ┌────────────────────────┐   ┌────────────────────────────┐    │
│  │   Dashboard Server      │   │   MCP Server                │    │
│  │   (Express, port 4444)  │   │   ┌──────────────────────┐  │    │
│  │                          │   │   │ stdio transport     │  │    │
│  │   • REST routes         │◄──┤   ├──────────────────────┤  │    │
│  │   • WebSocket /realtime │   │   │ HTTP transport      │  │    │
│  │   • Static dashboard    │   │   │ (optional, port +1) │  │    │
│  └────────────┬────────────┘   │   └──────────────────────┘  │    │
│               │                └─────────────┬──────────────┘    │
│               │                              │                   │
│               ▼                              ▼                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                  Application Services                     │    │
│  │                                                            │    │
│  │  Sprint Orchestrator   ←→   Virtual Worker Service        │    │
│  │  Settings Service      ←→   Memory / Embedding Service    │    │
│  │  Conversation Service  ←→   Connection / Listener Service │    │
│  │  Project Service       ←→   Preview / Docker Service      │    │
│  │  Telemetry Service     ←→   Heartbeat & Lease Service     │    │
│  └─────────────┬──────────────────────────┬──────────────────┘    │
│                │                          │                        │
│                ▼                          ▼                        │
│  ┌────────────────────────┐   ┌──────────────────────────┐        │
│  │  Repositories (DB)     │   │  External integrations    │        │
│  │  • SQLite (default)    │   │  • Jules Agent API        │        │
│  │  • Postgres (planned)  │   │  • Provider CLIs          │        │
│  │  • Markdown filesystem │   │  • GitHub / gh CLI        │        │
│  │                         │   │  • Docker daemon          │        │
│  └────────────────────────┘   └──────────────────────────┘        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

The process is started by `src/index.ts` → `JulesAgentServer.run()`. Lifecycle:

1. **Boot settings** — load and migrate the settings DB.
2. **Refresh API key** — pull from CLI / env / settings.
3. **Prune connections** — clean stale MCP connections from the prior run.
4. **Cleanup sprint previews** — remove stale Docker preview containers.
5. **Docker asset pruning** — remove orphaned worker images / containers.
6. **Boot dashboard** — bind Express on `DASHBOARD_PORT`.
7. **Boot MCP stdio transport** — connect to stdin/stdout if not a TTY.
8. **Boot MCP HTTP transport** *(optional)* — bind the JSON-RPC HTTP listener.
9. **Mark MCP service bound** — `/ready` flips to ready.
10. **Start background loops** — runtime cleanup (15 s), sprint preview reconciliation (15 s), live snapshot refresh (30 s).
11. **Start virtual worker service** — begin reconcile cycle (3 s).

Source: `src/server/jules-agent-server.ts:870-994`.

## Major services

### Sprint orchestrator

Handles the lifecycle of sprints and tasks. Built around three runners:

- **`SprintActionRunner`** (`src/domain/sprint/orchestrator/sprint-action-runner.ts`) — top-level dispatcher for `plan` / `status` / `orchestrate`.
- **`CycleRunner`** (`src/domain/sprint/orchestrator/cycle-runner.ts`) — executes one cycle of the pipeline.
- **`WatchLoopRunner`** (`src/domain/sprint/orchestrator/watch-loop-runner.ts`) — wraps the cycle runner in the continuous monitoring loop.

Detail: [Sprint engine](./sprint-engine.md).

### Virtual worker service

Provisions ephemeral workers (Docker container or host process) to handle attention items.

- **`VirtualWorkerService`** (`src/services/virtual-worker-service.ts`).
- Reconciles every **3 s**, polls session state every **2 s**.

Detail: [Virtual workers](./virtual-workers.md).

### MCP server

`McpServer` from `@modelcontextprotocol/sdk` plus our `ToolRegistry` and `McpRequestRouter`.

- **Stdio transport** — `StdioServerTransport`.
- **HTTP transport** — `StreamableHTTPServerTransport` over Express, mounted at `/mcp`.

Detail: [MCP server](./mcp-server.md).

### Dashboard server

- Express 5 application.
- 100+ REST routes.
- WebSocket server at `/api/realtime` for push updates.
- Static dashboard bundle from `dashboard/dist/`.

Detail: [Dashboard architecture](./dashboard-architecture.md).

### Repositories

All DB access goes through repository classes (`src/repositories/`). The default backend is **SQLite**. A migration plan to Postgres exists (see `docs/architecture/postgres-migration-plan.md` in the engineering archive).

Subtask data is *also* persisted as markdown files for portability — see [Sprint format](../developer/sprint-format.md).

### External integrations

- **Jules API** — REST via Axios (`src/integrations/jules-api-client.ts`).
- **Provider CLIs** — via spawn (`gemini`, `codex`, `claude`, `qwen`, `opencode`).
- **GitHub** — via `gh` CLI in `REMOTE` mode, local Git in `LOCAL` mode.
- **Docker** — via the Docker socket (HTTP API).

## Data flow: a sprint cycle

```
Dashboard click "Orchestrate"            MCP client calls manage_code_ux:start
            │                                            │
            ▼                                            ▼
      POST /api/sprints/.../orchestrate        ToolRegistry → sprint-actions.ts
            │                                            │
            └────────────────────┬───────────────────────┘
                                 ▼
                        SprintActionRunner.runOrchestrate
                                 │
                                 ▼
                       WatchLoopRunner.run (loop)
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                      ▼
         CycleRunner.run                   sleep(watchLoopInterval)
              │
   ┌──────────┴──────────────────────────────┐
   ▼          ▼          ▼          ▼         ▼
 branch  load    session  status   start    merge
 preflight subtasks sync  derivation ready  protocol
                                    tasks
                                       │
                       ┌───────────────┴────────────────┐
                       ▼                                ▼
              JulesApiClient.startTask        VirtualWorkerService.runProjectCycle
                       │                                │
                       ▼                                ▼
                Jules hosted session          Docker / host CLI worker
                       │                                │
                       └────────────┬───────────────────┘
                                    ▼
                          Worker session events
                                    │
                                    ▼
                  Real-time WebSocket → Dashboard
```

## Background loops (heartbeat services)

| Loop | Interval | Purpose |
| --- | --- | --- |
| Runtime cleanup | 15 s | Prune dead MCP connections, expired leases. |
| Sprint preview reconciliation | 15 s | Match preview session DB rows against running containers. |
| Live snapshot refresh | 30 s | Recompute the dashboard live snapshot. |
| Virtual worker reconcile | 3 s | Pick up new attention items, dispatch workers. |
| Virtual worker session poll | 2 s | Poll active worker sessions for state. |
| WebSocket heartbeat | 30 s (default) | Ping connected dashboard clients. |

## Failure modes

- **Dashboard port in use** — Code UX increments the port and rebinds. The bound URL is logged.
- **MCP stdio in TTY** — Code UX assumes interactive launch and skips stdio binding (so it does not garble your terminal). Use `--headless` or pipe stdin to engage stdio explicitly.
- **API key missing** — boot continues; affected provider is marked `disabled` in detection. Tasks routed to that provider error.
- **Heartbeat lease expiry** — a sprint run with an expired lease can be re-acquired by another runner instance. The original runner detects on next cycle and exits.
- **Emergency stop** — see [Sprint engine → emergency stop](./sprint-engine.md#emergency-stop).

## Process supervision

Code UX exits with non-zero status on:

- Unhandled error during boot.
- SIGTERM (graceful) / SIGINT.
- Critical orchestration failure (rare; emergency stop is *recoverable*, not a process exit).

Use a process supervisor (systemd, pm2, Kubernetes deployment) for production. Code UX is stateless across restarts except for what's in the DB; restart frequency does not affect correctness.
