#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const keepTemp = process.env.CODE_UX_KEEP_RELEASE_INSTALL_TEMP === "1";
const SERVER_READY_TIMEOUT_MS = 60_000;
const RUNTIME_SMOKE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

const TERMINAL_SPRINT_STATUSES = new Set(["completed", "failed", "cancelled"]);
const SUCCESS_TASK_STATUSES = new Set(["completed", "coding_completed"]);

function parseArgs(argv) {
  const parsed = { binPath: "", installDir: "" };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bin-path") {
      parsed.binPath = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--bin-path=")) {
      parsed.binPath = arg.slice("--bin-path=".length);
    } else if (arg === "--install-dir") {
      parsed.installDir = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--install-dir=")) {
      parsed.installDir = arg.slice("--install-dir=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.binPath) {
    throw new Error("--bin-path is required.");
  }
  if (!parsed.installDir) {
    throw new Error("--install-dir is required.");
  }
  return {
    binPath: path.resolve(parsed.binPath),
    installDir: path.resolve(parsed.installDir),
  };
}

function printUsage() {
  console.log("Usage: node scripts/e2e/run-installed-package-e2e.mjs --bin-path <installed dist/index.js> --install-dir <temp npm project>");
}

function redact(value) {
  return String(value)
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/("(?:apiKey|githubToken|gitlabToken|jiraToken|apiToken)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canBindPort(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
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

async function findFreePortPair() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dashboardPort = await findFreePort();
    const mcpPort = await findFreePort();
    if (dashboardPort !== mcpPort && await canBindPort(dashboardPort) && await canBindPort(mcpPort)) {
      return { dashboardPort, mcpPort };
    }
  }
  throw new Error("Unable to allocate distinct dashboard and MCP ports.");
}

function httpRequest(baseUrl, method, pathname, body, expectedStatuses = [200]) {
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
        Accept: "application/json, text/html, text/css, application/javascript, */*",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        const status = res.statusCode || 0;
        const contentType = String(res.headers["content-type"] || "");
        let parsed = raw;
        if (contentType.includes("application/json") && raw.trim().length > 0) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
        }
        if (expectedStatuses.includes(status)) {
          resolve({ status, headers: res.headers, body: parsed, raw });
          return;
        }
        reject(new Error(redact(`${method} ${url.pathname} failed with HTTP ${status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`)));
      });
    });
    req.setTimeout(15_000, () => {
      req.destroy(new Error(`${method} ${url.pathname} timed out.`));
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function runCommand(label, command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${label} failed with exit code ${code ?? 1}.\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`));
    });
  });
}

function buildChildEnvironment(homeDir, dashboardPort, mcpPort) {
  const passThrough = new Set([
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
  ]);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && passThrough.has(key)) {
      env[key] = value;
    }
  }
  const tmpPath = path.join(homeDir, "tmp");
  return {
    ...env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
    TMPDIR: tmpPath,
    TEMP: tmpPath,
    TMP: tmpPath,
    DASHBOARD_HOST: "127.0.0.1",
    DASHBOARD_PORT: String(dashboardPort),
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: String(mcpPort),
    MCP_HTTP_ENABLED: "true",
    CODE_UX_CONTAINERIZED_GIT: "0",
    CODE_UX_GIT_CONTAINER_MODE: "host",
    CODEUX_E2E_PROVIDER_CLI_SHIM: "1",
    NODE_ENV: "production",
  };
}

async function startInstalledRuntime({ binPath, installDir, homeDir, dashboardPort, mcpPort, logPath }) {
  const env = buildChildEnvironment(homeDir, dashboardPort, mcpPort);
  await mkdir(env.TMPDIR, { recursive: true });

  const child = spawn(process.execPath, [binPath], {
    cwd: installDir,
    env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const appendLog = async (source, chunk) => {
    const text = redact(chunk.toString("utf8"));
    if (source === "stdout") {
      stdout += text;
    } else {
      stderr += text;
    }
    await writeFile(logPath, `[stdout]\n${stdout}\n[stderr]\n${stderr}`, "utf8").catch(() => undefined);
  };
  child.stdout?.on("data", (chunk) => {
    void appendLog("stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    void appendLog("stderr", chunk);
  });

  let exit = null;
  child.on("close", (code, signal) => {
    exit = { code: code ?? 1, signal };
  });

  const baseUrl = `http://127.0.0.1:${dashboardPort}`;
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    if (exit) {
      throw new Error(`Installed runtime exited before /health became available: ${JSON.stringify(exit)}\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`);
    }
    try {
      const response = await httpRequest(baseUrl, "GET", "/health");
      if (response.body?.status === "UP") {
        return { child, baseUrl, getLogs: () => ({ stdout, stderr }) };
      }
      lastError = new Error(`/health returned ${JSON.stringify(response.body)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for installed runtime /health${lastError ? `: ${lastError.message}` : ""}`);
}

async function stopRuntime(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(process.platform === "win32" ? "SIGTERM" : "SIGTERM");
  const stopped = await Promise.race([
    new Promise((resolve) => child.once("close", () => resolve(true))),
    delay(10_000).then(() => false),
  ]);
  if (!stopped) {
    child.kill("SIGKILL");
  }
}

async function verifyDashboardAssets(baseUrl) {
  const index = await httpRequest(baseUrl, "GET", "/");
  if (typeof index.raw !== "string" || !/<!doctype html/i.test(index.raw)) {
    throw new Error("Dashboard root did not return the built index.html document.");
  }
  const assetMatch = index.raw.match(/(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css))"/);
  if (!assetMatch) {
    throw new Error("Dashboard index.html did not reference a Vite asset.");
  }
  const assetPath = assetMatch[1].startsWith("/") ? assetMatch[1] : `/${assetMatch[1]}`;
  const asset = await httpRequest(baseUrl, "GET", assetPath);
  if (asset.raw.trim().length === 0) {
    throw new Error(`Dashboard asset ${assetPath} was empty.`);
  }
  console.log(`Verified dashboard asset: ${assetPath}`);
}

async function createGitFixture(projectDir) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "README.md"), "# Installed package smoke fixture\n", "utf8");
  await runCommand("git init", "git", ["init"], { cwd: projectDir });
  await runCommand("git checkout main", "git", ["checkout", "-B", "main"], { cwd: projectDir });
  await runCommand("git config user.name", "git", ["config", "user.name", "Code UX E2E"], { cwd: projectDir });
  await runCommand("git config user.email", "git", ["config", "user.email", "codeux-e2e@example.invalid"], { cwd: projectDir });
  await runCommand("git add", "git", ["add", "README.md"], { cwd: projectDir });
  await runCommand("git commit", "git", ["commit", "-m", "Initial fixture"], { cwd: projectDir });
}

async function createGitBranch(projectDir, branchName, startPoint = "main") {
  await runCommand(`git branch ${branchName}`, "git", ["branch", branchName, startPoint], { cwd: projectDir });
}

async function readFileFromGitBranch(projectDir, branchName, filePath) {
  const result = await runCommand(`git show ${branchName}:${filePath}`, "git", ["show", `${branchName}:${filePath}`], { cwd: projectDir });
  return result.stdout;
}

function buildInstalledSmokeSettings() {
  const providerId = "mockup-cli";
  const routeProvider = () => ({ enabled: true, model: "default", weight: 100 });
  const workerRoute = () => ({
    profile: "WORKER",
    strategy: "MANUAL",
    provider: providerId,
    allowedProviders: [providerId],
    providers: { [providerId]: routeProvider() },
  });

  return {
    git: {
      githubMode: "LOCAL",
      autoCreatePr: false,
      autoCloseLinkedIssues: false,
      deleteMergedBranches: true,
      defaultBranch: "main",
      featureBranchPrefix: "installed-e2e/",
    },
    ciIntelligence: {
      enabled: false,
      enableLivePrMonitoring: false,
      resolveAllCommentsBeforeMainMerge: false,
      resolveMainMergeConflicts: false,
      resolveMainMergeFailedChecks: false,
      resolveAllCommentsBeforeFeatureMerge: false,
      resolveMergeConflicts: false,
      waitForJulesCiAutofix: false,
      featurePrAutoMergeMode: "OFF",
      mainBranchAutoMergeMode: "OFF",
    },
    cliWorkflow: {
      executionMode: "HOST",
      gitMode: "local",
      cleanupWorktreeOnSuccess: true,
      cleanupWorktreeOnFailure: true,
      containerInstallPlaywrightBrowsers: false,
    },
    sprintPreview: {
      enabled: false,
      autoStartOnRunningSprint: false,
      rebuildOnTaskCompletion: false,
      rebuildOnSprintCompletion: false,
    },
    sprintLoopSteps: {
      branchPreflight: false,
      watchLoopIntervalSeconds: 1,
      watchLoopOutputIntervalSeconds: 15,
    },
    aiProvider: {
      provider: providerId,
      strategy: "MANUAL",
      providers: {
        [providerId]: {
          provider: providerId,
          name: "Installed Smoke Mockup CLI",
          enabled: true,
          model: "default",
          weight: 100,
          thinkingMode: "MEDIUM",
          maxConcurrentTasks: 2,
        },
      },
      invocationRouting: {
        task_coding: {
          profile: "GLOBAL",
          strategy: "MANUAL",
          provider: providerId,
          allowedProviders: [providerId],
          providers: { [providerId]: routeProvider() },
        },
        planning: workerRoute(),
        ci_fix: workerRoute(),
        merge_conflict: workerRoute(),
      },
    },
    workers: {
      executionMode: "VIRTUAL",
      virtualWorkerProvider: providerId,
      model: "default",
      maxConcurrency: 2,
      timeoutSeconds: 120,
    },
    agents: {
      qualityAssurance: {
        enabled: false,
        maxTaskReviewRuns: 0,
        maxSprintReviewRuns: 0,
        taskCompletion: { enabled: false },
        sprintCompletion: { enabled: false },
        completedTaskWithoutPr: { enabled: false },
      },
      selfReflection: {
        planning: { enabled: false },
        qualityAssurance: { enabled: false },
      },
    },
  };
}

async function runCredentialFreeMockupPath(baseUrl, projectDir) {
  const sprintFeatureBranch = "installed-e2e/smoke-feature";
  await httpRequest(baseUrl, "POST", "/api/user/onboarding/complete", undefined, [200, 404]);
  const project = (await httpRequest(baseUrl, "POST", "/api/projects", {
    name: "Installed package smoke project",
    sourceType: "local",
    sourceRef: projectDir,
    defaultBranch: "main",
    status: "idle",
    settingsOverrides: buildInstalledSmokeSettings(),
  }, [201])).body;
  await httpRequest(baseUrl, "PUT", `/api/projects/${encodeURIComponent(project.id)}/select`);
  const sprint = (await httpRequest(baseUrl, "POST", `/api/projects/${encodeURIComponent(project.id)}/sprints`, {
    name: "Installed package smoke sprint",
    goal: "Verify the installed package can execute the compiled mockup-cli runtime path.",
    status: "idle",
    showcasePinned: false,
    featureBranch: sprintFeatureBranch,
  }, [201])).body;
  await createGitBranch(projectDir, sprintFeatureBranch);
  await httpRequest(baseUrl, "PUT", `/api/projects/${encodeURIComponent(project.id)}/selected-sprint`, { sprintId: sprint.id });
  await httpRequest(baseUrl, "POST", `/api/projects/${encodeURIComponent(project.id)}/tasks`, {
    sprintId: sprint.id,
    taskKey: "installed-smoke-1",
    title: "Run installed package mockup provider",
    promptMarkdown: [
      "Use the deterministic mockup-cli provider from the installed package.",
      "mockup-cli:write installed-smoke-output.txt :: installed package mockup provider passed",
      "mockup-cli:run node -e \"const fs=require('node:fs'); if(!fs.readFileSync('installed-smoke-output.txt','utf8').includes('passed')) process.exit(1)\"",
    ].join("\n"),
    description: "Installed package runtime smoke task.",
    status: "pending",
    priority: "medium",
    executorType: "docker_cli",
    sortOrder: 0,
    dependsOnTaskIds: [],
    isIndependent: true,
    model: "default",
  }, [201]);

  await httpRequest(baseUrl, "POST", `/api/projects/${encodeURIComponent(project.id)}/sprints/${encodeURIComponent(sprint.id)}/orchestrate`, {}, [202]);

  const startedAt = Date.now();
  let lastSummary = "no poll results";
  while (Date.now() - startedAt < RUNTIME_SMOKE_TIMEOUT_MS) {
    const [tasksResponse, sprintsResponse] = await Promise.all([
      httpRequest(baseUrl, "GET", `/api/projects/${encodeURIComponent(project.id)}/tasks?sprintId=${encodeURIComponent(sprint.id)}`),
      httpRequest(baseUrl, "GET", `/api/projects/${encodeURIComponent(project.id)}/sprints`),
    ]);
    const tasks = Array.isArray(tasksResponse.body) ? tasksResponse.body : [];
    const sprints = Array.isArray(sprintsResponse.body?.sprints) ? sprintsResponse.body.sprints : [];
    const latestSprint = sprints.find((candidate) => candidate.id === sprint.id);
    lastSummary = `sprint=${latestSprint?.status || "unknown"} tasks=${tasks.map((task) => `${task.taskKey || task.id}:${task.status}`).join(",")}`;

    if (latestSprint && TERMINAL_SPRINT_STATUSES.has(latestSprint.status)) {
      const failedTask = tasks.find((task) => !SUCCESS_TASK_STATUSES.has(task.status));
      if (latestSprint.status === "completed" && !failedTask) {
        const outputPath = path.join(projectDir, "installed-smoke-output.txt");
        let output = "";
        if (existsSync(outputPath)) {
          output = await readFile(outputPath, "utf8");
        } else {
          output = await readFileFromGitBranch(projectDir, sprintFeatureBranch, "installed-smoke-output.txt");
        }
        if (!output.includes("installed package mockup provider passed")) {
          throw new Error(`Unexpected mockup output content: ${output}`);
        }
        console.log("Verified credential-free mockup-cli runtime path.");
        return;
      }
      throw new Error(`Installed mockup runtime path failed: ${lastSummary}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for installed mockup runtime path: ${lastSummary}`);
}

const args = parseArgs(process.argv);
const tempRoot = await mkdtemp(path.join(tmpdir(), "codeux-installed-package-e2e-"));
const homeDir = path.join(tempRoot, "home");
const projectDir = path.join(tempRoot, "fixture-repo");
const logPath = path.join(tempRoot, "installed-runtime.log");
let runtime = null;

try {
  if (!existsSync(args.binPath)) {
    throw new Error(`Installed bin target does not exist: ${args.binPath}`);
  }
  if (!existsSync(args.installDir)) {
    throw new Error(`Install directory does not exist: ${args.installDir}`);
  }

  const { dashboardPort, mcpPort } = await findFreePortPair();
  console.log(`Installed package smoke workspace: ${tempRoot}`);
  console.log(`Starting installed runtime on dashboard port ${dashboardPort} and MCP port ${mcpPort}.`);

  await createGitFixture(projectDir);
  runtime = await startInstalledRuntime({
    binPath: args.binPath,
    installDir: args.installDir,
    homeDir,
    dashboardPort,
    mcpPort,
    logPath,
  });
  await verifyDashboardAssets(runtime.baseUrl);
  await runCredentialFreeMockupPath(runtime.baseUrl, projectDir);

  console.log("Installed package runtime E2E smoke passed.");
} catch (error) {
  console.error("Installed package runtime E2E smoke failed.");
  console.error(error instanceof Error ? error.message : String(error));
  if (runtime) {
    const logs = runtime.getLogs();
    if (logs.stdout.trim()) {
      console.error(`\nRuntime stdout:\n${logs.stdout.trim()}`);
    }
    if (logs.stderr.trim()) {
      console.error(`\nRuntime stderr:\n${logs.stderr.trim()}`);
    }
  }
  process.exitCode = 1;
} finally {
  if (runtime) {
    await stopRuntime(runtime.child);
  }
  if (keepTemp) {
    console.log(`Keeping installed package smoke workspace: ${tempRoot}`);
  } else {
    await rm(tempRoot, { force: true, recursive: true });
  }
}
