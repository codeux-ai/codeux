import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codeux-e2e-home-'));
const mockProviderCliPath = path.resolve(process.cwd(), 'scripts/e2e/mock-provider-cli.mjs');
const dashboardPort = Number.parseInt(
  process.env.CODEUX_E2E_DASHBOARD_PORT || process.env.DASHBOARD_PORT || '4464',
  10,
);
const resolvedDashboardPort = Number.isFinite(dashboardPort) ? dashboardPort : 4464;
const dashboardBaseUrl = `http://127.0.0.1:${resolvedDashboardPort}`;
const chromiumExecutablePath = (() => {
  if (process.platform !== 'linux' || !fs.existsSync('/ms-playwright')) {
    return undefined;
  }

  for (const browserDirectory of fs
    .readdirSync('/ms-playwright', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith('chromium_headless_shell-') || name.startsWith('chromium-'))
    .sort()) {
    const headlessShellPath = path.join('/ms-playwright', browserDirectory, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (fs.existsSync(headlessShellPath)) {
      return headlessShellPath;
    }

    const chromePath = path.join('/ms-playwright', browserDirectory, 'chrome-linux64', 'chrome');
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  return undefined;
})();

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  outputDir: 'test-results',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Keep browser tests serialized because they share one local server and DB. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: dashboardBaseUrl,
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,

    /* Preserve failure artifacts without producing heavy output for passing runs. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'navigation',
      testMatch: 'tests/e2e/navigation/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'settings',
      testMatch: 'tests/e2e/settings/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'projects',
      testMatch: 'tests/e2e/projects/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tasks',
      testMatch: 'tests/e2e/tasks/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'agents',
      testMatch: 'tests/e2e/agents/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'config',
      testMatch: 'tests/e2e/config/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    // Rebuild the dashboard with gated workspaces enabled so navigation specs
    // exercise the production route tree instead of depending on a caller's
    // previously built dashboard assets.
    command: 'pnpm exec vite build && node dist/index.js',
    // Poll the liveness probe (/health) rather than the readiness probe (/ready).
    // /ready only returns 200 once a project has a live-status timestamp, which
    // never happens in a clean CI checkout, so it would hang until timeout.
    url: `${dashboardBaseUrl}/health`,
    reuseExistingServer: false,
    // The feature-gated production dashboard build can exceed one minute on
    // resource-constrained CI runners before the health listener is available.
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XDG_CONFIG_HOME: path.join(tempHome, '.config'),
      XDG_DATA_HOME: path.join(tempHome, '.local', 'share'),
      CODE_UX_DIRECTORY_BROWSER_ROOTS: os.tmpdir(),
      CODEUX_E2E_PROVIDER_CLI_SHIM: mockProviderCliPath,
      DASHBOARD_PORT: String(resolvedDashboardPort),
      MCP_HTTP_PORT: String(resolvedDashboardPort + 1),
      // Browser E2E only needs the dashboard HTTP server. In particular, do not
      // let Playwright's inherited stdin pipe activate the MCP stdio lifecycle.
      CODE_UX_DISABLE_MCP_STDIO: '1',
      MCP_HTTP_ENABLED: 'false',
      CODE_UX_CONTAINERIZED_GIT: '0',
      CODE_UX_GIT_CONTAINER_MODE: 'host',
      VITE_CODEUX_FEATURE_NODES: 'true',
      VITE_CODEUX_NODE_FLOW_BACKEND: 'true',
      VITE_CODEUX_AUTOMATION_SECURITY: 'true',
      VITE_CODEUX_FEATURE_CUSTOM_DASHBOARDS: 'true',
    },
  },
});
