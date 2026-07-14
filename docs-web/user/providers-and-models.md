# Providers and models

Code UX dispatches work across **seven providers**, each accepting one or more **models**. This page is the catalog plus the routing system that decides which provider answers which kind of work.

## The providers

| Provider | Type | Auth detection path | Default `maxConcurrentTasks` |
| --- | --- | --- | --- |
| `jules` | Hosted Jules Agent API | `JULES_API_KEY` env | `15` |
| `gemini` | Local Gemini CLI (deprecated) | `~/.gemini/` | `0` (adaptive) |
| `codex` | Local Codex CLI (OpenAI) | `~/.codex/` | `0` (adaptive) |
| `claude-code` | Local Claude Code CLI | `~/.claude/` | `0` (adaptive) |
| `qwen-code` | Local Qwen Code CLI | `~/.qwen/` | `0` (adaptive) |
| `opencode` | Local OpenCode CLI (multi-model) | `~/.local/share/opencode/` or `~/.config/opencode/` | `0` (adaptive) |
| `antigravity` | Local Antigravity CLI | `~/.antigravity/` | `0` (adaptive) |

All non-Jules providers are *virtual workers*. In the default Docker workflow, Code UX downloads only activated provider CLIs into versioned local Docker volumes, mounts them read-only, and checks their stable channels when the persisted six-hour update watermark is due. Selecting a provider in onboarding starts preparation before Login. Authentication still uses each provider's normal login flow and is stored separately from the tool volume.

For local providers, a concurrency value of `0` selects automatic CPU/memory admission. A positive
value remains a hard provider ceiling. Jules runs remotely and retains the hosted unlimited meaning
for `0`.

Gemini CLI remains supported for existing and new configurations but is deprecated in the UI, excluded from fresh Easy recommendations, and accompanied by a migration action toward Antigravity. Code UX does not silently change Gemini credentials, defaults, or routing.

## External chat connectors

Settings -> Integrations -> Chat Connectors includes external chat connector connections for WhatsApp, iMessage, Telegram, Slack, Microsoft Teams, and Discord channels. These are not AI model providers and they do not affect invocation routing. They bind authenticated external chat bridges to Code UX projects so inbound messages can enter project chat threads and assistant replies can be delivered back through the same bridge.

Connection modes are explicit per connector:

- `managed_bridge` — HTTP delivery to a configured managed bridge URL.
- `webhook` — HTTP delivery to a configured generic bridge or bot gateway URL.
- `native_bridge` — shell-free local command execution for native bridge scripts, with JSON on stdin and optional bridge token environment variables.
- `official_api` — provider-native authentication and fixed provider endpoints implemented by the WhatsApp, Telegram, Slack, Microsoft Teams, and Discord profiles.

iMessage supports managed and native third-party bridges only; Apple does not expose an official public personal-iMessage bot endpoint. Managed, webhook, and native endpoints remain operator-selected integrations and are not provider-certified merely because a connector profile is registered. Use only the modes advertised by the selected profile.

Chat provider setup stores connection records, write-only secrets, channel bindings, routing hints, and outbound delivery state separately from AI provider credentials. Webhook ingress requires HMAC signatures when a signing secret is configured; Managed and native bridge ingress use bearer-style bridge tokens. Shared external channels can route to multiple projects only when a selector or routing hint chooses exactly one binding.

For the full setup and routing contract in the published docs, see [External chat connectors](../architecture/external-chat-providers.md).

## The models

The full model catalog lives in `src/repositories/settings-defaults.ts`. The defaults below reflect the currently shipped release.

### Gemini
```
auto, pro, flash, flash-lite,
gemini-3-pro-preview, gemini-3-flash-preview,
gemini-3.1-pro-preview, gemini-3.1-pro-preview-customtools, gemini-3.1-flash-lite-preview,
gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3.1-flash-lite,
gemma-4-31b-it, gemma-4-26b-a4b-it, gemini-2.5-flash-base, gemini-3-flash-base
```

### Claude
```
default, sonnet, opus, haiku,
sonnet[1m], opus[1m], opusplan,
claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001,
claude-fable-5
```

### Codex (OpenAI)
```
gpt-5.5, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna,
gpt-5.4, gpt-5.4-mini,
gpt-5.3-codex, gpt-5.3-codex-spark,
gpt-5.2-codex, gpt-5.2,
gpt-5.1-codex-max, gpt-5.1, gpt-5.1-codex,
gpt-5-codex, gpt-5-codex-mini, gpt-5
```

### Custom Endpoints (Claude Code & Codex)

For providers that support custom API endpoints (Claude Code and Codex), you can configure a **Custom Base URL** and a **Custom Model** in Settings.

- **Custom Base URL**: Overrides the default API endpoint. Useful for routing through gateways like OpenRouter or LiteLLM.
- **Custom Model**: Overrides the model identifier sent to the CLI and recorded in telemetry.

When a Custom Model is set:
1. **CLI Execution**: Code UX passes the custom model to the CLI via `--model` and relevant environment variables (e.g., `ANTHROPIC_MODEL`, `CODEX_MODEL`).
2. **Telemetry Labeling**: The custom model slug is used in the dashboard's stats snapshots, invocation logs, and task-run events instead of the default or preset model name.
3. **Claude Code Specifics**: Setting a custom model for Claude Code points *all* internal model tiers (fast, opus, etc.) at that single slug to ensure the gateway doesn't receive requests for unsupported models.

The loopback URL rewriting behavior (e.g., `host.docker.internal` in Docker mode) also applies to these custom base URLs.

### Qwen
```
qwen3-coder-plus, qwen3.5-plus, qwen3-coder-next,
qwen3-max, qwen3-max-2026-01-23,
qwen-plus, qwen-max
```

Qwen custom-endpoint instances define their model id in Settings -> Providers. Code UX adds that configured model to the AI Models selector and writes it into Qwen Code `modelProviders` at runtime. The Custom endpoint preset is Ollama-compatible by default: API key `your_api_key`, model `glm-4.7-flash`, environment key `OLLAMA_API_KEY`, and base URL `http://127.0.0.1:11434/v1`. In Docker mode, Code UX rewrites loopback URLs to `host.docker.internal` inside the container; Linux Docker Engine runs with loopback endpoints use Docker's `host-gateway` mapping.

### OpenCode
```
anthropic/claude-sonnet-4-5, anthropic/claude-opus-4-1, anthropic/claude-haiku-4-5,
openai/gpt-5, openai/gpt-5-mini,
github-copilot/gpt-5,
openrouter/anthropic/claude-sonnet-4.5
```

OpenCode provider-key and custom-endpoint instances generate a per-run OpenCode config. Code UX writes that generated config to a temporary `opencode.json`, sets `OPENCODE_CONFIG`, and maps the saved key to `OPENCODE_API_KEY`. The Custom endpoint preset is Ollama-compatible by default: API key `your_api_key`, provider/model `ollama/glm-4.7-flash`, environment key `OLLAMA_API_KEY`, and base URL `http://127.0.0.1:11434/v1`. In Docker mode, Code UX rewrites loopback URLs to `host.docker.internal` inside the container; Linux Docker Engine runs with loopback endpoints use Docker's `host-gateway` mapping.

### Antigravity
```
default, gemini-3.5-flash, gemini-3.1-pro-high, gemini-3.1-pro-low,
gemini-3-flash, claude-sonnet-4.6-thinking, claude-opus-4.6-thinking,
gpt-oss-120b
```

### Default per provider

| Provider | Default model |
| --- | --- |
| Jules | `default` |
| Gemini | `auto` |
| Claude Code | `default` |
| Codex | `gpt-5.5` |
| Qwen Code | `qwen3-coder-plus` |
| OpenCode | `anthropic/claude-sonnet-4-5` |
| Antigravity | `default` |

Set per-provider model in **Settings → AI providers**.

## Thinking modes

CLI providers expose provider-specific **thinking** or **reasoning** selections. Jules is hosted/managed and does not expose a thinking control in Code UX.

| Provider | Thinking selections |
| --- | --- |
| Gemini | `minimal`, `low`, `medium`, `high` |
| Codex | `low`, `medium`, `high`, `xhigh` |
| Claude Code | `low`, `medium`, `high`, `xhigh`, `max` |
| Qwen Code | `low`, `medium`, `high`, `xhigh`, `max` |
| OpenCode | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Antigravity | `low`, `high` |

Older saved values `SMALL`, `MEDIUM`, and `HIGH` continue to load and are migrated to the closest supported value for the selected provider.

Route-specific thinking overrides are optional. Selecting **Inherit base thinking** on a route removes that route's `thinkingMode` override, so later provider-level thinking budget changes apply to the route.

## Provider weights and strategies

In **Settings → AI providers** each provider has a `weight` (0–100). Weights are used by the routing strategy:

- `MANUAL` — every routing ID points to a specific provider config.
- `WEIGHTED` — random sampling proportional to weights.
- `ORCHESTRATOR` — let an orchestrator agent decide per invocation (advanced).

Default weights: Jules = 60, Gemini = 20, Codex = 20.

## Invocation routing

Different *kinds* of work route to different providers. The seven invocation IDs:

| ID | Used for |
| --- | --- |
| `task_coding` | The actual coding work in tasks. |
| `planning` | Sprint planning decomposition. |
| `dashboard_reply` | Non-coding chat responses on the dashboard. |
| `clarification_reply` | Auto-answering an agent's clarification request. |
| `qa_review` | Quality assurance pass on completed work. |
| `ci_fix` | Fixing a failing CI check. |
| `merge_conflict` | Resolving Git merge conflicts on a worker branch. |

For each ID, you can pick:

- A **provider config**.
- An **agent preset** (optional).
- A **routing profile** (`GLOBAL` for system-wide, `WORKER` for per-worker overrides).

The `ci_fix` card also includes **Continue from same session and model as coding task**, enabled by default. When a CI failure belongs to one coding task, Code UX resumes that task's exact provider session and effective model, preserving its context and workspace. Turn the option off to route task repairs through the CI Fix provider configuration below it. Final-merge CI repair always uses the configured route because it is sprint-scoped rather than owned by one task.

Route provider values are exact provider-config IDs, not provider-type aliases. For example, `gemini` only selects the provider instance whose id is exactly `gemini`; it will not silently select another Gemini instance such as `gemini-fast`. If a sprint or project override adds a dedicated provider instance, that instance must be present in the effective provider list before routes, allowed-provider pools, worker defaults, and per-route overrides can reference it.

Manual routing never falls back to another provider when the selected or inherited provider instance is unavailable. If that exact instance is disabled, missing, blocked by the invocation type, or incompatible with the current Git/Jules mode, Code UX stops with a visible routing error in the dashboard so you can enable that instance or choose a different route.

Project and sprint route-provider overrides replace the inherited provider map for that specific invocation route. If an override declares `task_coding.providers`, `merge_conflict.providers`, or `qa_review.providers`, only those provider-config IDs are eligible for that route; parent providers are not merged back in.

A common high-quality setup:

| ID | Provider | Model | Why |
| --- | --- | --- | --- |
| `task_coding` | Codex | `gpt-5.5` | Strong code generation. |
| `planning` | Claude Code | `opus` | Best at structured decomposition. |
| `dashboard_reply` | Antigravity | `gemini-3-flash` | Supported Google-powered local CLI path. |
| `clarification_reply` | Claude Code | `sonnet` | Strong reasoning, lower cost than opus. |
| `qa_review` | Claude Code | `opus` | Thorough review. |
| `ci_fix` | Codex | `gpt-5.5` | Iterative debugging. |
| `merge_conflict` | Codex | `gpt-5.5` | Mechanical merging. |

## Choosing a virtual worker provider

The dashboard exposes a single *virtual worker provider* (`workers.virtualWorkerProvider`) used when the engine spins up an ephemeral worker (e.g. to handle a CI fix attention item). Defaults to `codex`; pick an activated and authenticated provider. Code UX prepares its CLI automatically in Docker mode.

## Execution modes

Per provider, you choose an execution mode:

- `HOST` — invoke the CLI directly on the host machine. Requires the CLI to be on `PATH`. Auth is whatever the CLI normally uses.
- `DOCKER` — invoke the CLI inside a `node:24-bookworm` container with mounts. Optional: mount the provider auth path so the in-container CLI uses your local credentials.

Docker mode is recommended for hermetic execution and auditability. Host mode is faster.

## Auth mounting

Toggle **Mount auth** per provider to mount the auth path (e.g. `~/.gemini`) read-only into the worker container. Without this, the in-container CLI must be re-authenticated.

## API keys

For providers that accept an API key (most do, in addition to or instead of CLI auth), the **API key** field accepts:

- A literal key.
- An `${ENV_VAR}` reference resolved at start time.

Keys are stored in the settings DB and never logged.

## Detection hints

The Settings → AI providers panel displays a **Detected** column. Code UX inspects:

- Env variables: `JULES_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.
- CLI auth directories.

When a value is detected, you get a one-click button to fill the corresponding settings field.

## Picking the right provider

Rules of thumb:

| You want… | Provider |
| --- | --- |
| Hosted, no local install | `jules` |
| Best raw code generation | `codex` (gpt-5.5 / gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna) |
| Best reasoning / planning | `claude-code` (opus / sonnet[1m]) |
| Cheap, fast iteration | `gemini` (flash) |
| Privacy / on-prem | `qwen-code` (local-model) |
| Multi-model flexibility | `opencode` |
| Agent workbench routing | `antigravity` |

You are encouraged to mix providers via routing rather than picking one for everything.
