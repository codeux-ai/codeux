# OpenCode Integration

Code UX supports OpenCode as a first-class virtual CLI provider alongside Gemini, Codex, Claude Code, and Qwen Code.

## Runtime Contract

- Provider id: `opencode`
- Default provider config id: `opencode`
- Default local auth path: `~/.local/share/opencode`
- Default model: `anthropic/claude-sonnet-4-5`
- Docker fallback install: `curl -fsSL https://opencode.ai/install | bash`
- Non-interactive command: `opencode run --format json --dir <workspace> --model <provider/model> <prompt>`

OpenCode can be selected anywhere a virtual CLI provider is accepted: task coding, planning, dashboard replies, clarification replies, QA review, CI repair, and merge-conflict repair.

Planning routes use the same named OpenCode provider instance settings as chat and task execution. When sprint planning or prompt improvement resolves to OpenCode, Code UX forwards the selected instance's auth mode, provider id, model id, base URL, environment key, npm package, auth mount settings, and selected model into the structured provider runner before invoking `opencode run`.

## Authentication Modes

Each named OpenCode provider instance stores an `openCodeAuthMode` (`LOCAL_AUTH`, `ENV_KEY`, or `CUSTOM_PROVIDER`). API-key mode can use `ENV_KEY` or `CUSTOM_PROVIDER`; local/dashboard auth forces `openCodeAuthMode` to `LOCAL_AUTH`.

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

Code UX builds an inline OpenCode config in `OPENCODE_CONFIG_CONTENT`, writes it to a per-run `opencode.json`, points OpenCode at it with `OPENCODE_CONFIG`, and maps the broker-resolved provider credential to `OPENCODE_API_KEY` for that invocation. The configured `openCodeEnvKey` identifies the runtime environment key; it does not resolve or import a value into settings.
The generated config sets `permission` to `"allow"` for headless Code UX runs so OpenCode file edits and shell actions do not wait for an interactive approval prompt.

### Custom Provider

`CUSTOM_PROVIDER` generates an OpenCode provider entry for OpenAI-compatible endpoints. The selected model becomes `<openCodeProviderId>/<openCodeModelId>`, not the placeholder `custom/model`.

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

OpenCode provider failures use the shared CLI provider error classifier. OpenRouter key exhaustion messages such as `API Error: 403 Key limit exceeded (weekly limit)` are treated as `QUOTA_EXHAUSTED`, so affected runs enter the same quota handling path as other CLI providers. When the gateway does not include a concrete reset time, Code UX records the task as quota-limited without an active retry timestamp.

When Custom endpoint is selected for a fresh OpenCode instance, the settings form pre-fills an Ollama-compatible local endpoint:

- Provider id: `ollama`
- Model id: `glm-4.7-flash`
- Base URL: `http://127.0.0.1:11434/v1`
- Environment key: `OLLAMA_API_KEY`

If the endpoint requires a secret, create or select it through the write-only credential manager. Ordinary provider settings serialize only its credential reference.

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

- mounts the task Git checkout at `/workspace` and the provider runtime home at `/code-ux-runtime-home`
- creates `$HOME/.local/share/opencode` and `$HOME/.config/opencode`
- copies mounted local auth from `/opt/credentials/opencode`
- passes `OPENCODE_API_KEY` and `OPENCODE_CONFIG_CONTENT` into the container
- writes `OPENCODE_CONFIG_CONTENT` to `$HOME/.config/opencode/opencode.json` and exports `OPENCODE_CONFIG` before running `opencode`
- invokes OpenCode with `--dir /workspace`; generated config permissions allow headless task runs to edit the isolated workspace instead of stopping on tool approval
- keeps OpenCode's database and internal snapshot Git store under `/code-ux-runtime-home/.local/share/opencode`, outside the worktree OpenCode snapshots
- rewrites loopback URLs in generated OpenCode config from `127.0.0.1` or `localhost` to `host.docker.internal` on Docker Desktop, WSL, macOS, Windows, and Linux Docker runs with loopback MCP or model endpoints so local endpoints such as Ollama remain reachable from the provider container
- installs OpenCode if `opencode` is missing and fallback installs are enabled

Host execution writes the generated config to `.code-ux/tmp/opencode-config-<session>.json` for the duration of the run and sets `OPENCODE_CONFIG` to that path. Host runs also pass `--dir <worktree>`. The generated config is never written into a permanent host OpenCode config file. This keeps one named Code UX provider instance from overwriting another instance's OpenCode settings.

OpenCode JSON retry continuation uses native OpenCode session ids only when the CLI reports one in JSON events such as `session.created` or `session.status`. If a retry only has Code UX's logical session id, Code UX invokes `opencode run --continue` instead of `opencode run --session <logical-id>` so OpenCode resumes the latest session without raising `Session not found`.

If OpenCode rejects a real native session id with `Session not found`, Code UX retries once in the same preserved workspace without `--session` or `--continue`. This keeps the failed worktree available while letting OpenCode create a fresh local session instead of failing the task solely because its session store no longer contains the prior id.

After a successful run, Code UX reads `opencode export <sessionID>` when a native session id is available. The export supplies session-cumulative `info.tokens` and `info.cost`; the stats page uses configured model-pricing rates first, then falls back to this provider-reported cost when no catalogue or override rate matches the stored OpenCode model id.

## Dashboard Surface

The v2 Integrations page exposes OpenCode-specific setup panels:

- local auth copy from `~/.local/share/opencode`
- built-in provider key setup for standard OpenCode providers
- custom OpenAI-compatible endpoint setup with provider id, model id, package, base URL, runtime environment-key name, and broker credential binding
- masked generated config preview

Provider routing remains instance-based: multiple OpenCode instances can coexist, each with its own auth mode, credential reference, mount path, custom endpoint, model, weight, and route overrides. Custom endpoint instances appear on the AI Models page with their generated `provider/model` selector, such as `ollama/glm-4.7-flash`, instead of the placeholder `custom/model`.
