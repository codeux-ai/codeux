# MCP Tools and Contracts

This guide defines the MCP tool surface, behavior expectations, and key operational rules.

## Tool Handler Split

### Management tools
Implemented in:
- `src/mcp/management-tool-handler.ts`

These cover:
- `manage_projects`
- `manage_sprints`
- `manage_tasks`
- `manage_quicksprints`
- `manage_scheduler`
- `scheduler_code_ux`
- `manage_agents`
- `manage_node_flows`
- `manage_memory`
- `manage_skills`
- `search_knowledge`
- `search_skills`
- `manage_settings`
- `manage_preview`
- `manage_chat_providers`
- `manage_telemetry`
- `register_worker_endpoint`
- `pull_task_dispatch`
- `update_task_dispatch`

The same management domains are also exposed through the direct `codeux` CLI management surface. See [CLI Commands Reference](../reference/cli-commands.md) for the command syntax, aliases, interactive prompting behavior, and approval handling.

### Core tools
Implemented in:
- `src/mcp/core-tool-handler.ts`

These cover:
- `get_session`
- listen-mode connection registration and inbox/reply flow

### Agent tools
Implemented in:
- `src/mcp/agent-tool-handler.ts`

These cover:
- `generate_dashboard_reply`

### Management
- `manage_projects`
- `manage_sprints`
- `manage_tasks`
- `manage_quicksprints`
- `manage_scheduler`
- `scheduler_code_ux`
- `manage_agents`
- `manage_node_flows`
- `manage_memory`
- `manage_skills`
- `search_knowledge`
- `search_skills`
- `manage_settings`
- `manage_preview`
- `manage_chat_providers`
- `manage_telemetry`

### Worker control plane
- `register_worker_endpoint`
- `pull_task_dispatch`
- `update_task_dispatch`

These tools are exposed by the main `project_manager` MCP runtime, including server mode. `register_worker_endpoint` records the full eligible `projectIds` set and stores `activeProjectIds` only as the current focus subset. `pull_task_dispatch` returns a dispatch only with a lease token; workers must not start local execution without that token. `update_task_dispatch` renews running leases, records terminal state, and may return `controlAction: "cancel"` when the dashboard has requested cancellation.

## Registered Tools

Defined in `src/contracts/mcp-tool-definitions.ts`.

Typed tool argument contracts and registry dispatch are defined in `src/api/mcp/tool-registry.ts`.

- `get_session`
### Listen mode
- `listen`
- `start_listen`
- `pull_inbox`
- `post_listen_reply`

### Agent execution
- `generate_dashboard_reply`

### Output minimization
- `get_session` returns a compact session summary (state, provider, PR links, last activity summary) instead of full raw payload.

## Per-Agent Tool Access

Worker MCP clients can advertise their agent preset with the `X-Code-Ux-Agent` header on the Code UX MCP connection. When the header is absent, Code UX treats the request as a project-manager or stdio-style client and applies the system MCP tool toggles for the current runtime role.

Native provider MCP calls can also advertise `X-Code-Ux-Invocation` with the execution invocation id that originated the call. Code UX validates it with the same single-header, length, and identifier-character rules as `X-Code-Ux-Agent`, then stores it as request-scoped context for management handlers that need to associate actions with the originating provider invocation. The invocation id is not added to public MCP response payloads.

When the header is present, Code UX must resolve it to an explicit agent MCP access policy before exposing built-in Code UX management tools. Malformed HTTP header values are rejected before MCP routing; if an advertised agent identity reaches the router but is unknown or resolves to an agent without an explicit MCP access policy, `list_tools` returns no Code UX tools and `call_tool` rejects every Code UX management tool with MCP `MethodNotFound`. This fail-closed behavior prevents an unrecognized agent from inheriting broad system-level management access.

For a resolved agent policy:
- `codeUxEnabled: false` removes every built-in Code UX tool from `list_tools` and causes `call_tool` to return `MethodNotFound`, even when system-level toggles enable those tools.
- `codeUxEnabled: true` applies the agent's per-tool overrides over the system MCP tool toggles.
- Runtime-role filtering still applies after system and agent policy checks.
- Custom external MCP servers remain limited to the agent's linked server ids and are not broadened by Code UX tool availability.

## Common Response Shape

Successful responses return:

```json
{
  "content": [
    { "type": "text", "text": "..." }
  ]
}
```

Core and agent tool errors return:

```json
{
  "content": [
    { "type": "text", "text": "Error: ..." }
  ],
  "isError": true
}
```

Unknown tool names raise MCP `MethodNotFound`.

Management tool runtime and validation failures return a stringified JSON envelope in the same text content block and set `isError: true` on the MCP tool response:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"result\": {\n    \"status\": \"error\",\n    \"domain\": \"tasks\",\n    \"action\": \"create\",\n    \"message\": \"projectId is required\",\n    \"errorType\": \"validation\",\n    \"field\": \"projectId\"\n  }\n}"
    }
  ],
  "isError": true
}
```

The parsed management envelope has:
- `result.status: "error"` for every management failure.
- `result.domain` and `result.action` copied from the failed management call.
- `result.message` as the developer-facing failure reason.
- `result.errorType: "validation"` for payload parser failures and `"runtime"` for dependency or execution failures.
- `result.field` when a validation helper can identify the invalid field.

Approval responses are not errors. Calls that need human confirmation still return `approvalRequired: true` and do not set `isError`.

Tool arguments are validated against `src/contracts/mcp-tool-definitions.ts` before dispatch. Invalid tool payload shapes, missing required schema fields, invalid enum values, and malformed approval envelopes fail as MCP `InvalidParams` errors before management action handlers run. Management action parser failures still use the standardized management error envelope described above, with sanitized validation messages and a `field` when the helper can identify one.

## Scheduler Tools

Code UX exposes two scheduler MCP surfaces:

- `manage_scheduler` is the project-manager management surface. It can list, create, schedule sprints, schedule quicksprints, schedule chat messages, schedule wakeup follow-ups, update entries, delete entries with approval, and run due entries.
- `scheduler_code_ux` is the restricted agent-owned surface. It supports only `list`, `schedule_wakeup`, `schedule_task`, and `cancel`. The Code UX suffix intentionally avoids collisions with scheduler tools exposed by provider CLIs or other MCP servers.

The restricted `scheduler_code_ux` tool accepts either an absolute `scheduledFor` ISO timestamp or one positive relative delay field, `delaySeconds` or `delayMinutes`. `schedule_wakeup` requires `projectId` and `bodyMarkdown`, and may include `title`, `timezone`, `threadId`, and `connectionId`. `schedule_task` requires `projectId` and `taskId`, and may include `title`, `timezone`, and a provider override.

The broad `manage_scheduler` tool also supports `schedule_wakeup`. It requires `projectId`, `bodyMarkdown`, and either an absolute `scheduledFor` ISO timestamp or positive `delaySeconds`; it creates a one-time `targetType: "wakeup"` entry by default. Wakeups may include optional `threadId`, `connectionId`, and `title` fields, either flattened or inside `wakeupTarget`. They may also include `sourceInvocationId` and `resumeAfterInvocationCompletion`. When an MCP caller has request-scoped invocation context and `resumeAfterInvocationCompletion` is not `false`, Code UX stamps that invocation id onto the stored `wakeupTarget` so the follow-up waits for the originating provider invocation to reach `completed` before posting. Passing `resumeAfterInvocationCompletion: false` prevents automatic invocation stamping; passing an explicit `sourceInvocationId` uses that invocation id instead of the request context.

Schedule an explicit wakeup after a relative delay:

```json
{
  "action": "schedule_wakeup",
  "projectId": "project-123",
  "bodyMarkdown": "Check whether the migration finished and summarize any blocker.",
  "delaySeconds": 300,
  "threadId": "thread-456",
  "title": "Migration follow-up"
}
```

Schedule a wakeup for a specific ISO timestamp:

```json
{
  "action": "schedule_wakeup",
  "projectId": "project-123",
  "scheduledFor": "2026-07-07T18:30:00.000Z",
  "wakeupTarget": {
    "bodyMarkdown": "Post the release readiness reminder.",
    "connectionId": "connection-789",
    "sourceInvocationId": "invocation-abc",
    "resumeAfterInvocationCompletion": true
  }
}
```

Every `scheduler_code_ux` entry is persisted as an `agent_scheduler` target. The runtime stamps `origin: "agent_scheduler"`, `source: "agent_scheduler"`, and `createdByAgentId` from the current MCP agent context. `list` returns only entries created by the calling agent. `cancel` changes the matching entry status to `cancelled` only when the entry is an agent-scheduler wakeup or task entry created by that same agent. Dashboard-created entries, `manage_scheduler` entries, entries without agent-scheduler metadata, and entries created by another agent are rejected with the standard management validation envelope.

The restricted tool intentionally does not expose due-entry execution, arbitrary update, recurrence editing, sprint scheduling, quicksprint scheduling, memory remediation scheduling, or global scheduler destructive controls.

### Destructive Action Approvals

Destructive actions (e.g., actions starting with `delete_`, `reset_`, `replace_`) follow an explicit approval flow to prevent accidental data loss:
1. The initial call is sent without an `approval` block, or with `approval.confirmed: false`.
2. The server short-circuits the action, returning an early envelope with `approvalRequired: true` and an explanatory `approvalMessage`.
3. The server records a pending approval fingerprint for the normalized tool domain, action, scope identifiers, and payload. Scope identifiers include project, sprint, and task ids when present; settings fingerprints also include the setting path and proposed value.
4. The agent reviews the message and issues the exact same call again, but with `approval.confirmed: true` added to the payload.
5. The server executes the operation only when the confirmed call matches the pending fingerprint exactly and the pending approval has not expired. The approval is consumed before execution and cannot be replayed.
6. A confirmed call with any payload substitution, changed identifier, changed setting path, changed proposed value, meaningful array-order change, or `null` versus missing-field change is rejected with another approval-required response and does not consume the original pending approval.

### Settings Human Confirmation Gate

All mutating settings actions require a stateful human-confirmation step. This includes:
- `replace_system_settings`
- `patch_system_setting`
- `replace_project_settings`
- `patch_project_setting`
- `reset_project_settings`
- `replace_sprint_settings`
- `patch_sprint_setting`
- `reset_sprint_settings`
- `apply_settings_bundle` when the bundle contains provider credentials, git tokens, issue-tracker tokens, or login credentials
- `export_settings_bundle` when `includeSecrets: true` would export provider credentials, git tokens, issue-tracker tokens, or login credentials

Runtime behavior:
1. The first mutating settings call never changes settings, even if it includes `approval.confirmed: true`.
2. The server records a pending approval for the exact settings action, scope, setting path, and normalized payload for 15 minutes.
3. The response returns `approvalRequired: true` with instructions to ask the user for confirmation.
4. The client must not call the same endpoint again with `approval.confirmed: true` unless the user explicitly confirms the exact change.
5. After user confirmation, the same action and same payload can be called once with `approval.confirmed: true` within 15 minutes; the pending approval is consumed and cannot be reused.
6. A different settings payload, even for the same setting path, creates a separate pending approval and does not execute. Fingerprints preserve explicit `null`, explicit `undefined`, and array order, while object key order is normalized.

### Settings Synchronization Bundles

`manage_settings` supports settings synchronization through:
- `export_settings_bundle`
- `apply_settings_bundle`

Bundles use the existing `SettingsRepository` system, project, and sprint APIs. Applies are normalized through the same sanitizer and resolution helpers used by dashboard-saved settings, so imports do not persist raw unsanitized payloads.

Bundle metadata includes:
- `schemaVersion: 1`
- `exportedAt`
- `includedScopes`, containing `system`, `projects`, and/or `sprints`
- `fingerprint`, a SHA-256 fingerprint computed from a secret-redacted bundle representation
- `containsSecrets`

Export defaults to the `system` scope and redacts secret-bearing fields. `includeSecrets: true` may return provider API keys, git tokens, issue-tracker tokens, and login credential markers only after the one-use approval flow succeeds for the exact export payload. Bearer tokens are not generated by export; they appear only if they already exist in an explicitly approved settings payload.

Apply accepts a `bundle` object and optional `scopes` for partial import. Project entries must include `projectId`; sprint entries must include both `projectId` and `sprintId` so sprint overrides can be normalized against the resolved project base. Any bundle marked as containing secrets, or any bundle whose payload includes secret-bearing fields, requires the same one-use approval before persistence.

### Project Setup Action

`manage_projects` supports project setup:

```json
{
  "action": "setup",
  "projectId": "project-id",
  "setup": {
    "enabled": true,
    "options": {
      "agents": true,
      "quicksprints": true,
      "previewScript": true,
      "ci": true
    }
  }
}
```

The action runs the Project Setup Agent and returns the applied artifact summary, including created agent IDs, created quicksprint template IDs, and written project-relative files.

Dashboard calls can add `background: true` to the HTTP setup request. In that mode Code UX returns the created `invocationId` immediately and the invocation rail becomes the live tracking surface while setup continues.

### Project Creation Paths

`manage_projects` project creation uses the same initialization path as the dashboard. Git URL projects are cloned into the selected `cloneDir`, or `~/.code-ux/projects/<repo-name>` when `cloneDir` is omitted. `new-remote` project creation treats `cloneDir` as the clone parent directory and stores the project base directory as the single repository checkout root. `new-local` project creation resolves relative `sourceRef` values from the user's home directory and accepts absolute paths selected by the desktop picker without constraining them to the Code UX process working directory.

### Sprint, Task, and Settings Payload Normalization

For payload normalization in management tools, Code UX centralizes parsing behavior:
- **Required Strings**: Extracted via `parseRequiredString`. Must be present and non-blank (e.g. `"  "` is rejected). Returns trimmed string.
- **Required String Aliases**: Extracted via `parseRequiredStringAlias`. This preserves public aliases such as sprint `title` for `name` while failing with one shared validation error when both are blank or missing.
- **Optional Strings**: Extracted via `parseOptionalString`. Returns trimmed string, or `undefined` if blank.
- **Optional String Arrays**: Extracted via `parseOptionalStringArray`. Filters out non-string items and trims, returning `undefined` if the resulting array is empty.
- **Optional Numbers**: Extracted via `parseOptionalNumber`. Validates finiteness and optional min/max constraints.
- **Optional Enums**: Extracted via `parseOptionalEnum`. Normalizes case and whitespace to match allowed literal types.
- **Strict Optional Integers and Enums**: Extracted via `parseOptionalIntegerStrict` and `parseOptionalEnumStrict` when a supplied invalid value should be rejected instead of silently ignored. Omitted values still allow action-level defaults.
- **Required Objects**: Extracted via `parseRequiredObject`. The value must be a non-null object and not an array.
- **Required Present Values**: Extracted via `parseRequiredPresentValue` for patch-style payloads. The key must be present, but the value may explicitly be `null`; omitted and `undefined` values are distinct from `null` in approval fingerprints and patch application.
- **Validation Errors**: Parser failures throw `ManagementValidationError`, which the management tool handler serializes as the standardized `result.status: "error"` envelope with `errorType: "validation"` and `isError: true`.


The dedicated management tools (`manage_sprints`, `manage_tasks`, `manage_quicksprints`, `manage_scheduler`, `manage_node_flows`, `manage_settings`) share the same action handlers.

## Node Flow Tools

`manage_node_flows` exposes project node workflows through the project-manager MCP surface. It supports `list`, `get`, `create`, `update`, `delete`, `validate`, `run`, `list_runs`, `get_run`, `attach_to_agent`, and `detach_from_agent`.

Node-flow management always delegates graph validation and persistence to `NodeFlowService`; `run` delegates execution through the configured node-flow runtime service. Create and update calls reject malformed graph specs before repository writes. `delete` uses the standard stateful approval handshake.

The graph payload is the shared `NodeFlowGraph` contract:

- `nodes`: `{ id, type, title, description?, position?, widgetSchema?, data? }`
- `edges`: `{ id?, fromNodeId, toNodeId, fromHandle?, toHandle? }`
- `inputSchema`: optional graph-level widget schema for run input
- `metadata`: optional JSON object

Validation checks graph shape, unique node ids, edge endpoints, acyclicity, JSON-safe node data, widget schema fields, select options, finite numeric constraints, and default values that match field types. Runtime support is narrower than graph storage: executable node types are currently `input`, `set_fields`, `template`, `provider_prompt`, `http_request`, and `output`.

Agents should build Code UX-adapted flows from structured graph specs instead of cloning n8n workflows one-to-one. A good flow exposes the values an operator or agent should edit, keeps runtime behavior repeatable, names nodes by Code UX behavior, and validates every required field before saving. MCP callers can provide `widgets` as a graph-level `{ fields: [...] }` schema or as node-id keys mapped to each node's `widgetSchema`.

Secret-safe widget guidance:

- use `secretRef` for credential references, not raw secret values
- do not put API keys, bearer tokens, cookies, passwords, or private headers in `graph.metadata`, `node.data`, widget defaults, run `input`, or examples
- use placeholder references such as `settings.provider.default` or `secret://service/token`
- treat MCP responses as redacted summaries; flow and run responses mask secret-shaped graph data, inputs, trigger payloads, node payloads, and outputs before returning them through MCP

Attach a flow as an agent skill:

```json
{
  "action": "attach_to_agent",
  "flowId": "flow-123",
  "agentPresetId": "agent-123",
  "skillAlias": "Review automation",
  "description": "Runs the reusable review node flow."
}
```

Run a flow:

```json
{
  "action": "run",
  "projectId": "project-123",
  "flowId": "flow-123",
  "input": {
    "prompt": "Review the current diff"
  }
}
```

Create a small executable flow with graph-level run widgets:

```json
{
  "action": "create",
  "projectId": "project-123",
  "name": "Daily API Check",
  "description": "Fetches a status endpoint and returns a compact result.",
  "graph": {
    "nodes": [
      { "id": "input", "type": "input", "title": "Run input" },
      {
        "id": "request",
        "type": "http_request",
        "title": "Fetch status",
        "data": {
          "method": "GET",
          "url": "{{ input.statusUrl }}",
          "headers": { "authorization": "Bearer {{ input.apiTokenRef }}" },
          "responsePath": "status"
        }
      },
      {
        "id": "output",
        "type": "output",
        "title": "Return status",
        "data": { "fields": { "status": "{{ nodes.request.extracted }}" } }
      }
    ],
    "edges": [
      { "fromNodeId": "input", "toNodeId": "request" },
      { "fromNodeId": "request", "toNodeId": "output" }
    ]
  },
  "widgets": {
    "fields": [
      { "id": "statusUrl", "type": "text", "label": "Status URL", "required": true },
      { "id": "apiTokenRef", "type": "secretRef", "label": "API token reference", "required": true }
    ]
  }
}
```

Use node-id keyed widgets when node configuration should stay editable in the dashboard inspector:

```json
{
  "action": "update",
  "flowId": "flow-123",
  "graph": {
    "nodes": [
      { "id": "request", "type": "http_request", "title": "Fetch status" }
    ],
    "edges": []
  },
  "widgets": {
    "request": {
      "fields": [
        {
          "id": "method",
          "type": "select",
          "label": "HTTP method",
          "defaultValue": "GET",
          "options": [
            { "label": "GET", "value": "GET" },
            { "label": "POST", "value": "POST" }
          ]
        },
        { "id": "url", "type": "text", "label": "URL", "required": true }
      ]
    }
  }
}
```

Validate a draft graph without saving:

```json
{
  "action": "validate",
  "projectId": "project-123",
  "graph": {
    "nodes": [
      { "id": "input", "type": "input", "title": "Run input" }
    ],
    "edges": []
  }
}
```

Inspect runs:

```json
{ "action": "list_runs", "flowId": "flow-123" }
```

```json
{ "action": "get_run", "runId": "run-123" }
```

Detach a flow from an agent:

```json
{
  "action": "detach_from_agent",
  "flowId": "flow-123",
  "agentPresetId": "agent-123"
}
```

### `manage_skills` persistent skill actions

`manage_skills` is the management surface for persistent project skill storage. It is available in the `agents_memory` category for project-manager clients and for agents with explicit Code UX tool access. It is separate from workspace files: callers save skill markdown through the MCP payload, and Code UX writes the durable skill rows and embeddings through `SkillService`.

Available actions:
- `authoring_prompt`: returns the comprehensive skill-authoring prompt, including markdown/frontmatter format and the workflow for saving skills through `manage_skills` instead of writing into the workspace.
- `list_storages`: requires `projectId`; returns project-owned skill storages.
- `get_storage`: requires `projectId` and `storageId`; returns one project-owned skill storage.
- `create_storage`: requires `projectId` and `name`; accepts `description` and `storageKind` (`project` or `shared`).
- `update_storage`: requires `projectId` and `storageId`; accepts `name`, `description`, and `storageKind`.
- `delete_storage`: requires `projectId` and `storageId`; approval-gated. Deletes the storage, contained skills, embeddings, and agent attachments.
- `reset_storage`: requires `projectId` and `storageId`; approval-gated. Deletes skills and embeddings in the storage while keeping the storage and attachments.
- `list_agent_storages`: requires `projectId` and `agentPresetId`; returns the agent's enabled storage attachments and attached storages.
- `attach_storage`: requires `projectId`, `agentPresetId`, and `storageId`; attaches a project-owned storage to a project-owned agent preset.
- `detach_storage`: requires `projectId`, `agentPresetId`, and `storageId`; removes the attachment.
- `list_skills`: requires `projectId` and `storageId`; accepts `limit`; returns concise skill summaries, not full markdown bodies.
- `get_skill`: requires `projectId` and `skillId`; accepts `includeContent`. By default the response is concise; set `includeContent: true` only when the caller needs the full stored body.
- `create_skill` and `import_markdown`: require `projectId`, `storageId`, and `markdown`; accept `sourceType` (`manual`, `imported`, or `generated`) and nullable `sourceRef`.
- `update_skill`: requires `projectId`, `storageId`, `skillId`, and `markdown`; accepts `sourceType` and nullable `sourceRef`. The supplied `storageId` must match the skill's current storage because updates edit skills in place; moving a skill between storages requires a future explicit move operation. When `sourceType` or `sourceRef` are omitted, the existing skill provenance is preserved.
- `delete_skill`: requires `projectId` and `skillId`; approval-gated. Deletes the stored markdown and embeddings.
- `export_markdown`: requires `projectId` and `skillId`; returns the full reconstructed markdown with frontmatter.

Skill markdown uses YAML-like frontmatter followed by the instruction body:

```md
---
title: Review Discipline
description: Keep review findings concrete.
tags: ["review", "quality"]
appliesTo: ["src/services", "tests/backend"]
version: 1.0.0
---

Focus on bugs, regressions, missing tests, and rollback risk.
```

The parser supports scalar frontmatter fields and simple list forms for `tags` and `appliesTo`. The body is the authoritative instruction content. Metadata is stored in dedicated columns so `export_markdown` can reconstruct the markdown.

Updating a skill replaces its markdown-derived metadata and instruction body while keeping the skill in its current storage. The update path preserves existing provenance (`sourceType` and `sourceRef`) unless the caller explicitly supplies replacement source fields.

Create or import example:

```json
{
  "action": "import_markdown",
  "projectId": "project-123",
  "storageId": "skills-review",
  "markdown": "---\ntitle: Review Discipline\ndescription: Keep review findings concrete.\ntags: [\"review\"]\n---\n\nFocus on bugs, regressions, and missing tests."
}
```

Approval example for destructive skill deletion:

```json
{
  "action": "delete_skill",
  "projectId": "project-123",
  "skillId": "skill-123"
}
```

The first call returns `approvalRequired: true`. After human approval, repeat the same request with:

```json
{
  "action": "delete_skill",
  "projectId": "project-123",
  "skillId": "skill-123",
  "approval": { "confirmed": true }
}
```

Project isolation is enforced below the MCP handler by `SkillService` and `SkillRepository`. Storage, skill, embedding, and agent-attachment operations verify the supplied `projectId`; IDs from another project are rejected instead of being read or mutated.

### `search_skills` retrieval tool

`search_skills` is the retrieval-focused skill surface. It can be exposed to agents independently from `manage_skills` through per-agent MCP tool filtering. This lets an agent retrieve durable skill guidance without granting it storage creation, mutation, attachment management, export, delete, or reset capabilities.

Persistent skill runtime behavior is documented with agent preset storage ownership in [Agent Preset Foundation](../architecture/agent-preset-foundation.md#data-model) and the Settings/Agents UI contract in [Agents Design System](../dashboard/design-system-agents.md#persistent-skills). The integration regression in `tests/backend/integration/persistent-skills-runtime.test.ts` covers the MCP retrieval contract together with repository attachments and provider runtime injection.

Schema:

```json
{
  "projectId": "project-123",
  "query": "review pull request risk checklist",
  "agentPresetId": "agent-123",
  "storageId": "skills-review",
  "limit": 5,
  "minSimilarity": 0.3
}
```

Fields:
- `projectId` and non-blank `query` are required.
- `agentPresetId` is optional. When supplied without `storageId`, only storages attached to that project-owned agent are searched.
- `storageId` is optional. When supplied, search is limited to that project-owned storage.
- `limit` defaults to 10 and is capped by the handler.
- `minSimilarity` is optional and must be between 0 and 1 when supplied.

Response shape:

```json
{
  "result": {
    "results": [
      {
        "similarity": 0.91,
        "skill": {
          "id": "skill-123",
          "projectId": "project-123",
          "storageId": "skills-review",
          "name": "Review Discipline",
          "description": "Keep review findings concrete.",
          "sourceType": "manual",
          "sourceRef": null,
          "tags": ["review"],
          "appliesTo": ["src/services"],
          "version": "1.0.0",
          "contentHash": "sha256...",
          "createdAt": "2026-07-07T00:00:00.000Z",
          "updatedAt": "2026-07-07T00:00:00.000Z",
          "summary": "Focus on bugs, regressions, missing tests, and rollback risk."
        }
      }
    ]
  }
}
```

Search responses intentionally return concise summaries. To retrieve a complete stored skill, call `manage_skills` with `export_markdown`, or call `get_skill` with `includeContent: true` when the caller has management access.

### `manage_memory` claim actions

`manage_memory` supports durable long-term memory claim management in addition to raw memory actions. These actions are available to `project_manager` runtime roles and let project managers create canonical project claims directly without a sprint ID:

```json
{
  "action": "create_claim",
  "projectId": "project-123",
  "claim": "Use dependency factory composition for service wiring.",
  "category": "patterns",
  "confidence": 0.9,
  "durability": 0.85,
  "tags": ["architecture"],
  "appliesToPaths": ["src/services"],
  "sourceMemoryId": "mem-123"
}
```

`create_claim` writes the canonical `memory_claims` row and a project-scoped mirror memory whose source metadata uses `originType: "memory_claim"` and `originId` equal to the claim ID. The mirror memory content is the claim text, its category matches the claim category, and its strength is the larger of `confidence` and `durability`. This preserves compatibility with semantic claim search, which retrieves project memories first and hydrates active claims from that source metadata. When `sourceMemoryId` is provided, the action also links it as supporting evidence unless a more specific `supportType` and `weight` or `evidenceWeight` are supplied.

`update_claim` keeps the mirror memories aligned by updating their content, category, and strength after the canonical row changes. Claim search hydrates only active claims from mirror memories, so deprecated claims stop appearing in claim search without deleting their evidence history.

Available claim actions:
- `create_claim`: requires `projectId` and non-blank `claim`; accepts `category`, `confidence`, `durability`, `tags`, `appliesToPaths`, `sourceMemoryId`, `supersedesClaimId`, `supportType`, `weight`, and `evidenceWeight`. `category` defaults to `context`; `confidence` and `durability` default to `0.8`; direct claims use manual source metadata.
- `list_claims`: requires `projectId`; accepts `status`, `category`, and `limit`.
- `get_claim`: requires `projectId` and `claimId`.
- `update_claim`: requires `projectId` and `claimId`; accepts updated `claim`, `category`, `confidence`, `durability`, `status`, `tags`, `appliesToPaths`, and nullable `supersedesClaimId`; keeps project mirror memories in sync.
- `add_claim_evidence`: requires `projectId`, `claimId`, and `memoryId`; accepts `supportType` (`supports`, `contradicts`, or `supersedes`) and `weight`.
- `deprecate_claim`: requires `projectId`, `claimId`, and explicit `approval.confirmed: true`. The first unconfirmed call returns the standard `approvalRequired` envelope and does not mutate state.

Claim reads and writes remain project-scoped. A claim ID or evidence memory outside the provided project is rejected instead of being linked across project boundaries.

Destructive claim lifecycle example:

```json
{
  "action": "deprecate_claim",
  "projectId": "project-123",
  "claimId": "claim-123"
}
```

The first call returns `approvalRequired: true`. To execute the deprecation after explicit human approval, repeat the same request with:

```json
{
  "action": "deprecate_claim",
  "projectId": "project-123",
  "claimId": "claim-123",
  "approval": { "confirmed": true }
}
```

For sprint create/update calls:
- `name` is the canonical repository field.
- `title` is accepted as a public MCP alias for `name`.
- `goal` is the canonical repository field.
- `goalMarkdown` is accepted as a public MCP alias for `goal`.
- `linkedIssues` can include imported issue body and conversation markdown. Sprint create merges that context into the goal under `## Linked Issues`; sprint update does the same when a replacement goal is provided. Prompt-only issue body and conversation content are not stored in linked issue repository rows.
- Missing or blank `projectId`, `sprintId`, `sprintRunId`, `name`, and `title` values are rejected before repository calls so MCP clients receive a validation error instead of a low-level `.trim()` failure.

### `manage_sprints import_issues`

`manage_sprints` action `import_issues` is the MCP contract for GitHub, GitLab, Jira, Notion, Asana, Linear, Miro, Lucid, Figma/FigJam, and Mural importer access. Internal MCP clients use it for search-only discovery, assigned-work searches, explicit ticket or external-object imports, linked sprint issue attachment, and optional planning after import.

Provider requirements:
- GitHub imports require a saved effective `git.githubToken` in system or project settings.
- GitLab imports require a saved effective `git.gitlabToken` in system or project settings.
- Jira imports require Jira integration settings: host/site URL, account email, API token, and usually a default project key.
- Notion imports require a saved effective `notion.apiToken`. `databaseId` can narrow page search or explicitly import a database.
- Asana imports require a saved effective `asana.apiToken` plus either `workspaceId` for workspace task search or `providerProjectId` / `asana.projectId` for project task fallback.
- Linear imports require a saved effective `linear.apiToken`. `teamId`, `teamKey`, and `providerProjectId` can narrow issue search when configured or supplied.
- Miro imports require a saved effective `miro.apiToken`. `boardId` identifies a board for board item imports, and `itemTypes` can narrow item types.
- Lucid imports require a saved effective `lucid.apiToken`. `documentId` identifies a Lucidchart/Lucidspark document; `search` can discover documents.
- Figma/FigJam imports require a saved effective `figma.apiToken` plus `fileKey` or explicit file keys in `externalIds`.
- Mural imports require a saved effective `mural.apiToken` plus `workspaceId` for workspace mural search or `muralId` / `mural.boardId` for a specific mural. Mural API support is beta/limited and may return only metadata and readable content available to the token.
- Importer workflows do not fall back to local CLI authentication. A locally authenticated `gh`, `glab`, or Git remote is not enough for MCP issue search, explicit import, sprint attachment, or planning import paths.
- External imports are read/attach only. Code UX does not transition, complete, close, write back, comment on, or otherwise mutate imported work items, boards, documents, files, or murals.

Search/import callers can provide `provider` (`github`, `gitlab`, `jira`, `notion`, `asana`, `linear`, `miro`, `lucid`, `figma`, or `mural`), `repository`, `hostDomain`, `workspaceId`, `providerProjectId`, `externalProjectId`, `asanaProjectId`, `linearProjectId`, `teamId`, `teamKey`, `databaseId`, `boardId`, `documentId`, `fileKey`, `muralId`, `itemTypes`, `projectKey`, `search`, `state`, `status`, `labels`, `assignee`, `assigneeText`, `issueKeys`, `issueNumbers`, `issueRefs`, `externalIds`, `includeConversation`, `limit`, and optional sprint attachment fields. `sprintId` and `attachToSprint` represent sprint attachment intent. `planAfterImport`, `autoStart`, `planningAgentPresetId`, `replan`, and `overrides` represent optional planning intent after import.

Search-only GitHub example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "github",
  "repository": "codeux-ai/codeux",
  "hostDomain": "github.com",
  "search": "import label:bug",
  "state": "open",
  "limit": 10
}
```

Search-only GitLab example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "gitlab",
  "repository": "platform/runtime",
  "hostDomain": "gitlab.com",
  "search": "runner timeout",
  "state": "open",
  "limit": 20
}
```

Assigned-to-me Jira example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "jira",
  "projectKey": "OPS",
  "assigneeText": "me",
  "status": "in_progress",
  "limit": 20
}
```

Search-only Notion example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "notion",
  "databaseId": "notion-database-id",
  "search": "roadmap acceptance criteria",
  "limit": 10
}
```

Search-only Asana example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "asana",
  "workspaceId": "asana-workspace-gid",
  "providerProjectId": "asana-project-gid",
  "search": "checkout import",
  "includeConversation": true,
  "limit": 20
}
```

Search-only Linear example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "linear",
  "teamKey": "ENG",
  "state": "In Progress",
  "labels": ["import"],
  "search": "checkout",
  "includeConversation": true,
  "limit": 20
}
```

Miro board item example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "miro",
  "boardId": "miro-board-id",
  "itemTypes": ["sticky_note", "text"],
  "limit": 25
}
```

Lucid document search example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "lucid",
  "search": "architecture",
  "limit": 10
}
```

Figma/FigJam file example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "figma",
  "fileKey": "figma-file-key",
  "includeConversation": true
}
```

Mural workspace example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "mural",
  "workspaceId": "mural-workspace-id",
  "search": "planning",
  "limit": 10
}
```

Explicit Jira key example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "jira",
  "projectKey": "OPS",
  "issueKeys": ["OPS-123"],
  "includeConversation": true
}
```

Explicit GitLab issue number example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "gitlab",
  "repository": "platform/runtime",
  "hostDomain": "gitlab.com",
  "issueNumbers": [42],
  "includeConversation": true
}
```

Explicit GitHub issue number example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "github",
  "repository": "codeux-ai/codeux",
  "hostDomain": "github.com",
  "issueNumbers": [42],
  "includeConversation": true
}
```

Explicit external object example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "notion",
  "externalIds": ["notion-page-id"],
  "includeConversation": false
}
```

Explicit canvas object example:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "provider": "figma",
  "fileKey": "figma-file-key",
  "includeConversation": true
}
```

Attach imported issues to an existing sprint:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "sprintId": "sprint-456",
  "provider": "jira",
  "projectKey": "OPS",
  "issueRefs": ["OPS-123", "OPS-124"],
  "includeConversation": true,
  "attachToSprint": true
}
```

Attach imported issues and run planning after the sprint goal is enriched:

```json
{
  "action": "import_issues",
  "projectId": "project-123",
  "sprintId": "sprint-456",
  "provider": "github",
  "repository": "codeux-ai/codeux",
  "hostDomain": "github.com",
  "issueRefs": ["#42", "#43"],
  "includeConversation": true,
  "attachToSprint": true,
  "planAfterImport": true,
  "autoStart": false,
  "replan": true,
  "planningAgentPresetId": "planner-agent",
  "overrides": {
    "taskCount": 4
  }
}
```

Result shape:
- Search mode returns `mode: "search"` and populates `searchedIssues` with lightweight normalized issue summaries.
- Explicit-reference mode returns `mode: "explicit"` and populates `importedContexts` with prompt contexts that can include full issue body and conversation text. For Notion, Asana, Linear, and canvas providers, explicit imports use `externalIds` or provider-specific identifiers such as `databaseId`, `boardId`, `documentId`, `fileKey`, and `muralId`.
- When `sprintId` is supplied and `attachToSprint` is not `false`, the response includes persisted `linkedIssues` metadata records and the updated `sprint`.
- When `planAfterImport` is `true`, the response includes the optional `planning` result from sprint planning. `planAfterImport` requires `sprintId` because planning runs against an existing sprint.

Persistence and prompt behavior:
- `issueKeys` and Jira-style refs such as `OPS-123` resolve through Jira. `issueNumbers` and refs such as `#42` or `!42` resolve through GitHub/GitLab when `repository` and `hostDomain` are provided or inferable from the project.
- `externalIds` resolve through Notion page/database fetches, Asana task fetches, Linear issue fetches, Miro board/item fetches, Lucid document content fetches, Figma/FigJam file fetches, or Mural metadata/content fetches. Search results and explicit contexts normalize to linked-source records with `externalId`, `sourceKind`, stable display keys, source URL, preview text, metadata, and prompt markdown when readable provider content is available.
- Full issue body and comment/conversation text are merged into the sprint goal under `## Linked Issues` before planning so the Planning agent receives the complete context.
- Linked issue persistence stores metadata only: provider, repository or project key, issue key/number, title, labels, assignees, status, source URL, and related tracking fields. Full remote issue bodies and comments remain prompt-only data and are not stored in linked issue rows.
- Issue search and import are not destructive actions. Sprint deletion remains approval-gated.

For task create/update calls:
- `title` is canonical; `name` is accepted as an alias.
- `projectId` is required for list/create, and `sprintId` is required for create. List can omit `sprintId` to return all project tasks.
- Supported edit fields include `promptMarkdown`, `description`, `status`, `priority`, `executorType`, `agentPresetId`, `model`, `sortOrder`, `dependsOnTaskIds`, `isIndependent`, and `isMerged`.

For quicksprint calls:
- `manage_quicksprints` supports `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `execute`, and `start`.
- `start` is an MCP-friendly alias for execution with `submitMode: "plan_and_start"`.
- `execute` defaults to `submitMode: "plan_only"` when no submit mode is supplied.
- `taskCount` is the canonical task-number field for execution. MCP accepts it as a number or numeric string.
- `noTaskLimit: true` lets the planner choose the number of subtasks and disables the fixed-count prompt.
- `delete_template` requires approval confirmation. Custom templates are removed from the project template directory; built-in/default templates are hidden for the project by writing a local tombstone marker instead of deleting shared bundled assets.

For scheduler calls:
- `manage_scheduler` supports `list`, `create`, `schedule_sprint`, `schedule_quicksprint`, `schedule_chat`, `schedule_wakeup`, `schedule_node_flow`, `update`, `delete`, and `run_due`.
- Generic `create` requires `targetType: "sprint" | "quicksprint" | "chat" | "wakeup" | "node_flow"`.
- The `schedule_*` aliases infer the target type and accept flattened target fields.
- Recurrence `frequency` accepts `minutely`, `hourly`, `daily`, `weekly`, and `monthly`; the dashboard renders `minutely` as `Minutes` and the matching recurrence summaries use labels such as `Every minute` and `Every 15 minutes`.
- Minute recurrence uses the same UTC scheduler math as longer intervals, so the normalized rule advances `nextRunAt` and expands occurrences exactly like other frequencies once the minute literal has been parsed.
- Scheduled quicksprints use the same `taskCount` number or numeric-string normalization as direct quicksprints.
- Scheduled chat messages use `bodyMarkdown`, optional `threadId`, optional `connectionId`, and optional `title`. When due, the scheduler posts through the same chat runtime used by dashboard conversations.
- Scheduled wakeups use `bodyMarkdown`, either `delaySeconds` or `scheduledFor`, optional `threadId`, optional `connectionId`, optional `title`, optional `sourceInvocationId`, and optional `resumeAfterInvocationCompletion`. They are one-time follow-ups by default; recurrence is available only through the generic scheduler contract and is not required for delayed project-manager check-backs.
- Scheduled node flows use `flowId`, optional JSON object `input`, and optional `flowVersion`, either flattened or nested under `nodeFlowTarget`. When due, the scheduler calls the node-flow runtime with scheduler trigger metadata and only advances the entry after the runtime returns.
- `update` supports pausing and resuming entries via the `status` field. Resuming a `paused` entry to `scheduled` recomputes the next run time to the next future occurrence, preventing immediate execution of missed runs. Pause/resume acts as automation gating and does not manually trigger the target.
- `delete` requires approval confirmation.

Wakeup examples:

```json
{
  "action": "schedule_wakeup",
  "projectId": "proj-1",
  "delaySeconds": 30,
  "bodyMarkdown": "Check back in 30 seconds."
}
```

```json
{
  "action": "schedule_wakeup",
  "projectId": "proj-1",
  "scheduledFor": "2026-06-09T12:00:00.000Z",
  "bodyMarkdown": "Check back at noon."
}
```

For preview calls:
- `manage_preview` supports `list_sessions`, `start_session`, `rebuild_session`, `stop_session`, `remove_session`, `get_logs`, `get_url`, `get_script`, and `update_script`.
- `remove_session` requires approval confirmation.

For external chat provider calls:
- `manage_chat_providers` supports `list_provider_definitions`, `list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`, `list_channel_bindings`, `create_channel_binding`, `update_channel_binding`, `delete_channel_binding`, and `list_outbound_deliveries`.
- Supported provider kinds are `whatsapp`, `imessage`, `telegram`, `slack`, `microsoft-teams`, and `discord`, delivered through the implemented `managed_bridge`, `webhook`, or `native_bridge` bridge contracts. The tool does not claim direct official API integration with those providers.
- Connection responses return redacted credential metadata and generated ingress URL guidance; raw `secrets` are not exposed in success responses, validation errors, or approval envelopes.
- `delete_connection` and `delete_channel_binding` require approval confirmation.
- `update_connection` requires a one-use approval handshake before replacing a non-empty `secrets` payload. The preflight response is bound to a redacted payload plus secret hash and does not echo secret values.
- Channel bindings attach an external channel to a project with optional routing hints, inbound/outbound flags, and `suppressRichWidgets`. Multiple projects may share one external channel; runtime ingress uses selectors and records `disambiguation_needed` instead of guessing when no selector chooses exactly one project.
- `list_outbound_deliveries` is read-only delivery-state inspection. It can filter by provider connection, channel binding, external channel, delivery status, and limit. Delivery statuses include `pending`, `sending`, `delivered`, `retryable_failure`, `processed`, `failed`, `duplicate`, and `cancelled`.
- The management surface only configures providers, bindings, setup definitions, ingress URL guidance, and outbound delivery inspection. Authenticated ingress and outbound sending remain runtime services outside this management contract.

Create a webhook-backed connection:

```json
{
  "action": "create_connection",
  "providerKind": "slack",
  "displayName": "Team chat bridge",
  "bridgeMode": "webhook",
  "status": "active",
  "enabled": true,
  "setup": {
    "eventsUrl": "https://bridge.example.test/events",
    "appId": "app-generic"
  },
  "secrets": {
    "signingSecret": "replace-with-secret",
    "botToken": "replace-with-token"
  }
}
```

Bind a shared channel to a project:

```json
{
  "action": "create_channel_binding",
  "providerConnectionId": "connection-generic",
  "externalChannelId": "channel-shared",
  "externalChannelName": "Shared engineering channel",
  "projectId": "project-alpha",
  "routingHints": {
    "projectSelectorPrefix": "alpha",
    "aliases": ["alpha", "project-alpha"]
  },
  "inboundEnabled": true,
  "outboundEnabled": true,
  "suppressRichWidgets": true
}
```

Inspect retryable outbound delivery state:

```json
{
  "action": "list_outbound_deliveries",
  "providerConnectionId": "connection-generic",
  "externalChannelId": "channel-shared",
  "deliveryStatus": "retryable_failure",
  "limit": 25
}
```

For settings patch calls, `value` may be any JSON value, including strings, booleans, numbers, `null`, arrays, or objects.
Settings patch and replacement calls still require the stateful human-confirmation gate described above.

## Important Runtime Behaviors

### Listen-mode behavior
- `listen` is now the primary listening contract for both normal stdio MCP clients and workers.
- `listen` registers or refreshes the connection, then blocks until one actionable event is available or timeout expires.
- `listen` returns exactly one event at a time: a dashboard message or a timeout result with explicit "call listen again" continuation guidance.
- `listen` now returns compact event payloads instead of full connection/message records:
  - dashboard messages: `id`, `threadId`, `projectId`, `bodyMarkdown`, optional `metadata`
  - timeout: continuation only
- The default `listen` timeout is derived from dashboard settings `sprintLoopSteps.watchLoopOutputIntervalSeconds` and currently defaults to `300`.
- The default internal idle polling cadence inside one blocking `listen` call is now `3000ms`, which reduces idle listener churn without changing the external MCP loop contract.
- Connection heartbeat writes are throttled while listeners stay idle, so a healthy long-poll listener no longer rewrites connection state every second.
- `listen` is exposed on the project-manager runtime over both stdio and HTTP.
- `start_listen` registers or refreshes an MCP connection in sqlite and returns pending dashboard messages for the active project.
- `pull_inbox` is the pull-based inbox endpoint for listening MCPs.
- `post_listen_reply` writes a connection reply back into the project conversation thread and marks the handled dashboard message as processed.
- `post_listen_reply` now returns only `threadId` and `deliveryStatus`, because the caller already knows the reply body and thread context it just submitted.
- `start_listen` and `pull_inbox` now remain as low-level compatibility primitives and should not be the first-choice listener workflow for normal human-driven MCP clients.
- New dashboard threads should remain unassigned by default until explicitly targeted or claimed by a real listener.

### Agent reply behavior
- `generate_dashboard_reply` generates a reply-only markdown response for a dashboard inbox message using the editable `Worker` agent plus the project repo context.
- `generate_dashboard_reply` also accepts `mode = compact_thread`, which treats the supplied markdown as a prepared compaction prompt and records the run as a `chat_compaction` invocation.
- `post_listen_reply` accepts optional `metadata`, which Code UX uses for hidden control-plane replies such as connected-worker thread compaction.

## Removed Legacy Surface

These legacy MCP tools are no longer registered:

- `get_source`
- `list_sources`
- `list_all_sources`
- `create_session`
- `list_sessions`
- `approve_session_plan`
- `send_session_message`
- `wait_for_session_completion`
- `get_activity`
- `list_activities`
- `list_all_activities`
- `task_agent`

Code UX now keeps orchestration inside its own DB-backed dispatch layer. External MCP clients interact through listener, inbox, dispatch, and control-plane tools instead of direct Jules session management.

## Stability Expectations

When modifying tool contracts:
1. Keep argument names backward compatible where possible.
2. Update both backend and dashboard types if shared payloads change.
3. Add or update tests in `tests/backend/**/*.test.ts` or `tests/dashboard/**/*.test.ts`.
4. Document changes in `docs/` and `README.md`.

## Jules API Client Typing Boundary

`src/integrations/jules-api-client.ts` is the typed transport boundary for Jules REST calls.

Current expectations:
- Request/response interfaces are explicit for all list and session APIs (for example `JulesListSourcesRequest`, `JulesListSessionsResponse`, `JulesCreateSessionRequest`).
- Pagination inputs remain MCP-friendly (`page_size`, `page_token`) and are translated to Jules REST query keys (`pageSize`, `pageToken`) inside the client.
- Session route normalization is centralized so all session-aware methods consistently accept either `123` or `sessions/123`.
- Client-level behavior is covered by `tests/backend/services/jules-api-client.test.ts` (query mapping, pagination, session normalization, API key handling).

## Runtime Tool Enablement

MCP tool availability is runtime-configurable from dashboard settings (`mcpTools`).

Behavior:
- Disabled tools are omitted from `ListToolsRequestSchema` responses.
- Calls to disabled tools return MCP `MethodNotFound`.
- Toggle state is persisted in settings storage and applied without server restart.

## Runtime Role Gating

Code UX now also filters tools by runtime role before applying dashboard toggles.

Current roles:

- `project_manager`

Behavior:

- Code UX now exposes only the project-manager tool surface
- the same tool list is used for stdio and HTTP transports

This keeps Gemini CLI and other regular MCP clients compatible without cluttering them with worker-local controls.
