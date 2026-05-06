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
- model id from the AI Models routing panel

For OpenAI-compatible providers, Code UX also forwards `OPENAI_API_KEY` and `OPENAI_BASE_URL` to the Qwen process. This covers DashScope compatible mode, OpenRouter, Ollama, vLLM, LM Studio, and similar endpoints.

## Docker Runtime

Docker execution prepares Qwen in the same bootstrap path as other CLI providers:

- creates `$HOME/.qwen`
- copies mounted local auth from `/opt/credentials/qwen-code`
- merges generated MCP/settings fragments from `/opt/provider-config/qwen-settings.json`
- installs Qwen Code if `qwen` is missing and fallback installs are enabled

The bootstrap merge is additive and preserves existing `mcpServers` entries.

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
