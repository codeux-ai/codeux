// Dashboard frontend performance benchmark.
//
// Two phases against the production build served by stub-server.mjs:
//   1. COLD LOAD  — full page load per route; measures mount cost, FCP, long
//                   tasks (main-thread blocking), JS heap, DOM size.
//   2. RAPID NAV  — single app load, then click through every route N times
//                   (the "navigating fast" scenario); measures jank (long
//                   tasks during the storm) and heap growth after forced GC
//                   (memory-leak signal: retained listeners / detached nodes).
//
// Usage: node dashboard/bench/benchmark.mjs [--url http://localhost:4599]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4599);
// If --url is passed, benchmark a live server instead of spawning the stub.
const LIVE_URL = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
const BASE = LIVE_URL || `http://localhost:${PORT}`;
const PROGRESS = path.join(__dirname, "progress.log");
const prog = (m) => {
  fs.appendFileSync(PROGRESS, `${new Date().toISOString()} ${m}\n`);
  try { process.stderr.write(m + "\n"); } catch {}
};

// Spawn the stub server as a child so the whole benchmark is one process tree
// (survives a single tool invocation; no cross-call persistence needed).
function startStub() {
  const child = spawn(process.execPath, [path.join(__dirname, "stub-server.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return child;
}
async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/projects`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("stub server did not start");
}

const ROUTES = [
  { name: "Overview", path: "/" },
  { name: "Sprints", path: "/sprints" },
  { name: "Tasks", path: "/tasks" },
  { name: "Projects", path: "/projects" },
  { name: "Chat", path: "/chat" },
  { name: "Agents", path: "/agents" },
  { name: "Stats", path: "/stats" },
  { name: "Scheduler", path: "/scheduler" },
  { name: "Memory", path: "/memory" },
  { name: "Browser", path: "/browser" },
  { name: "Files", path: "/files" },
  { name: "Live", path: "/live" },
  { name: "Config", path: "/config" },
];

const LONGTASK_INIT = `
  window.__lt = [];
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lt.push(e.duration);
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch {}
`;

function loadCapNotExceeded(t0) {
  return Date.now() - t0 < 5000; // hard cap per route settle
}

function stats(arr) {
  if (!arr.length) return { count: 0, total: 0, max: 0 };
  const total = arr.reduce((a, b) => a + b, 0);
  return { count: arr.length, total: Math.round(total), max: Math.round(Math.max(...arr)) };
}

async function heapBytes(client) {
  const { metrics } = await client.send("Performance.getMetrics");
  const m = metrics.find((x) => x.name === "JSHeapUsedSize");
  return m ? m.value : 0;
}

async function gc(client) {
  try {
    await client.send("HeapProfiler.collectGarbage");
  } catch {}
}

async function main() {
  fs.writeFileSync(PROGRESS, "");
  prog(`benchmark start pid=${process.pid}`);
  let stub = { kill() {} };
  if (LIVE_URL) {
    prog(`benchmarking live server ${LIVE_URL}`);
  } else {
    stub = startStub();
    await waitForServer();
    prog(`stub ready on ${BASE} (BG_MODE=${process.env.BG_MODE ?? "ANIMATED"})`);
  }
  prog("launching chrome…");

  // GPU on by default: this app busy-spins rAF (and crashes software-WebGL)
  // under headless `--disable-gpu`. Set NOGPU=1 only if your box lacks any GL.
  const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", ...(process.env.NOGPU === "1" ? ["--disable-gpu"] : [])];
  let browser, context, page, client;
  const freshBrowser = async () => {
    if (browser && browser.isConnected()) await browser.close().catch(() => {});
    browser = await chromium.launch({ channel: "chrome", headless: true, args: launchArgs });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await context.addInitScript(LONGTASK_INIT);
  };
  const freshPage = async () => {
    if (!browser || !browser.isConnected()) await freshBrowser();
    if (page && !page.isClosed()) await page.close().catch(() => {});
    page = await context.newPage();
    page.on("crash", () => prog("  !! page crashed"));
    client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    return page;
  };

  const report = { base: BASE, generatedAt: new Date().toISOString(), cold: [], rapidNav: null };

  await freshBrowser();
  await freshPage();

  // ───────────── Phase 1: cold load per route ─────────────
  for (const route of ROUTES) {
    const url = BASE + route.path;
    try {
      if (page.isClosed()) await freshPage();
      const t0 = Date.now();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      // NB: do NOT wait for networkidle — the realtime WebSocket keeps the
      // network permanently active, so networkidle never fires.
      await page.waitForSelector("#main-content", { timeout: 12000 }).catch(() => {});
      // Settle: poll until DOM node count stabilises (lazy chunk + data render
      // complete) or a 4s cap, whichever first.
      let prevN = -1, stableMs = 0;
      while (stableMs < 600 && loadCapNotExceeded(t0)) {
        await page.waitForTimeout(150);
        const n = await page.evaluate(() => document.querySelectorAll("*").length).catch(() => prevN);
        stableMs = n === prevN ? stableMs + 150 : 0;
        prevN = n;
      }
      const loadMs = Date.now() - t0;

      const paint = await page.evaluate(() => {
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        const nav = performance.getEntriesByType("navigation")[0];
        return {
          fcp: fcp ? Math.round(fcp.startTime) : null,
          domInteractive: nav ? Math.round(nav.domInteractive) : null,
          domNodes: document.querySelectorAll("*").length,
        };
      });
      const lt = stats(await page.evaluate(() => window.__lt || []));
      const heap = Math.round((await heapBytes(client)) / 1048576);

      report.cold.push({
        route: route.name, path: route.path, loadMs,
        fcp: paint.fcp, domInteractive: paint.domInteractive, domNodes: paint.domNodes,
        longTasks: lt.count, blockingMs: lt.total, maxTaskMs: lt.max, heapMB: heap,
      });
      prog(
        `cold ${route.name.padEnd(10)} load=${loadMs}ms fcp=${paint.fcp}ms blocking=${lt.total}ms(${lt.count}) dom=${paint.domNodes} heap=${heap}MB\n`,
      );
    } catch (err) {
      process.stderr.write(`cold ${route.name.padEnd(10)} FAILED: ${String(err).slice(0, 120)}\n`);
      report.cold.push({ route: route.name, path: route.path, error: String(err).slice(0, 200) });
      await freshPage();
    }
  }

  // ───────────── Phase 2: rapid in-app navigation ─────────────
  if (page.isClosed()) await freshPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForSelector("#main-content", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__lt = [];
  });
  await gc(client);
  const heapStart = await heapBytes(client);
  const domStart = await page.evaluate(() => document.querySelectorAll("*").length);

  const LOOPS = 5;
  const navPaths = ROUTES.filter((r) => r.path !== "/files").map((r) => r.path); // skip 12MB monaco load in the storm
  const navTimings = [];
  for (let loop = 0; loop < LOOPS; loop++) {
    for (const p of navPaths) {
      const sel = `a[href="${p}"]`;
      const link = await page.$(sel);
      const t0 = Date.now();
      if (link) {
        await link.click({ timeout: 2000 }).catch(() => {});
      } else {
        await page.evaluate((pp) => window.history.pushState({}, "", pp), p);
      }
      await page.waitForTimeout(120); // simulate a fast human click cadence
      navTimings.push(Date.now() - t0);
    }
  }
  await page.waitForTimeout(500);
  const ltNav = stats(await page.evaluate(() => window.__lt || []));
  await gc(client);
  await page.waitForTimeout(300);
  const heapEnd = await heapBytes(client);
  const domEnd = await page.evaluate(() => document.querySelectorAll("*").length);

  report.rapidNav = {
    loops: LOOPS,
    navigations: navTimings.length,
    longTasks: ltNav.count,
    blockingMs: ltNav.total,
    maxTaskMs: ltNav.max,
    heapStartMB: Math.round(heapStart / 1048576),
    heapEndMB: Math.round(heapEnd / 1048576),
    heapGrowthMB: Math.round((heapEnd - heapStart) / 1048576),
    domStart,
    domEnd,
    domGrowth: domEnd - domStart,
  };
  prog(
    `\nrapidNav ${navTimings.length} navs blocking=${ltNav.total}ms(${ltNav.count}) max=${ltNav.max}ms heap ${report.rapidNav.heapStartMB}->${report.rapidNav.heapEndMB}MB (Δ${report.rapidNav.heapGrowthMB}) dom ${domStart}->${domEnd} (Δ${report.rapidNav.domGrowth})\n`,
  );

  await browser.close();
  stub.kill("SIGKILL");

  const tag = (process.env.BG_MODE ?? "ANIMATED").toLowerCase();
  const outJson = path.join(__dirname, `results-${tag}.json`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(__dirname, `results-${tag}.md`), renderMarkdown(report));
  process.stderr.write(`\nwrote ${outJson} and results-${tag}.md\n`);
}

function renderMarkdown(r) {
  const lines = [];
  lines.push(`# Dashboard frontend benchmark`);
  lines.push(`\n_${r.generatedAt} — ${r.base}_\n`);
  lines.push(`## Cold load per route\n`);
  lines.push(`| Route | Load ms | FCP ms | Blocking ms (long tasks) | Max task ms | DOM nodes | Heap MB |`);
  lines.push(`|---|--:|--:|--:|--:|--:|--:|`);
  for (const c of r.cold) {
    lines.push(
      `| ${c.route} | ${c.loadMs} | ${c.fcp ?? "—"} | ${c.blockingMs} (${c.longTasks}) | ${c.maxTaskMs} | ${c.domNodes} | ${c.heapMB} |`,
    );
  }
  const n = r.rapidNav;
  lines.push(`\n## Rapid navigation (${n.loops} loops × ${n.navigations / n.loops} routes = ${n.navigations} navs)\n`);
  lines.push(`- Total main-thread blocking: **${n.blockingMs} ms** across ${n.longTasks} long tasks (max ${n.maxTaskMs} ms)`);
  lines.push(`- Heap: ${n.heapStartMB} MB → ${n.heapEndMB} MB after GC (**Δ ${n.heapGrowthMB} MB**)`);
  lines.push(`- DOM nodes: ${n.domStart} → ${n.domEnd} after GC (**Δ ${n.domGrowth}**)`);
  lines.push(`\n_Heap/DOM growth after forced GC across repeated navigation is the leak signal._`);
  return lines.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  try {
    spawn("pkill", ["-f", "stub-server.mjs"]);
  } catch {}
  process.exit(1);
});
