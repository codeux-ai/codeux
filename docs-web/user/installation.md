# Installation

Code UX ships as the `codeux` npm package. There are two supported installation paths:

1. **Global install** — recommended for most users. Lets you run `codeux` (or `npx codeux`) from anywhere.
2. **From source** — recommended for contributors and anyone customising the engine.

## Prerequisites

| Requirement | Why |
| --- | --- |
| **Node.js 22 LTS** or later | Code UX targets Node 22 in CI and uses ES2022 / NodeNext modules. |
| **Git ≥ 2.30** | The orchestrator manages worktrees, branches, and merges. |
| **A Jules API key** *(optional but recommended)* | Required to dispatch work to the hosted Jules Agent API. Without it, you must use virtual workers (Gemini, Codex, Claude Code, Qwen Code, or OpenCode CLIs). |
| **Docker** *(optional)* | Required only if you run virtual workers in `DOCKER` execution mode (default is `HOST`). Also required for sprint preview browsers. |
| **GitHub CLI (`gh`)** *(optional)* | Used by the merge protocol when `githubMode` is `REMOTE`. |

If you plan to use a CLI provider as a virtual worker, you must install that provider's CLI separately and authenticate it. See [Providers and models](./providers-and-models.md).

## Option 1 — Global install (recommended)

```bash
npm install -g codeux
```

Verify it is on your `PATH`:

```bash
codeux --help
```

You should see the option list ending with environment variable descriptions.

> **Tip:** If you do not want a global install, you can always run the package on demand with `npx -y codeux`. This is what most MCP client configurations use.

## Option 2 — From source

```bash
git clone https://github.com/codeux-ai/codeux.git
cd codeux
pnpm install
cp .env.example .env
# Edit .env and set JULES_API_KEY
pnpm run build
```

Then either run from `dist/`:

```bash
node dist/index.js --api-key YOUR_KEY
```

or globally link:

```bash
pnpm link --global
codeux --help
```

For details on the test and CI workflow, see [Building from source](../developer/building-from-source.md).

## Configuring the API key

Code UX resolves the Jules API key in this order, highest priority first:

1. CLI flag: `--api-key <key>`
2. Environment variable: `JULES_API_KEY`
3. Environment variable: `JULES_KEY`
4. Settings files at any location in the [config search path](../developer/configuration.md#config-search-path), under any of these keys: `julesApiKey`, `JULES_API_KEY`, `julesKey`, `JULES_KEY`.

The simplest setup is a project-local `.env` file:

```bash
# .env
JULES_API_KEY=sk-jules-...
DASHBOARD_PORT=4444
```

Or a settings file in your home directory:

```jsonc
// ~/.code-ux/settings.json
{
  "julesApiKey": "sk-jules-..."
}
```

> Code UX reads from both `~/.code-ux/` (current naming) and `~/.jules-subagents/` (legacy). New installations should use `.code-ux`.

## Provider CLI installation (for virtual workers)

If you plan to use any non-Jules provider, install and authenticate that provider's CLI before launching Code UX. Code UX detects auth automatically by looking at:

| Provider | Detected at |
| --- | --- |
| Gemini CLI | `~/.gemini/` |
| Codex CLI | `~/.codex/` |
| Claude Code CLI | `~/.claude/` |
| Qwen Code CLI | `~/.qwen/` |
| OpenCode CLI | `~/.local/share/opencode/` or `~/.config/opencode/` |

You can enable provider auth mounting (so the worker container can use your local credentials) per provider in the dashboard's **Settings → Providers** panel.

## Running Code UX

Once installed, the simplest way to start everything is:

```bash
codeux
```

This starts:

- The MCP server on **stdio** (only consumed if Code UX was invoked from an MCP client; ignored when stdin is a TTY).
- The dashboard on `http://localhost:4444`.

To run **headless** (no dashboard), useful when Code UX is launched as a child process by an MCP client:

```bash
codeux --headless
```

To enable the **remote MCP HTTP gateway** so external workers can connect:

```bash
codeux --mcp-http --mcp-http-auth-token "$(openssl rand -hex 32)"
```

See the full flag reference in [Configuration & CLI](../developer/configuration.md).

## Updating

```bash
# Global install
npm update -g codeux

# Source
cd codeux
git pull
pnpm install
pnpm run build
```

## Uninstall

```bash
npm uninstall -g codeux
rm -rf ~/.code-ux ~/.jules-subagents
```

This removes the binary and home-directory settings, but does **not** touch project-local `.code-ux/` or `.jules-subagents/` directories. Remove those manually per project if desired.
