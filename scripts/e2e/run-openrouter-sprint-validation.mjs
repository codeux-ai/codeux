#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_OPENROUTER_MODEL,
  SCENARIOS,
  SUCCESS_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  getScenario,
  listScenarioIds,
} from "./openrouter-sprint-scenarios.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_ENTRYPOINT = path.join(REPO_ROOT, "dist", "index.js");
const ARTIFACT_ROOT = path.join(REPO_ROOT, ".cache", "e2e-openrouter");
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;
const SERVER_READY_TIMEOUT_MS = 60_000;
const SERVER_SHUTDOWN_TIMEOUT_MS = 15_000;
const TERMINAL_SPRINT_STATUSES = new Set(["completed", "failed", "cancelled"]);
const activeChildren = new Set();

const SECRET_ENV_KEYS = new Set([
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "JULES_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
]);

function parseArgs(argv) {
  const parsed = { scenario: "all", timeoutMs: null, keepArtifacts: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      parsed.scenario = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--scenario=")) {
      parsed.scenario = arg.slice("--scenario=".length);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else if (arg === "--keep-artifacts") {
      parsed.keepArtifacts = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.scenario) throw new Error("--scenario must not be blank.");
  if (parsed.timeoutMs !== null && (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0)) {
    throw new Error("--timeout-ms must be a positive number.");
  }
  return parsed;
}

function printUsage() {
  console.log([
    "Usage: node scripts/e2e/run-openrouter-sprint-validation.mjs [--scenario all|smoke|ci-repair|conflict-dag] [--timeout-ms N]",
    "",
    "Skips with exit code 0 when OPENROUTER_API_KEY is absent.",
    `Default model: ${DEFAULT_OPENROUTER_MODEL}`,
  ].join("\n"));
}

function redact(value) {
  let output = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const secrets = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.JULES_API_KEY,
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITLAB_TOKEN,
  ].filter((secret) => typeof secret === "string" && secret.length > 0);
  for (const secret of secrets) output = output.split(secret).join("[REDACTED]");
  output = output.replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]");
  output = output.replace(/("(?:apiKey|githubToken|gitlabToken|jiraToken|apiToken)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
  return output;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Failed to allocate a local port."));
        else resolve(port);
      });
    });
  });
}

function buildChildEnvironment(homeDir, port) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || SECRET_ENV_KEYS.has(key)) continue;
    if ([
      "PATH",
      "Path",
      "PATHEXT",
      "SystemRoot",
      "WINDIR",
      "ComSpec",
      "SHELL",
      "LANG",
      "LC_ALL",
      "CI",
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
    ].includes(key)) {
      env[key] = value;
    }
  }
  return {
    ...env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    TMPDIR: path.join(homeDir, "tmp"),
    TEMP: path.join(homeDir, "tmp"),
    TMP: path.join(homeDir, "tmp"),
    DASHBOARD_PORT: String(port),
    MCP_HTTP_ENABLED: "false",
    NODE_ENV: "production",
    CODE_UX_E2E_OPENROUTER: "1",
  };
}

function spawnLogged(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    activeChildren.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      activeChildren.delete(child);
      reject(error);
    });
    child.on("close", (code, signal) => {
      activeChildren.delete(child);
      if (code === 0) resolve({ code, signal, stdout, stderr });
      else reject(new Error(redact(`${command} ${args.join(" ")} failed with code ${code ?? signal}\n${stderr || stdout}`)));
    });
  });
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function createTempGitProject(baseDir, scenarioId) {
  const repoDir = path.join(baseDir, `project-${scenarioId}`);
  await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.mkdir(path.join(repoDir, "test"), { recursive: true });
  await writeFile(path.join(repoDir, "README.md"), "# Code UX OpenRouter E2E\n\nTemporary validation project.\n");
  await writeFile(path.join(repoDir, "package.json"), `${JSON.stringify({ type: "module", scripts: { test: "node test/run-validation.mjs" } }, null, 2)}\n`);
  await writeFile(path.join(repoDir, "src", "shared-state.js"), "export function currentValue() {\n  return 'initial';\n}\n");
  await writeFile(path.join(repoDir, "src", "ci-target.js"), "export function stableNumber() {\n  return 40;\n}\n");
  await writeFile(path.join(repoDir, "test", "run-validation.mjs"), [
    "import { stableNumber } from '../src/ci-target.js';",
    "",
    "if (stableNumber() !== 42) {",
    "  throw new Error(`Expected stableNumber() to return 42, received ${stableNumber()}`);",
    "}",
    "",
    "console.log('validation passed');",
  ].join("\n"));
  await spawnLogged("git", ["init", "-b", "main"], { cwd: repoDir });
  await spawnLogged("git", ["config", "user.name", "Code UX E2E"], { cwd: repoDir });
  await spawnLogged("git", ["config", "user.email", "codeux-e2e@example.invalid"], { cwd: repoDir });
  await spawnLogged("git", ["add", "."], { cwd: repoDir });
  await spawnLogged("git", ["commit", "-m", "initial validation fixture"], { cwd: repoDir });
  return repoDir;
}

function httpRequest(baseUrl, method, pathname, body) {
  const url = new URL(pathname, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers: {
        Host: url.host,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        if (raw.trim()) {
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(redact(`${method} ${url.pathname} failed with HTTP ${res.statusCode}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`)));
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForReady(baseUrl) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    try {
      const ready = await httpRequest(baseUrl, "GET", "/ready");
      if (ready?.status === "READY" || ready?.status === "UP") return;
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(`Code UX did not become ready within ${SERVER_READY_TIMEOUT_MS}ms${lastError ? `: ${lastError.message}` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCodeUx(homeDir, port, artifactDir) {
  const childEnv = buildChildEnvironment(homeDir, port);
  await fs.mkdir(childEnv.TMPDIR, { recursive: true });
  const logPath = path.join(artifactDir, "server.log");
  const child = spawn(process.execPath, [DIST_ENTRYPOINT], {
    cwd: REPO_ROOT,
    env: childEnv,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  activeChildren.add(child);
  const logChunks = [];
  const appendLog = async (source, chunk) => {
    const line = redact(`[${source}] ${chunk.toString("utf8")}`);
    logChunks.push(line);
    if (logChunks.join("").length > 2_000_000) logChunks.splice(0, Math.max(1, Math.floor(logChunks.length / 3)));
    await fs.appendFile(logPath, line, "utf8").catch(() => undefined);
  };
  child.stdout?.on("data", (chunk) => { void appendLog("stdout", chunk); });
  child.stderr?.on("data", (chunk) => { void appendLog("stderr", chunk); });
  child.on("close", () => {
    activeChildren.delete(child);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(baseUrl).catch((error) => {
    throw new Error(`${error.message}\nServer log tail:\n${logChunks.join("").slice(-4000)}`);
  });
  return { baseUrl, child };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
  const finished = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(SERVER_SHUTDOWN_TIMEOUT_MS).then(() => "timeout"),
  ]);
  if (finished === "timeout" && child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }
}

async function stopAllChildren(primaryChild) {
  await stopProcess(primaryChild);
  await Promise.all([...activeChildren].filter((child) => child !== primaryChild).map((child) => stopProcess(child)));
}

function configureOpenRouterSettings(settings, apiKey, model) {
  const next = structuredClone(settings);
  next.integrations.providers.codex = {
    ...(next.integrations.providers.codex || {}),
    provider: "codex",
    name: "OpenRouter E2E Codex",
    apiKey,
    mountAuth: false,
    authPath: "",
    authType: "apiKey",
    customBaseUrl: OPENROUTER_BASE_URL,
    customModel: model,
    customProviderId: "openrouter",
  };
  next.defaults.aiProvider.provider = "codex";
  next.defaults.aiProvider.strategy = "MANUAL";
  next.defaults.aiProvider.providers.codex = {
    ...(next.defaults.aiProvider.providers.codex || {}),
    provider: "codex",
    name: "OpenRouter E2E Codex",
    enabled: true,
    model,
    weight: 100,
    thinkingMode: "MEDIUM",
    maxConcurrentTasks: 2,
  };
  for (const route of ["task_coding", "ci_fix", "merge_conflict"]) {
    next.defaults.aiProvider.invocationRouting[route] = {
      ...next.defaults.aiProvider.invocationRouting[route],
      profile: "GLOBAL",
      strategy: "MANUAL",
      provider: "codex",
      allowedProviders: ["codex"],
      providers: { codex: { model } },
    };
  }
  next.defaults.workers.virtualWorkerProvider = "codex";
  next.defaults.workers.model = model;
  next.defaults.workers.timeoutSeconds = 1800;
  next.defaults.cliWorkflow.gitMode = "local";
  next.defaults.cliWorkflow.executionMode = process.env.CODEUX_E2E_CLI_EXECUTION_MODE === "HOST" ? "HOST" : "DOCKER";
  next.defaults.cliWorkflow.cleanupWorktreeOnSuccess = true;
  next.defaults.cliWorkflow.cleanupWorktreeOnFailure = false;
  next.defaults.git.githubMode = "LOCAL";
  next.defaults.git.autoCreatePr = false;
  next.defaults.git.defaultBranch = "main";
  next.defaults.git.featureBranchPrefix = "e2e/";
  next.defaults.git.deleteMergedBranches = false;
  next.defaults.sprintLoopSteps.watchLoopIntervalSeconds = 3;
  next.defaults.sprintLoopSteps.watchLoopOutputIntervalSeconds = 60;
  next.defaults.agents.qualityAssurance.enabled = false;
  return next;
}

function buildProjectSettingsOverride(model) {
  const route = { profile: "GLOBAL", strategy: "MANUAL", provider: "codex", allowedProviders: ["codex"], providers: { codex: { model } } };
  return {
    aiProvider: {
      provider: "codex",
      strategy: "MANUAL",
      providers: { codex: { provider: "codex", name: "OpenRouter E2E Codex", enabled: true, model, weight: 100, thinkingMode: "MEDIUM", maxConcurrentTasks: 2 } },
      invocationRouting: { task_coding: route, ci_fix: route, merge_conflict: route },
    },
    workers: { virtualWorkerProvider: "codex", model, timeoutSeconds: 1800 },
    cliWorkflow: { gitMode: "local", executionMode: process.env.CODEUX_E2E_CLI_EXECUTION_MODE === "HOST" ? "HOST" : "DOCKER", cleanupWorktreeOnSuccess: true, cleanupWorktreeOnFailure: false },
    git: { githubMode: "LOCAL", autoCreatePr: false, defaultBranch: "main", featureBranchPrefix: "e2e/", deleteMergedBranches: false },
    agents: { qualityAssurance: { enabled: false } },
    sprintLoopSteps: { watchLoopIntervalSeconds: 3, watchLoopOutputIntervalSeconds: 60 },
  };
}

async function createScenarioRecords(baseUrl, repoDir, scenario, model) {
  const project = await httpRequest(baseUrl, "POST", "/api/projects", {
    name: "OpenRouter E2E temporary project",
    sourceType: "local",
    sourceRef: repoDir,
    initMode: "existing",
    defaultBranch: "main",
    featureBranchPrefix: "e2e/",
    settingsOverrides: buildProjectSettingsOverride(model),
  });
  await httpRequest(baseUrl, "PUT", `/api/projects/${encodeURIComponent(project.id)}/select`);
  const sprint = await httpRequest(baseUrl, "POST", `/api/projects/${encodeURIComponent(project.id)}/sprints`, { ...scenario.sprint, status: "idle", showcasePinned: false });
  await httpRequest(baseUrl, "PUT", `/api/projects/${encodeURIComponent(project.id)}/selected-sprint`, { sprintId: sprint.id });
  const taskIdsByKey = new Map();
  const tasks = [];
  for (let index = 0; index < scenario.tasks.length; index += 1) {
    const taskSpec = scenario.tasks[index];
    const dependsOnTaskIds = (taskSpec.dependsOn || []).map((key) => {
      const taskId = taskIdsByKey.get(key);
      if (!taskId) throw new Error(`Scenario ${scenario.id} references missing dependency key ${key}`);
      return taskId;
    });
    const task = await httpRequest(baseUrl, "POST", `/api/projects/${encodeURIComponent(project.id)}/tasks`, {
      sprintId: sprint.id,
      taskKey: taskSpec.key,
      title: taskSpec.title,
      promptMarkdown: taskSpec.promptMarkdown,
      description: taskSpec.promptMarkdown,
      status: "pending",
      priority: taskSpec.priority || "medium",
      executorType: "docker_cli",
      sortOrder: index,
      dependsOnTaskIds,
      isIndependent: dependsOnTaskIds.length === 0,
      sourceType: taskSpec.sourceType || null,
      model,
    });
    taskIdsByKey.set(taskSpec.key, task.id);
    tasks.push(task);
  }
  return { project, sprint, tasks };
}

function summarizeTasks(tasks) {
  return tasks.map((task) => ({
    id: task.id,
    key: task.taskKey,
    title: task.title,
    status: task.status,
    mergeIndicator: task.mergeIndicator || null,
    isMerged: Boolean(task.isMerged),
  }));
}

function deriveFailureReason(tasks, sprint, timeout) {
  if (timeout) return "timed out before terminal task completion";
  const failedTask = tasks.find((task) => !SUCCESS_TASK_STATUSES.has(task.status));
  if (failedTask) {
    const reviewReason = failedTask.qa_review?.error_reason || failedTask.latestReview?.summary || "";
    return `task ${failedTask.taskKey || failedTask.id} ended with status ${failedTask.status}${reviewReason ? `: ${reviewReason}` : ""}`;
  }
  if (sprint?.status && !["completed", "idle", "running"].includes(sprint.status)) return `sprint ended with status ${sprint.status}`;
  return null;
}

async function pollScenario(baseUrl, projectId, sprintId, timeoutMs) {
  const startedAt = Date.now();
  let latestTasks = [];
  let latestSprints = null;
  while (Date.now() - startedAt < timeoutMs) {
    latestTasks = await httpRequest(baseUrl, "GET", `/api/projects/${encodeURIComponent(projectId)}/tasks?sprintId=${encodeURIComponent(sprintId)}`);
    latestSprints = await httpRequest(baseUrl, "GET", `/api/projects/${encodeURIComponent(projectId)}/sprints`);
    const sprint = Array.isArray(latestSprints?.sprints) ? latestSprints.sprints.find((item) => item.id === sprintId) : null;
    if (latestTasks.length > 0 && latestTasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) {
      return { timedOut: false, tasks: latestTasks, sprint };
    }
    if (sprint?.status && TERMINAL_SPRINT_STATUSES.has(sprint.status)) {
      return { timedOut: false, tasks: latestTasks, sprint };
    }
    await delay(POLL_INTERVAL_MS);
  }
  return {
    timedOut: true,
    tasks: latestTasks,
    sprint: Array.isArray(latestSprints?.sprints) ? latestSprints.sprints.find((item) => item.id === sprintId) : null,
  };
}

async function runScenario(server, scenario, options) {
  const startedAt = Date.now();
  const scenarioDir = path.join(options.workspaceDir, scenario.id);
  await fs.mkdir(scenarioDir, { recursive: true });
  const repoDir = await createTempGitProject(scenarioDir, scenario.id);
  const records = await createScenarioRecords(server.baseUrl, repoDir, scenario, options.model);
  const orchestration = await httpRequest(server.baseUrl, "POST", `/api/projects/${encodeURIComponent(records.project.id)}/sprints/${encodeURIComponent(records.sprint.id)}/orchestrate`, {});
  const polled = await pollScenario(server.baseUrl, records.project.id, records.sprint.id, options.timeoutMs || scenario.timeoutMs || DEFAULT_TIMEOUT_MS);
  const failureReason = deriveFailureReason(polled.tasks, polled.sprint, polled.timedOut);
  const summary = {
    scenario: scenario.id,
    scenarioName: scenario.name,
    sprintId: records.sprint.id,
    projectId: records.project.id,
    sprintStatus: polled.sprint?.status || records.sprint.status || null,
    orchestration,
    taskStatuses: summarizeTasks(polled.tasks),
    elapsedMs: Date.now() - startedAt,
    failureReason,
    artifactDir: path.relative(REPO_ROOT, options.artifactDir),
  };
  await writeFile(path.join(options.artifactDir, `${scenario.id}-summary.json`), `${redact(summary)}\n`);
  console.log(redact(summary));
  if (failureReason) throw new Error(`${scenario.id} failed: ${failureReason}`);
  return summary;
}

async function main() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!openRouterApiKey) {
    console.log("Skipping OpenRouter sprint validation: OPENROUTER_API_KEY is not set.");
    return;
  }
  const args = parseArgs(process.argv);
  const scenarios = args.scenario === "all" ? SCENARIOS : [getScenario(args.scenario)].filter(Boolean);
  if (scenarios.length === 0) throw new Error(`Unknown scenario '${args.scenario}'. Expected one of: all, ${listScenarioIds().join(", ")}`);
  if (!(await pathExists(DIST_ENTRYPOINT))) throw new Error("Missing dist/index.js. Run `pnpm run build` before OpenRouter sprint validation.");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.join(ARTIFACT_ROOT, runId);
  const workspaceDir = path.join(artifactDir, "workspace");
  const homeDir = path.join(artifactDir, "home");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  const port = await findFreePort();
  const model = process.env.CODEUX_E2E_OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  let server = null;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopAllChildren(server?.child);
  };
  const handleInterrupt = (signal) => {
    void stop().finally(() => {
      process.removeListener(signal, signalHandlers[signal]);
      process.kill(process.pid, signal);
    });
  };
  const signalHandlers = {
    SIGINT: () => handleInterrupt("SIGINT"),
    SIGTERM: () => handleInterrupt("SIGTERM"),
    SIGHUP: () => handleInterrupt("SIGHUP"),
  };
  process.once("SIGINT", signalHandlers.SIGINT);
  process.once("SIGTERM", signalHandlers.SIGTERM);
  process.once("SIGHUP", signalHandlers.SIGHUP);
  try {
    server = await startCodeUx(homeDir, port, artifactDir);
    const systemSettings = await httpRequest(server.baseUrl, "GET", "/api/system-settings");
    await httpRequest(server.baseUrl, "PUT", "/api/system-settings", configureOpenRouterSettings(systemSettings, openRouterApiKey, model));
    const summaries = [];
    for (const scenario of scenarios) {
      summaries.push(await runScenario(server, scenario, { artifactDir, workspaceDir, model, timeoutMs: args.timeoutMs }));
    }
    await writeFile(path.join(artifactDir, "summary.json"), `${redact({ summaries })}\n`);
  } finally {
    process.removeListener("SIGINT", signalHandlers.SIGINT);
    process.removeListener("SIGTERM", signalHandlers.SIGTERM);
    process.removeListener("SIGHUP", signalHandlers.SIGHUP);
    await stop();
    if (!args.keepArtifacts) await fs.rm(path.join(artifactDir, "home", "tmp"), { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(redact(error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
