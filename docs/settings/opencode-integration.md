# OpenCode Integration

Code UX supports OpenCode as a first-class virtual CLI provider alongside Gemini, Codex, Claude Code, and Qwen Code.

## Runtime Contract

- Provider id: `opencode`
- Default provider config id: `opencode`
- Default local auth path: `~/.local/share/opencode`
- Default model: `anthropic/claude-sonnet-4-5`
- Docker fallback install: `curl -fsSL https://opencode.ai/install | bash`
- Non-interactive command: `opencode run --model <provider/model> <prompt>`

OpenCode can be selected anywhere a virtual CLI provider is accepted: task coding, planning, dashboard replies, clarification replies, QA review, CI repair, and merge-conflict repair.

## Authentication Modes

Each named OpenCode provider instance stores an `openCodeAuthMode`.

### Local Auth

`LOCAL_AUTH` copies the host OpenCode auth directory into Docker when `mountAuth` is enabled.

This mode is intended for credentials created by OpenCode's `/connect` flow or `opencode auth login`.

The runtime mounts the configured `authPath` to `/opt/credentials/opencode` and copies it into `$HOME/.local/share/opencode` inside the provider container. The default path is `~/.local/share/opencode`, where OpenCode stores `auth.json`.

### Provider Key

`ENV_KEY` configures a built-in OpenCode provider with an API key. The selected model remains a normal OpenCode `provider/model` value, such as:

```text
anthropic/claude-sonnet-4-5
openai/gpt-5
github-copilot/gpt-5
```

Code UX builds an inline OpenCode config in `OPENCODE_CONFIG_CONTENT`, writes it to a per-run `opencode.json`, points OpenCode at it with `OPENCODE_CONFIG`, and maps the stored provider key to `OPENCODE_API_KEY`. The configured `openCodeEnvKey` is still used as an import hint when the saved key is empty.

### Custom Provider

`CUSTOM_PROVIDER` generates an OpenCode provider entry for OpenAI-compatible endpoints:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "custom": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "custom",
      "options": {
        "baseURL": "https://api.example.com/v1",
        "apiKey": "{env:OPENCODE_API_KEY}"
      },
      "models": {
        "model": {
          "name": "model"
        }
      }
    }
  },
  "model": "custom/model"
}
```

This covers OpenRouter, LiteLLM, Ollama, vLLM, LM Studio, private gateways, and other OpenAI-compatible services.

## MCP Tools

OpenCode reads MCP servers from the `mcp` section of its config. Code UX includes the management MCP server in the same generated config payload used for provider settings:

```json
{
  "mcp": {
    "code_ux": {
      "type": "remote",
      "url": "http://127.0.0.1:4444/mcp",
      "enabled": true
    }
  }
}
```

When the runtime connection has a bearer token, Code UX includes an `Authorization` header in that MCP entry.

## Docker Execution

Docker execution prepares OpenCode in the shared CLI bootstrap path:

- creates `$HOME/.local/share/opencode` and `$HOME/.config/opencode`
- copies mounted local auth from `/opt/credentials/opencode`
- passes `OPENCODE_API_KEY` and `OPENCODE_CONFIG_CONTENT` into the container
- writes `OPENCODE_CONFIG_CONTENT` to `$HOME/.config/opencode/opencode.json` and exports `OPENCODE_CONFIG` before running `opencode`
- rewrites loopback URLs in generated OpenCode config from `127.0.0.1` or `localhost` to `host.docker.internal` on Docker Desktop, WSL, macOS, and Windows so local endpoints such as Ollama remain reachable from the provider container
- installs OpenCode if `opencode` is missing and fallback installs are enabled

Host execution writes the generated config to `.code-ux/tmp/opencode-config-<session>.json` for the duration of the run and sets `OPENCODE_CONFIG` to that path. The generated config is never written into a permanent host OpenCode config file. This keeps one named Code UX provider instance from overwriting another instance's OpenCode settings.

## Dashboard Surface

The v2 Integrations page exposes OpenCode-specific setup panels:

- local auth copy from `~/.local/share/opencode`
- built-in provider key setup for standard OpenCode providers
- custom OpenAI-compatible endpoint setup with provider id, model id, package, base URL, and environment-key import hint
- masked generated config preview

Provider routing remains instance-based: multiple OpenCode instances can coexist, each with its own auth mode, API key, mount path, custom endpoint, model, weight, and route overrides. Custom endpoint instances appear on the AI Models page with their generated `provider/model` selector, such as `ollama/glm-4.7-flash`, instead of the placeholder `custom/model`.
