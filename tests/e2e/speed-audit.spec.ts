import { test, expect, type Locator, type Page } from '@playwright/test';
import { completeOnboarding, ensureSelectedProject } from './helpers/prepare-app';

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

const routeReadyTimeoutMs = 15_000;

function locatorForRouteReady(page: Page, route: string): Locator {
  const mainHeading = (name: string): Locator => page.locator('main h1:visible', { hasText: name });

  switch (route) {
    case '/':
      return mainHeading('Overview');
    case '/sprints':
      return mainHeading('Active Sprints');
    case '/tasks':
      return mainHeading('Task Board');
    case '/projects':
      return mainHeading('Manage Projects');
    case '/chat':
      return mainHeading('Project Conversations');
    case '/agents':
      return mainHeading('Your Workforce');
    case '/stats':
      return mainHeading('Stats');
    case '/scheduler':
      return page.getByTestId('scheduler-page-root');
    case '/config':
      return mainHeading('Settings & Integration');
    case '/memory':
      return mainHeading('Memory Map');
    case '/browser':
      return page.getByTestId('browser-page-root');
    case '/files':
      return page.getByTestId('file-browser-page-root');
    default:
      throw new Error(`No route readiness locator configured for ${route}`);
  }
}

test.beforeEach(async ({ page, request }) => {
  await completeOnboarding(request);
  await ensureSelectedProject(request);

  await page.addInitScript(() => {
    localStorage.setItem('codeux:dashboard-tour-hidden:v1', 'true');
  });
});

test('Benchmark Page Load & Fast Navigation', async ({ page }) => {
  const consoleMessages: { type: string; text: string }[] = [];
  const requestLog: { url: string; duration: number }[] = [];
  const activeRequests = new Map<string, number>();

  // Listen to console and page errors
  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleMessages.push({ type: 'error', text: err.message });
    console.error('Page Error:', err.message);
  });

  // Track network request durations
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
  await page.goto('/');
  await expect(locatorForRouteReady(page, '/')).toBeVisible({ timeout: routeReadyTimeoutMs });
  const initialLoadTime = Date.now() - loadStart;
  console.log(`Initial load duration: ${initialLoadTime}ms`);

  // Get DOM nodes count and Memory if available
  const initialMetrics = await page.evaluate(() => {
    const memory = (performance as any).memory;
    return {
      domNodes: document.getElementsByTagName('*').length,
      usedJSHeapSize: memory ? memory.usedJSHeapSize : null,
      totalJSHeapSize: memory ? memory.totalJSHeapSize : null,
    };
  });
  console.log('Initial metrics:', JSON.stringify(initialMetrics, null, 2));

  console.log('\n--- 2. Page Navigation Benchmarking ---');
  const navigationTimes: Record<string, number> = {};

  for (const route of routes) {
    const navStart = Date.now();
    await page.goto(route);
    await expect(locatorForRouteReady(page, route)).toBeVisible({ timeout: routeReadyTimeoutMs });
    const duration = Date.now() - navStart;
    navigationTimes[route] = duration;
    console.log(`Route navigation to ${route}: ${duration}ms`);
  }

  console.log('\n--- 3. Rapid Navigation Stability & Memory Leak Test ---');
  const leakTimes: number[] = [];
  const memoryGrowth: any[] = [];

  // Navigate rapidly back and forth 3 times across all routes
  for (let i = 0; i < 3; i++) {
    const cycleStart = Date.now();
    for (const route of routes) {
      await page.goto(route);
    }
    const cycleDuration = Date.now() - cycleStart;
    leakTimes.push(cycleDuration);

    const metrics = await page.evaluate(() => {
      const memory = (performance as any).memory;
      return {
        domNodes: document.getElementsByTagName('*').length,
        usedJSHeapSize: memory ? memory.usedJSHeapSize : null,
      };
    });
    memoryGrowth.push(metrics);
    console.log(`Fast navigation cycle ${i + 1} took ${cycleDuration}ms. Current DOM Nodes: ${metrics.domNodes}, Used JS Heap: ${metrics.usedJSHeapSize ? (metrics.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB' : 'N/A'}`);
  }

  // Output findings
  console.log('\n--- Speed Audit Results Summary ---');
  console.log(`Initial Load Time: ${initialLoadTime}ms`);
  console.log('Single Route Nav Times:', JSON.stringify(navigationTimes, null, 2));
  console.log('Memory growth snapshots:', JSON.stringify(memoryGrowth, null, 2));

  const slowRequests = requestLog.filter(r => r.duration > 150).sort((a, b) => b.duration - a.duration);
  if (slowRequests.length > 0) {
    console.log('\nSlow API / Network Requests (>150ms):');
    slowRequests.slice(0, 15).forEach(r => {
      console.log(`  - ${r.url}: ${r.duration}ms`);
    });
  }

  // "Failed to fetch" errors are in-flight requests aborted by this test's own
  // rapid back-to-back navigation, not real defects — drop them so the audit
  // only surfaces genuine console errors.
  const consoleErrors = consoleMessages.filter(
    m => m.type === 'error' && !/Failed to fetch/i.test(m.text),
  );
  if (consoleErrors.length > 0) {
    console.log('\nConsole Errors detected during audit:');
    consoleErrors.forEach(err => console.log(`  [Error] ${err.text}`));
  }

  // Basic assertions to ensure page is functional
  expect(initialLoadTime).toBeLessThan(5000);
});
