# Workspace Setup

## Purpose and scope
Provide a step-by-step guide for workspace setup to ensure a successful onboarding experience. This guide covers the essential steps for configuring a local environment for development.

## Prerequisites
- Node.js 20+
- pnpm
- Git
- Access to the target repository
- A valid Jules API key (if working with MCP or sprint orchestration features)

## Setup Steps
1. Clone the repository to your local machine using `git clone`.
2. Navigate into the cloned directory.
3. Install dependencies by running `pnpm install`.
4. Configure your local environment variables by copying `.env.example` to `.env` and adding your `JULES_API_KEY` and any other required secrets.
5. Build the project using `pnpm run build`.
6. Start the local development server with `pnpm run dev`.

## Expected Result
The repository is successfully cloned, dependencies are installed without errors, the build passes, and the local development server starts successfully and is accessible in a web browser (usually at `http://localhost:4444`).

## Source files involved
- `.env.example`
- `package.json`
- `pnpm-lock.yaml`

## Data flow or behavior summary
The setup process prepares the local filesystem, pulls down required package dependencies, builds the application using the TypeScript compiler and Vite, and starts the development server instance to accept local requests.

## Configuration and defaults
- The default package manager is `pnpm`.
- The default development server port is `4444`.
- Configuration values can be overridden via `.env` or system settings depending on the project setup.

## Failure cases and troubleshooting notes
- If dependencies fail to install, ensure `pnpm` is installed and you are using Node 20+.
- If the build fails with TypeScript errors, try running `pnpm run clean` (if available) or manually deleting `.cache` directories before rebuilding.
- If the development server fails to start due to port conflicts, configure `DASHBOARD_PORT` in your `.env` file to an open port.

## Related links
- [Quickstart](./quickstart.md)
