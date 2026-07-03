import * as fs from "fs/promises";
import * as path from "path";
import { resolveConfiguredPath } from "./cli-docker-utils.js";

export type SprintPreviewPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface SprintPreviewCommandDetection {
  packageManager: SprintPreviewPackageManager;
  installCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
}

export interface SprintPreviewCommandSource {
  exists(filePath: string): Promise<boolean>;
  readTextFile(filePath: string): Promise<string>;
  listFiles?(): Promise<string[]>;
}

interface PackageJsonLike {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const PREVIEW_SCRIPT_NAMES = ["preview", "start", "serve", "dev"] as const;
const STATIC_DIR_CANDIDATES = ["dist", "build", "out", "public"] as const;
const WORKSPACE_PACKAGE_DIRS = ["apps", "packages", "frontend", "client", "web"] as const;
const WEB_DEV_SCRIPT_PATTERN = /\b(vite|next\s+dev|astro\s+dev|nuxt\s+dev|remix\s+dev|webpack(?:-dev-server)?|rspack(?:\s+serve)?|rsbuild\s+dev|parcel|expo\s+start|react-scripts\s+start|vite-node)\b/i;
const WEB_RUNTIME_SCRIPT_PATTERN = /\b(vite|next|astro|nuxt|remix|webpack(?:-dev-server)?|rspack|rsbuild|parcel|serve|http-server|sirv|wrangler|node|tsx|ts-node)\b/i;

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
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    throw new Error("Absolute and protocol-relative URLs are not allowed.");
  }
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    throw new Error("Control characters are not allowed in preview paths.");
  }
  try {
    const url = new URL(trimmed, "http://localhost");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    throw new Error("Malformed preview path.");
  }
};

export async function detectSprintPreviewCommands(repoPath: string, source?: SprintPreviewCommandSource): Promise<SprintPreviewCommandDetection> {
  const packageManager = await detectPackageManager(repoPath, source);
  const packageJson = await readPackageJson(repoPath, source);
  const scripts = packageJson?.scripts || {};
  const runner = getRunCommandFactory(packageManager);

  const installCommand = buildInstallCommand(packageManager);
  const rootRuntime = buildRunCommand(packageManager, scripts, "", false);
  const workspacePackageJsonPaths = rootRuntime ? [] : await listWorkspacePackageJsonPaths(repoPath, source);
  const workspaceRuntime = rootRuntime
    ? null
    : await detectWorkspacePreviewRuntime(repoPath, packageManager, source, workspacePackageJsonPaths);
  const runtime = rootRuntime || workspaceRuntime;
  const hasWorkspacePackages = Boolean(packageJson?.workspaces) || workspacePackageJsonPaths.length > 0;
  const buildCommand = runtime?.scriptName === "dev"
    ? null
    : buildBuildCommand(packageManager, runtime?.packageDir || "", runtime?.scripts || scripts, hasWorkspacePackages);
  let runCommand = runtime?.command
    || (!hasWorkspacePackages && buildCommand ? buildStaticFallbackRunCommand() : null);

  if (!runCommand) {
    // Fallback: Check for common entry files if no script is found in package.json
    const entries = ["server.js", "app.js", "index.js", "src/server.js", "src/index.js"];
    for (const entry of entries) {
      if (await fileExists(repoPath, entry, source)) {
        runCommand = `node ${entry}`;
        break;
      }
    }
  }

  return {
    packageManager,
    installCommand,
    buildCommand,
    runCommand,
  };
}

export async function detectPackageManager(repoPath: string, source?: SprintPreviewCommandSource): Promise<SprintPreviewPackageManager> {
  const checks: Array<{ file: string; packageManager: SprintPreviewPackageManager }> = [
    { file: "pnpm-lock.yaml", packageManager: "pnpm" },
    { file: "pnpm-workspace.yaml", packageManager: "pnpm" },
    { file: "yarn.lock", packageManager: "yarn" },
    { file: "bun.lockb", packageManager: "bun" },
    { file: "bun.lock", packageManager: "bun" },
    { file: "package-lock.json", packageManager: "npm" },
  ];

  for (const check of checks) {
    if (await fileExists(repoPath, check.file, source)) {
      return check.packageManager;
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
    "  echo \"[preview] Starting port proxy on $listen_port (preferring upstream $preferred_upstream_port)...\"",
    "  node - \"$listen_port\" \"$preferred_upstream_port\" <<'NODE' &",
    "const fs = require('fs');",
    "const net = require('net');",
    "const listenPort = Number(process.argv[2]);",
    "const preferredUpstreamPort = Number(process.argv[3]);",
    "const listListeningPorts = () => {",
    "  const ports = new Set();",
    "  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {",
    "    try {",
    "      const content = fs.readFileSync(file, 'utf8').trim();",
    "      if (!content) continue;",
    "      const lines = content.split(/\\n+/).slice(1);",
    "      for (const line of lines) {",
    "        const cols = line.trim().split(/\\s+/);",
    "        if (cols[3] !== '0A') continue;",
    "        const localAddress = String(cols[1] || '');",
    "        const [, portHex] = localAddress.split(':');",
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
    "  const commonPorts = [3000, 5173, 8080, 8000, 3001, 5000, 8081, 4200];",
    "  for (const port of commonPorts) {",
    "    if (ports.includes(port) && port !== listenPort) return port;",
    "  }",
    "  for (const port of ports) {",
    "    if (port === listenPort) continue;",
    "    return port;",
    "  }",
    "  return preferredUpstreamPort;",
    "};",
    "const server = net.createServer((downstream) => {",
    "  if (!downstream.writable) return;",
    "  const upstreamPort = resolveUpstreamPort();",
    "  const tryConnect = (host, fallback) => {",
    "    const socket = net.connect({ host, port: upstreamPort });",
    "    let handled = false;",
    "    const destroyBoth = () => { downstream.destroy(); socket.destroy(); };",
    "    socket.on('connect', () => {",
    "      handled = true;",
    "      if (!downstream.writable) {",
    "        socket.destroy();",
    "        return;",
    "      }",
    "      downstream.pipe(socket);",
    "      socket.pipe(downstream);",
    "      downstream.on('error', destroyBoth);",
    "      socket.on('error', destroyBoth);",
    "      downstream.on('close', destroyBoth);",
    "      socket.on('close', destroyBoth);",
    "    });",
    "    socket.on('error', () => {",
    "      if (!handled) {",
    "        handled = true;",
    "        socket.destroy();",
    "        fallback ? fallback() : downstream.destroy();",
    "      }",
    "    });",
    "  };",
    "  tryConnect('127.0.0.1', () => {",
    "    tryConnect('::1', () => {",
    "      downstream.destroy();",
    "    });",
    "  });",
    "});",
    "server.on('error', (error) => {",
    "  console.error(`[preview] Proxy server error: ${error.message}`);",
    "  process.exit(1);",
    "});",
    "server.listen(listenPort, '0.0.0.0', () => {",
    "  console.log(`[preview] Proxy listening on 0.0.0.0:${listenPort}`);",
    "});",
    "NODE",
    "  proxy_pid=$!",
    "}",
    "",
    "proxy_pid=\"\"",
    "app_pid=\"\"",
    "",
    "cleanup_preview_runtime() {",
    "  echo \"[preview] Cleaning up preview runtime...\"",
    "  set +e",
    "  if [ -n \"$proxy_pid\" ]; then",
    "    echo \"[preview] Killing proxy (PID $proxy_pid)...\"",
    "    kill \"$proxy_pid\" >/dev/null 2>&1 || true",
    "  fi",
    "  if [ -n \"$app_pid\" ]; then",
    "    echo \"[preview] Killing app (PID $app_pid)...\"",
    "    kill \"$app_pid\" >/dev/null 2>&1 || true",
    "    wait \"$app_pid\" >/dev/null 2>&1 || true",
    "  fi",
    "  echo \"[preview] Cleanup complete.\"",
    "}",
    "trap cleanup_preview_runtime EXIT INT TERM",
    "",
    "# Dependency/build caching. node_modules and build output live in the per-sprint",
    "# Docker volume, which survives container removal and dashboard restarts. We only",
    "# re-run install when the dependency manifests change, and only re-run the build when",
    "# the source commit changes — keeping warm restarts cheap. Any missing stamp or",
    "# artifact falls back to a full build, so the cache can never serve stale output.",
    "preview_install_stamp=\"$SPRINT_PREVIEW_WORKSPACE/.code-ux-preview-install.stamp\"",
    "preview_build_stamp=\"$SPRINT_PREVIEW_WORKSPACE/.code-ux-preview-build.stamp\"",
    "",
    "preview_dependency_signature() {",
    "  local manifests=\"\"",
    "  local f",
    "  for f in package.json package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock bun.lockb; do",
    "    [ -f \"$f\" ] && manifests=\"$manifests $f\"",
    "  done",
    "  if [ -z \"$manifests\" ]; then echo \"no-manifest\"; return 0; fi",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    cat $manifests | sha256sum | awk '{print $1}'",
    "  else",
    "    cat $manifests | cksum | awk '{print $1\"-\"$2}'",
    "  fi",
    "}",
    "",
    "if [ -n \"${SPRINT_PREVIEW_INSTALL_COMMAND:-}\" ]; then",
    "  preview_install_signature=\"$(preview_dependency_signature)\"",
    "  if [ -d node_modules ] && [ -f \"$preview_install_stamp\" ] && [ \"$(cat \"$preview_install_stamp\" 2>/dev/null)\" = \"$preview_install_signature\" ]; then",
    "    echo \"[preview] Dependencies unchanged; reusing cached node_modules (skipping install).\"",
    "  else",
    "    echo \"[preview] Running install command: $SPRINT_PREVIEW_INSTALL_COMMAND\"",
    "    bash -c \"$SPRINT_PREVIEW_INSTALL_COMMAND\"",
    "    printf '%s' \"$preview_install_signature\" > \"$preview_install_stamp\"",
    "    # Dependencies changed, so any prior build is stale — force a rebuild below.",
    "    rm -f \"$preview_build_stamp\"",
    "  fi",
    "fi",
    "",
    "if [ -n \"${SPRINT_PREVIEW_BUILD_COMMAND:-}\" ]; then",
    "  preview_build_key=\"${SPRINT_PREVIEW_SOURCE_COMMIT:-}\"",
    "  if [ -n \"$preview_build_key\" ] && [ -f \"$preview_build_stamp\" ] && [ \"$(cat \"$preview_build_stamp\" 2>/dev/null)\" = \"$preview_build_key\" ]; then",
    "    echo \"[preview] Source commit unchanged ($preview_build_key); reusing cached build (skipping build).\"",
    "  else",
    "    echo \"[preview] Running build command: $SPRINT_PREVIEW_BUILD_COMMAND\"",
    "    bash -c \"$SPRINT_PREVIEW_BUILD_COMMAND\"",
    "    if [ -n \"$preview_build_key\" ]; then printf '%s' \"$preview_build_key\" > \"$preview_build_stamp\"; fi",
    "  fi",
    "fi",
    "",
    "start_preview_port_proxy \"$SPRINT_PREVIEW_PROXY_PORT\" \"$SPRINT_PREVIEW_PORT\"",
    "",
    "if [ -n \"${SPRINT_PREVIEW_RUN_COMMAND:-}\" ]; then",
    "  echo \"[preview] Starting app: $SPRINT_PREVIEW_RUN_COMMAND\"",
    "  bash -c \"$SPRINT_PREVIEW_RUN_COMMAND\" &",
    "  app_pid=$!",
    "  echo \"[preview] App started with PID $app_pid. Waiting for process...\"",
    "  wait \"$app_pid\"",
    "  exit_code=$?",
    "  echo \"[preview] App exited with code $exit_code.\"",
    "  exit $exit_code",
    "fi",
    "",
    "for candidate in dist build out public; do",
    "  if [ -d \"$candidate\" ]; then",
    "    echo \"[preview] Found static directory '$candidate'. Starting static server...\"",
    "    if ! command -v serve >/dev/null 2>&1; then",
    "      echo \"[preview] 'serve' not found, installing...\"",
    "      npm install -g serve",
    "    fi",
    "    echo \"[preview] Serving '$candidate' on port $SPRINT_PREVIEW_PORT...\"",
    "    serve -s \"$candidate\" -l \"$SPRINT_PREVIEW_PORT\" &",
    "    app_pid=$!",
    "    wait \"$app_pid\"",
    "    exit_code=$?",
    "    exit $exit_code",
    "  fi",
    "done",
    "",
    "echo \"[preview] Error: Could not determine a runnable preview command.\" >&2",
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
  packageDir = "",
  allowStaticFallback = true,
): { command: string; scriptName: typeof PREVIEW_SCRIPT_NAMES[number]; packageDir: string; scripts: Record<string, string> } | null {
  const availableScript = PREVIEW_SCRIPT_NAMES.find((name) => isUsablePreviewScript(name, scripts[name]));

  if (availableScript === "preview") {
    const previewArgs = ["--host", "0.0.0.0", "--port", "\"$SPRINT_PREVIEW_PORT\""];
    return {
      command: `HOST=0.0.0.0 PORT="$SPRINT_PREVIEW_PORT" DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT="$SPRINT_PREVIEW_PORT" ${runPackageScript(packageManager, packageDir, "preview", previewArgs)}`,
      scriptName: availableScript,
      packageDir,
      scripts,
    };
  }

  if (availableScript === "start" || availableScript === "serve" || availableScript === "dev") {
    return {
      command: `HOST=0.0.0.0 PORT="$SPRINT_PREVIEW_PORT" DASHBOARD_HOST=0.0.0.0 DASHBOARD_PORT="$SPRINT_PREVIEW_PORT" ${runPackageScript(packageManager, packageDir, availableScript)}`,
      scriptName: availableScript,
      packageDir,
      scripts,
    };
  }

  if (allowStaticFallback && typeof scripts.build === "string" && scripts.build.trim().length > 0) {
    return {
      command: buildStaticFallbackRunCommand(),
      scriptName: "serve",
      packageDir,
      scripts,
    };
  }

  return null;
}

function buildStaticFallbackRunCommand(): string {
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

function buildBuildCommand(
  packageManager: SprintPreviewPackageManager,
  packageDir: string,
  scripts: Record<string, string>,
  hasWorkspacePackages: boolean,
): string | null {
  if (typeof scripts.build !== "string" || scripts.build.trim().length === 0) {
    return null;
  }
  if (!packageDir && hasWorkspacePackages) {
    return null;
  }
  return runPackageScript(packageManager, packageDir, "build");
}

async function detectWorkspacePreviewRuntime(
  repoPath: string,
  packageManager: SprintPreviewPackageManager,
  source?: SprintPreviewCommandSource,
  packageJsonPaths?: string[],
): Promise<ReturnType<typeof buildRunCommand>> {
  const paths = packageJsonPaths ?? await listWorkspacePackageJsonPaths(repoPath, source);
  for (const packageJsonPath of paths) {
    const packageDir = path.posix.dirname(packageJsonPath);
    const packageJson = await readJsonFile(repoPath, packageJsonPath, source);
    const runtime = buildRunCommand(packageManager, packageJson?.scripts || {}, packageDir, false);
    if (runtime) {
      return runtime;
    }
  }
  return null;
}

async function listWorkspacePackageJsonPaths(repoPath: string, source?: SprintPreviewCommandSource): Promise<string[]> {
  if (source?.listFiles) {
    return (await source.listFiles())
      .filter((filePath) => filePath.endsWith("/package.json"))
      .filter((filePath) => WORKSPACE_PACKAGE_DIRS.some((dir) => filePath.startsWith(`${dir}/`)))
      .sort((left, right) => scorePackagePath(left) - scorePackagePath(right) || left.localeCompare(right));
  }

  const results: string[] = [];
  for (const dir of WORKSPACE_PACKAGE_DIRS) {
    const root = path.join(repoPath, dir);
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const packageJsonPath = path.join(root, entry, "package.json");
      try {
        await fs.access(packageJsonPath);
        results.push(path.posix.join(dir, entry, "package.json"));
      } catch {
        continue;
      }
    }
  }
  return results.sort((left, right) => scorePackagePath(left) - scorePackagePath(right) || left.localeCompare(right));
}

function scorePackagePath(filePath: string): number {
  const normalized = filePath.toLowerCase();
  if (/apps\/(web|client|app|frontend|dashboard|admin|studio|site)/.test(normalized)) return 0;
  if (normalized.startsWith("apps/")) return 1;
  if (/packages\/(web|client|app|frontend|dashboard|admin|studio|site)/.test(normalized)) return 2;
  return 3;
}

function isUsablePreviewScript(scriptName: typeof PREVIEW_SCRIPT_NAMES[number], script: string | undefined): boolean {
  if (typeof script !== "string" || script.trim().length === 0) {
    return false;
  }
  if (scriptName === "dev") {
    return WEB_DEV_SCRIPT_PATTERN.test(script);
  }
  return scriptName !== "start" || WEB_RUNTIME_SCRIPT_PATTERN.test(script);
}

function runPackageScript(
  packageManager: SprintPreviewPackageManager,
  packageDir: string,
  script: string,
  args: string[] = [],
): string {
  if (!packageDir) {
    return getRunCommandFactory(packageManager)(script, args);
  }
  const quotedDir = shellQuote(packageDir);
  switch (packageManager) {
    case "pnpm":
      return args.length > 0
        ? `pnpm --dir ${quotedDir} ${script} -- ${args.join(" ")}`
        : `pnpm --dir ${quotedDir} ${script}`;
    case "yarn":
      return args.length > 0
        ? `yarn --cwd ${quotedDir} ${script} ${args.join(" ")}`
        : `yarn --cwd ${quotedDir} ${script}`;
    case "bun":
      return args.length > 0
        ? `bun --cwd ${quotedDir} run ${script} -- ${args.join(" ")}`
        : `bun --cwd ${quotedDir} run ${script}`;
    case "npm":
    default:
      return args.length > 0
        ? `npm --prefix ${quotedDir} run ${script} -- ${args.join(" ")}`
        : `npm --prefix ${quotedDir} run ${script}`;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function fileExists(repoPath: string, filePath: string, source?: SprintPreviewCommandSource): Promise<boolean> {
  if (source) {
    return await source.exists(filePath);
  }
  try {
    await fs.access(path.join(repoPath, filePath));
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(repoPath: string, source?: SprintPreviewCommandSource): Promise<PackageJsonLike | null> {
  return await readJsonFile(repoPath, "package.json", source);
}

async function readJsonFile(repoPath: string, filePath: string, source?: SprintPreviewCommandSource): Promise<PackageJsonLike | null> {
  try {
    const raw = source
      ? await source.readTextFile(filePath)
      : await fs.readFile(path.join(repoPath, filePath), "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as PackageJsonLike;
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

export const resolvePreviewScriptPath = async (repoPath: string, configuredPath: string): Promise<string> => {
  const defaultScript = path.resolve(repoPath, ".code-ux/browser/start-preview.sh");

  if (!configuredPath || typeof configuredPath !== "string" || configuredPath.trim().length === 0) {
    return defaultScript;
  }

  let resolved = resolveConfiguredPath(repoPath, configuredPath);

  try {
    resolved = await fs.realpath(resolved);
  } catch (err) {
    // If file doesn't exist, we fallback to string check, assuming it will be created.
    // Wait, the "last-mile" verification implies we should check realpath. If it doesn't exist,
    // we can check the realpath of the directory it's going into.
    try {
       const dir = await fs.realpath(path.dirname(resolved));
       resolved = path.join(dir, path.basename(resolved));
    } catch {
       // if even directory does not exist, just use string matching for creation.
    }
  }

  const realRepoPath = await fs.realpath(repoPath).catch(() => path.resolve(repoPath));
  const isWithin = resolved === realRepoPath || resolved.startsWith(realRepoPath + path.sep);

  if (!isWithin) {
    return defaultScript;
  }

  return resolved;
};
