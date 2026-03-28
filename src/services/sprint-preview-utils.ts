import * as fs from "fs/promises";
import * as path from "path";

export type SprintPreviewPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface SprintPreviewCommandDetection {
  packageManager: SprintPreviewPackageManager;
  installCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
}

interface PackageJsonLike {
  scripts?: Record<string, string>;
}

const PREVIEW_SCRIPT_NAMES = ["preview", "start", "serve"] as const;
const STATIC_DIR_CANDIDATES = ["dist", "build", "out", "public"] as const;

const commandExistsSnippet = (command: string): string => `if ! command -v ${command} >/dev/null 2>&1; then npm install -g ${command}; fi`;

const npmRun = (script: string, args: string[] = []): string => (
  args.length > 0 ? `npm run ${script} -- ${args.join(" ")}` : `npm run ${script}`
);

const pnpmRun = (script: string, args: string[] = []): string => (
  args.length > 0 ? `pnpm ${script} -- ${args.join(" ")}` : `pnpm ${script}`
);

const yarnRun = (script: string, args: string[] = []): string => (
  args.length > 0 ? `yarn ${script} ${args.join(" ")}` : `yarn ${script}`
);

const bunRun = (script: string, args: string[] = []): string => (
  args.length > 0 ? `bun run ${script} -- ${args.join(" ")}` : `bun run ${script}`
);

const getRunCommandFactory = (packageManager: SprintPreviewPackageManager) => {
  switch (packageManager) {
    case "pnpm":
      return pnpmRun;
    case "yarn":
      return yarnRun;
    case "bun":
      return bunRun;
    case "npm":
    default:
      return npmRun;
  }
};

export const normalizePreviewPath = (value: string | null | undefined): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "/";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return `${url.pathname || "/"}${url.search}${url.hash}` || "/";
    } catch {
      return "/";
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

export async function detectSprintPreviewCommands(repoPath: string): Promise<SprintPreviewCommandDetection> {
  const packageManager = await detectPackageManager(repoPath);
  const packageJson = await readPackageJson(repoPath);
  const scripts = packageJson?.scripts || {};
  const runner = getRunCommandFactory(packageManager);

  const installCommand = buildInstallCommand(packageManager);
  const buildCommand = typeof scripts.build === "string" && scripts.build.trim().length > 0
    ? runner("build")
    : null;
  const runCommand = buildRunCommand(packageManager, scripts);

  return {
    packageManager,
    installCommand,
    buildCommand,
    runCommand,
  };
}

export async function detectPackageManager(repoPath: string): Promise<SprintPreviewPackageManager> {
  const checks: Array<{ file: string; packageManager: SprintPreviewPackageManager }> = [
    { file: "pnpm-lock.yaml", packageManager: "pnpm" },
    { file: "yarn.lock", packageManager: "yarn" },
    { file: "bun.lockb", packageManager: "bun" },
    { file: "bun.lock", packageManager: "bun" },
    { file: "package-lock.json", packageManager: "npm" },
  ];

  for (const check of checks) {
    try {
      await fs.access(path.join(repoPath, check.file));
      return check.packageManager;
    } catch {
      continue;
    }
  }

  return "npm";
}

export function buildGeneratedSprintPreviewScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "export SPRINT_PREVIEW_WORKSPACE=\"${SPRINT_PREVIEW_WORKSPACE:-${SPRINT_PREVIEW_WORKTREE:-$PWD}}\"",
    "cd \"$SPRINT_PREVIEW_WORKSPACE\"",
    "export HOST=\"${HOST:-0.0.0.0}\"",
    "export PORT=\"${SPRINT_PREVIEW_PORT:-3000}\"",
    "export DASHBOARD_HOST=\"${DASHBOARD_HOST:-0.0.0.0}\"",
    "export DASHBOARD_PORT=\"${DASHBOARD_PORT:-$PORT}\"",
    "export SPRINT_PREVIEW_PROXY_PORT=\"${SPRINT_PREVIEW_PROXY_PORT:-39000}\"",
    "",
    "start_preview_port_proxy() {",
    "  local listen_port=\"$1\"",
    "  local preferred_upstream_port=\"$2\"",
    "  node - \"$listen_port\" \"$preferred_upstream_port\" <<'NODE' &",
    "const fs = require('fs');",
    "const net = require('net');",
    "const listenPort = Number(process.argv[2]);",
    "const preferredUpstreamPort = Number(process.argv[3]);",
    "const listListeningPorts = () => {",
    "  const ports = new Set();",
    "  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {",
    "    try {",
    "      const lines = fs.readFileSync(file, 'utf8').trim().split(/\\n+/).slice(1);",
    "      for (const line of lines) {",
    "        const cols = line.trim().split(/\\s+/);",
    "        if (cols[3] !== '0A') continue;",
    "        const local = String(cols[1] || '');",
    "        const [, portHex] = local.split(':');",
    "        if (!portHex) continue;",
    "        const port = Number.parseInt(portHex, 16);",
    "        if (Number.isFinite(port)) ports.add(port);",
    "      }",
    "    } catch {}",
    "  }",
    "  return [...ports];",
    "};",
    "const resolveUpstreamPort = () => {",
    "  const ports = listListeningPorts();",
    "  if (ports.includes(preferredUpstreamPort)) return preferredUpstreamPort;",
    "  for (const port of ports) {",
    "    if (port === listenPort) continue;",
    "    return port;",
    "  }",
    "  return preferredUpstreamPort;",
    "};",
    "const server = net.createServer((downstream) => {",
    "  const upstreamPort = resolveUpstreamPort();",
    "  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort });",
    "  downstream.pipe(upstream);",
    "  upstream.pipe(downstream);",
    "  const destroyBoth = () => { downstream.destroy(); upstream.destroy(); };",
    "  downstream.on('error', destroyBoth);",
    "  upstream.on('error', destroyBoth);",
    "});",
    "server.on('error', (error) => {",
    "  console.error(`Sprint preview proxy failed: ${error.message}`);",
    "  process.exit(1);",
    "});",
    "server.listen(listenPort, '0.0.0.0');",
    "NODE",
    "  proxy_pid=$!",
    "}",
    "",
    "if [ -n \"${SPRINT_PREVIEW_INSTALL_COMMAND:-}\" ]; then",
    "  bash -c \"$SPRINT_PREVIEW_INSTALL_COMMAND\"",
    "fi",
    "",
    "if [ -n \"${SPRINT_PREVIEW_BUILD_COMMAND:-}\" ]; then",
    "  bash -c \"$SPRINT_PREVIEW_BUILD_COMMAND\"",
    "fi",
    "",
    "if [ -n \"${SPRINT_PREVIEW_RUN_COMMAND:-}\" ]; then",
    "  proxy_pid=\"\"",
    "  start_preview_port_proxy \"$SPRINT_PREVIEW_PROXY_PORT\" \"$SPRINT_PREVIEW_PORT\"",
    "  bash -c \"$SPRINT_PREVIEW_RUN_COMMAND\" &",
    "  app_pid=$!",
    "  cleanup_preview_runtime() {",
    "    if [ -n \"$proxy_pid\" ]; then kill \"$proxy_pid\" >/dev/null 2>&1 || true; fi",
    "    if [ -n \"${app_pid:-}\" ]; then wait \"$app_pid\" >/dev/null 2>&1 || true; fi",
    "  }",
    "  trap cleanup_preview_runtime EXIT INT TERM",
    "  wait \"$app_pid\"",
    "  exit $?",
    "fi",
    "",
    "for candidate in dist build out public; do",
    "  if [ -d \"$candidate\" ]; then",
    "    if ! command -v serve >/dev/null 2>&1; then npm install -g serve; fi",
    "    exec serve -s \"$candidate\" -l \"$SPRINT_PREVIEW_PORT\"",
    "  fi",
    "done",
    "",
    "echo \"Sprint preview could not determine a runnable preview command.\" >&2",
    "exit 1",
    "",
  ].join("\n");
}

export async function readOptionalSprintPreviewScript(scriptPath: string): Promise<{ exists: boolean; content: string }> {
  try {
    const content = await fs.readFile(scriptPath, "utf8");
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
}

function buildInstallCommand(packageManager: SprintPreviewPackageManager): string | null {
  switch (packageManager) {
    case "pnpm":
      return `${commandExistsSnippet("pnpm")}; pnpm install --prefer-offline --no-frozen-lockfile`;
    case "yarn":
      return "corepack enable >/dev/null 2>&1 || true; yarn install --frozen-lockfile || yarn install";
    case "bun":
      return "if command -v bun >/dev/null 2>&1; then bun install; else npm install; fi";
    case "npm":
    default:
      return "npm ci || npm install";
  }
}

function buildRunCommand(
  packageManager: SprintPreviewPackageManager,
  scripts: Record<string, string>,
): string | null {
  const runner = getRunCommandFactory(packageManager);
  const availableScript = PREVIEW_SCRIPT_NAMES.find((name) => typeof scripts[name] === "string" && scripts[name].trim().length > 0);

  if (availableScript === "preview") {
    const previewArgs = ["--host", "0.0.0.0", "--port", "\"$SPRINT_PREVIEW_PORT\""];
    return `HOST=0.0.0.0 PORT="$SPRINT_PREVIEW_PORT" DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT="$SPRINT_PREVIEW_PORT" ${runner("preview", previewArgs)}`;
  }

  if (availableScript === "start" || availableScript === "serve") {
    return `HOST=0.0.0.0 PORT="$SPRINT_PREVIEW_PORT" DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT="$SPRINT_PREVIEW_PORT" ${runner(availableScript)}`;
  }

  if (typeof scripts.build === "string" && scripts.build.trim().length > 0) {
    return [
      "for candidate in dist build out public; do",
      "  if [ -d \"$candidate\" ]; then",
      "    if ! command -v serve >/dev/null 2>&1; then npm install -g serve; fi",
      "    exec serve -s \"$candidate\" -l \"$SPRINT_PREVIEW_PORT\"",
      "  fi",
      "done",
      "exit 1",
    ].join(" ");
  }

  return null;
}

async function readPackageJson(repoPath: string): Promise<PackageJsonLike | null> {
  try {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as PackageJsonLike;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function resolveStaticPreviewEntry(repoPath: string): Promise<string | null> {
  for (const candidate of STATIC_DIR_CANDIDATES) {
    try {
      await fs.access(path.join(repoPath, candidate));
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
