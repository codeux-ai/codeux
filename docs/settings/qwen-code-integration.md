# Qwen Code Integration

Code UX supports Qwen Code as a first-class virtual CLI provider alongside Gemini, Codex, and Claude Code.

## Provider Identity

- Provider id: `qwen-code`
- Default provider config id: `qwen-code`
- Default local auth path: `~/.qwen`
- Default model: `qwen3-coder-plus`
- Docker fallback install: `npm install -g @qwen-code/qwen-code`

Qwen Code can be selected anywhere a virtual CLI provider is accepted: task coding, planning, dashboard replies, clarification replies, QA review, CI repair, and merge-conflict repair.

## Authentication Modes

The system integration entry for each named Qwen instance stores a `qwenAuthMode`.

### Local Auth

`LOCAL_AUTH` copies the host Qwen directory into Docker when `mountAuth` is enabled.

This mode is intended for Qwen OAuth credentials created by:

```bash
qwen auth qwen-oauth
```

The runtime mounts the configured `authPath` to `/opt/credentials/qwen-code` and copies it into `$HOME/.qwen` inside the provider container.

### Alibaba Cloud Coding Plan

`ALIBABA_CODING_PLAN` uses the dedicated Coding Plan API key and region.

- China endpoint: `https://coding.dashscope.aliyuncs.com/v1`
- International endpoint: `https://coding-intl.dashscope.aliyuncs.com/v1`
- Environment key: `BAILIAN_CODING_PLAN_API_KEY`

The Qwen runner launches with `--auth-type openai` and sets `OPENAI_BASE_URL` to the selected Coding Plan endpoint so non-interactive Docker runs can use the configured key.

### Custom Model Provider

`MODEL_PROVIDER` is for Qwen Code `modelProviders` style setup. Each instance can define:

- protocol: `openai`, `anthropic`, or `gemini`
- environment key
- base URL
- API key
- model id registered in Qwen Code `modelProviders`

For OpenAI-compatible providers, Code UX also forwards `OPENAI_API_KEY` and `OPENAI_BASE_URL` to the Qwen process. This covers DashScope compatible mode, OpenRouter, Ollama, vLLM, LM Studio, and similar endpoints.

Custom endpoint instances appear on the AI Models page with their configured model id, such as `glm-4.7-flash`, instead of stale placeholders such as `custom/model` or `local-model`.

Qwen Code custom provider failures use the shared CLI provider error classifier. OpenRouter key exhaustion messages such as `API Error: 403 Key limit exceeded (weekly limit)` are treated as `QUOTA_EXHAUSTED`, so affected runs enter the same quota handling path as Codex, Gemini, Claude Code, and other CLI providers. When the gateway does not include a concrete reset time, Code UX records the task as quota-limited without an active retry timestamp.

When Custom endpoint is selected for a fresh Qwen instance, the settings form pre-fills an Ollama-compatible local endpoint:

- API key: `your_api_key`
- Base URL: `http://127.0.0.1:11434/v1`
- Environment key: `OLLAMA_API_KEY`
- Model id: `glm-4.7-flash`
- Protocol: `openai`

## Docker Runtime

Docker execution prepares Qwen in the same bootstrap path as other CLI providers:

- creates `$HOME/.qwen`
- copies mounted local auth from `/opt/credentials/qwen-code`
- merges generated MCP/settings fragments from `/opt/provider-config/qwen-settings.json`
- writes generated `modelProviders`, selected model, and MCP settings into the mounted settings fragment for custom endpoint and Coding Plan runs
- rewrites loopback URLs in generated Qwen settings from `127.0.0.1` or `localhost` to `host.docker.internal` on Docker Desktop, WSL, macOS, and Windows so local endpoints such as Ollama remain reachable from the provider container
- installs Qwen Code if `qwen` is missing and fallback installs are enabled

The bootstrap merge is additive and preserves existing `mcpServers` entries.

## Session Continuation

Qwen Code stores saved chat sessions under `$HOME/.qwen/projects/<sanitized-cwd>/chats`. In Docker mode, Code UX sets `$HOME` to `/workspace/.code-ux-home`, so those saved sessions live inside the Docker workspace volume rather than inside the short-lived provider container.

Code UX does not pass its logical session ids to `qwen --resume <id>`. Those ids are not guaranteed to be Qwen saved-session ids and can produce errors such as `No saved session found with ID ...`. Instead, continuation uses Qwen's project-scoped `--continue` flag, which resumes the most recent saved Qwen session for the current workspace.

For Qwen runs where Code UX has to create a Docker workspace from a repo path, the workspace volume is preserved and reused for the same logical session. This keeps `/workspace/.code-ux-home/.qwen` stable across short-lived provider containers, so planning retries, dashboard chat turns, and follow-up provider invocations can continue the same Qwen session.

Dashboard chat continuations pass the previous logical chat session as `continueSessionId` even when native MCP is enabled, so Qwen receives `--continue` on follow-up turns. Chat prompts also mark dashboard user messages with `### User` and instruct Qwen to ignore provider setup text when answering questions about prior user messages.

During Docker bootstrap and host settings materialization, Code UX removes the legacy root-level `enableOpenAILogging` key from persisted Qwen settings and keeps the supported `model.enableOpenAILogging` setting. If an older Qwen process still emits the deprecation warning inline with the reply, invocation output sanitization strips the warning before it reaches the dashboard.

## External Hints

Code UX detects Qwen credentials from:

- `DASHSCOPE_API_KEY`
- `BAILIAN_CODING_PLAN_API_KEY`
- `QWEN_API_KEY`
- local files under `~/.qwen`

Detected keys and local auth availability are surfaced in the Integrations settings page so they can be imported into named provider instances.

## Dashboard Settings

The v2 Integrations page exposes Qwen-specific setup panels:

- Local auth path and Docker copy toggle
- Alibaba Cloud Coding Plan region and endpoint preview
- Custom provider protocol, env key, base URL, and masked generated `settings.json` preview

Provider routing remains instance-based: multiple Qwen instances can coexist, each with its own auth mode, API key, mount path, model, weight, and route overrides.
