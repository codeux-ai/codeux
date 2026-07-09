#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const START_PORT = 4544;
const END_PORT = 4644;

async function canFetchHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(250),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function canBindPort(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

async function findDashboardPort() {
  const explicit = Number.parseInt(process.env.CODEUX_E2E_DASHBOARD_PORT ?? '', 10);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  for (let port = START_PORT; port < END_PORT; port += 2) {
    const dashboardAvailable = !await canFetchHealth(port) && await canBindPort(port);
    const mcpAvailable = await canBindPort(port + 1);
    if (dashboardAvailable && mcpAvailable) {
      return port;
    }
  }
  throw new Error(`No available E2E dashboard/MCP port pair found in ${START_PORT}-${END_PORT}.`);
}

const dashboardPort = await findDashboardPort();
const mockProviderCliPath = path.resolve(process.cwd(), 'scripts/e2e/mock-provider-cli.mjs');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const pnpmArgs = ['exec', 'playwright', 'test', ...process.argv.slice(2)];

function resolvePnpmInvocation(command, args) {
  if (process.platform !== 'win32' || !process.env.PNPM_HOME) {
    return { command, args };
  }

  const pnpmCliPath = path.resolve(process.env.PNPM_HOME, '..', 'pnpm', 'bin', 'pnpm.cjs');
  if (!existsSync(pnpmCliPath)) {
    return { command, args };
  }

  return { command: process.execPath, args: [pnpmCliPath, ...args] };
}

const invocation = resolvePnpmInvocation(pnpmCommand, pnpmArgs);
const child = spawn(invocation.command, invocation.args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CODEUX_E2E_DASHBOARD_PORT: String(dashboardPort),
    CODEUX_E2E_PROVIDER_CLI_SHIM: process.env.CODEUX_E2E_PROVIDER_CLI_SHIM || mockProviderCliPath,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
