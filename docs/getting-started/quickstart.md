# Quickstart

This guide gets the MCP server and dashboard running locally with minimal setup.

## Prerequisites

- Node.js 22.13+
- pnpm 11.13.1 (only for building from source)
- A valid Jules API key
- Optional for remote git intelligence: GitHub CLI (`gh`) authenticated

## Install and Build (from source)

```bash
git clone https://github.com/codeux-ai/codeux.git
cd codeux
pnpm install
pnpm run build
```

## Configure API Key

Use one of these methods:

1. CLI argument (highest priority)
```bash
node dist/index.js --api-key YOUR_KEY
```

2. Environment variable
```bash
export JULES_API_KEY=YOUR_KEY
pnpm start
```

3. `.env` file in project root
```env
JULES_API_KEY=YOUR_KEY
```

4. `.code-ux/settings.json` (project or home)
```json
{
  "julesApiKey": "YOUR_KEY"
}
```

## Run in Development

```bash
pnpm run dev
```

This starts the server directly from TypeScript source through Node's `ts-node` ESM register hook, so local development uses the same `.js` import specifiers as the production build without requiring a precompile step.

## Run Compiled Server

```bash
pnpm run build
pnpm start
```

## Open Dashboard

Default URL:
- `http://localhost:4444`

The dashboard starts automatically when the server starts.
If `4444` is occupied, startup automatically retries `4445`, `4446`, and so on.

## Verify Health via API Endpoints

From another terminal:

```bash
curl http://localhost:4444/api/status
curl http://localhost:4444/api/system-settings
curl http://localhost:4444/api/git-status
```

## Common First Workflow

1. Configure system settings in dashboard, then adjust project settings and sprint overrides as needed.
2. Create the sprint and tasks. Code UX now prepares the local feature branch automatically when orchestration starts, and it will attempt to push that branch to `origin` when the remote exists.
3. Create the sprint tasks in the dashboard, or import them from markdown if you are bringing in an existing sprint plan.
4. Connect your worker with `listen` so it can monitor inbox, dispatch, and attention events for the project.
5. Start the sprint from the dashboard.
6. Follow merge/action-required protocol shown in dashboard and resume the sprint there when manual work is finished.

## Troubleshooting

- `Jules API Key is missing`
  - Confirm key source and priority order.
- Dashboard port in use
  - Set `DASHBOARD_PORT` in `.env` (e.g., `DASHBOARD_PORT=5555 pnpm run dev`), or configure `dashboardPort` in `config.json` or System Settings.

### Advanced Start Options

For local headless runs, you can pass `--headless` or `--no-dashboard`. For authenticated MCP-only server processes, use `--server-mode` or `CODE_UX_SERVER_MODE=true` with an explicit MCP HTTP bearer token. MCP HTTP gateway flags (`--mcp-https`, `--mcp-https-port`, etc.; legacy names) remain supported. See the [Installation CLI Flags](../docs-web/user/installation.md#cli-flags) reference for the complete list.
- Remote mode has no PR/CI data
  - Verify `gh` is installed and authenticated.

For operational issues, see [Operations Runbook](../operations/runbook.md).
