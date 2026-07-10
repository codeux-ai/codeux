# Provider Routing

This page describes how Code UX resolves provider, model, and provider pool selection for each invocation type.

## Why This Exists

Global provider settings are not enough once different workflows need different backends.

Examples:
- clarification auto-replies should usually follow the preferred worker CLI provider/model
- planning may want a different provider pool than task coding
- CI fix and merge-conflict repair runs often need worker-oriented defaults even when normal task routing is global

Code UX now separates:
- global provider defaults
- worker runtime defaults
- invocation-specific routing rules
- optional per-agent provider/model preferences
- provider credentials/instances managed by Integrations

Note that provider configuration is subject to the `system -> project -> sprint` resolution cascade and routing rules resolve against the effective settings at the current scope.
Effective API responses include `sources` metadata mapping routing rules and provider configurations to the scope that provided them.

*(Note: In routing contexts, `available` means detected credentials/auth presence or local auth enabled on that exact provider instance, whereas `enabled` means user-approved routing participation.)*

## Provider Runtime Artifacts

Provider runtime artifacts (such as host log paths, temporary output files, and Docker paths) are owned and managed by the `provider-runtime-artifacts` module. `ProviderRunner` delegates path resolution and artifact cleanup logic to this helper to ensure safer execution boundaries and testing.

Persistent skill storage is a separate provider runtime input, not a workspace artifact. When an invoked agent preset has persistent skill storage enabled and at least one attached storage, `ProviderExecutionService` appends a dedicated prompt section and passes explicit read/write storage mounts to the provider runner. The host root is derived under `~/.code-ux/persistent-skill-storages/<project-id>/<agent-id>/<storage-id>/`; Docker mounts that directory at `/code-ux/persistent-skills/<storage-id>/`. Code UX never mounts arbitrary storage paths from settings and never uses the project workspace or `.worktrees` directory as the persistent skill root.

Agents should call `search_skills` before creating a durable skill so they do not duplicate existing guidance. If they need to save a new reusable skill, they should use `manage_skills import_markdown` or another available MCP write action when the agent has that authority; otherwise they may write a markdown skill file into the mounted persistent storage path. The retrieval-only `search_skills` MCP surface can be exposed to skill-enabled agents without enabling unrelated Code UX management tools.

## Configuration Model

Backend types:
- `src/contracts/app-types.ts`
- `src/contracts/settings-scope-types.ts`

Routing implementation:
- `src/services/provider-routing.ts`

Provider CLI command generation and configuration utilities:
- `src/infrastructure/providers/cli/provider-command-specs.ts`
- `src/infrastructure/providers/cli/mcp-config-format.ts` (Local and Docker provider MCP config generation share one contract via `buildProviderMcpConfigArtifact`)

Each `aiProvider.invocationRouting.<routeId>` entry contains:
- `profile`
  - `GLOBAL`: baseline comes from top-level `aiProvider`
  - `WORKER`: baseline comes from `workers.virtualWorkerProvider` and `workers.model`
    - the worker model override is only applied when it is valid for the selected provider; otherwise Code UX falls back to that provider's own configured/default model instead of leaking a Codex/Gemini/Claude model across providers
- `strategy`
  - `MANUAL`, `WEIGHTED`, or `AGENT`
- `provider`
  - explicit manual provider config id, or `null` to inherit the profile default
- `allowedProviders`
  - optional provider config id subset for weighted or agent-provider selection; empty weighted/agent pools fail closed to the route's selected or inherited provider rather than opening to every enabled provider
- `providers`
  - sparse overrides for `enabled`, `model`, `weight`, and `thinkingMode`, keyed by provider config id

Provider instances are first-class routing targets:
- the default built-in instances use ids `jules`, `gemini`, `codex`, `claude-code`, `qwen-code`, and `opencode`
- additional instances can be added under the same provider type, such as multiple Codex credentials with different names and weights
- the internal `mockup-cli` provider id is reserved for deterministic credential-free sprint validation and should only be configured by test and CI paths such as the [Mockup Sprint Pentest](../development/mockup-sprint-pentest.md)
- each CLI instance also carries its own optional Docker auth-copy source (`mountAuth` + `authPath`), so routing one Codex, Qwen, or OpenCode instance vs another can change both credentials and local auth mount source
- Qwen Code instances additionally carry auth mode metadata for local OAuth cache copying, Alibaba Cloud Coding Plan, or custom `modelProviders`-style endpoints
- OpenCode instances additionally carry auth mode metadata for local `auth.json` cache copying, built-in provider API keys, or generated OpenAI-compatible custom provider config
- OpenAI-compatible gateway quota messages are classified consistently across CLI providers. For example, OpenRouter `API Error: 403 Key limit exceeded (weekly limit)` responses are treated as `QUOTA_EXHAUSTED`; when the gateway omits a reset timestamp, the affected work is marked quota-limited without an active retry timer.
- Codex usage-limit messages that only provide a wall-clock hint are handled conservatively: if the inferred reset would roll almost a full day or otherwise looks ambiguous, Code UX treats the reset as uncertain and falls back to the bounded quota retry path instead of locking the task behind a misleading next-day cooldown.
- `MANUAL` selects one exact instance
- `WEIGHTED` distributes across enabled instances, even when several share the same provider type
- `AGENT` uses the selected agent preset's optional provider/model preference when present, then falls back to the route's inherited/manual provider

## Thinking Mode Catalog

Thinking/reasoning settings are provider-keyed rather than global. Base provider settings and route overrides accept only values supported by the selected provider type:

| Provider | Settings values |
| --- | --- |
| Gemini | `minimal`, `low`, `medium`, `high` |
| Codex | `low`, `medium`, `high`, `xhigh` |
| Claude Code | `low`, `medium`, `high`, `xhigh`, `max` |
| Qwen Code | `low`, `medium`, `high`, `xhigh`, `max` |
| OpenCode | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Antigravity | `low`, `high` |
| Jules | Unsupported; no thinking control is rendered or forwarded |

Legacy persisted values `SMALL`, `MEDIUM`, and `HIGH` are accepted during load and validation for CLI providers and are normalized to provider-appropriate values. For example, Codex `HIGH` becomes `high`, while Antigravity `MEDIUM` becomes `high` because Antigravity exposes only low/high reasoning selections.

Route-specific thinking overrides are optional. When the AI Models route card is set to **Inherit base thinking**, Code UX removes the route's `thinkingMode` override and the invocation uses the provider instance's current base thinking value. This keeps provider-level thinking budget changes from being shadowed by stale route overrides.

Runtime delivery matches each CLI's reliable headless surface. Codex receives `model_reasoning_effort` via CLI config overrides, Claude Code receives `--effort`, Qwen Code receives generated runtime config `model.reasoningEffort`, and OpenCode receives `--variant`. Gemini and Antigravity do not expose a reliable per-run headless flag in the supported CLI path, so Code UX adds provider-specific prompt guidance for those providers only.

Legacy saved values of `ORCHESTRATOR` are normalized to `AGENT` when settings are loaded. The old rule-based provider picker is no longer exposed.

Manual route selection is authoritative for that route. Code UX never falls back from a manually selected provider instance to another enabled provider. If the selected or inherited instance is disabled, missing, unavailable for the invocation type, or blocked by LOCAL Git/Jules constraints, the invocation fails with a clear routing error so the operator can enable that exact instance or choose a different route provider. Dashboard/API routes return these provider-selection failures as visible `409` responses with the routing message; only unexpected internal failures are masked as `Internal Server Error`. A route can deliberately enable an otherwise disabled provider instance with `providers.<id>.enabled = true`; otherwise disabled instances remain unavailable.

## Supported Invocation Routes

- `task_coding`: primary provider-routed task execution
- `planning`: virtual planning and prompt-improvement runs
- `dashboard_reply`: dashboard chat replies generated by a CLI provider
- `clarification_reply`: automatic clarification answers for blocked workers
- `qa_review`: completion-time quality assurance reviews that can request follow-up fixes
- `ci_fix`: worker-owned CI repair runs
- `merge_conflict`: worker-owned merge-conflict repair runs
- `remediation`: memory curation runs, including optional AI post-sprint promotion review and scheduled long-term memory cleanup

## Resolution Rules

1. Start from the selected route.
2. Build the baseline provider-instance catalog from the route profile.
3. Apply worker-profile defaults when `profile = WORKER`. Incompatible worker model overrides are ignored instead of being forwarded to a different provider, but the inherited worker provider instance must still be eligible; Code UX does not auto-enable disabled worker defaults.
4. Apply invocation-specific per-provider overrides.
5. Filter by `allowedProviders`, then by any runtime provider pool restriction. Under `MANUAL`, the weighted pool is ignored, but the selected provider still must be enabled and available for the invocation.
6. Run the route's selected strategy. For `AGENT`, Code UX reads the selected agent preset's optional `providerConfigId` and `model`; blank agent fields inherit the route default. If that selected or inherited provider is unavailable, Code UX reports the routing error instead of trying another provider. The top-level `aiProvider.strategy` remains only for legacy settings compatibility.
7. If Jules is selected but unavailable or the current context requires a CLI provider, Code UX reports the routing error instead of rerouting within the remaining providers.
8. When a CLI instance is selected for Docker execution, Code UX forwards that instance's `mountAuth` and `authPath` into the runtime so the chosen route controls which local credential directory is copied.
9. If a persisted task already has a concrete provider assignment, such as `gemini` on retry, Code UX resolves the matching provider instance settings for that provider instead of reusing settings from a newly resolved fallback route. This keeps model and auth-copy settings aligned with the actual CLI being launched.
10. Legacy provider-id keyed payloads are normalized into the instance model so older settings rows and tests continue to resolve through the new routing engine.
11. If the resolved invocation is associated with an agent preset that has persistent skill storage enabled and attached, Code UX augments the prompt and runtime mounts after routing is resolved. This applies to task coding, planning, QA review and follow-up, dashboard replies, clarification replies, CI fix, merge-conflict repair, and memory remediation flows whenever the agent preset is known.
12. The `ci_fix.continueTaskSession` option defaults to `true`. For task-scoped CI failures with a resumable CLI coding run, Code UX uses that run's logical/native provider session, provider family, effective model, coding agent instructions, and preserved workspace. Disable **Continue from same session and model as coding task** under Settings → AI Models → CI fix to force task repairs through the standalone CI Fix provider route. Sprint-level final-merge repairs have no originating task session and always use the standalone route.

## Credential Mutual Exclusion

To prevent conflicting generated runtime configuration and credential leakage, Code UX enforces strict mutual exclusion between API key and local copy / dashboard login authentication modes for every non-Jules provider:

1. **API Key Mode (`authType === "apiKey"`)**:
   - `mountAuth` is automatically disabled (`false`).
   - The local copy / dashboard auth path (`authPath`) is cleared.
   - Preserves custom provider API-key sub-modes (e.g. Alibaba Cloud Coding Plan, custom OpenAI-compatible endpoints) and their specific endpoints/keys.

2. **Local Auth / Dashboard Login (`authType === "localAuth"` or `authType === "dashboardAuth"`)**:
   - The `apiKey` field is cleared.
   - Any custom model provider base URL (`customBaseUrl`) or custom model slug (`customModel`) overrides are cleared and ignored.
   - Provider-instance credentials remain isolated by exact instance id. A custom endpoint configured on a separate instance such as `Codex Local` is not inherited by `Codex Primary`, and mounted-auth runs ignore stale custom model fields even if an older settings row still contains them.
   - For **Qwen Code**, forces `qwenAuthMode` to `LOCAL_AUTH` (other modes: `ALIBABA_CODING_PLAN`, `MODEL_PROVIDER`) and clears all custom API-key sub-mode fields (`qwenRegion`, `qwenBaseUrl`, `qwenEnvKey`, `qwenModelId`, `qwenProtocol`, `qwenAdditionalModelProviders`).
   - For **OpenCode**, forces `openCodeAuthMode` to `LOCAL_AUTH` (other modes: `ENV_KEY`, `CUSTOM_PROVIDER`) and clears all custom API-key sub-mode fields (`openCodeProviderId`, `openCodeModelId`, `openCodeBaseUrl`, `openCodeEnvKey`, `openCodePackage`).
   - For **Codex**, ensures that no stale API key or custom model-provider overrides are passed to the child process environment (`withProviderEnv`) or command construction arguments.

## Current Defaults

- `task_coding` uses `GLOBAL`
- `planning` uses `WORKER`
- `dashboard_reply` uses `WORKER`
- `clarification_reply` uses `WORKER`
- `qa_review` uses `WORKER`
- `ci_fix` continues the task coding session/model by default when the failure belongs to one task; otherwise it uses `WORKER`
- `merge_conflict` uses `WORKER`
- `remediation` uses `WORKER`

That means:
- task coding uses the strategy stored on the `task_coding` route
- dashboard chat replies, clarification auto-answer, and QA review runs follow the preferred worker CLI provider/model by default instead of inheriting the global primary provider
- dashboard chat replies resolve from Route Mapping on every turn; stale thread runtime state is used only to decide whether a chat session can continue or must replay after the provider changes

## Provider Capacity Deferrals

Provider `maxConcurrentTasks` is enforced before a task is counted as started. When the selected provider is already at its global cap, sprint task dispatch creates or refreshes a queued dispatch/task-run record, records a `provider_concurrency_wait` event, and returns the task to a retryable `PENDING` state for the next orchestration cycle.

Custom provider instances carry their own `maxConcurrentTasks` value through the selected provider-settings override. Enforcement still counts active rows by provider family globally (for example all `qwen-code` invocations share the same running-count pool), but the limit used for a new invocation comes from the exact provider instance selected by routing or agent configuration.

Provider-cap queueing is not a task creation failure. It must not increment the consecutive task creation failure counter, trigger the emergency stop, or record `task_coding` guardrail usage. Real startup failures still use the normal failure path and continue to count toward `maxFailures`.

## Services Using Invocation Routing

- `src/services/task-service.ts`
  - task coding provider selection
- `src/services/worker-inbox-reply-service.ts`
  - dashboard reply and clarification reply resolution
- `src/services/quality-assurance-service.ts`
  - task-completion and sprint-completion QA review resolution
- `src/services/planning-agent-service.ts`
  - virtual planning provider/model resolution
- `src/services/virtual-worker-service.ts`
  - CI fix and merge-conflict worker-owned repair flows
- `src/services/memory-remediation-service.ts`
  - post-sprint memory curation and scheduled long-term memory cleanup
- `src/services/cli-workflow/pipeline/*.ts`
  - stages including `prepare`, `execute-provider`, `memory-capture`, `git-finalize`, `pr-finalize`, and `cleanup` consume explicit per-run provider settings instead of implicitly borrowing worker model overrides

## Dashboard Surface

The v2 settings page exposes:
- AI routing console with global/worker anchors, provider-instance counts, enabled-provider counts, and route totals
- global default instance and model
- worker default instance and model
- worker max concurrency, defaulting to `100` parallel worker-dispatched tasks with an editor range of `1` to `100`
- base provider instance defaults for model, thinking mode, weight, enabled state, and concurrency (with wait loops optionally bounded by `maxWaitMs` and cancellable via `AbortSignal`)
- invocation route profile and strategy
- per-route provider-instance subset selection
- per-route model and thinking-mode overrides
- per-instance API-key and local-auth configuration in Integrations
- Qwen Code setup panels for local auth, Alibaba Cloud Coding Plan, and custom endpoints
- OpenCode setup panels for local auth, built-in provider keys, and custom OpenAI-compatible endpoints
- restored Git Flow controls plus GitHub auth-copy controls in the live panel set
- quick category search with `/` focus
- Route Mapping as the main AI routing workspace with route summaries, provider-pool counts, and override counts
- pill-style controls for common mode switches such as profile, strategy, execution mode, and merge policy
- manual Route Mapping entries display and edit only their resolved primary instance, even if an older weighted pool remains saved on the route; weighted and agent strategies continue to display their selected provider pool

Dashboard route and model controls share provider display metadata from the settings view-model helpers:
- provider routes use provider instance ids internally but display the settings page instance name, such as `Codex Primary`, instead of legacy virtual-worker labels
- provider icons use the underlying provider type, so additional Codex, Qwen Code, OpenCode, and Antigravity instances keep the correct brand icon
- base and route thinking selectors use the selected provider instance's option catalog, hide for unsupported providers such as Jules, and label legacy saved values through their normalized provider-specific value
- default route/model options show the resolved inherited worker defaults when available, such as `Default Route (Codex Primary)` and `Default Model (gpt-5.5)`
- Codex model selectors include `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` as selectable catalog options while keeping `gpt-5.5` as the Codex default model
- custom endpoint provider instances display their effective configured model in Settings defaults, route cards, and default model labels. Codex and Claude Code API-key custom endpoint instances use `customModel` and their custom base URL when local auth is not mounted; Qwen Code `MODEL_PROVIDER` and OpenCode `CUSTOM_PROVIDER` instances use their generated configured model ids and endpoint metadata. Mounted/local-auth and dashboard-auth instances ignore stale custom model or base URL fields and keep showing the saved provider default.
- Sprint Composer and Quicksprint default route/model labels resolve from the `planning` invocation route mapping. A pinned Planning Route provider and its route-specific model override are displayed as the default, even when the worker default points at a different provider.
- Sprint Composer and Quicksprint explicit route selections keep the selected provider-instance id as the option value for UI state, but send the underlying CLI provider type in `PlanningOverrides.virtualProvider`. This selects by CLI provider type for planning/prompt-improvement runs, and `virtualModel` only overrides that planning run's selected provider model (it is not a general task-coding model override).
- model option values remain the provider catalog values returned by `getProviderModelOptions`; only labels and icons are display metadata

File:
- `dashboard/src/v2/SettingsPage.tsx`


## Provider Runtime Config Boundary

Code UX extracts provider runtime config and MCP config assembly from `ProviderRunner` into focused typed builder modules, such as `src/infrastructure/providers/cli/provider-runtime-config.ts`. This isolates the JSON/TOML generation logic for providers like Qwen, OpenCode, and Antigravity, while keeping process execution and mount creation in the runner.

## Custom MCP Server Safety

Custom MCP servers saved in settings are sanitized before provider runs generate Claude, Gemini, Qwen, Codex, OpenCode, or Antigravity MCP config. HTTP / SSE custom servers must use `http://` or `https://` URLs without embedded credentials or control characters. Local developer tools on loopback remain supported with explicit `localhost`, `127.0.0.1`, or `[::1]` URLs, but link-local metadata endpoints, multicast and broadcast addresses, and ambiguous numeric IP encodings such as decimal-integer, hexadecimal, shortened, or leading-zero IPv4 forms are rejected.

Custom HTTP headers keep the existing count and length limits and may carry normal auth headers such as `Authorization`. Code UX drops hop-by-hop and request-smuggling-sensitive names including `Host`, `Connection`, `Transfer-Encoding`, `Content-Length`, `TE`, `Trailer`, `Upgrade`, `Keep-Alive`, proxy auth/connection headers, and `Expect`.

Stdio custom servers continue to be serialized as provider-native command, args, and env fields rather than shell command strings. Commands containing shell metacharacters are rejected; args and env values are passed as structured strings in generated config artifacts.

## Provider Override Settings Boundary

Code UX enforces a single shared typed mapping boundary, `buildProviderSettingsOverride` in `src/services/provider-settings-override.ts`, for converting resolved dashboard provider settings and models into the isolated `providerSettingsOverride` payload needed for CLI execution and QA review dispatches. This shared boundary keeps contract drift out of the duplicated dispatch call sites while maintaining support for auth path overrides, Qwen auth mode sub-fields, OpenCode custom provider logic, and base provider parameters like model or API keys.
