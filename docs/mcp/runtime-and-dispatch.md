# MCP Runtime and Dispatch

This document explains how MCP requests flow through the server.

## Server Startup

Startup sequence:

1. `src/index.ts` loads environment and app config.
2. `src/index.ts` constructs `CodeUxServer`.
3. `src/server/code-ux-server.ts` constructs repositories/services/handlers/orchestrator.
4. `src/server/code-ux-server.ts` registers MCP request handlers.
5. `src/server/code-ux-server.ts` loads settings and prunes disconnected MCP connection rows.
6. `src/server/code-ux-server.ts` starts the dashboard server unless headless or server mode disables it.
   - Dashboard API routes (such as project, sprint, task, conversation, and planning endpoints) are broken out into modular route files for maintainability.
   - Route wrappers and body request parsers are maintained as separate server-layer boundaries.
7. `src/server/code-ux-server.ts` connects MCP stdio transport only when stdin is an MCP pipe/socket or `CODE_UX_ENABLE_MCP_STDIO=1` is set. TTY stdin and daemon-style character-device stdin such as `/dev/null` leave stdio disabled so the dashboard/backend stays alive without an attached client.
8. `src/server/code-ux-server.ts` optionally starts the MCP HTTP transport with the same project-manager tool surface.
9. `src/server/code-ux-server.ts` starts runtime intervals and schedules deferred startup work.

Long-running startup work is intentionally off the synchronous boot path:

- Startup recovery runs shortly after transports bind and resumes recoverable sprint runs.
- Stale preview/file-browser container cleanup and Docker asset pruning run after the dashboard is available.
- Branch reaping and database maintenance run later as background maintenance.
- The first runtime cleanup and preview reconciliation interval passes are delayed so they do not compete with initial dashboard load.

This keeps `/health`, `/ready`, the dashboard, and MCP transports responsive before Docker, git, and SQLite maintenance complete.

## Runtime Modes

Code UX exposes these MCP runtime roles:

- `project_manager`: The default human-facing and remote-client surface.
- `worker-host`: A headless execution role used by the local worker client.

The legacy `worker_gateway` runtime role has been removed. `codeux-worker` is a shipped worker process entrypoint, not a separate MCP runtime role advertised by the main server.

## Worker Enrollment And Dispatch

External worker hosts enroll as database-backed worker endpoints instead of using a separate cluster schema. Each endpoint is keyed by a stable MCP connection key (`mcp:<connectionKey>`) and records display name, transport, heartbeat-derived status, and execution/supervision capabilities in `worker_endpoints`.

Project eligibility is represented by `project_worker_assignments`. A project can have one primary worker plus any number of overflow workers; this assignment model does not cap the number of registered endpoints. Live MCP connections and enrolled external endpoints both use the same assignment records, and stale or offline endpoints are excluded from new task claims.

Worker task pickup is lease-backed:

- queued `task_dispatches` are claimed in priority order, filtered by project, sprint, sprint run, and executor type
- the claim transaction marks the dispatch `claimed`, binds its connection when available, and creates a `task_dispatch` row in `execution_leases`
- active leases prevent duplicate claims; expired leases can be replaced by a new worker claim
- worker heartbeats renew the task-dispatch lease while running
- cancellation and pause requests remain visible through the dispatch status and are returned to workers on update

Startup mode is separate from runtime role:

- Dashboard mode is the default. It binds the dashboard plus the MCP HTTP gateway.
- Headless mode (`--headless` or `--no-dashboard`) skips the dashboard while preserving the existing local-development MCP behavior, including unauthenticated loopback when the gateway is explicitly started without a token.
- Server mode (`--server-mode` or `CODE_UX_SERVER_MODE=true`) is the explicit remote MCP startup contract. It skips dashboard, dashboard realtime, terminal websocket, and static route registration; starts MCP HTTP by default; and requires a non-empty explicit bearer token from `MCP_HTTPS_AUTH_TOKEN`, `MCP_HTTP_AUTH_TOKEN`, `--mcp-https-auth-token`, or `--mcp-http-auth-token`, even on loopback. The MCP HTTP listener serves `/health` and `/ready` without the dashboard server.

For operator startup commands, client connection checks, settings synchronization, cluster worker enrollment, and troubleshooting, see [Secure Headless Server Mode](../operations/server-mode.md).

## MCP Request Handlers

Registered schemas:
- `ListToolsRequestSchema`
- `CallToolRequestSchema`

### Tool list handler
Returns enabled tool definitions from `src/contracts/mcp-tool-definitions.ts`, filtered by dashboard `mcpTools` settings.

When a worker MCP client advertises an agent preset, Code UX resolves that agent's explicit MCP access policy before listing tools. Unknown or malformed agent identities fail closed: `list_tools` returns no built-in Code UX tools, and `call_tool` returns MCP `MethodNotFound`.

### Tool call handler
- Resolves tool name.
- Verifies tool is enabled in `mcpTools`.
- Applies the same per-agent Code UX access policy used by `list_tools`.
- Validates tool arguments against the registered JSON schema before dispatch.
- Dispatches through typed `ToolRegistry` registration in `src/api/mcp/tool-registry.ts`.
- Wraps unknown tool as MCP `MethodNotFound`.
- Normalizes runtime/API errors into `isError` response.

## Correlation Context

MCP tool calls are wrapped in a correlation scope before dispatch.

- `src/server/code-ux-server.ts` derives a correlation ID from request metadata when available.
- If no correlation ID is provided, one is generated.
- `src/shared/logging/correlation-id.ts` stores the ID in `AsyncLocalStorage`.
- `src/server/mcp-request-router.ts` logs request lifecycle events with the shared logger.

This allows all log lines emitted during a tool call to share a single `correlationId`.

## Request-Scoped Agent And Thread Context

Dashboard chat reply turns clone the base Code UX MCP connection and attach the active `threadId` only to that turn. Provider configuration emits the originating thread as the internal `X-Code-Ux-Thread` header on the built-in Code UX MCP connection; non-chat provider runs omit it, and custom MCP servers never receive it. The HTTP gateway validates the header with the same single-value identifier rules used for MCP agent and session headers.

`manage_sprints followup` is intentionally synchronous and side-effect-limited: it saves an idle sprint with no tasks and does not start planning or scheduling. The Project Manager then creates a separate `manage_scheduler schedule_sprint` entry anchored with `after_sprint_end`. When that entry becomes due, the normal sprint-start boundary sees that the draft has no tasks, plans it with auto-start, and only then begins execution. This ordering prevents planning from inspecting the repository before the source sprint has completed.

The MCP gateway stores the resolved agent and thread identities in request-scoped `AsyncLocalStorage`. A direct `manage_sprints` `plan` call captures both identities before returning its immediate acknowledgement and planning ETA, so its detached planning continuation can target a completion or failure `agent_wakeup` to the originating dashboard thread after the planning promise settles. `SprintActions` tracks that promise per project and sprint to suppress duplicate provider submissions and duplicate terminal callbacks, and to keep `manage_sprints` `get` in progress until the complete planning workflow settles, even if its audit invocation reaches `completed` before task persistence or auto-start finishes. This header and context propagation are internal runtime architecture, not public MCP tool arguments.

The serialized `planningGuidance` returned through the management handler is additive to the existing acknowledgement. Its initial `nextCheckAt` equals the calculated `estimatedCompletionAt`; each later non-terminal read advances `nextCheckAt` by the fixed `recheckIntervalMs` of one minute. An ETA is not a deadline: overrun alone leaves the projection `in_progress` and is not failure evidence. Durable execution states project as `running` → `in_progress`, `completed` → `succeeded`, and `failed`, `cancelled`, or `paused` → their same-named terminal guidance. Terminal projections set `isTerminal: true`, set `nextCheckAt: null`, and include available failure evidence.

Dashboard planning follow-through intentionally has two one-shot paths. The assigned Project Manager owns ETA/status checks created through `scheduler_code_ux`, initially at the ETA and then one at a time at returned one-minute check timestamps. The runtime owns exactly one due-now, non-recurring completion/failure wakeup after the detached promise settles. On that existing terminal wakeup, the Project Manager cancels any obsolete pending status checks it created for the same invocation or sprint before reporting. It never converts these checks to recurrence and does not requeue planning or change provider, model, or settings while guidance remains non-terminal.

Standalone MCP clients do not have this dashboard thread context. Their background planning still continues server-side, but neither a terminal chat wakeup nor an agent-owned dashboard status check is created for them; those clients poll sprint `get`, task management, or telemetry state for completion using `nextCheckAt`. Polling only reads in-memory and durable invocation state and does not enqueue scheduler work.

## Worker Clarification Dispatch

Task-coding provider runs use the project-manager MCP gateway with the selected agent identity in `X-Code-Ux-Agent`. Code UX adds only the audience-scoped `request_clarification` grant needed by an eligible coding agent; it does not turn that agent into a project manager or expose `reply_to_clarification` or unrelated management tools. The project-manager reply route receives the complementary `reply_to_clarification` grant.

`request_clarification` persists a human-owned `worker_clarification` record in `project_attention_items`. The attention item is the durable public record and carries project, sprint, task, sprint-run, and dispatch ownership. Its versioned payload captures the task run, provider session, authenticated requester, deduplication key, Markdown question/answer, status, and timestamps. Task-run-backed requests also append idempotent `worker_clarification_*` events, allowing `session-sync-step.ts` to reconstruct pending, answered, or settled clarification state after a restart without a second persistence path.

Before persistence, the service validates every supplied execution reference against the project and merges references derived from the task run, dispatch, and sprint run. An exact duplicate request returns the existing attention item; the same project-scoped deduplication key with different content, requester, or runtime context is rejected. Because the item is human-owned, virtual-worker repair queues do not claim or answer it, and scheduling avoids issuing a duplicate task dispatch while the project-manager clarification is pending.

`reply_to_clarification` authorizes the authenticated replier for the clarification's project, then delivers before settling the attention item:

- Jules sends the answer through the existing session-message API. After acceptance, Code UX marks the linked task run, dispatch, and task as running/in progress and records `worker_clarification_continued`.
- Local CLI providers call the task-rerun continuation path with the preserved workspace, worker branch, provider, effective model, coding-agent route, and native session lineage. A successful tool response means that continuation was accepted by that dispatch path; it does not mean the coding task has completed.
- A taskless general question stores the answer with `deliveryMode: "recorded_answer"` and creates no coding dispatch.

Delivery failure leaves the clarification `pending`. Missing or mismatched task-run/provider-session scope, an unsupported provider, or a missing/preserved-workspace mismatch therefore cannot silently close the question. Once delivery succeeds, the attention item changes to `replied` and the reply event is appended. Duplicate concurrent replies share one in-flight operation, and a later retry of an already replied clarification returns the settled result without another message or task-rerun dispatch.

Session synchronization treats a latest matching request as blocked and a matching continued/replied event as answered. It ignores stale-session requests and does not resurrect cancelled or paused runs. This reconstruction may restore the runtime projection to running after an accepted answer, but it does not declare provider work or the task complete.

## Dispatch Layers

- Typed registry layer: `src/api/mcp/tool-registry.ts`
  - Defines strict argument interfaces for every MCP tool.
  - Provides `register` and `dispatch` APIs with compile-time tool/argument matching.
- Management dispatch target: `ManagementToolHandler`
  - Routes dedicated management tools such as `manage_projects`, `manage_memory`, `manage_node_flows`, and `manage_skills` to domain action classes.
  - Routes retrieval tools such as `search_knowledge` and `search_skills` separately, so agents can receive retrieval without broader management authority.
  - Applies stateful approval fingerprints to destructive management actions before mutation.
- Core dispatch target: `CoreToolHandler`
- Agent dispatch target: `AgentToolHandler`

This split keeps tool contracts stable while allowing orchestration internals to evolve independently.

## Persistent Skill Tools

Persistent skills use `SkillService` as the backend boundary. The MCP layer does not write markdown files into project workspaces and does not duplicate persistence logic; it validates payloads, formats concise responses, and calls the service.

The versioned runtime mount is content-addressed. An unchanged materialized storage is verified from its manifest and skill markdown through direct filesystem reads, then reuses a persisted marker only when its revision still matches `.git/HEAD` and its recorded Git-index fingerprint matches the current index bytes. This keeps the common path helper-free without mistaking staged or interrupted materialization for a committed revision. Markerless, stale-marker, or index-mismatch repositories take the guarded Git path once to prove or commit the snapshot before a new marker is written. Changed storage content acquires one helper lease for the complete add/status/commit/revision transaction, so a provider invocation never starts one helper container per Git command.

Runtime behavior:

- `manage_skills` is a Code UX management tool in the `agents_memory` category. It supports storage CRUD, skill markdown import/export, agent storage attachment management, and the skill-authoring prompt.
- `delete_storage`, `reset_storage`, and `delete_skill` return approval-required envelopes on first call and only mutate on the matching confirmed call.
- `search_skills` is registered as a distinct retrieval tool in the same category. Per-agent MCP policy can disable `manage_skills` while leaving `search_skills` enabled.
- Search scoping is project-owned. `storageId` limits retrieval to one storage; otherwise `agentPresetId` limits retrieval to the agent's attached storages; otherwise all project storages are eligible.
- Search results return ranked summaries with IDs and metadata. Full markdown retrieval remains behind `manage_skills` (`export_markdown` or `get_skill` with `includeContent: true`).

## Node Flow Tools

`manage_node_flows` uses `NodeFlowService` as the MCP backend boundary. The thin action layer parses MCP payloads and delegates catalog lookup, optimistic drafts, validation/policy review, credential metadata, publication/version operations, run controls, custom-node authoring, and attachments. Governed responses use graph summaries unless a legacy project-manager `get` explicitly requests the stored flow.

Runtime behavior:

- `create_draft` and `patch_draft` append immutable versions without auto-publication; stale `draftRevision` values return structured conflicts without writes. Legacy `create` and `update` retain auto-publication compatibility.
- `dry_run` never invokes the runtime; it reports validation, policy, credential, capability, and side-effect findings with redacted simulated output.
- `publish` and `rollback` use the stateful exact-payload approval handshake. Runtime execution always resolves a publication.
- `run` calls the configured node-flow runtime through `NodeFlowService.runFlow`.
- `cancel`, `retry`, and `inspect_run` operate on project-owned durable run records.
- `delete` uses the same stateful approval handshake as other destructive management actions.
- Attachments automatically expose only `run_attached_flow` to the owning agent. That operation verifies project, attachment, publication, and credential policy and records initiating agent/conversation metadata; it does not grant `manage_node_flows` or expose graphs/secrets.

## Custom MCP Defaults

Dashboard settings include custom MCP servers that local CLI providers may receive at execution time.

Code UX seeds Playwright MCP as a default custom MCP server:

- stable id and name: `playwright`
- transport: stdio
- command: `npx`
- args: `@playwright/mcp@latest`

Settings sanitization also repairs the legacy built-in `playwright-mcp` command with no arguments to this package-backed configuration. Other user-defined Playwright commands and arguments remain unchanged.

The built-in `code_ux` MCP tool surface is controlled separately from custom MCP servers. Agent presets store MCP access in `mcp_access_json`: `codeUxEnabled` controls the built-in Code UX tools, while `linkedServerIds` selects custom MCP servers such as `playwright`.

Agent-scoped provider runs are default-deny for built-in Code UX tools. Missing, malformed, or unconfigured agent MCP access resolves with `codeUxEnabled: false`, no linked custom servers, and no inherited `code_ux` connection. Explicitly saved `mcp_access_json` records are preserved and continue to control the agent. Non-agent project-manager MCP clients are still governed by system-level `mcpTools` settings rather than agent defaults.

The built-in `Worker` and `Project manager` agents still seed the `playwright` custom MCP server where that link is intended, but this custom-server default no longer implies built-in Code UX tool access. Generated task-coding roster agents created by Project Setup use the same custom-server-only default when they are first created. Planning, QA, setup, clarification, CI-fix, merge-conflict, and other non-chat agents do not receive scheduler or management Code UX tools unless their preset explicitly enables them. When Code UX is enabled from the agent MCP manager for a non-dashboard agent, the generated default keeps the restricted `scheduler_code_ux` tool explicitly disabled until the user enables it.

The dashboard chat reply route has one narrow exception. Every assigned dashboard reply agent receives the full built-in Code UX MCP surface, `scheduler_code_ux`, `add_long_term_memory`, and the default Playwright MCP server by default, even when the selected reply preset has Code UX disabled or no saved MCP policy. The provider run still receives the selected agent's linked custom MCP servers, adds the Playwright link once, and sends the assigned agent id through `X-Code-Ux-Agent`; the MCP router recognizes the assigned dashboard reply agent and applies this route-local full-access default. Its per-turn built-in Code UX connection also sends `X-Code-Ux-Thread`, which the HTTP gateway exposes as validated request context for the originating dashboard thread without changing global connection state or custom MCP server headers. When the preset explicitly enables Code UX access with narrower saved tool choices, the router preserves those saved choices and forces the self-wakeup and direct long-term-memory lanes on for dashboard replies.

## Internal Test Provider

`mockup-cli` is an internal test-only CLI provider. Settings sanitization, provider defaults, and invocation routing preserve it when an explicit system or project settings payload includes it, so tests can route task coding, CI fixes, and merge-conflict repair through a deterministic mock provider. It has no credential or auth-mount requirement, uses the `default` model, and is disabled by default.

The mock runtime executes in both host and Docker workspaces through a self-contained Node command, so it does not install packages or call a provider API. Prompts can include deterministic directives such as `mockup-cli:write <path> :: <content>`, `mockup-cli:append <path> :: <content>`, `mockup-cli:replace <path> :: <old> => <new>`, `mockup-cli:run <command>`, and `mockup-cli:fail`. Validation commands are parsed into explicit argv values and executed without shell interpretation. File paths are resolved inside the prepared provider workspace; attempts to write outside that workspace fail. Merge-conflict test prompts can use `mockup-cli:conflict <path> :: <content>` or mention a merge-conflict task to produce deterministic conflict markers.

Mock usage telemetry is reported as zero-token, `unsupported` mock telemetry with a stable native session id and a sanitized assistant transcript.

Normal dashboard onboarding and provider selection surfaces use public provider lists and do not advertise `mockup-cli`. The default Playwright MCP server also remains linked only to public local CLI providers unless a settings payload explicitly opts into a different provider list.

## Transport Model

Code UX now uses two MCP transport classes:

- stdio
- Streamable HTTP

### Stdio

Stdio remains the default MCP transport.

### HTTP

The main Code UX server can also expose an authenticated MCP HTTP endpoint.

That endpoint:

- is configured through `MCP_HTTP_*` / `MCP_HTTPS_*` env vars or `--mcp-http*` / `--mcp-https*` flags
- exposes the same project-manager tool surface as stdio
- uses the project-manager tool surface for worker control-plane calls instead of a separate worker-control-plane runtime role
- uses a generated user bearer token from `~/.code-ux/security.json` when no explicit token is supplied
- requires an explicit bearer token in server mode and rejects the generated user token fallback
- is HTTP at the Node listener; deploy TLS with a trusted reverse proxy/certificate when remote HTTPS is required

## Dashboard Settings Path

The Settings > MCP panel explains both runtime connection modes in place:

- Code UX exposes the built-in MCP server over stdio and authenticated Streamable HTTP.
- The Local CLI HTTP setup section shows the active URL and bearer token after the Streamable HTTP gateway has bound, lets the user regenerate the token, and can install the Code UX MCP entry into local Claude Code, Gemini, Codex, Qwen Code, OpenCode, and Antigravity config files.
- Local CLI HTTP installs write a remote MCP entry for the currently running gateway. Clients such as Codex require Code UX to stay running; if Codex fails to initialize `http://127.0.0.1:4445/mcp`, verify `curl --fail http://127.0.0.1:4445/health` and reinstall after URL or token changes.
- Reinstalling the local Codex config treats `[mcp_servers.code-ux]` as a managed block and replaces it with the current gateway URL and bearer token while preserving unrelated TOML settings and custom MCP server tables.
- Custom remote MCP servers are added from system scope by choosing `HTTP / SSE`, pasting the server URL, and optionally entering auth headers as a JSON object of header names to string values.
- HTTP custom server previews use `{ type: "http", url, headers }`; stdio custom server previews use command, args, and env.
- Custom server changes are injected into MCP-capable CLI containers on the next CLI run. Project scope can enable, disable, or override inherited system servers, but new custom servers are created at system scope.

## Error Handling

- Axios errors are unwrapped for user-friendly API messages.
- Generic errors are returned as text with `isError: true`.
- Server-level uncaught MCP errors are logged via `server.onerror`.

## Shutdown Behavior

On `SIGINT`, `SIGTERM`, or `SIGHUP`, and when the Electron shell quits:
- Server stops scheduler and virtual-worker loops so no new local work is claimed.
- Server requests every registered active dispatch to stop through its normal abort hook.
- Server scans running Docker containers for `code-ux.*` labels and kills any remaining Code UX-managed containers directly.
- Server preserves Docker workspace/runtime volumes and leaves shutdown-interrupted Docker-backed task rows retryable. Startup recovery closes the interrupted local CLI invocation/dispatch/QA telemetry as `cancelled`, not `failed`, and can resume from the same workspace volume when that retry mode is enabled.
- Server closes any active MCP stdio transport and the MCP HTTP transport. The dashboard and MCP HTTP listeners track open sockets and destroy them during shutdown, including upgraded dashboard WebSocket sockets, so an open browser tab does not hold the process in the HTTP close path.
- Process exits cleanly.
