import { _electron as electron } from "@playwright/test";
import { spawn } from "child_process";
import electronPath from "electron";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import { performance } from "perf_hooks";

const projectRoot = process.cwd();
const defaultRoutes = [
  "/",
  "/projects",
  "/config",
  "/agents",
  "/tasks",
  "/sprints",
  "/stats",
  "/scheduler",
  "/memory",
  "/browser",
  "/files",
  "/chat",
];

function readArg(name, fallback = null) {
  const inlinePrefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function readNumberArg(name, fallback) {
  const value = readArg(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function killProcessTree(childProcess) {
  if (!childProcess?.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("close", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  try {
    childProcess.kill("SIGKILL");
  } catch {
    // Process already exited.
  }
}

async function closeElectronApp(electronApp, childProcess) {
  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (childProcess && !childProcess.killed) {
    await killProcessTree(childProcess);
  }
}

async function fetchJson(origin, urlPath, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(`${origin}${urlPath}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForServer(origin, timeoutMs = 60_000) {
  const start = performance.now();
  let lastError = null;
  while (performance.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${origin}/health`, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}/health: ${lastError?.message || "unknown error"}`);
}

async function ensureSelectedProject(origin) {
  await fetchJson(origin, "/api/user/onboarding/complete", { method: "POST" }).catch(() => ({}));

  const projectsBody = await fetchJson(origin, "/api/projects");
  if (projectsBody.selectedProjectId) {
    return projectsBody.selectedProjectId;
  }

  let projectId = projectsBody.projects?.[0]?.id;
  if (!projectId) {
    const created = await fetchJson(origin, "/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Electron Runtime Benchmark",
        sourceType: "local",
        sourceRef: projectRoot,
      }),
    });
    projectId = created.id;
  }

  await fetchJson(origin, `/api/projects/${encodeURIComponent(projectId)}/select`, { method: "PUT" });
  return projectId;
}

async function sampleBackend(origin, projectId, timeoutMs) {
  const endpoints = [
    "/health",
    "/ready",
    "/api/projects",
    "/api/system-settings",
    `/api/projects/${encodeURIComponent(projectId)}/settings/effective`,
    `/api/projects/${encodeURIComponent(projectId)}/agent-presets`,
    "/api/user/onboarding",
  ];
  const samples = [];
  for (const endpoint of endpoints) {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${origin}${endpoint}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      await response.arrayBuffer();
      clearTimeout(timeout);
      samples.push({
        endpoint,
        ok: response.ok,
        status: response.status,
        durationMs: performance.now() - start,
      });
    } catch (error) {
      samples.push({
        endpoint,
        ok: false,
        status: 0,
        durationMs: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return samples;
}

async function copyIfPresent(sourcePath, targetPath) {
  try {
    await fs.access(sourcePath);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

async function seedHomeCodeUxData(sourceDir, tempHome) {
  const targetDir = path.join(tempHome, ".code-ux");
  await fs.mkdir(targetDir, { recursive: true });
  const entries = [
    "app.db",
    "app.db-wal",
    "app.db-shm",
    "settings.db",
    "settings.db-wal",
    "settings.db-shm",
    "session-tracking.db",
    "session-tracking.db-wal",
    "session-tracking.db-shm",
  ];
  const copied = [];
  for (const entry of entries) {
    if (await copyIfPresent(path.join(sourceDir, entry), path.join(targetDir, entry))) {
      copied.push(entry);
    }
  }
  return { sourceDir, targetDir, copied };
}

async function sampleRenderer(page) {
  return await page.evaluate(() => {
    const benchmark = window.__codeUxElectronBenchmark;
    const memory = performance.memory
      ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      }
      : null;
    return {
      url: window.location.href,
      title: document.title,
      nodeCount: document.querySelectorAll("*").length,
      canvasCount: document.querySelectorAll("canvas").length,
      memory,
      longTaskCount: benchmark?.longTasks?.length ?? 0,
      longTaskTotalMs: benchmark?.longTasks?.reduce((sum, task) => sum + task.duration, 0) ?? 0,
      lastLongTasks: benchmark?.longTasks?.slice(-5) ?? [],
      webglContextLostCount: benchmark?.webglContextLost?.length ?? 0,
      lastWebglContextLosses: benchmark?.webglContextLost?.slice(-5) ?? [],
      resourceCount: performance.getEntriesByType("resource").length,
    };
  });
}

async function sampleElectron(electronApp) {
  return await electronApp.evaluate(async ({ app, BrowserWindow }) => {
    const currentProcessMemory = typeof process.getProcessMemoryInfo === "function"
      ? await process.getProcessMemoryInfo()
      : null;
    return {
      windows: BrowserWindow.getAllWindows().length,
      mainProcessMemory: currentProcessMemory,
      appMetrics: app.getAppMetrics().map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        memory: metric.memory,
        cpu: metric.cpu,
      })),
    };
  });
}

async function navigateInApp(page, route, settleMs) {
  const start = performance.now();
  await page.evaluate((targetRoute) => {
    window.history.pushState({}, "", targetRoute);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
  await page.waitForFunction((targetRoute) => window.location.pathname === targetRoute, route, { timeout: 10_000 });
  await page.waitForSelector("#main-content", { timeout: 10_000 });
  await page.waitForTimeout(settleMs);
  return performance.now() - start;
}

async function exerciseRoute(page, route) {
  if (route === "/config") {
    const projectButton = page.getByRole("button", { name: /^Project$/ }).first();
    if (await projectButton.count()) {
      await projectButton.click({ timeout: 5_000 }).catch(() => undefined);
    }
  }

  if (route === "/agents") {
    await page.getByText(/Agent|Pick A Project|Workshop/i).first().waitFor({ timeout: 5_000 }).catch(() => undefined);
  }
}

function summarizeDurations(samples) {
  const durations = samples.map((sample) => sample.durationMs).filter((value) => Number.isFinite(value));
  return {
    count: durations.length,
    minMs: durations.length ? Math.min(...durations) : 0,
    avgMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length ? Math.max(...durations) : 0,
  };
}

async function main() {
  const cycles = readNumberArg("--cycles", 30);
  const durationMs = readNumberArg("--duration-ms", 0);
  const settleMs = readNumberArg("--settle-ms", 350);
  const sampleEvery = readNumberArg("--sample-every", 8);
  const probeTimeoutMs = readNumberArg("--probe-timeout-ms", 90_000);
  const routesArg = readArg("--routes");
  const executableOverride = readArg("--executable");
  const seedCodeUxDir = readArg("--seed-code-ux-dir");
  const seedHomeCodeUx = hasArg("--seed-home-code-ux");
  const routes = routesArg ? routesArg.split(",").map((route) => route.trim()).filter(Boolean) : defaultRoutes;

  const mainPath = path.join(projectRoot, "dist", "electron", "main.js");
  const executablePath = executableOverride ? path.resolve(projectRoot, executableOverride) : electronPath;
  const launchArgs = executableOverride ? [] : [mainPath];
  await fs.access(executablePath);
  if (!executableOverride) {
    await fs.access(mainPath);
  }

  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(projectRoot, ".cache", "electron-runtime-benchmark", runId);
  const tempHome = path.join(outputDir, "home");
  await fs.mkdir(tempHome, { recursive: true });
  await fs.mkdir(path.join(tempHome, "AppData", "Roaming"), { recursive: true });
  await fs.mkdir(path.join(tempHome, "AppData", "Local"), { recursive: true });

  let seededData = null;
  if (seedCodeUxDir || seedHomeCodeUx) {
    const sourceDir = seedCodeUxDir
      ? path.resolve(projectRoot, seedCodeUxDir)
      : path.join(os.homedir(), ".code-ux");
    seededData = await seedHomeCodeUxData(sourceDir, tempHome);
  }

  console.log(`Launching Electron runtime benchmark on ${origin}`);
  console.log(`Executable: ${executablePath}`);
  console.log(`Routes: ${routes.join(", ")}`);
  console.log(`Output: ${outputDir}`);
  if (seededData) {
    console.log(`Seeded .code-ux data from ${seededData.sourceDir}`);
    console.log(`Copied: ${seededData.copied.join(", ") || "(none)"}`);
  }

  const electronApp = await electron.launch({
    executablePath,
    args: launchArgs,
    env: {
      ...process.env,
      APPDATA: path.join(tempHome, "AppData", "Roaming"),
      CODE_UX_DISABLE_MCP_STDIO: "1",
      DASHBOARD_PORT: String(port),
      HOME: tempHome,
      LOCALAPPDATA: path.join(tempHome, "AppData", "Local"),
      MCP_HTTP_ENABLED: "0",
      USERPROFILE: tempHome,
      XDG_CACHE_HOME: path.join(tempHome, ".cache"),
      XDG_CONFIG_HOME: path.join(tempHome, ".config"),
      XDG_DATA_HOME: path.join(tempHome, ".local", "share"),
    },
    timeout: 90_000,
  });

  const requestStarts = new Map();
  const apiSamples = [];
  const abortedApiSamples = [];
  const routeSamples = [];
  const backendSamples = [];
  const rendererSamples = [];
  const electronSamples = [];
  const consoleMessages = [];
  const pageErrors = [];
  let isClosing = false;
  let electronProcess = null;

  try {
    electronProcess = electronApp.process();
    await waitForServer(origin);
    const projectId = await ensureSelectedProject(origin);

    const page = await electronApp.firstWindow({ timeout: 60_000 });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.evaluate(() => {
      window.__codeUxElectronBenchmark = { longTasks: [], webglContextLost: [] };
      window.addEventListener("webglcontextlost", (event) => {
        const store = window.__codeUxElectronBenchmark;
        store.webglContextLost.push({
          at: performance.now(),
          target: event.target instanceof HTMLCanvasElement
            ? {
              width: event.target.width,
              height: event.target.height,
              className: event.target.className,
            }
            : null,
        });
      }, true);
      if ("PerformanceObserver" in window) {
        try {
          const observer = new PerformanceObserver((list) => {
            const store = window.__codeUxElectronBenchmark;
            for (const entry of list.getEntries()) {
              store.longTasks.push({
                name: entry.name,
                startTime: entry.startTime,
                duration: entry.duration,
              });
            }
            if (store.longTasks.length > 500) {
              store.longTasks.splice(0, store.longTasks.length - 500);
            }
          });
          observer.observe({ entryTypes: ["longtask"] });
          window.__codeUxElectronBenchmark.longTaskObserver = observer;
        } catch {
          // Older Chromium builds may not expose longtask in every context.
        }
      }
    });

    page.on("console", (message) => {
      const type = message.type();
      if (type === "error" || type === "warning") {
        consoleMessages.push({
          type,
          text: message.text(),
          location: message.location(),
          route: page.url(),
          atMs: performance.now(),
        });
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push({
        message: error.message,
        stack: error.stack,
        route: page.url(),
        atMs: performance.now(),
      });
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/ready")) {
        requestStarts.set(request, performance.now());
      }
    });
    page.on("requestfailed", (request) => {
      if (isClosing) return;
      const start = requestStarts.get(request);
      if (start === undefined) return;
      requestStarts.delete(request);
      const error = request.failure()?.errorText || "request failed";
      if (error.includes("ERR_ABORTED")) {
        abortedApiSamples.push({
          url: request.url(),
          method: request.method(),
          status: 0,
          ok: false,
          durationMs: performance.now() - start,
          error,
          route: page.url(),
        });
        return;
      }
      apiSamples.push({
        url: request.url(),
        method: request.method(),
        status: 0,
        ok: false,
        durationMs: performance.now() - start,
        error,
        route: page.url(),
      });
    });
    page.on("response", (response) => {
      const request = response.request();
      const start = requestStarts.get(request);
      if (start === undefined) return;
      requestStarts.delete(request);
      void response.finished().then(() => {
        if (isClosing) return;
        apiSamples.push({
          url: response.url(),
          method: request.method(),
          status: response.status(),
          ok: response.ok(),
          durationMs: performance.now() - start,
          route: page.url(),
        });
      }).catch(() => undefined);
    });

    const startedAt = performance.now();
    let iteration = 0;
    let shouldContinue = true;
    while (shouldContinue) {
      for (const route of routes) {
        iteration += 1;
        const duration = await navigateInApp(page, route, settleMs);
        await exerciseRoute(page, route);
        routeSamples.push({
          iteration,
          route,
          durationMs: duration,
          atMs: performance.now() - startedAt,
        });

        if (iteration % sampleEvery === 0) {
          backendSamples.push({
            iteration,
            atMs: performance.now() - startedAt,
            samples: await sampleBackend(origin, projectId, probeTimeoutMs),
          });
          rendererSamples.push({
            iteration,
            atMs: performance.now() - startedAt,
            sample: await sampleRenderer(page),
          });
          electronSamples.push({
            iteration,
            atMs: performance.now() - startedAt,
            sample: await sampleElectron(electronApp),
          });
          const lastRoutes = routeSamples.slice(-sampleEvery);
          console.log(
            `iteration ${iteration}: route avg ${summarizeDurations(lastRoutes).avgMs.toFixed(1)}ms, `
            + `api p95 ${summarizeDurations(apiSamples.slice(-50)).p95Ms.toFixed(1)}ms`
          );
        }

        if (durationMs > 0 && performance.now() - startedAt >= durationMs) {
          shouldContinue = false;
          break;
        }
      }
      if (durationMs <= 0 && iteration >= cycles * routes.length) {
        shouldContinue = false;
      }
    }

    await page.waitForTimeout(1000);
  } finally {
    isClosing = true;
    requestStarts.clear();
    await closeElectronApp(electronApp, electronProcess);
  }

  const failedApiSamples = apiSamples.filter((sample) => !sample.ok);
  const slowApiSamples = apiSamples.filter((sample) => sample.durationMs > 1000);
  const slowRoutes = routeSamples.filter((sample) => sample.durationMs > 1500);
  const summary = {
    runId,
    origin,
    routes,
    cycles,
    durationMs,
    settleMs,
    probeTimeoutMs,
    seededData,
    totals: {
      routeSamples: routeSamples.length,
      apiSamples: apiSamples.length,
      failedApiSamples: failedApiSamples.length,
      slowApiSamples: slowApiSamples.length,
      abortedApiSamples: abortedApiSamples.length,
      slowRoutes: slowRoutes.length,
      consoleMessages: consoleMessages.length,
      pageErrors: pageErrors.length,
    },
    routeDurations: summarizeDurations(routeSamples),
    apiDurations: summarizeDurations(apiSamples),
    backendDurations: summarizeDurations(backendSamples.flatMap((sample) => sample.samples)),
    slowRoutes: slowRoutes.slice(-30),
    slowApiSamples: slowApiSamples.slice(-50),
    abortedApiSamples: abortedApiSamples.slice(-50),
    failedApiSamples: failedApiSamples.slice(-50),
    consoleMessages: consoleMessages.slice(-100),
    pageErrors,
    samples: {
      backend: backendSamples,
      renderer: rendererSamples,
      electron: electronSamples,
    },
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log("Benchmark summary:");
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log(`Route p95: ${summary.routeDurations.p95Ms.toFixed(1)}ms`);
  console.log(`API p95: ${summary.apiDurations.p95Ms.toFixed(1)}ms`);
  console.log(`Backend probe p95: ${summary.backendDurations.p95Ms.toFixed(1)}ms`);
  console.log(`Wrote ${path.join(outputDir, "summary.json")}`);

  if (summary.totals.pageErrors > 0 || summary.totals.failedApiSamples > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
