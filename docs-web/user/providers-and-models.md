# Providers and models

Code UX dispatches work across **seven providers**, each accepting one or more **models**. This page is the catalog plus the routing system that decides which provider answers which kind of work.

## The providers

| Provider | Type | Auth detection path | Default `maxConcurrentTasks` |
| --- | --- | --- | --- |
| `jules` | Hosted Jules Agent API | `JULES_API_KEY` env | `15` |
| `gemini` | Local Gemini CLI | `~/.gemini/` | `0` (unlimited) |
| `codex` | Local Codex CLI (OpenAI) | `~/.codex/` | `0` (unlimited) |
| `claude-code` | Local Claude Code CLI | `~/.claude/` | `0` (unlimited) |
| `qwen-code` | Local Qwen Code CLI | `~/.qwen/` | `0` (unlimited) |
| `opencode` | Local OpenCode CLI (multi-model) | `~/.local/share/opencode/` or `~/.config/opencode/` | `0` (unlimited) |
| `antigravity` | Local Antigravity CLI | `~/.antigravity/` | `0` (unlimited) |

All non-Jules providers are *virtual workers* — Code UX shells out to the provider's CLI, optionally inside a Docker container. Authentication is provided by the host CLI's normal login flow; Code UX merely detects and references it.

## The models

The full model catalog lives in `src/repositories/settings-defaults.ts`. The defaults below reflect the shipped 1.2.x release.

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
claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
```

### Codex (OpenAI)
```
gpt-5.5, gpt-5.4, gpt-5.4-mini,
gpt-5.3-codex, gpt-5.3-codex-spark,
gpt-5.2-codex, gpt-5.2,
gpt-5.1-codex-max, gpt-5.1, gpt-5.1-codex,
gpt-5-codex, gpt-5-codex-mini, gpt-5
```

### Qwen
```
qwen3-coder-plus, qwen3.5-plus, qwen3-coder-next,
qwen3-max, qwen3-max-2026-01-23,
qwen-plus, qwen-max
```

Qwen custom-endpoint instances define their model id in Settings -> Providers. Code UX adds that configured model to the AI Models selector and writes it into Qwen Code `modelProviders` at runtime. The Custom endpoint preset is Ollama-compatible by default: API key `your_api_key`, model `glm-4.7-flash`, environment key `OLLAMA_API_KEY`, and base URL `http://127.0.0.1:11434/v1`. In Docker mode on Docker Desktop, WSL, macOS, or Windows, Code UX rewrites that loopback URL to `host.docker.internal` inside the container.

### OpenCode
```
anthropic/claude-sonnet-4-5, anthropic/claude-opus-4-1, anthropic/claude-haiku-4-5,
openai/gpt-5, openai/gpt-5-mini,
github-copilot/gpt-5,
openrouter/anthropic/claude-sonnet-4.5
```

OpenCode provider-key and custom-endpoint instances generate a per-run OpenCode config. Code UX writes that generated config to a temporary `opencode.json`, sets `OPENCODE_CONFIG`, and maps the saved key to `OPENCODE_API_KEY`. The Custom endpoint preset is Ollama-compatible by default: API key `your_api_key`, provider/model `ollama/glm-4.7-flash`, environment key `OLLAMA_API_KEY`, and base URL `http://127.0.0.1:11434/v1`. In Docker mode on Docker Desktop, WSL, macOS, or Windows, Code UX rewrites that loopback URL to `host.docker.internal` inside the container.

### Default per provider

| Provider | Default model |
| --- | --- |
| Jules | `default` |
| Gemini | `auto` |
| Claude Code | `default` |
| Codex | `gpt-5.3-codex` |
| Qwen | `qwen3-coder-plus` |
| OpenCode | `anthropic/claude-sonnet-4-5` |

Set per-provider model in **Settings → AI providers**.

## Thinking modes

Each provider has a **thinking mode** governing reasoning depth:

- `SMALL` — fastest, lowest cost.
- `MEDIUM` — balanced (default for most providers).
- `HIGH` — deepest reasoning; recommended for `task_coding` on Codex and Claude.

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
| `task_coding` | The actual coding work in subtasks. |
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

A common high-quality setup:

| ID | Provider | Model | Why |
| --- | --- | --- | --- |
| `task_coding` | Codex | `gpt-5.3-codex` | Strong code generation. |
| `planning` | Claude Code | `opus` | Best at structured decomposition. |
| `dashboard_reply` | Gemini | `flash` | Cheap, fast, conversational. |
| `clarification_reply` | Claude Code | `sonnet` | Strong reasoning, lower cost than opus. |
| `qa_review` | Claude Code | `opus` | Thorough review. |
| `ci_fix` | Codex | `gpt-5.3-codex` | Iterative debugging. |
| `merge_conflict` | Codex | `gpt-5.3-codex` | Mechanical merging. |

## Choosing a virtual worker provider

The dashboard exposes a single *virtual worker provider* (`workers.virtualWorkerProvider`) used when the engine spins up an ephemeral worker (e.g. to handle a CI fix attention item). Defaults to `codex`; pick the provider whose CLI is reliably installed and authenticated on the host.

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
| Best raw code generation | `codex` (gpt-5.3-codex / gpt-5.4) |
| Best reasoning / planning | `claude-code` (opus / sonnet[1m]) |
| Cheap, fast iteration | `gemini` (flash) |
| Privacy / on-prem | `qwen-code` (local-model) |
| Multi-model flexibility | `opencode` |
| Agent workbench routing | `antigravity` |

You are encouraged to mix providers via routing rather than picking one for everything.
