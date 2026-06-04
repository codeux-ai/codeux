import { spawn } from 'child_process';
import { chromium } from 'playwright';
import http from 'http';

const serverPort = 4444;
const baseUrl = `http://127.0.0.1:${serverPort}`;

const routes = [
  '/',
  '/sprints',
  '/tasks',
  '/projects',
  '/chat',
  '/agents',
  '/stats',
  '/scheduler',
  '/config',
  '/memory',
  '/browser',
  '/files',
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkReady() {
  return new Promise((resolve) => {
    http.get(`${baseUrl}/ready`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => {
      resolve(false);
    });
  });
}

async function main() {
  console.log('Starting local server...');
  const serverProc = spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      JULES_API_KEY: 'dummy_key_for_speed_audit',
      DASHBOARD_PORT: String(serverPort),
    },
    stdio: 'ignore',
  });

  // Wait for server to be ready (up to 30s)
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await checkReady();
    if (ready) break;
    await delay(500);
  }

  if (!ready) {
    console.error('Server failed to start or become ready in 30s.');
    serverProc.kill();
    process.exit(1);
  }

  console.log('Server is ready. Launching Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags="--expose-gc"'],
  });

  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 }
  });

  const consoleMessages = [];
  const requestLog = [];
  const activeRequests = new Map();

  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleMessages.push({ type: 'error', text: err.message });
    console.error('Page Error:', err.message);
  });

  page.on('request', (req) => {
    activeRequests.set(req.url(), Date.now());
  });
  page.on('requestfinished', (req) => {
    const start = activeRequests.get(req.url());
    if (start) {
      requestLog.push({ url: req.url(), duration: Date.now() - start });
      activeRequests.delete(req.url());
    }
  });
  page.on('requestfailed', (req) => {
    activeRequests.delete(req.url());
  });

  console.log('\n--- 1. Initial Page Load Audit ---');
  const loadStart = Date.now();
  await page.goto(`${baseUrl}/`);
  await page.waitForLoadState('networkidle');
  const initialLoadTime = Date.now() - loadStart;
  console.log(`Initial load duration: ${initialLoadTime}ms`);

  const initialMetrics = await page.evaluate(() => {
    const memory = performance.memory;
    return {
      domNodes: document.getElementsByTagName('*').length,
      usedJSHeapSize: memory ? memory.usedJSHeapSize : null,
      totalJSHeapSize: memory ? memory.totalJSHeapSize : null,
    };
  });
  console.log('Initial metrics:', JSON.stringify(initialMetrics, null, 2));

  const robustClick = async (locator) => {
    try {
      await locator.first().click({ force: true, timeout: 1500 });
    } catch (err) {
      await locator.first().evaluate((el) => el.click());
    }
  };

  console.log('\n--- 2. Page Navigation Benchmarking (Client-side) ---');
  const navigationTimes = {};

  for (const route of routes) {
    const navStart = Date.now();
    const link = page.locator(`a[href="${route}"]:visible`);
    if (route !== '/' && (await link.count()) > 0) {
      await robustClick(link);
      await delay(1000); // 1s stabilization buffer for graphs, GSAP, etc.
      const duration = Date.now() - navStart;
      navigationTimes[route] = duration;
      console.log(`Client-side route navigation to ${route}: ${duration}ms`);
    } else {
      await page.goto(`${baseUrl}${route}`);
      await page.waitForLoadState('domcontentloaded');
      await delay(1000);
      const duration = Date.now() - navStart;
      navigationTimes[route] = duration;
      console.log(`Fallback (goto) route navigation to ${route}: ${duration}ms`);
    }
  }

  console.log('\n--- 3. Rapid Navigation Stability & Memory Leak Test (Client-side) ---');
  const memoryGrowth = [];

  for (let i = 0; i < 5; i++) {
    const cycleStart = Date.now();
    for (const route of routes) {
      const link = page.locator(`a[href="${route}"]:visible`);
      if (route !== '/' && (await link.count()) > 0) {
        await robustClick(link);
        await delay(200); // Fast navigation delay
      } else {
        await page.goto(`${baseUrl}${route}`);
        await delay(200);
      }
    }
    const cycleDuration = Date.now() - cycleStart;

    // Force GC if possible, and extract metrics
    const metrics = await page.evaluate(async () => {
      if (window.gc) {
        window.gc();
      }
      const memory = performance.memory;
      return {
        domNodes: document.getElementsByTagName('*').length,
        usedJSHeapSize: memory ? memory.usedJSHeapSize : null,
      };
    });
    memoryGrowth.push(metrics);
    console.log(`Fast navigation cycle ${i + 1} took ${cycleDuration}ms. Current DOM Nodes: ${metrics.domNodes}, Used JS Heap: ${metrics.usedJSHeapSize ? (metrics.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB' : 'N/A'}`);
  }

  console.log('\nClosing browser and stopping server...');
  await browser.close();
  serverProc.kill();

  console.log('\n================ Speed Audit Results Summary ================');
  console.log(`Initial Load Time: ${initialLoadTime}ms`);
  console.log('\nRoute Navigation Times:');
  for (const [route, time] of Object.entries(navigationTimes)) {
    console.log(`  - ${route.padEnd(12)}: ${time}ms`);
  }

  console.log('\nMemory / DOM Growth over 5 Rapid Navigation Cycles (Client-side):');
  memoryGrowth.forEach((m, idx) => {
    console.log(`  - Cycle ${idx + 1}: DOM Nodes = ${m.domNodes}, JS Heap = ${m.usedJSHeapSize ? (m.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB' : 'N/A'}`);
  });

  const slowRequests = requestLog.filter(r => r.duration > 100).sort((a, b) => b.duration - a.duration);
  if (slowRequests.length > 0) {
    console.log('\nSlow API / Network Requests (>100ms):');
    slowRequests.slice(0, 20).forEach(r => {
      console.log(`  - ${r.url}: ${r.duration}ms`);
    });
  }

  const consoleErrors = consoleMessages.filter(m => m.type === 'error');
  if (consoleErrors.length > 0) {
    console.log('\nConsole Errors detected during audit:');
    consoleErrors.forEach(err => console.log(`  [Error] ${err.text}`));
  }
  console.log('============================================================');
}

main().catch((err) => {
  console.error('Audit failed:', err);
});
