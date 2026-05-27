# Workspace Setup

## Purpose and scope
Provide a step-by-step guide for workspace setup to ensure a successful onboarding experience. This guide covers the essential environment configuration steps needed before running the application locally.

## Prerequisites
- Node.js 18+
- pnpm
- Git
- Access to the target repository
- A valid Jules API key (required for MCP and orchestration features)

## Steps
1. Clone the repository using `git clone` and navigate into the directory.
2. Install dependencies by running `pnpm install`.
3. Copy `.env.example` to `.env` in the root directory.
4. Configure your API key. You can do this by setting `JULES_API_KEY` in the `.env` file, passing it via the `--api-key` CLI argument, or adding it to `.jules-subagents/settings.json`.
5. (Optional) If port 4444 is already in use on your machine, configure a custom port by setting `DASHBOARD_PORT=4445` in your `.env` file.
6. Verify your setup by running `pnpm run dev` and confirming the server starts without configuration errors.

## Expected Result
Dependencies install correctly, the `.env` file contains your Jules API key, any required port overrides are set, and running `pnpm run dev` successfully launches the local development server (typically available at `http://localhost:4444` unless overridden).

## Configuration and defaults
- The default package manager is `pnpm`.
- The default development server port is `4444`.
- Configuration values can be overridden via `.env` or system settings depending on the project setup.

## Failure cases and troubleshooting notes
- If dependencies fail to install, ensure `pnpm` is installed and you are using Node 18+.
- If the development server fails to start due to port conflicts, configure `DASHBOARD_PORT` in your `.env` file to an open port (e.g., 4445).
- If you encounter a `Jules API Key is missing` error on startup, verify that `JULES_API_KEY` is correctly set in your `.env` file or passed via CLI argument.

## Related links
- [Overview](./overview.md)

## Technical Reference
### Source files involved
- `.env.example`
- `package.json`
- `pnpm-lock.yaml`

### Data flow or behavior summary
The setup process prepares the local filesystem, pulls down required package dependencies, and establishes the runtime environment configuration needed for the Vite development server and Node backend to operate correctly.